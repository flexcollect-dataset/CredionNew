// emailService.js
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { ClientSecretCredential } = require("@azure/identity");

// ---------- CONFIG ----------
const BUCKET_NAME = process.env.AWS_BUCKET_NAME || "credion-reports";
const REGION = process.env.AWS_REGION || "ap-southeast-2";
const TENANT_ID = process.env.TENANT_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SENDER_UPN = process.env.SENDER_UPN || process.env.EMAIL_USER || "accounts@credion.com.au";

// Basic validation up-front
for (const [key, val] of Object.entries({
  TENANT_ID, CLIENT_ID, CLIENT_SECRET, SENDER_UPN, BUCKET_NAME: BUCKET_NAME, REGION
})) {
  if (!val) {
    console.warn(`[emailService] Missing env var: ${key}`);
  }
}

// ---------- AWS S3 ----------
const s3Client = new S3Client({
  region: REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  } : undefined
});

// Stream -> Buffer helper
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Download one PDF from S3
async function downloadPDFFromS3(filename) {
  try {
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: filename });
    const res = await s3Client.send(command);
    const buffer = await streamToBuffer(res.Body);
    return {
      success: true,
      buffer,
      contentType: res.ContentType || "application/pdf",
      filename
    };
  } catch (err) {
    console.error("[emailService] Error downloading from S3:", filename, err);
    return { success: false, error: err.message, filename };
  }
}

// ---------- GRAPH AUTH ----------
const credential = new ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET);

// Get a bearer token for Microsoft Graph
async function getGraphToken() {
  // “.default” will use the app’s consented application permissions (Mail.Send)
  const scope = "https://graph.microsoft.com/.default";
  const token = await credential.getToken(scope);
  if (!token || !token.token) throw new Error("Failed to acquire Graph access token");
  return token.token;
}

// ---------- GRAPH SEND ----------
async function graphSendMail({ senderUpn, toEmail, subject, html, text, attachments }) {
  const accessToken = await getGraphToken();

  // Build Graph attachments
  const graphAttachments = (attachments || []).map(a => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: a.filename,
    contentType: a.contentType || "application/pdf",
    contentBytes: a.buffer.toString("base64")
  }));

  const body = {
    message: {
      subject,
      body: { contentType: "HTML", content: html || "<p>(no content)</p>" },
      toRecipients: [{ emailAddress: { address: toEmail } }],
      attachments: graphAttachments
    },
    saveToSentItems: true
  };

  const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderUpn)}/sendMail`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    const e = new Error(`Graph sendMail failed: ${resp.status} ${resp.statusText} ${errText}`);
    e.status = resp.status;
    throw e;
  }

  // sendMail returns 202 with no messageId in v1.0
  return { success: true };
}

// ---------- PUBLIC API ----------
/**
 * Send reports via Microsoft Graph
 * @param {string} toEmail - recipient
 * @param {Array<string>} pdfFilenames - S3 keys
 * @param {string} matterName - optional
 */
async function sendReports(toEmail, pdfFilenames, matterName) {
  try {
    if (!toEmail || !pdfFilenames?.length) {
      throw new Error("Email and PDF filenames are required");
    }

    console.log(`📧 Preparing to send ${pdfFilenames.length} report(s) to ${toEmail}`);

    // Download all PDFs from S3 (skip failures, but require at least one)
    const downloads = await Promise.all(pdfFilenames.map(downloadPDFFromS3));
    const attachments = downloads.filter(d => d.success).map(d => ({
      filename: d.filename,
      buffer: d.buffer,
      contentType: d.contentType
    }));

    const failed = downloads.filter(d => !d.success);
    for (const f of failed) {
      console.warn(`⚠️ Failed to download ${f.filename}: ${f.error}`);
    }
    if (!attachments.length) {
      throw new Error("No PDFs could be downloaded from S3");
    }

    const subject = `Credion Reports - ${attachments.length} Report(s)`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Credion Reports</h2>
        <p>Dear User,</p>
        <p>Please find attached ${attachments.length} report(s)${matterName ? ` for ${matterName}` : ""}.</p>
        <p>These reports have been generated and are ready for review.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #6b7280; font-size: 12px;">
          This is an automated email from Credion. Please do not reply to this email.
        </p>
      </div>
    `;
    const text = `Credion Reports

Please find attached ${attachments.length} report(s)${matterName ? ` for ${matterName}` : ""}.
These reports have been generated and are ready for review.`;

    const response = await graphSendMail({
      senderUpn: SENDER_UPN,
      toEmail,
      subject,
      html,
      text,
      attachments
    });

    console.log("✅ Email sent via Microsoft Graph");
    return {
      success: true,
      reportsSent: attachments.length,
      recipient: toEmail
    };
  } catch (error) {
    console.error("[emailService] Error sending email via Graph:", error);
    throw error;
  }
}

module.exports = {
  sendReports
};