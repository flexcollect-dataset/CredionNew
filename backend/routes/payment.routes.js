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
        ispdfcreate = false;
        await createReport({ business, type, ispdfcreate});
        
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


router.post('/convert-with-variables', async (req, res) => {
  try {
    const templateName = 'task1.html'; // This was a placeholder, now dynamically determined in pdf.service.js
    const data = req.body;
    console.log("************************************************")
    console.log(data?.reportype);

    if (!data) {
      return res.status(400).json({
        success: false,
        error: 'Data is required'
      });
    }

    // Use the service to convert with variables
    const result = await convertWithVariables(data, templateName); // templateName is now passed but largely ignored in favor of reportype

    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(data.rdata?.current_tax_debt?.amount);

    // Return success response with both local and S3 URLs
    res.json({
      success: true,
      message: 'PDF generated and uploaded to S3 successfully',
      filename: result.pdfFilename,
      local: {
        downloadUrl: `/media/${result.pdfFilename}`,
        fullPath: result.outputPath
      },
      s3: {
        key: result.s3UploadResult.key,
        location: result.s3UploadResult.location,
        etag: result.s3UploadResult.etag
      },
      fileInfo: {
        totalPages: result.pageCount,
        fileSize: `${(result.pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`,
        generatedAt: new Date().toISOString()
      },
      replacedVariables: {
        company_type: data.company_type,
        acn: data.acn || data.rdata?.entity?.acn,
        abn: data.abn || data.rdata?.entity?.abn,
        companyName: data.rdata?.entity?.name,
        entity_abn: data.rdata?.entity?.abn,
        entity_acn: data.rdata?.entity?.acn,
        entity_name: data.rdata?.entity?.name,
        entity_review_date: moment(data.rdata?.entity?.review_date).format('DD/MM/YYYY'),
        entity_registered_in: data.rdata?.entity?.registered_in,
        entity_abr_gst_status: data.rdata?.entity?.abr_gst_status,
        entity_document_number: data.rdata?.entity?.document_number,
        entity_organisation_type: data.rdata?.entity?.organisation_type,
        entity_asic_date_of_registration: moment(data.rdata?.entity?.asic_date_of_registration).format('DD/MM/YYYY'),
        current_date_and_time: moment().format('DD MMMM YYYY'),
        current_tax_debt_amount: formattedAmount,
        current_tax_debt_ato_updated_at: moment.utc(data.rdata?.current_tax_debt?.ato_updated_at).format('MMMM D, YYYY, [at] h:mm:ss A'),
      }
    });

  } catch (error) {
    console.error('Error converting HTML to PDF:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to convert HTML to PDF or upload to S3',
      details: error.message
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
    return response;
}


// Function to create report via external API
async function createReport({ business, type, userId, matterId, ispdfcreate }) {
    try {
        const abn = business?.Abn;
        const acn = abn.substring(2);
        if (!abn) {
            throw new Error('ABN not found in business data');
        }
        
        if (type == "asic-current" || type == "court" || type == "ato") {
            existingReport = await checkExistingReportData(abn, "asic-current");
        } else {
            existingReport = await checkExistingReportData(abn, type);
        }
        if (existingReport) {
            console.log(`✅ CACHE HIT: Found existing report in Reports table`);
            console.log(`   Report ID: ${existingReport.data}`);
            console.log(`   UUID: ${existingReport.uuid}`);
            console.log(`   Created: ${existingReport.created_at}`);
            
            // Fetch the report data from Alares API for parsing and storing
            reportId = existingReport?.id
            reportData = existingReport.rdata;
        } else {
           if( type == "asic-current" || type == "court" || type == "ato" ) {
                //const apiUrl = 'https://alares.com.au/api/reports/create';
                const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
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

                // console.log('Report creation API response:', createResponse.data);

                // Now call GET API to fetch the report data
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
            } else if ( type == "asic-historical" ) {
                //const apiUrl = 'https://alares.com.au/api/reports/create';
                const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
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

                //console.log('Report creation API response:', createResponse.data);

                // Now call GET API to fetch the report data
                //const getApiUrl = `https://alares.com.au/api/reports/${createResponse.data.uuid}/json`;
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
            } else if ( type == "asic-company" ) {
                const apiUrl = 'https://alares.com.au/api/reports/create';
                const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
                const params = {
                    type: 'company',
                    abn: abn,
                    asic_relational: '1'
                };
                // createResponse = await axios.post(apiUrl, null, {
                //     params: params,
                //     headers: {
                //         'Authorization': `Bearer ${bearerToken}`,
                //         'Content-Type': 'application/json'
                //     },
                //     timeout: 30000 // 30 second timeout
                // });

                //console.log('Report creation API response:', createResponse.data);

                // Now call GET API to fetch the report data
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
            } else if ( type == "ppsr" ){
                const ppsrTokenn = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IkY2NThCODUzNDlCODc3MTVGOUM1QjI1ODgzNDcwNTVERjM5NTk1QjlSUzI1NiIsInR5cCI6ImF0K2p3dCIsIng1dCI6IjlsaTRVMG00ZHhYNXhiSllnMGNGWGZPVmxiayJ9.eyJuYmYiOjE3NjIwNDA3MzMsImV4cCI6MTc2MjA0MjUzMywiaXNzIjoiaHR0cDovL2xvY2FsaG9zdDo2MjE5NyIsImF1ZCI6ImludGVncmF0aW9uLWFwaSIsImNsaWVudF9pZCI6ImZsZXhjb2xsZWN0LWFwaS1pbnRlZ3JhdGlvbiIsImlkIjoiMTAyNzkiLCJuYW1lIjoiZmxleGNvbGxlY3QtYXBpLWludGVncmF0aW9uIiwic3ViIjoiZThiMjEwMDYtYzgxYy00YWE4LThhMDYtYWFjMzZjNzY5ODE0Iiwibmlja25hbWUiOiJGbGV4Y29sbGVjdCBJTlRFR1JBVElPTiIsInV1aWQiOiJlOGIyMTAwNi1jODFjLTRhYTgtOGEwNi1hYWMzNmM3Njk4MTQiLCJqdGkiOiJGMjcyRUU5QUVGM0QyMUIxQzAwNEE1QTdBRUMyOTg2RSIsImlhdCI6MTc2MjA0MDczMywic2NvcGUiOlsidXNlcmFjY2VzcyIsImludGVncmF0aW9uYWNjZXNzIl19.kAOJHiPtNtYuaYOKMZFVXsVObcLS09L4jLIKr82hUm9q2EVnGlbXyFuellqochr9aK_3QaMQGFogHo2_r_NNuVJtVlAI82Pg0JRKOoYP0cQ381KCboZNcih6EIE47-XiU5CYSJ8SvkSWIibJeIkUR4hn2BEkocoKSDj8THoQx7yBIxWGQ9bxxkiujAcq7EeLePIOHNZg7rtCv-gtoMwts0LO6qi3T4QqDFtUyv2jQ7SBKZzBBp3eYpyTcSt_dyiVEgDWDmtB-en_zRUDgV5hN5_AbK43G1lCHd8dpsPkXgotqngfvNz_oMpuxZtorKf3ItaNtlWpOeyqs7UH4LfZbA';
                
                // Remove first 2 characters from ABN to get ACN
                
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
                //console.log('✅ PPSR API Response:', response.data);
                reportData = response;
            } else if ( type == "director-ppsr" ){
                const ppsrTokenn = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IkY2NThCODUzNDlCODc3MTVGOUM1QjI1ODgzNDcwNTVERjM5NTk1QjlSUzI1NiIsInR5cCI6ImF0K2p3dCIsIng1dCI6IjlsaTRVMG00ZHhYNXhiSllnMGNGWGZPVmxiayJ9.eyJuYmYiOjE3NjE3OTM5MzAsImV4cCI6MTc2MTc5NTczMCwiaXNzIjoiaHR0cDovL2xvY2FsaG9zdDo2MjE5NyIsImF1ZCI6ImludGVncmF0aW9uLWFwaSIsImNsaWVudF9pZCI6ImZsZXhjb2xsZWN0LWFwaS1pbnRlZ3JhdGlvbiIsImlkIjoiMTAyNzkiLCJuYW1lIjoiZmxleGNvbGxlY3QtYXBpLWludGVncmF0aW9uIiwic3ViIjoiZThiMjEwMDYtYzgxYy00YWE4LThhMDYtYWFjMzZjNzY5ODE0Iiwibmlja25hbWUiOiJGbGV4Y29sbGVjdCBJTlRFR1JBVElPTiIsInV1aWQiOiJlOGIyMTAwNi1jODFjLTRhYTgtOGEwNi1hYWMzNmM3Njk4MTQiLCJqdGkiOiI0RDM4QUY5MzVDMUQ1OUZGMzRFRDg5OTlGNDYxNjU0QyIsImlhdCI6MTc2MTc5MzkzMCwic2NvcGUiOlsidXNlcmFjY2VzcyIsImludGVncmF0aW9uYWNjZXNzIl19.kMPMLQCSbfCOd-Mc3lB8ijYYwWUfJikoYUmbfWcF7IWoiyQnyDkVMP_JrlKtoF0B0AB9IZQTHvVKbprJwbA5gPWJvnGI7pFQXNa21G0Srgdd8tioWY4UdxjujrQMpwaaQrvQOYV7-lmOIcXpj3SB3uQsWkRCWAvJ3HlukVjIMvOraJmg4tRQCerMuEn-oEOu_NHKguL0c0d7l-v-rPBJ11xPBa9RgEZJ0-E96kAPwHm5tk4yIvKHmu_WMmAxU56TnF3p8RFk_d566LHuVqTanzEaZS9m5PqMyUE5WRnUe5-S-FVSPetNTqGSNinplx90aBlI1XoRPiIlSt7J1noT_Q';
                
                // Remove first 2 characters from ABN to get ACN
                const acn = abn.substring(2);
                console.log(acn)
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
                response.data.ppsrCloudId = auSearchIdentifier;
                //console.log('✅ PPSR API Response:', response.data);
                let reportData = response;
            } else if ( type = "director-bankruptcy" ){
                const apiUrl = 'https://services.afsa.gov.au/brs/api/v2/search-by-name';
                const bearerToken = 'eyJraWQiOiIwRDRXdDh3UiIsImFsZyI6IlJTMjU2IiwidHlwIjoiSldUIn0.eyJpc3MiOiJBdXN0cmFsaWFuIEZpbmFuY2lhbCBTZWN1cml0eSBBdXRob3JpdHkiLCJpYXQiOjE3NjIwNDYzNjQsInN1YiI6IjY3ODY4IiwidXNyIjoiOGQyZTIxMWEtODhkNS00NDZmLWIzNTUtNmIxMGE4Mjc4ZTNmIiwiYXBwIjoiQ1JFRElUT1JfUFJBQ1RJVElPTkVSIiwiZW1sIjpudWxsLCJpbnQiOmZhbHNlLCJjaGEiOiJBUElfS0VZIiwiZ24iOm51bGwsInNuIjoiOGQyZTIxMWEiLCJtZmEiOnRydWUsImV4cCI6MTc2MjA0ODE2NH0.jmjek8ph0AWJ7AWNJLefhw02e9-CDZy-Y6eShwNUqOzYQMB0bsUruRkUmTdTsCvIy27IWNmE-Tm7AttDyJoW551_1A1hMbvdtzG88kQbVyoumeHCniRbvc2-IZxNEgaaNkOQTdc7Lq7RTLcMfj8H694KGSLwzLzR8hnPiQIbz12eC4gsazxgdgBNvSg4ugxAk4xRLFvJ_liSEi-17tmfJiHnFbUBi6YA1mjWKU_p-q266BCm3pp4uDbu0qo5RILyPoNVBaoiVcEpLSuRoOGXUQk07IyR2A7lehnRHmsLM7WFHTN6H2AOqGKdL09044xuNViauEP4aschOCCoW1MdRPj9pWVS0LyVPc1oo8qzeJJ0oxeJuAz1Z40ZQoo-8JTDb0_XM6WwYu8p17LSSdq2aBMBcP9hzwyMXBn8N0WVOAtJ4O_HbVXuOe0lYGUa5E0xq1lZiawrrdPSW0TPNpbMuFaBl4SaaSGmwt4sk54_u0b3Il1yCjeTk0df_QZwj6jK';
                const params = {
                    debtorSurname: 'adgemis',
                    debtorGivenName: 'jon',
                };
                response = await axios.get(apiUrl, {
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
                reportData = response;
            } else if ( type = "director-related" ){
                const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
                const bapiURL = 'https://alares.com.au/api/asic/search'
                const bparams = {
                    first_name: "jon",
                    last_name: "adgemis",
                    dob_from: '24-04-1978',
                };
                bcreateResponse = await axios.get(bapiURL, {
                    params: bparams,
                    headers: {
                        'Authorization': `Bearer ${bearerToken}`
                    },
                    timeout: 30000 // 30 second timeout
                });
                
                const apiUrl = 'https://alares.com.au/api/reports/create';
                const params = {
                    type: 'individual',
                    name: "jon adgemis",
                    dob: '24-04-1978',
                    asic_current: '1',
                    person_id: bcreateResponse.data[0].person_id,
                    acs_search_id: bcreateResponse.data[0].search_id
                };
                createResponse = await axios.post(apiUrl, null, {
                    params: params,
                    headers: {
                        'Authorization': `Bearer ${bearerToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 second timeout
                });

                reportData = await asic_report_data(createResponse.data.uuid);
                reportData.data.uuid = createResponse.data.uuid;
            }  

            const { sequelize } = require('../config/db');
            const [iresult] = await sequelize.query(`
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
                console.log(iresult);
                reportId = iresult[0].id;
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