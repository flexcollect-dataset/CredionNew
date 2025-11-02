const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { User, UserPaymentMethod, Report, ApiData } = require('../models');
const axios = require('axios');

// Middleware to check if user is authenticated
const authenticateSession = (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ 
            success: false, 
            error: 'UNAUTHORIZED',
            message: 'Please log in to continue' 
        });
    }
    next();
};

// Function to check if report data exists and is within 7 days

function delay(t) {
    return new Promise(resolve => setTimeout(resolve, t));
}



// Helper function to sanitize business number
function sanitizeBusinessNumber(input) {
    return input.replace(/\D/g, '');
}

// Helper function to search ABN by name using Australian Business Register API
async function searchABNByName(companyName) {
    const ABN_GUID = process.env.ABN_GUID || '250e9f55-f46e-4104-b0df-774fa28cff97';
    const url = `https://abr.business.gov.au/json/MatchingNames.aspx?name=${encodeURIComponent(companyName)}&maxResults=10&guid=${ABN_GUID}`;
    
    console.log(`🔍 Searching ABN for: ${companyName}`);
    
    try {
        const response = await axios.get(url);
        const text = response.data;
        
        // Extract JSON from JSONP response
        const match = text.match(/callback\((.*)\)/);
        if (!match) {
            throw new Error('Invalid ABN lookup response format');
        }
        
        const data = JSON.parse(match[1]);
        return data.Names || [];
    } catch (error) {
        console.error('Error searching ABN by name:', error);
        throw error;
    }
}

// Helper function to get ABN details
async function getABNInfo(abn) {
    const ABN_GUID = process.env.ABN_GUID || '250e9f55-f46e-4104-b0df-774fa28cff97';
    const url = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${abn}&callback=callback&guid=${ABN_GUID}`;
    
    console.log(`🔍 Getting ABN info for: ${abn}`);
    
    try {
        const response = await axios.get(url);
        const text = response.data;
        
        // Extract JSON from JSONP response
        const match = text.match(/callback\((.*)\)/);
        if (!match) {
            throw new Error('Invalid ABN lookup response format');
        }
        
        const data = JSON.parse(match[1]);
        return data;
    } catch (error) {
        console.error('Error fetching ABN info:', error);
        throw error;
    }
}

// Endpoint to search company by name or ABN
router.get('/search-company/:searchTerm', async (req, res) => {
    try {
        const { searchTerm } = req.params;
        const sanitized = sanitizeBusinessNumber(searchTerm);
        
        // Check if it's a number (ABN/ACN search)
        if (sanitized && sanitized.length >= 9) {
            console.log(`📊 Searching by ABN: ${sanitized}`);
            const abnInfo = await getABNInfo(sanitized);
            res.json({
                success: true,
                results: abnInfo ? [abnInfo] : []
            });
        } else {
            console.log(`📊 Searching by name: ${searchTerm}`);
            const results = await searchABNByName(searchTerm);
            res.json({
                success: true,
                results: results
            });
        }
    } catch (error) {
        console.error('Error searching company:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

async function checkExistingReportData(abn, type) {
    const existingReport = await ApiData.findOne({
        where: {
            abn: abn,
            rtype: type
        },
        order: [['created_at', 'DESC']]
    });
    return existingReport;
}

// Endpoint to get or create report data
router.post('/get-report-data', async (req, res) => {
    try {
        const { abn, type } = req.body;
        
        if (!abn || !type) {
            return res.status(400).json({
                success: false,
                error: 'ABN and type are required'
            });
        }
        
        // Call createReport - it will check if data exists internally
        // If exists: returns existing data
        // If not: fetches from API, stores, and returns data
        const business = { Abn: abn };
        await createReport({ business, type });
        
        // Fetch the data (either existing or newly created)
        const data = await checkExistingReportData(abn, type);
        
        if (data) {
            return res.json({
                success: true,
                available: true,
                data: {
                    createdAt: data.created_at,
                    rdata: data.rdata
                }
            });
        } else {
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch and store report data'
            });
        }
        
    } catch (error) {
        console.error('Error getting report data:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Function to create report via external API
async function createReport({ business, type }) {
    try {
        // Extract ABN from business data
        console.log(`🔍 BUSINESS DATA DEBUG:`);
        console.log(`   Full business object:`, JSON.stringify(business, null, 2));
        
        const abn = business?.Abn;
        const acn = abn.substring(2);
                console.log(acn)
        console.log(`   Extracted ABN: "${abn}"`);
        console.log(`   Report Type: "${type}"`);
        
        if (!abn) {
            throw new Error('ABN not found in business data');
        }
        
        if (type == "asic-current" || type == "court" || type == "ato") {
            existingReport = await checkExistingReportData(abn, "asic-current");
        } else {
            existingReport = await checkExistingReportData(abn, type);
        }



        console.log("========================");
        console.log(existingReport);
        console.log("========================");
        if (existingReport) {
            console.log(`✅ CACHE HIT: Found existing report in Reports table`);
            console.log(`   Report ID: ${existingReport.data}`);
            console.log(`   UUID: ${existingReport.uuid}`);
            console.log(`   Created: ${existingReport.created_at}`);
            
            // Fetch the report data from Alares API for parsing and storing
            reportData = existingReport.data;
        } else {
            if (type == "asic-current" || type == "court" || type == "ato") {
                const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
                const getApiUrl = `https://alares.com.au/api/reports/019a2e17-f011-7183-a3db-de2ef10aaebf/json`;

                console.log('Fetching report data from:', getApiUrl);

                const response = await axios.get(getApiUrl, {
                    headers: {
                        'Authorization': `Bearer ${bearerToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 second timeout
                });
                response.data.uuid = "019a2e17-f011-7183-a3db-de2ef10aaebf";
                reportData = response;
            } else if (type == "asic-historical") {
                const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
                const getApiUrl = `https://alares.com.au/api/reports/019a375e-b08e-7181-96b7-8ff9880c2e07/json`;

                console.log('Fetching report data from:', getApiUrl);

                const response = await axios.get(getApiUrl, {
                    headers: {
                        'Authorization': `Bearer ${bearerToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 second timeout
                });
                response.data.uuid = "019a375e-b08e-7181-96b7-8ff9880c2e07";
                reportData = response;
            } else if (type == "asic-company") {
                const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
                const getApiUrl = `https://alares.com.au/api/reports/019a375e-b08e-7181-96b7-8ff9880c2e07/json`;

                console.log('Fetching report data from:', getApiUrl);

                const response = await axios.get(getApiUrl, {
                    headers: {
                        'Authorization': `Bearer ${bearerToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 second timeout
                });
                response.data.uuid = "019a375e-b08e-7181-96b7-8ff9880c2e07";
                reportData = response;
            } else if (type == "ppsr") {
                const ppsrTokenn = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IkY2NThCODUzNDlCODc3MTVGOUM1QjI1ODgzNDcwNTVERjM5NTk1QjlSUzI1NiIsInR5cCI6ImF0K2p3dCIsIng1dCI6IjlsaTRVMG00ZHhYNXhiSllnMGNGWGZPVmxiayJ9.eyJuYmYiOjE3NjE5MTM5NDUsImV4cCI6MTc2MTkxNTc0NSwiaXNzIjoiaHR0cDovL2xvY2FsaG9zdDo2MTE5NyIsImF1ZCI6ImludGVncmF0aW9uLWFwaSIsImNsaWVudF9pZCI6ImZsZXhjb2xsZWN0LWFwaS1pbnRlZ3JhdGlvbi1wcm9kIiwiaWQiOiIxMDQyOCIsIm5hbWUiOiJmbGV4Y29sbGVjdC1hcGktaW50ZWdyYXRpb24tcHJvZCIsInN1YiI6IjZiNmI3MmRhLWMzMzMtNDVhNy1hNzI5LTA0ZWY2MWMwMzVkMSIsIm5pY2tuYW1lIjoiRmxleGNvbGxlY3QgSU5URUdSQVRJT04iLCJ1dWlkIjoiNmI2YjcyZGEtYzMzMy00NWE3LWE3MjktMDRlZjYxYzAzNWQxIiwianRpIjoiMTgxNzRFQzhFRUM5Qzk1MUZBQTAxRTgzRTRBREEyN0YiLCJpYXQiOjE3NjE5MTM5NDUsInNjb3BlIjpbInVzZXJhY2Nlc3MiLCJpbnRlZ3JhdGlvbmFjY2VzcyJdfQ.Qy3omALdsWtJv_XZCWZJKUqRJXaEWEsiOttRxDymvjAXz-afW89CD8U0dUdRxVc7VUi_aVtm-_1JGCZm3rkZqPvuYmLBeRo_ZYDJ6WgSUrHzKl3vsSK1QLhYo6pEdTnJE568mfwn74G7Jjh1rb88unh0YQUCfSb8vcDTk8A7kKaKY-EXIiPeiDumXhTV-q_d0NgjDZY8XfaBtZlH3TqSt2F4Us7HQ5_Jt8ygwlGcvae4bGe8V5MxAI-ViyVCuk46Scfis2wXP_ctgv9S8p63Gcu3xKeOlIa0XCgLz9jvPjiK3VId9NQzKlUcNcEIqf23IKR4vyyqWOZE9bozMRmCww';
                
                // Remove first 2 characters from ABN to get ACN
                
                // Step 1: Submit search request
                const submitUrl = 'https://uat-gateway.ppsrcloud.com/api/b2b/ausearch/submit-grantor-session-cmd';
                const requestData = {
                    customerRequestId: `flexcollect-001`,
                    clientReference: "Credion Company Search",
                    pointInTime: null,
                    criteria: [
                        {
                            grantorType: "organisation",
                            organisationNumberType: "acn",
                            organisationNumber: "146939013"
                        }
                    ]
                };

                // Step 1: Submit the search request
                const submitResponse = await axios.post(submitUrl, requestData, {
                    headers: {
                        'Authorization': `Bearer ${ppsrTokenn}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 second timeout
                });

                // Extract auSearchIdentifier from the response
                // The response contains ppsrCloudId which should be used as auSearchIdentifier
                const auSearchIdentifier = submitResponse.data.resource?.ppsrCloudId;
                
                if (!auSearchIdentifier) {
                    throw new Error('No auSearchIdentifier (ppsrCloudId) returned from PPSR submit request');
                }
                
                console.log('🔍 PPSR STEP 2 - Fetch Data:');
                console.log('   auSearchIdentifier:', auSearchIdentifier);
                
                await delay(3000);
                // Step 2: Fetch actual data using the auSearchIdentifier
                const fetchUrl = 'https://uat-gateway.ppsrcloud.com/api/b2b/ausearch/result-details';
                const fetchData = {
                    auSearchIdentifier: auSearchIdentifier,
                    pageNumber: 1,
                    pageSize: 50
                };

                console.log('   Fetch Data:', JSON.stringify(fetchData, null, 2));

                const response = await axios.post(fetchUrl, fetchData, {
                    headers: {
                        'Authorization': `Bearer ${ppsrTokenn}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 second timeout
                });
                response.data.uuid = auSearchIdentifier;
                reportData = response;
            } 

            const { sequelize } = require('../config/db');
            const [insertid] = await sequelize.query(`
                     INSERT INTO Api_Data (
                         rtype, uuid, search_word, abn, 
                         acn, rdata, alert, created_at, updated_at
                     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                     RETURNING id
                 `, {
                    bind: [
                        type,
                        reportData.data.uuid || null,
                        null,
                        abn || null,
                        acn || null,
                        JSON.stringify(reportData.data) || null,
                        false,
                    ]
                });
        }
        
        return {
            success: true
        };
        
    } catch (error) {
        console.error('Error creating report:', error);
        console.log("mital");
        if (error.response) {
            // API returned an error response
            throw new Error(`Report API error: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`);
        } else if (error.request) {
            // Request was made but no response received
            throw new Error('Report API request failed - no response received');
        } else {
            // Something else happened
            throw new Error(`rrrrrrReport creation failed: ${error.message}`);
        }
    }
}

// Get Stripe publishable key
router.get('/config', (req, res) => {
    res.json({
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
});

// Save card (create customer and attach payment method)
router.post('/save-card', authenticateSession, async (req, res) => {
    try {
        const { paymentMethodId, saveCard, setAsDefault } = req.body;
        const userId = req.session.userId;

        if (!paymentMethodId) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_PAYMENT_METHOD',
                message: 'Payment method ID is required'
            });
        }

        // Get user details
        const user = await User.findOne({ where: { userId } });
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'USER_NOT_FOUND',
                message: 'User not found'
            });
        }

        let customerId = null;
        let stripePaymentMethodId = paymentMethodId;

        // Only create customer and save card if user wants to save it
        if (saveCard) {
            // Check if user already has a Stripe customer ID
            const existingPaymentMethod = await UserPaymentMethod.findOne({
                where: { userId, isActive: true }
            });

            if (existingPaymentMethod && existingPaymentMethod.stripeCustomerId) {
                customerId = existingPaymentMethod.stripeCustomerId;
            } else {
                // Create Stripe customer
                const customer = await stripe.customers.create({
                    email: user.email,
                    name: `${user.firstName} ${user.lastName}`,
                    metadata: {
                        userId: userId.toString()
                    }
                });
                customerId = customer.id;
            }

            // Attach payment method to customer
            await stripe.paymentMethods.attach(paymentMethodId, {
                customer: customerId
            });

            // Set as default payment method for customer
            await stripe.customers.update(customerId, {
                invoice_settings: {
                    default_payment_method: paymentMethodId
                }
            });

            // Get payment method details
            const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

            // Deactivate previous default payment methods if this should be default
            if (setAsDefault) {
                await UserPaymentMethod.update(
                    { isDefault: false },
                    { where: { userId, isActive: true } }
                );
            }

            // Save payment method to database
            await UserPaymentMethod.create({
                userId,
                stripeCustomerId: customerId,
                stripePaymentMethodId: paymentMethodId,
                cardBrand: paymentMethod.card.brand,
                cardLast4: paymentMethod.card.last4,
                cardExpMonth: paymentMethod.card.exp_month,
                cardExpYear: paymentMethod.card.exp_year,
                isDefault: setAsDefault || false,
                isActive: true
            });
        }

        res.json({
            success: true,
            message: saveCard ? 'Payment method saved successfully' : 'Payment method verified successfully',
            customerId,
            paymentMethodId: stripePaymentMethodId
        });

    } catch (error) {
        console.error('Save card error:', error);
        
        // Handle Stripe-specific errors
        if (error.type === 'StripeCardError') {
            return res.status(400).json({
                success: false,
                error: 'CARD_ERROR',
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: 'Failed to save payment method',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get user's saved payment methods
router.get('/payment-methods', authenticateSession, async (req, res) => {
    try {
        const userId = req.session.userId;

        const paymentMethods = await UserPaymentMethod.findAll({
            where: { userId, isActive: true },
            order: [['isDefault', 'DESC'], ['createdAt', 'DESC']]
        });

        res.json({
            success: true,
            paymentMethods: paymentMethods.map(pm => ({
                paymentMethodId: pm.paymentMethodId,
                cardBrand: pm.cardBrand,
                cardLast4: pm.cardLast4,
                cardExpMonth: pm.cardExpMonth,
                cardExpYear: pm.cardExpYear,
                isDefault: pm.isDefault,
                createdAt: pm.createdAt
            }))
        });

    } catch (error) {
        console.error('Get payment methods error:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: 'Failed to retrieve payment methods'
        });
    }
});

// Set default payment method
router.put('/payment-methods/:id/set-default', authenticateSession, async (req, res) => {
    try {
        const userId = req.session.userId;
        const paymentMethodId = req.params.id;

        const paymentMethod = await UserPaymentMethod.findOne({
            where: { paymentMethodId, userId, isActive: true }
        });

        if (!paymentMethod) {
            return res.status(404).json({
                success: false,
                error: 'NOT_FOUND',
                message: 'Payment method not found'
            });
        }

        // Remove default from all other payment methods
        await UserPaymentMethod.update(
            { isDefault: false },
            { where: { userId, isActive: true } }
        );

        // Set this payment method as default
        await paymentMethod.update({ isDefault: true });

        // Update Stripe customer default payment method
        if (paymentMethod.stripeCustomerId && paymentMethod.stripePaymentMethodId) {
            try {
                await stripe.customers.update(paymentMethod.stripeCustomerId, {
                    invoice_settings: {
                        default_payment_method: paymentMethod.stripePaymentMethodId
                    }
                });
            } catch (stripeError) {
                console.error('Stripe update error:', stripeError);
                // Continue even if Stripe update fails
            }
        }

        res.json({
            success: true,
            message: 'Default payment method updated successfully'
        });

    } catch (error) {
        console.error('Set default payment method error:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: 'Failed to set default payment method'
        });
    }
});

// Delete a payment method
router.delete('/payment-methods/:id', authenticateSession, async (req, res) => {
    try {
        const userId = req.session.userId;
        const paymentMethodId = req.params.id;

        const paymentMethod = await UserPaymentMethod.findOne({
            where: { paymentMethodId, userId, isActive: true }
        });

        if (!paymentMethod) {
            return res.status(404).json({
                success: false,
                error: 'NOT_FOUND',
                message: 'Payment method not found'
            });
        }

        // Detach from Stripe
        if (paymentMethod.stripePaymentMethodId) {
            try {
                await stripe.paymentMethods.detach(paymentMethod.stripePaymentMethodId);
            } catch (stripeError) {
                console.error('Stripe detach error:', stripeError);
                // Continue even if Stripe detach fails
            }
        }

        // Mark as inactive in database
        await paymentMethod.update({ isActive: false });

        res.json({
            success: true,
            message: 'Payment method deleted successfully'
        });

    } catch (error) {
        console.error('Delete payment method error:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: 'Failed to delete payment method'
        });
    }
});



// Export functions for testing
module.exports = {
    router,
    createReport,
    checkExistingReportData
};

