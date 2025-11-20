require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const session = require('express-session');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { testConnection } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3001;
const sanitizeBaseUrl = (url) => (url ? url.replace(/\/$/, '') : '');
const FRONTEND_BASE_URL = sanitizeBaseUrl(process.env.FRONTEND_APP_URL || process.env.FRONTEND_URL || '');

// Allow all origins in production if CORS_ORIGINS is not set, or allow specific origins
const defaultOrigins = process.env.NODE_ENV === 'production' 
  ? ['http://localhost:5173', 'https://credion.com.au', 'https://flexcollect.com.au', 'https://www.flexcollect.com.au', 'https://credion.netlify.app', 'https://credion-reports.netlify.app', 'https://*.netlify.app']
  : ['http://localhost:5173'];

const allowedOrigins = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || defaultOrigins.join(','))
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

// For Netlify subdomains, allow any netlify.app domain
const isNetlifyOrigin = (origin) => {
  return origin && (
    origin.includes('netlify.app') || 
    origin.includes('credion.com.au') ||
    origin.includes('flexcollect.com.au') ||
    allowedOrigins.includes(origin)
  );
};

app.use((req, res, next) => {
  console.log('[INCOMING]', req.method, req.originalUrl);
  next();
});


app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }
    // Allow if in allowedOrigins list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Allow Netlify domains
    if (isNetlifyOrigin(origin)) {
      return callback(null, true);
    }
    // Allow in development
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    console.log('CORS blocked origin:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  exposedHeaders: ['Content-Disposition']
}));

app.options('*', cors({
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    if (isNetlifyOrigin(origin)) {
      return callback(null, true);
    }
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com"],
      frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"],
      connectSrc: ["'self'", "https://api.stripe.com"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Credion API Server',
    status: 'running',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Matter Routes
const matterRoutes = require('./routes/matter.routes');
app.use('/api/matters', matterRoutes);

// Import models
const { User, UserPaymentMethod, Matter } = require('./models');

// Payment Methods API Routes
// POST /payment-methods - Add new payment method
app.post('/payment-methods', async (req, res) => {
  try {
    const { stripePaymentMethodId, cardholderName, userId, isDefault } = req.body;

    // Basic validation
    if (!stripePaymentMethodId || !cardholderName || !userId) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Stripe payment method ID, cardholder name, and user ID are required'
      });
    }

    try {
      // Retrieve the payment method from Stripe to get card details
      const paymentMethod = await stripe.paymentMethods.retrieve(stripePaymentMethodId);
      
      if (!paymentMethod || !paymentMethod.card) {
        return res.status(400).json({
          error: 'PAYMENT_ERROR',
          message: 'Invalid payment method'
        });
      }

      // Save to database
      const newPaymentMethod = await UserPaymentMethod.create({
        userId: userId,
        stripePaymentMethodId: paymentMethod.id,
        cardBrand: paymentMethod.card.brand,
        cardLast4: paymentMethod.card.last4,
        cardExpMonth: paymentMethod.card.exp_month,
        cardExpYear: paymentMethod.card.exp_year,
        isDefault: isDefault || false,
        isActive: true
      });

      // If this is the first payment method or marked as default, set it as default
      if (isDefault || !await UserPaymentMethod.findOne({ where: { userId, isDefault: true } })) {
        await UserPaymentMethod.update(
          { isDefault: false },
          { where: { userId } }
        );
        await UserPaymentMethod.update(
          { isDefault: true },
          { where: { paymentMethodId: newPaymentMethod.paymentMethodId } }
        );
      }

      res.status(201).json({
        success: true,
        message: 'Payment method added successfully',
        paymentMethod: {
          id: paymentMethod.id,
          last4: paymentMethod.card.last4,
          brand: paymentMethod.card.brand,
          expiryMonth: paymentMethod.card.exp_month,
          expiryYear: paymentMethod.card.exp_year,
          cardholderName,
          isDefault: isDefault || false
        }
      });

    } catch (error) {
      console.error('Payment method creation error:', error);
      res.status(400).json({
        error: 'PAYMENT_ERROR',
        message: 'Invalid payment method details'
      });
    }

  } catch (error) {
    console.error('Add payment method error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An error occurred while adding payment method'
    });
  }
});

// GET /payment-methods - Get user's payment methods
app.get('/payment-methods', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'User ID is required'
      });
    }

    // Fetch from database using Sequelize
    const paymentMethods = await UserPaymentMethod.findAll({
      where: {
        userId: userId,
        isActive: true
      },
      order: [['isDefault', 'DESC'], ['createdAt', 'DESC']]
    });
    
    // Transform the data to match frontend expectations
    const formattedPaymentMethods = paymentMethods.map(method => ({
      id: method.stripePaymentMethodId || method.paymentMethodId,
      last4: method.cardLast4,
      brand: method.cardBrand,
      expiryMonth: method.cardExpMonth,
      expiryYear: method.cardExpYear,
      isDefault: method.isDefault,
      cardholderName: 'Card Holder' // We don't store this in the current schema
    }));

    res.json({
      success: true,
      paymentMethods: formattedPaymentMethods
    });

  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An error occurred while fetching payment methods'
    });
  }
});

// PUT /payment-methods/:id/set-default - Set default payment method
app.put('/payment-methods/:id/set-default', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'User ID is required'
      });
    }

    // First, unset all default payment methods for this user
    await UserPaymentMethod.update(
      { isDefault: false },
      { where: { userId: userId } }
    );

    // Then set the specified payment method as default
    const [updatedRows] = await UserPaymentMethod.update(
      { isDefault: true },
      { 
        where: { 
          stripePaymentMethodId: id,
          userId: userId 
        },
        returning: true
      }
    );

    if (updatedRows === 0) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Payment method not found'
      });
    }

    res.json({
      success: true,
      message: 'Default payment method updated'
    });

  } catch (error) {
    console.error('Set default payment method error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An error occurred while updating default payment method'
    });
  }
});

// DELETE /payment-methods/:id - Delete payment method
app.delete('/payment-methods/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'User ID is required'
      });
    }

    // Find the payment method first
    const paymentMethod = await UserPaymentMethod.findOne({
      where: { 
        stripePaymentMethodId: id,
        userId: userId,
        isActive: true
      }
    });

    if (!paymentMethod) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Payment method not found'
      });
    }

    // Detach payment method from Stripe (this removes it from customer)
    try {
      await stripe.paymentMethods.detach(id);
    } catch (stripeError) {
      console.error('Stripe detach error:', stripeError);
      // Continue with database deletion even if Stripe fails
    }

    // Soft delete from database (set is_active = false)
    await UserPaymentMethod.update(
      { isActive: false },
      { 
        where: { 
          stripePaymentMethodId: id,
          userId: userId 
        }
      }
    );

    res.json({
      success: true,
      message: 'Payment method deleted successfully'
    });

  } catch (error) {
    console.error('Delete payment method error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An error occurred while deleting payment method'
    });
  }
});

// Authentication Routes (PostgreSQL)
const authRoutes = require('./routes/auth.postgres');
app.use('/auth', authRoutes);

const buildFrontendUrl = (explicitUrl, pathSuffix) => {
  if (explicitUrl) {
    return explicitUrl;
  }
  if (FRONTEND_BASE_URL) {
    return `${FRONTEND_BASE_URL}${pathSuffix}`;
  }
  return '/';
};

// Card Details route - redirect to frontend
app.get('/card-details', (req, res) => {
  const target = buildFrontendUrl(process.env.FRONTEND_CARD_DETAILS_URL, '/card-details');
  res.redirect(target);
});

// Payment Methods Management route - redirect to frontend
app.get('/payment-methods-page', (req, res) => {
  const target = buildFrontendUrl(process.env.FRONTEND_PAYMENT_METHODS_URL, '/payment-methods');
  res.redirect(target);
});

// Search route - redirect to frontend
app.get('/search', (req, res) => {
  const target = buildFrontendUrl(process.env.FRONTEND_SEARCH_URL, '/search');
  res.redirect(target);
});

// Payment Routes
const paymentRoutes = require('./routes/payment.routes');

// Report Creation endpoint (without payment) - MUST be before API routes to avoid conflicts
app.post('/api/create-report', async (req, res) => {
  try {
    const { business, type, userId, matterId, ispdfcreate } = req.body;

    if (!business || !type || !userId) {
      return res.status(400).json({
        error: 'MISSING_PARAMETERS',
        message: 'business, type, and userId are required'
      });
    }

    // Extract ABN for validation
    const abn = business?.Abn || business?.abn || business?.ABN;
    if(business?.isCompany == "ORGANISATION") {
      if (!abn) {
        return res.status(400).json({
          error: 'ABN_NOT_FOUND',
          message: 'ABN not found in business data'
        });
      }
    }

    // Import the createReport function from payment routes
    const { createReport } = require('./routes/payment.routes');
    
    // Call the createReport function (it will handle cache checking internally)
    const reportResponse = await createReport({
      business,
      type,
      userId,
      matterId,
      ispdfcreate
    });

    res.json({
      success: true,
      message: 'Report created successfully',
      report: reportResponse
    });

  } catch (error) {
    console.error('Error creating report:', error);
    res.status(500).json({
      error: 'REPORT_CREATION_FAILED',
      message: error.message || 'Failed to create report'
    });
  }
});

// Now mount payment routes - MUST be before other /api routes
// Mount at /api first to ensure bankruptcy, director-related, and land-title routes are accessible
app.use('/api', paymentRoutes.router);
app.use('/api/payment', paymentRoutes.router);

// Email Service
const emailService = require('./services/email.service');

// Send Reports via Email endpoint
app.post('/api/send-reports', async (req, res) => {
  try {
    const { email, pdfFilenames, matterName } = req.body;

    if (!email || !pdfFilenames || !Array.isArray(pdfFilenames) || pdfFilenames.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_PARAMETERS',
        message: 'Email and PDF filenames array are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_EMAIL',
        message: 'Please provide a valid email address'
      });
    }

    console.log(`📧 Email request received: ${email}, ${pdfFilenames.length} report(s)`);

    // Send reports via email
    const result = await emailService.sendReports(email, pdfFilenames, matterName || 'Matter');

    res.json({
      success: true,
      message: `Reports sent successfully to ${email}`,
      reportsSent: result.reportsSent,
      messageId: result.messageId,
      recipient: result.recipient
    });

  } catch (error) {
    console.error('Error sending reports:', error);
    res.status(500).json({
      success: false,
      error: 'EMAIL_SENDING_FAILED',
      message: error.message || 'Failed to send reports'
    });
  }
});

// General API Routes - Mount AFTER payment routes to avoid conflicts
// Mount at /api/general to avoid conflicts with payment routes
const apiRoutes = require('./routes/api.routes');
app.use('/api/general', apiRoutes);
// Also mount at /api for backward compatibility, but after payment routes
app.use('/api', apiRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'NOT_FOUND',
    message: 'API endpoint not found' 
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Credion server is running on http://localhost:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Test database connection
  await testConnection();
});

module.exports = app;
