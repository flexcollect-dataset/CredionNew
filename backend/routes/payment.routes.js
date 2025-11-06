const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { User, UserPaymentMethod, Report, ApiData } = require('../models');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const moment = require('moment');
const { uploadToS3 } = require('../services/s3.service');
const { replaceVariables, convertWithVariables, addDownloadReportInDB, ensureMediaDir, mediaDir } = require('../services/pdf.service');
const UserReport = require('../models/UserReport');
const { sequelize } = require('../config/db');
const { apiClients, getToken } = require("./apiClients.js");

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
        const business = { Abn: abn, isCompany: 'ORGANISATION' };
        const ispdfcreate = false;
        await createReport({ business, type, ispdfcreate, userId: null, matterId: null});
        
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

async function asic_report_data(uuid) {
    //Now call GET API to fetch the report data
    const getApiUrl = `https://alares.com.au/api/reports/${uuid}/json`;
    const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';

    const response = await axios.get(getApiUrl, {
        headers: {
            'Authorization': `Bearer ${bearerToken}`,
            'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
    });
    response.data.uuid = uuid;
    return response;
}

async function fetchPpsrReportData(auSearchIdentifier) {

    // Get dynamic token for PPSR
    const ppsrToken = await getToken('ppsr');
    await delay(3000);

    // Step 2: Fetch actual data using the auSearchIdentifier
    const fetchUrl = 'https://uat-gateway.ppsrcloud.com/api/b2b/ausearch/result-details';
    const fetchData = {
        auSearchIdentifier: auSearchIdentifier,
        pageNumber: 1,
        pageSize: 50
    };

    const response = await axios.post(fetchUrl, fetchData, {
        headers: {
            'Authorization': `Bearer ${ppsrToken}`,
            'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
    });
    
    // Set the appropriate field based on the report type
    response.data.uuid = auSearchIdentifier;
    return response;
}

async function director_ppsr_report(fname, lname, dob) {
    // Get dynamic token for PPSR
    const ppsrToken = await getToken('ppsr');
    
    // Convert dob to YYYY-MM-DD format
    let formattedDob = "1993-03-01"; // Default fallback
    if (dob) {
        try {
            // Try to parse the date with explicit format (DD/MM/YYYY is common)
            // Try multiple formats to handle different input formats
            let parsedDate;
            if (typeof dob === 'string') {
                // Try DD/MM/YYYY format first (most common based on error)
                if (dob.includes('/')) {
                    parsedDate = moment(dob, 'DD/MM/YYYY', true); // strict mode
                    if (!parsedDate.isValid()) {
                        // Try MM/DD/YYYY as fallback
                        parsedDate = moment(dob, 'MM/DD/YYYY', true);
                    }
                } else if (dob.includes('-')) {
                    // Already in ISO format or similar
                    parsedDate = moment(dob, ['YYYY-MM-DD', 'DD-MM-YYYY'], true);
                } else {
                    // Try moment's default parsing as last resort
                    parsedDate = moment(dob);
                }
            } else {
                // If it's already a Date object or moment object
                parsedDate = moment(dob);
            }
            
            if (parsedDate && parsedDate.isValid()) {
                formattedDob = parsedDate.format('YYYY-MM-DD');
            } else {
                console.warn('Invalid date format for dob:', dob);
            }
        } catch (error) {
            console.error('Error formatting date of birth:', error, 'dob:', dob);
            // If parsing fails, use default
        }
    }
    
    // Step 1: Submit search request
    const submitUrl = 'https://uat-gateway.ppsrcloud.com/api/b2b/ausearch/submit-grantor-session-cmd';
    const requestData = {
        customerRequestId: `flexcollect-001`,
        clientReference: "Credion Company Search",
        pointInTime: null,
        criteria: [
            {
                grantorType: "individual",
                individualDateOfBirth: formattedDob,
                individualFamilyName: lname,
                individualGivenNames: fname,
                acceptIndividualGrantorSearchDeclaration: true,
            }
        ]
    };

    // Step 1: Submit the search request
    const submitResponse = await axios.post(submitUrl, requestData, {
        headers: {
            'Authorization': `Bearer ${ppsrToken}`,
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
    
    // Step 2: Fetch actual data using the auSearchIdentifier
    return await fetchPpsrReportData(auSearchIdentifier);
}

async function director_bankrupcty_report(fname, lname, dob) {
    // Get dynamic token for Bankruptcy
    const bearerToken = await getToken('bankruptcy');
    console.log(bearerToken);
    const apiUrl = 'https://services.afsa.gov.au/brs/api/v2/search-by-name';
    const params = {
        debtorSurname: lname,
        debtorGivenName: fname,
    };
    const response = await axios.get(apiUrl, {
        params: params,
        headers: {
            'Authorization': `Bearer ${bearerToken}`
        },
        Accept: 'application/json',
        responseType: 'json',
        timeout: 30000 // 30 second timeout
    });
    // console.log('Report creation API response:', createResponse.data);
    response.data.uuid = response.data.insolvencySearchId;
    return response;
}

async function director_related_report( fname, lname, dob ) {
    const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
    // const bapiURL = 'https://alares.com.au/api/asic/search'
    // const bparams = {
    //     first_name: "jon",
    //     last_name: "adgemis",
    //     dob_from: '24-04-1978',
    // };
    // bcreateResponse = await axios.get(bapiURL, {
    //     params: bparams,
    //     headers: {
    //         'Authorization': `Bearer ${bearerToken}`
    //     },
    //     timeout: 30000 // 30 second timeout
    // });
    
    // const apiUrl = 'https://alares.com.au/api/reports/create';
    // const params = {
    //     type: 'individual',
    //     name: "jon adgemis",
    //     dob: '24-04-1978',
    //     asic_current: '1',
    //     person_id: bcreateResponse.data[0].person_id,
    //     acs_search_id: bcreateResponse.data[0].search_id
    // };
    // createResponse = await axios.post(apiUrl, null, {
    //     params: params,
    //     headers: {
    //         'Authorization': `Bearer ${bearerToken}`,
    //         'Content-Type': 'application/json'
    //     },
    //     timeout: 30000 // 30 second timeout
    // });
    //reportData = await asic_report_data(createResponse.data.uuid);
    reportData = await asic_report_data('019a53e1-b608-723a-9398-6562a6c50303');
    return reportData; 
}

// Function to create report via external API
async function createReport({ business, type, userId, matterId, ispdfcreate }) {
    try {
        let existingReport = null;
        let iresult = null;
        let reportId = null;
        let reportData = null;
        let pdffilename = null;
        if(business?.isCompany == "ORGANISATION") {
            abn = business?.Abn;
            acn = abn.substring(2);
            if (!abn) {
                throw new Error('ABN not found in business data');
            }
        }

        if(business?.isCompany == "ORGANISATION") {
            if (type == "asic-current" || type == "court" || type == "ato") {
                existingReport = await checkExistingReportData(abn, "asic-current");
            } else {
                existingReport = await checkExistingReportData(abn, type);
            }
        }
        
        if (existingReport) {
            // Fetch the report data from Alares API for parsing and storing
            reportId = existingReport.id;
            // If rdata is already an object, wrap it in { data: ... } format
            const rdataObj = typeof existingReport.rdata === 'string' 
                ? JSON.parse(existingReport.rdata) 
                : existingReport.rdata;
            
            reportData = {
                data: rdataObj
            };


        } else {
            if( type == "asic-current" || type == "court" || type == "ato" ) {
                // const apiUrl = 'https://alares.com.au/api/reports/create';
                // const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
                // const params = {
                //     type: 'company',
                //     abn: abn,
                //     asic_current: '1'
                // };
                // createResponse = await axios.post(apiUrl, null, {
                //     params: params,
                //     headers: {
                //         'Authorization': `Bearer ${bearerToken}`,
                //         'Content-Type': 'application/json'
                //     },
                //     timeout: 30000 // 30 second timeout
                // });

                // Now call GET API to fetch the report data
                reportData = await asic_report_data('019a5245-a55e-71e0-b61d-711411a81b5e');

            } else if ( type == "asic-historical" ) {

                // const apiUrl = 'https://alares.com.au/api/reports/create';
                // const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
                // const params = {
                //     type: 'company',
                //     abn: abn,
                //     asic_historical: '1'
                // };
                // createResponse = await axios.post(apiUrl, null, {
                //     params: params,
                //     headers: {
                //         'Authorization': `Bearer ${bearerToken}`,
                //         'Content-Type': 'application/json'
                //     },
                //     timeout: 30000 // 30 second timeout
                // });

                // Now call GET API to fetch the report data
                reportData = await asic_report_data('019a2349-f1c5-738a-b306-950e842370d3');

            } else if ( type == "asic-company" ) {
                // const apiUrl = 'https://alares.com.au/api/reports/create';
                // const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
                // const params = {
                //     type: 'company',
                //     abn: abn,
                //     asic_relational: '1'
                // };
                // createResponse = await axios.post(apiUrl, null, {
                //     params: params,
                //     headers: {
                //         'Authorization': `Bearer ${bearerToken}`,
                //         'Content-Type': 'application/json'
                //     },
                //     timeout: 30000 // 30 second timeout
                // });

                // Now call GET API to fetch the report data
                //reportData = await asic_report_data(createResponse.data.uuid);
                reportData = await asic_report_data('019a375e-b08e-7181-96b7-8ff9880c2e07')
            } else if ( type == "ppsr" ){
                // Get dynamic token for PPSR
                const ppsrToken = await getToken('ppsr');
                
                // Step 1: Submit search request
                const submitUrl = 'https://uat-gateway.ppsrcloud.com/api/b2b/ausearch/submit-grantor-session-cmd';
                const requestData = {
                    customerRequestId: "flexcollect-001",
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

                const submitResponse = await axios.post(submitUrl, requestData, {
                    headers: {
                        'Authorization': `Bearer ${ppsrToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 second timeout
                });

                // Extract auSearchIdentifier from the response
                const auSearchIdentifier = submitResponse.data.resource?.ppsrCloudId;
                if (!auSearchIdentifier) {
                    throw new Error('No auSearchIdentifier (ppsrCloudId) returned from PPSR submit request');
                }
                
                // Step 2: Fetch actual data using the auSearchIdentifier
                reportData = await fetchPpsrReportData(auSearchIdentifier);
                console.log(reportData);
            } else if ( type == "director-ppsr" ){
                reportData = await director_ppsr_report(business.fname, business.lname, business.dob);
            } else if ( type == "director-bankruptcy" ){
                reportData = await director_bankrupcty_report(business.fname, business.lname, business.dob);
            } else if ( type == "director-related" ){
                reportData = await director_related_report(business.fname, business.lname, business.dob);
            }  
            // Ensure reportData has the correct structure
            const reportDataForDb = reportData.data || reportData;
            const uuid = reportDataForDb.uuid || reportDataForDb.ppsrCloudId || reportDataForDb.insolvencySearchId || null;
            if (!existingReport && reportData) {
                if(business?.isCompany == "ORGANISATION") {
                    [iresult] = await sequelize.query(`
                        INSERT INTO api_data ( rtype, uuid, search_word, abn, acn, rdata, alert, created_at, updated_at ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING id`, 
                        {
                            bind: [
                                type,
                                uuid,
                                null,
                                abn,
                                acn,
                                JSON.stringify(reportDataForDb) || null,
                                false,
                            ]
                        }
                    );
                }else{
                    [iresult] = await sequelize.query(`
                        INSERT INTO api_data ( rtype, uuid, search_word, abn, acn, rdata, alert, created_at, updated_at ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING id`, 
                        {
                            bind: [
                                type,
                                uuid,
                                null,
                                null,
                                null,
                                JSON.stringify(reportDataForDb) || null,
                                false,
                            ]
                        }
                    );
                }
            }
            reportId = iresult[0].id;
        }
        
        // Validate reportData before proceeding
        if (!reportData) {
            throw new Error('Report data is missing. Failed to fetch or retrieve report data.');
        }
        
        // Ensure reportData has the correct structure for addDownloadReportInDB
        // It expects either { data: ... } or the data object directly
        if (!reportData.data && typeof reportData === 'object') {
            reportData = { data: reportData };
        }
        
        if(ispdfcreate) {
            pdffilename = await addDownloadReportInDB( reportData, userId , matterId, reportId, `${uuidv4()}`, type );
            return pdffilename;
        }else {
            return {
                success: true
            }
        }
        
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
    checkExistingReportData,
    addDownloadReportInDB

};