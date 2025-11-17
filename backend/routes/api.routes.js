const express = require('express');
const router = express.Router();

// Example API endpoint
router.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Credion API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      api: '/api',
      auth: '/auth'
    }
  });
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Route diagnostic endpoint - check if new routes exist
router.get('/routes-check', (req, res) => {
  try {
    const paymentRoutes = require('./payment.routes');
    const routes = [];
    
    if (paymentRoutes.router) {
      paymentRoutes.router.stack.forEach((middleware) => {
        if (middleware.route) {
          routes.push({
            method: Object.keys(middleware.route.methods)[0].toUpperCase(),
            path: middleware.route.path
          });
        }
      });
    }
    
    const hasBankruptcy = routes.some(r => r.path === '/bankruptcy/matches');
    const hasDirectorRelated = routes.some(r => r.path === '/director-related/matches');
    const hasLandTitle = routes.some(r => r.path === '/land-title/counts');
    
    res.json({
      success: true,
      routesLoaded: routes.length,
      routes: routes,
      bankruptcyRoute: hasBankruptcy ? 'FOUND' : 'NOT FOUND',
      directorRelatedRoute: hasDirectorRelated ? 'FOUND' : 'NOT FOUND',
      landTitleRoute: hasLandTitle ? 'FOUND' : 'NOT FOUND',
      allRoutesWorking: hasBankruptcy && hasDirectorRelated && hasLandTitle
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Authentication routes are now in app.js directly
// Removed to prevent duplicate routes

// Search functionality moved to frontend - direct API calls to Australian Business Register

// Add more routes here as needed
// router.use('/users', require('./users.routes'));

module.exports = router;