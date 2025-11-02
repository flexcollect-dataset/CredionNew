const axios = require('axios');
const { ApiData, sequelize } = require('../models');

// Helper function to add delay
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if API data exists in cache
 * @param {string} abn - Australian Business Number
 * @param {string} type - Report type (asic-current, asic-historical, ppsr, etc.)
 * @returns {Promise<object|null>} - Cached data or null if not found
 */
async function checkApiDataCache(abn, type) {
    try {
        console.log(`🔍 CACHE CHECK: ABN="${abn}", Type="${type}"`);
        
        const existingData = await ApiData.findOne({
            where: {
                abn: abn,
                rtype: type
            },
            order: [['created_at', 'DESC']]
        });
        
        if (existingData) {
            console.log(`✅ CACHE HIT: Found cached data for ABN ${abn} (${type})`);
            return existingData;
        }
        
        console.log(`❌ CACHE MISS: No cached data found for ABN ${abn} (${type})`);
        return null;
    } catch (error) {
        console.error('Error checking API data cache:', error);
        return null;
    }
}

/**
 * Store API response data to cache
 * @param {object} data - Data to store
 * @param {string} data.type - Report type
 * @param {string} data.uuid - Unique identifier
 * @param {string} data.abn - Australian Business Number
 * @param {string} data.acn - Australian Company Number
 * @param {object} data.apiResponse - The API response data to cache
 * @returns {Promise<number>} - ID of inserted record
 */
async function storeApiDataCache({ type, uuid, abn, acn, apiResponse }) {
    try {
        console.log(`💾 STORING TO CACHE: ABN="${abn}", Type="${type}"`);
        
        const [result] = await sequelize.query(`
            INSERT INTO Api_Data (
                rtype, uuid, search_word, abn, 
                acn, rdata, alert, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
            RETURNING id
        `, {
            bind: [
                type,
                uuid || null,
                null,
                abn || null,
                acn || null,
                JSON.stringify(apiResponse) || null,
                false,
            ]
        });
        
        const insertedId = result[0].id;
        console.log(`✅ CACHE STORED: ID=${insertedId}`);
        return insertedId;
    } catch (error) {
        console.error('Error storing API data to cache:', error);
        throw error;
    }
}

/**
 * Fetch ASIC Current data from Alares API
 * @param {string} abn - Australian Business Number
 * @returns {Promise<object>} - API response data
 */
async function fetchAsicCurrentData(abn) {
    try {
        console.log(`📡 FETCHING ASIC CURRENT DATA for ABN: ${abn}`);
        
        const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
        
        // For now using hardcoded UUID as in backup - replace with actual API call when needed
        const getApiUrl = `https://alares.com.au/api/reports/019a2e17-f011-7183-a3db-de2ef10aaebf/json`;
        
        console.log('   API URL:', getApiUrl);
        
        const response = await axios.get(getApiUrl, {
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        response.data.uuid = "019a2e17-f011-7183-a3db-de2ef10aaebf";
        
        console.log(`✅ ASIC CURRENT DATA FETCHED`);
        return response.data;
    } catch (error) {
        console.error('❌ ASIC CURRENT API Error:', error.message);
        throw error;
    }
}

/**
 * Fetch ASIC Historical data from Alares API
 * @param {string} abn - Australian Business Number
 * @returns {Promise<object>} - API response data
 */
async function fetchAsicHistoricalData(abn) {
    try {
        console.log(`📡 FETCHING ASIC HISTORICAL DATA for ABN: ${abn}`);
        
        const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
        
        // For now using hardcoded UUID - replace with actual API call when needed
        const getApiUrl = `https://alares.com.au/api/reports/019a375e-b08e-7181-96b7-8ff9880c2e07/json`;
        
        console.log('   API URL:', getApiUrl);
        
        const response = await axios.get(getApiUrl, {
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        response.data.uuid = "019a375e-b08e-7181-96b7-8ff9880c2e07";
        
        console.log(`✅ ASIC HISTORICAL DATA FETCHED`);
        return response.data;
    } catch (error) {
        console.error('❌ ASIC HISTORICAL API Error:', error.message);
        throw error;
    }
}

/**
 * Fetch PPSR data from PPSR Cloud API
 * @param {string} abn - Australian Business Number
 * @param {string} acn - Australian Company Number
 * @returns {Promise<object>} - API response data
 */
async function fetchPpsrData(abn, acn) {
    try {
        console.log(`📡 FETCHING PPSR DATA for ABN: ${abn}, ACN: ${acn}`);
        
        const ppsrToken = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IkY2NThCODUzNDlCODc3MTVGOUM1QjI1ODgzNDcwNTVERjM5NTk1QjlSUzI1NiIsInR5cCI6ImF0K2p3dCIsIng1dCI6IjlsaTRVMG00ZHhYNXhiSllnMGNGWGZPVmxiayJ9.eyJuYmYiOjE3NjE5MTM5NDUsImV4cCI6MTc2MTkxNTc0NSwiaXNzIjoiaHR0cDovL2xvY2FsaG9zdDo2MTE5NyIsImF1ZCI6ImludGVncmF0aW9uLWFwaSIsImNsaWVudF9pZCI6ImZsZXhjb2xsZWN0LWFwaS1pbnRlZ3JhdGlvbi1wcm9kIiwiaWQiOiIxMDQyOCIsIm5hbWUiOiJmbGV4Y29sbGVjdC1hcGktaW50ZWdyYXRpb24tcHJvZCIsInN1YiI6IjZiNmI3MmRhLWMzMzMtNDVhNy1hNzI5LTA0ZWY2MWMwMzVkMSIsIm5pY2tuYW1lIjoiRmxleGNvbGxlY3QgSU5URUdSQVRJT04iLCJ1dWlkIjoiNmI2YjcyZGEtYzMzMy00NWE3LWE3MjktMDRlZjYxYzAzNWQxIiwianRpIjoiMTgxNzRFQzhFRUM5Qzk1MUZBQTAxRTgzRTRBREEyN0YiLCJpYXQiOjE3NjE5MTM5NDUsInNjb3BlIjpbInVzZXJhY2Nlc3MiLCJpbnRlZ3JhdGlvbmFjY2VzcyJdfQ.Qy3omALdsWtJv_XZCWZJKUqRJXaEWEsiOttRxDymvjAXz-afW89CD8U0dUdRxVc7VUi_aVtm-_1JGCZm3rkZqPvuYmLBeRo_ZYDJ6WgSUrHzKl3vsSK1QLhYo6pEdTnJE568mfwn74G7Jjh1rb88unh0YQUCfSb8vcDTk8A7kKaKY-EXIiPeiDumXhTV-q_d0NgjDZY8XfaBtZlH3TqSt2F4Us7HQ5_Jt8ygwlGcvae4bGe8V5MxAI-ViyVCuk46Scfis2wXP_ctgv9S8p63Gcu3xKeOlIa0XCgLz9jvPjiK3VId9NQzKlUcNcEIqf23IKR4vyyqWOZE9bozMRmCww';
        
        // Step 1: Submit search request
        console.log('   PPSR STEP 1: Submitting search request...');
        const submitUrl = 'https://uat-gateway.ppsrcloud.com/api/b2b/ausearch/submit-grantor-session-cmd';
        const requestData = {
            customerRequestId: `flexcollect-${Date.now()}`,
            clientReference: "Credion API Search",
            pointInTime: null,
            criteria: [
                {
                    grantorType: "organisation",
                    organisationNumberType: "acn",
                    organisationNumber: acn
                }
            ]
        };
        
        const submitResponse = await axios.post(submitUrl, requestData, {
            headers: {
                'Authorization': `Bearer ${ppsrToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        const auSearchIdentifier = submitResponse.data.resource?.ppsrCloudId;
        
        if (!auSearchIdentifier) {
            throw new Error('No auSearchIdentifier (ppsrCloudId) returned from PPSR submit request');
        }
        
        console.log(`   PPSR STEP 1 COMPLETE: auSearchIdentifier=${auSearchIdentifier}`);
        console.log('   Waiting 3 seconds before fetching results...');
        
        // Wait for PPSR to process
        await delay(3000);
        
        // Step 2: Fetch actual data using the auSearchIdentifier
        console.log('   PPSR STEP 2: Fetching search results...');
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
            timeout: 30000
        });
        
        response.data.uuid = auSearchIdentifier;
        
        console.log(`✅ PPSR DATA FETCHED`);
        return response.data;
    } catch (error) {
        console.error('❌ PPSR API Error:', error.message);
        throw error;
    }
}

/**
 * Main function to get API data - checks cache first, then fetches from API if needed
 * @param {string} abn - Australian Business Number
 * @param {string} type - Data type (asic-current, asic-historical, ppsr, court, ato)
 * @returns {Promise<object>} - Cached or freshly fetched data
 */
async function getApiData(abn, type) {
    try {
        // Check cache first
        const cachedData = await checkApiDataCache(abn, type);
        if (cachedData) {
            console.log(`✅ RETURNING CACHED DATA`);
            return {
                source: 'cache',
                data: cachedData.rdata,
                cachedAt: cachedData.created_at
            };
        }
        
        // Cache miss - fetch from API
        console.log(`📡 FETCHING FRESH DATA FROM API`);
        let apiResponse;
        let uuid;
        const acn = abn.substring(2); // Remove first 2 characters to get ACN
        
        // Route to appropriate API based on type
        if (type === 'asic-current' || type === 'court' || type === 'ato') {
            apiResponse = await fetchAsicCurrentData(abn);
            uuid = apiResponse.uuid;
        } else if (type === 'asic-historical') {
            apiResponse = await fetchAsicHistoricalData(abn);
            uuid = apiResponse.uuid;
        } else if (type === 'ppsr') {
            apiResponse = await fetchPpsrData(abn, acn);
            uuid = apiResponse.uuid;
        } else {
            throw new Error(`Unsupported API data type: ${type}`);
        }
        
        // Store in cache
        await storeApiDataCache({
            type,
            uuid,
            abn,
            acn,
            apiResponse
        });
        
        console.log(`✅ RETURNING FRESH DATA`);
        return {
            source: 'api',
            data: apiResponse,
            fetchedAt: new Date()
        };
    } catch (error) {
        console.error(`❌ ERROR GETTING API DATA: ${error.message}`);
        throw error;
    }
}

module.exports = {
    checkApiDataCache,
    storeApiDataCache,
    fetchAsicCurrentData,
    fetchAsicHistoricalData,
    fetchPpsrData,
    getApiData
};

