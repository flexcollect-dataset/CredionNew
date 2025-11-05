const nodemailer = require('nodemailer');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

// S3 Client for downloading PDFs
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-southeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME || 'credion-reports';

// Create reusable transporter object using Office 365 SMTP
// IMPORTANT: Office 365 requires an App Password (not regular password) when security defaults are enabled
// To generate an App Password:
// 1. Go to https://mysignins.microsoft.com/security-info
// 2. Click "Create app password" or "Add method" > "App password"
// 3. Copy the generated password and use it in EMAIL_PASSWORD environment variable
const transporter = nodemailer.createTransport({
  host: 'smtp.office365.com',
  port: 587,
  secure: false, // true for 465, false for other ports (587 uses STARTTLS)
  auth: {
    user: process.env.EMAIL_USER || 'accounts@credion.com.au',
    pass: process.env.EMAIL_PASSWORD || 'FlexCollect1!' // Use App Password here
  },
  tls: {
    ciphers: 'TLSv1.2',
    rejectUnauthorized: true // Keep true for production security
  },
  requireTLS: true,
  debug: process.env.NODE_ENV === 'development' // Enable debug in development
});

// Verify transporter configuration
transporter.verify(function (error, success) {
  if (error) {
    console.error('Email transporter verification failed:', error);
  } else {
    console.log('✅ Email server is ready to send messages');
  }
});

/**
 * Download PDF from S3
 */
async function downloadPDFFromS3(filename) {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: filename
    });

    const response = await s3Client.send(command);
    
    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    return {
      success: true,
      buffer: buffer,
      contentType: response.ContentType || 'application/pdf'
    };
  } catch (error) {
    console.error('Error downloading PDF from S3:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Send reports via email
 * @param {string} toEmail - Recipient email address
 * @param {Array<string>} pdfFilenames - Array of PDF filenames in S3
 * @param {string} matterName - Optional matter name
 */
async function sendReports(toEmail, pdfFilenames, matterName = 'Matter') {
  try {
    if (!toEmail || !pdfFilenames || pdfFilenames.length === 0) {
      throw new Error('Email and PDF filenames are required');
    }

    console.log(`📧 Preparing to send ${pdfFilenames.length} report(s) to ${toEmail}`);

    // Download all PDFs from S3
    const attachments = [];
    for (const filename of pdfFilenames) {
      console.log(`📥 Downloading ${filename} from S3...`);
      const pdfResult = await downloadPDFFromS3(filename);
      
      if (!pdfResult.success) {
        console.error(`⚠️ Failed to download ${filename}:`, pdfResult.error);
        continue; // Skip this file but continue with others
      }

      attachments.push({
        filename: filename,
        content: pdfResult.buffer,
        contentType: pdfResult.contentType
      });
    }

    if (attachments.length === 0) {
      throw new Error('No PDFs could be downloaded from S3');
    }

    // Email content
    const fromEmail = process.env.EMAIL_USER || 'accounts@credion.com.au';
    const mailOptions = {
      from: `"Credion" <${fromEmail}>`,
      to: toEmail,
      subject: `Credion Reports - ${attachments.length} Report(s)`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc2626;">Credion Reports</h2>
          <p>Dear User,</p>
          <p>Please find attached ${attachments.length} report(s)${matterName ? ` for ${matterName}` : ''}.</p>
          <p>These reports have been generated and are ready for review.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #6b7280; font-size: 12px;">
            This is an automated email from Credion. Please do not reply to this email.
          </p>
        </div>
      `,
      text: `Credion Reports\n\nPlease find attached ${attachments.length} report(s)${matterName ? ` for ${matterName}` : ''}.\n\nThese reports have been generated and are ready for review.`,
      attachments: attachments
    };

    // Send email
    console.log(`📤 Sending email to ${toEmail}...`);
    const info = await transporter.sendMail(mailOptions);

    console.log(`✅ Email sent successfully! Message ID: ${info.messageId}`);

    return {
      success: true,
      messageId: info.messageId,
      reportsSent: attachments.length,
      recipient: toEmail
    };

  } catch (error) {
    console.error('Error sending email:', error);
    
    // Provide helpful error messages for common Office 365 issues
    if (error.responseCode === 535 || error.message?.includes('535')) {
      const helpfulError = new Error(
        'Office 365 authentication failed. Please use an App Password instead of your regular password. ' +
        'Generate one at https://mysignins.microsoft.com/security-info and set it in the EMAIL_PASSWORD environment variable.'
      );
      helpfulError.originalError = error;
      throw helpfulError;
    }
    
    if (error.responseCode === 454 || error.message?.includes('454')) {
      const helpfulError = new Error(
        'Office 365 requires STARTTLS. Please check your SMTP configuration.'
      );
      helpfulError.originalError = error;
      throw helpfulError;
    }
    
    throw error;
  }
}

module.exports = {
  sendReports,
  transporter
};

