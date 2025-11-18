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


// Proxy routes for bankruptcy and director-related endpoints
// Duplicate the actual implementation here to ensure ALB routing works
router.get('/bankruptcy/matches', async (req, res) => {
	try {
		const { firstName, lastName, dateOfBirth } = req.query;
		const { getToken } = require('./apiClients');
		const axios = require('axios');

		if (!lastName || typeof lastName !== 'string' || lastName.trim().length === 0) {
			return res.status(400).json({
				success: false,
				error: 'MISSING_SURNAME',
				message: 'Last name is required to search bankruptcy records',
				matches: []
			});
		}

		// Get dynamic token for Bankruptcy
		const bearerToken = await getToken('bankruptcy');
		
		const apiUrl = 'https://services.afsa.gov.au/brs/api/v2/search-by-name';
		const params = {
			debtorSurname: lastName.trim()
		};
		
		if (firstName && typeof firstName === 'string' && firstName.trim().length > 0) {
			params.debtorGivenName = firstName.trim();
		}
		
		if (dateOfBirth && typeof dateOfBirth === 'string' && dateOfBirth.trim().length > 0) {
			params.debtorDateOfBirth = dateOfBirth.trim();
		}

		const response = await axios.get(apiUrl, {
			params: params,
			headers: {
				'Authorization': `Bearer ${bearerToken}`,
				'Accept': 'application/json'
			},
			timeout: 30000
		});

		let matches = [];
		if (response.data) {
			if (Array.isArray(response.data.insolvencies)) {
				matches = response.data.insolvencies;
			} else if (Array.isArray(response.data)) {
				matches = response.data;
			} else if (Array.isArray(response.data?.results)) {
				matches = response.data.results;
			} else if (Array.isArray(response.data?.data)) {
				matches = response.data.data;
			} else if (response.data?.data && !Array.isArray(response.data.data)) {
				matches = [response.data.data];
			}
		}

		return res.json({
			success: true,
			matches: matches || []
		});
	} catch (error) {
		console.error('Error searching bankruptcy matches:', error?.response?.data || error.message);
		
		const status = error?.response?.status || 500;
		const message =
			error?.response?.data?.message ||
			error?.message ||
			'Failed to retrieve bankruptcy records';

		return res.status(status).json({
			success: false,
			error: 'BANKRUPTCY_SEARCH_FAILED',
			message,
			matches: []
		});
	}
});


module.exports = router;