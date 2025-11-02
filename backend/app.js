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

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
  exposedHeaders: ['Content-Disposition']
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

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

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

// Card Details route (requires authentication)
app.get('/card-details', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.redirect('/auth/login');
    }
    
    // Get user details
    const user = await User.findByPk(req.session.userId, {
      attributes: ['userId', 'firstName', 'lastName', 'email', 'isActive', 'currentPlan']
    });
    
    if (!user || !user.isActive) {
      req.session.destroy();
      return res.redirect('/auth/login');
    }
    
    res.render('card-details', { 
      title: 'Add Payment Method - Credion',
      userId: user.userId,
      userEmail: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      appName: process.env.APP_NAME || 'Credion'
    });
  } catch (error) {
    console.error('Error rendering card details page:', error);
    res.redirect('/auth/login');
  }
});

// Payment Methods Management route (requires authentication)
app.get('/payment-methods-page', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.redirect('/auth/login');
    }
    
    // Get user details
    const user = await User.findByPk(req.session.userId, {
      attributes: ['userId', 'firstName', 'lastName', 'email', 'isActive']
    });
    
    if (!user || !user.isActive) {
      req.session.destroy();
      return res.redirect('/auth/login');
    }
    
    res.render('payment-methods', { 
      title: 'Payment Methods - Credion',
      userId: user.userId,
      userEmail: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      appName: process.env.APP_NAME || 'Credion'
    });
  } catch (error) {
    console.error('Error rendering payment methods page:', error);
    res.redirect('/auth/login');
  }
});

// Search route (requires authentication)
app.get('/search', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.redirect('/auth/login');
    }
    
    // Get user details
    const user = await User.findByPk(req.session.userId, {
      attributes: ['userId', 'firstName', 'lastName', 'email', 'isActive']
    });
    
    if (!user || !user.isActive) {
      req.session.destroy();
      return res.redirect('/auth/login');
    }
    
    res.render('search', { 
      title: 'Search - Credion',
      user: {
        userId: user.userId,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email
      },
      appName: process.env.APP_NAME || 'Credion'
    });
  } catch (error) {
    console.error('Error rendering search page:', error);
    res.redirect('/auth/login');
  }
});

// Payment Routes
const paymentRoutes = require('./routes/payment.routes');

// Report Creation endpoint (without payment) - MUST be before API routes to avoid conflicts
app.post('/api/create-report', async (req, res) => {
  try {
    const { business, type, userId, matterId } = req.body;

    if (!business || !type || !userId) {
      return res.status(400).json({
        error: 'MISSING_PARAMETERS',
        message: 'business, type, and userId are required'
      });
    }

    // Extract ABN for validation
    const abn = business?.Abn || business?.abn || business?.ABN;
    
    if (!abn) {
      return res.status(400).json({
        error: 'ABN_NOT_FOUND',
        message: 'ABN not found in business data'
      });
    }

    // Import the createReport function from payment routes
    const { createReport } = require('./routes/payment.routes');
    
    // Call the createReport function (it will handle cache checking internally)
    const reportResponse = await createReport({
      business,
      type
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

// Now mount payment routes
app.use('/api/payment', paymentRoutes.router);
app.use('/api', paymentRoutes.router); // Mount at /api for check-data endpoint

// General API Routes
const apiRoutes = require('./routes/api.routes');
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
