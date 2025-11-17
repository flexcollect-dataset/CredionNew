// Quick test script to verify routes are loaded
const express = require('express');
const paymentRoutes = require('./routes/payment.routes');

const app = express();

// Mount routes the same way as app.js
app.use('/api/payment', paymentRoutes.router);
app.use('/api', paymentRoutes.router);

// Test route registration
const routes = [];
paymentRoutes.router.stack.forEach((middleware) => {
  if (middleware.route) {
    routes.push({
      path: middleware.route.path,
      methods: Object.keys(middleware.route.methods)
    });
  }
});

console.log('✅ Routes loaded in payment.routes.js:');
console.log('=====================================');
routes.forEach(route => {
  console.log(`${route.methods.join(', ').toUpperCase().padEnd(8)} /api${route.path}`);
});

// Check for specific routes
const hasBankruptcy = routes.some(r => r.path === '/bankruptcy/matches');
const hasDirectorRelated = routes.some(r => r.path === '/director-related/matches');
const hasLandTitle = routes.some(r => r.path === '/land-title/counts');

console.log('\n🔍 Route Check:');
console.log(`  /api/bankruptcy/matches: ${hasBankruptcy ? '✅ FOUND' : '❌ NOT FOUND'}`);
console.log(`  /api/director-related/matches: ${hasDirectorRelated ? '✅ FOUND' : '❌ NOT FOUND'}`);
console.log(`  /api/land-title/counts: ${hasLandTitle ? '✅ FOUND' : '❌ NOT FOUND'}`);

process.exit(hasBankruptcy && hasDirectorRelated && hasLandTitle ? 0 : 1);

