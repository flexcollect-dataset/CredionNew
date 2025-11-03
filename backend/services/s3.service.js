const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Configure AWS S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

// S3 Upload function for PDF
const uploadToS3 = async (fileBuffer, filename, contentType = 'application/pdf') => {
  try {
    const params = {
      Bucket: BUCKET_NAME,
      Key: `${filename}`,
      Body: fileBuffer,
      ContentType: contentType,
      Metadata: {
        'uploaded-by': 'pdf-generation-api',
        'generated-at': new Date().toISOString()
      }
    };

    const command = new PutObjectCommand(params);
    const result = await s3Client.send(command);
    
    return {
      success: true,
      key: params.Key,
      location: `https://${BUCKET_NAME}.${process.env.AWS_REGION}.amazonaws.com/${params.Key}`,
      etag: result.ETag
    };
  } catch (error) {
    console.error('Error uploading to S3:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  uploadToS3,
  s3Client
};

