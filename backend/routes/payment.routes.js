const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { User, UserPaymentMethod, Report, ApiData } = require('../models');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const moment = require('moment');
const { XMLParser } = require('fast-xml-parser');
const { uploadToS3 } = require('../services/s3.service');
const { replaceVariables, convertWithVariables, addDownloadReportInDB, ensureMediaDir, mediaDir } = require('../services/pdf.service');
const UserReport = require('../models/UserReport');
const { sequelize } = require('../config/db');
const { apiClients, getToken } = require("./apiClients.js");
const OpenAI = require("openai");



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

function delay(t) {
	return new Promise(resolve => setTimeout(resolve, t));
}

function sanitizeBusinessNumber(input) {
	return input.replace(/\D/g, '');
}

// Helper function to search ABN by name using Australian Business Register API
async function searchABNByName(companyName) {
	const ABN_GUID = process.env.ABN_GUID || '250e9f55-f46e-4104-b0df-774fa28cff97';
	const url = `https://abr.business.gov.au/json/MatchingNames.aspx?name=${encodeURIComponent(companyName)}&maxResults=10&guid=${ABN_GUID}`;
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
			const abnInfo = await getABNInfo(sanitized);
			res.json({
				success: true,
				results: abnInfo ? [abnInfo] : []
			});
		} else {
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

router.get('/director-related/matches', async (req, res) => {
	try {
		const { firstName, lastName, dobFrom, dobTo } = req.query;

		if (!lastName || typeof lastName !== 'string' || lastName.trim().length === 0) {
			return res.status(400).json({
				success: false,
				error: 'MISSING_SURNAME',
				message: 'Last name is required to search director related entities'
			});
		}

		const rawData = await searchDirectorRelatedMatches({
			firstName: firstName && typeof firstName === 'string' ? firstName.trim() : undefined,
			lastName: lastName.trim(),
			dobFrom: dobFrom && typeof dobFrom === 'string' ? dobFrom.trim() : undefined,
			dobTo: dobTo && typeof dobTo === 'string' ? dobTo.trim() : undefined
		});

		const matches = Array.isArray(rawData) ? rawData : Array.isArray(rawData?.results) ? rawData.results : [];

		return res.json({
			success: true,
			matches
		});
	} catch (error) {
		console.error('Error searching director related matches:', error?.response?.data || error.message);

		const status = error?.response?.status || 500;
		const message =
			error?.response?.data?.message ||
			error?.message ||
			'Failed to retrieve director related entities';

		return res.status(status).json({
			success: false,
			error: 'DIRECTOR_RELATED_SEARCH_FAILED',
			message
		});
	}
});

// Bankruptcy matches endpoint
router.get('/bankruptcy/matches', async (req, res) => {
	try {
		const { firstName, lastName, dateOfBirth } = req.query;

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
			// Format date of birth if needed (AFSA API might expect specific format)
			params.debtorDateOfBirth = dateOfBirth.trim();
		}

		const response = await axios.get(apiUrl, {
			params: params,
			headers: {
				'Authorization': `Bearer ${bearerToken}`,
				'Accept': 'application/json'
			},
			timeout: 30000 // 30 second timeout
		});

		// AFSA API returns data with insolvencies array
		// Extract matches from response - AFSA returns { insolvencies: [...], insolvencySearchId: "...", resultCount: ... }
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

// Court name search endpoint
router.get('/court/name-search', async (req, res) => {
	try {
		const { firstName, lastName, state, courtType } = req.query;

		if (!lastName || typeof lastName !== 'string' || lastName.trim().length === 0) {
			return res.status(400).json({
				success: false,
				error: 'MISSING_SURNAME',
				message: 'Last name is required to search court records',
				matches: []
			});
		}

		const bearerToken = '3eiXhUHT9G25QO9'; // Court API key
		const matches = [];

		// Determine which court types to search
		const searchCriminal = !courtType || courtType === 'ALL' || courtType === 'CRIMINAL';
		const searchCivil = !courtType || courtType === 'ALL' || courtType === 'CIVIL';

		// Search Criminal Court if needed
		if (searchCriminal) {
			try {
				const criminalApiUrl = 'https://corp-api.courtdata.com.au/api/search/criminal/name';
				const criminalParams = {
					surname: lastName.trim()
				};
				
				if (firstName && typeof firstName === 'string' && firstName.trim().length > 0) {
					criminalParams.given_name = firstName.trim();
				}
				
				if (state && typeof state === 'string' && state.trim().length > 0) {
					criminalParams.state = state.trim();
				}

				const criminalResponse = await axios.get(criminalApiUrl, {
					params: criminalParams,
					headers: {
						'Api-Key': bearerToken,
						'accept': 'application/json',
						'X-CSRF-TOKEN': ''
					},
					timeout: 30000
				});

				// Extract matches from criminal response
				// Check for response.data.data.records structure first
				if (criminalResponse.data?.data?.records && Array.isArray(criminalResponse.data.data.records)) {
					criminalResponse.data.data.records.forEach((item) => {
						matches.push({
							...item,
							courtType: 'CRIMINAL',
							source: 'criminal'
						});
					});
				} else if (criminalResponse.data && Array.isArray(criminalResponse.data)) {
					criminalResponse.data.forEach((item) => {
						matches.push({
							...item,
							courtType: 'CRIMINAL',
							source: 'criminal'
						});
					});
				} else if (criminalResponse.data?.results && Array.isArray(criminalResponse.data.results)) {
					criminalResponse.data.results.forEach((item) => {
						matches.push({
							...item,
							courtType: 'CRIMINAL',
							source: 'criminal'
						});
					});
				}
			} catch (error) {
				console.error('Error searching criminal court:', error?.response?.data || error.message);
				// Continue to civil search even if criminal fails
			}
		}

		// Search Civil Court if needed
		if (searchCivil) {
			try {
				const civilApiUrl = 'https://corp-api.courtdata.com.au/api/search/civil/name';
				const civilParams = {
					surname: lastName.trim()
				};
				
				if (firstName && typeof firstName === 'string' && firstName.trim().length > 0) {
					civilParams.given_name = firstName.trim();
				}
				
				if (state && typeof state === 'string' && state.trim().length > 0) {
					civilParams.state = state.trim();
				}

				const civilResponse = await axios.get(civilApiUrl, {
					params: civilParams,
					headers: {
						'Api-Key': bearerToken,
						'accept': 'application/json',
						'X-CSRF-TOKEN': ''
					},
					timeout: 30000
				});

				// Extract matches from civil response
				// Check for response.data.data.records structure first
				if (civilResponse.data?.data?.records && Array.isArray(civilResponse.data.data.records)) {
					civilResponse.data.data.records.forEach((item) => {
						matches.push({
							...item,
							courtType: 'CIVIL',
							source: 'civil'
						});
					});
				} else if (civilResponse.data && Array.isArray(civilResponse.data)) {
					civilResponse.data.forEach((item) => {
						matches.push({
							...item,
							courtType: 'CIVIL',
							source: 'civil'
						});
					});
				} else if (civilResponse.data?.results && Array.isArray(civilResponse.data.results)) {
					civilResponse.data.results.forEach((item) => {
						matches.push({
							...item,
							courtType: 'CIVIL',
							source: 'civil'
						});
					});
				}
			} catch (error) {
				console.error('Error searching civil court:', error?.response?.data || error.message);
				// Continue even if civil search fails
			}
		}

		return res.json({
			success: true,
			matches: matches || []
		});
	} catch (error) {
		console.error('Error searching court names:', error?.response?.data || error.message);
		
		const status = error?.response?.status || 500;
		const message =
			error?.response?.data?.message ||
			error?.message ||
			'Failed to retrieve court records';

		return res.status(status).json({
			success: false,
			error: 'COURT_SEARCH_FAILED',
			message,
			matches: []
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

/**
 * Extract search word from business object based on report type
 * For ORGANISATION: returns company name
 * For INDIVIDUAL: returns name from selection object if available, otherwise fname + lname
 * @param {Object} business - Business object containing report data
 * @param {String} type - Report type
 * @returns {String|null} - Search word or null if not found
 */
function extractSearchWord(business, type) {
	if (!business) {
		return null;
	}

	// Determine if this is an organization or individual based on report type
	const isLandTitleOrg = type === 'land-title-organisation';
	const isLandTitleIndividual = type === 'land-title-individual';
	const isOrganization = isLandTitleOrg || 
	                     (business?.isCompany === "ORGANISATION" && !isLandTitleIndividual);
	const isIndividual = isLandTitleIndividual || 
	                    (business?.isCompany === "INDIVIDUAL" && !isLandTitleOrg);

	if (isOrganization) {
		// For organizations, use company name
		return business?.Name || business?.name || business?.companyName || business?.CompanyName || null;
	} else if (isIndividual) {
		// For individuals, check for selection objects first based on report type
		let searchWord = null;

		// Check report-specific selection objects
		if (type === 'director-bankruptcy' && business?.bankruptcySelection?.debtor) {
			const debtor = business.bankruptcySelection.debtor;
			const givenNames = debtor.givenNames || '';
			const surname = debtor.surname || '';
			if (givenNames || surname) {
				searchWord = `${givenNames} ${surname}`.trim();
			}
		} else if ((type === 'director-related' || type === 'director-related-historical') && business?.directorRelatedSelection?.name) {
			searchWord = business.directorRelatedSelection.name;
		} else if (type === 'director-court' || type === 'director-court-civil' || type === 'director-court-criminal') {
			// For court reports, prefer civilSelection.fullname, fallback to criminalSelection.fullname
			if (business?.civilSelection?.fullname) {
				searchWord = business.civilSelection.fullname;
			} else if (business?.criminalSelection?.fullname) {
				searchWord = business.criminalSelection.fullname;
			}
		} else if (type === 'land-title-individual') {
			searchWord = business?.person?.fullName;
		}

		if (type === 'rego-ppsr') {
			const firstName = business?.fname || business?.firstName || '';
			const middleName = business?.mname || business?.middleName || '';
			const lastName = business?.lname || business?.lastName || '';
			
			const nameParts = [firstName, middleName, lastName].filter(part => part && part.trim());
			searchWord = nameParts.length > 0 ? nameParts.join(' ').trim() : null;
		}

		// If no selection object found, use fname and lname
		if (!searchWord) {
			const firstName = business?.fname || business?.firstName || '';
			const middleName = business?.mname || business?.middleName || '';
			const lastName = business?.lname || business?.lastName || '';
			
			const nameParts = [firstName, middleName, lastName].filter(part => part && part.trim());
			searchWord = nameParts.length > 0 ? nameParts.join(' ').trim() : null;
		}
		return searchWord;
	}

	if(type === 'land-title-address') {
		return searchWord = business?.address;
	}

	if(type === 'land-title-reference') {
		return searchWord = business?.referenceId;
	}
	return null;
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
		await createReport({ business, type, ispdfcreate, userId: null, matterId: null });

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
	//Now call GET API to fetch the report data with retry logic
	const getApiUrl = `https://alares.com.au/api/reports/${uuid}/json`;
	const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
	
	const maxRetries = 5;
	const initialDelay = 3000; // Start with 3 seconds
	const maxDelay = 15000; // Max 15 seconds between retries
	const requestTimeout = 30000; // 30 seconds per request
	
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			// Wait before retry (except first attempt)
			if (attempt > 0) {
				const delayTime = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
				console.log(`Retrying report fetch for UUID ${uuid}, attempt ${attempt + 1}/${maxRetries}, waiting ${delayTime}ms...`);
				await delay(delayTime);
			} else {
				// First attempt - wait 3 seconds
				await delay(initialDelay);
			}
			
			const response = await axios.get(getApiUrl, {
				headers: {
					'Authorization': `Bearer ${bearerToken}`,
					'Content-Type': 'application/json'
				},
				timeout: requestTimeout
			});
			
			// If we get a successful response, return it
			if (response.data) {
				response.data.uuid = uuid;
				console.log(`Successfully fetched report data for UUID ${uuid} on attempt ${attempt + 1}`);
				return response;
			}
		} catch (error) {
			// If this is the last attempt, throw the error
			if (attempt === maxRetries - 1) {
				console.error(`Failed to fetch report data for UUID ${uuid} after ${maxRetries} attempts:`, error.message);
				throw new Error(`Failed to fetch report data after ${maxRetries} attempts: ${error.message}`);
			}
			// Otherwise, log and continue to next retry
			console.warn(`Attempt ${attempt + 1} failed for UUID ${uuid}:`, error.message);
		}
	}
	
	// Should not reach here, but just in case
	throw new Error(`Failed to fetch report data for UUID ${uuid} after ${maxRetries} attempts`);
}

async function fetchPpsrReportData(auSearchIdentifier) {

	// Get dynamic token for PPSR
	const ppsrToken = await getToken('ppsr');
	await delay(3000);

	// Step 2: Fetch actual data using the auSearchIdentifier
	const fetchUrl = 'https://gateway.ppsrcloud.com/api/b2b/ausearch/result-details';
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

async function director_ppsr_report(business) {
	// Get dynamic token for PPSR
	const ppsrToken = await getToken('ppsr');

	// Convert dob to YYYY-MM-DD format
	let formattedDob = "1993-03-01"; // Default fallback
	if (business.dob) {
		try {
			// Try to parse the date with explicit format (DD/MM/YYYY is common)
			// Try multiple formats to handle different input formats
			let parsedDate;
			if (typeof business.dob === 'string') {
				// Try DD/MM/YYYY format first (most common based on error)
				if (business.dob.includes('/')) {
					parsedDate = moment(business.dob, 'DD/MM/YYYY', true); // strict mode
					if (!parsedDate.isValid()) {
						// Try MM/DD/YYYY as fallback
						parsedDate = moment(business.dob, 'MM/DD/YYYY', true);
					}
				} else if (business.dob.includes('-')) {
					// Already in ISO format or similar
					parsedDate = moment(business.dob, ['YYYY-MM-DD', 'DD-MM-YYYY'], true);
				} else {
					// Try moment's default parsing as last resort
					parsedDate = moment(business.dob);
				}
			} else {
				// If it's already a Date object or moment object
				parsedDate = moment(business.dob);
			}

			if (parsedDate && parsedDate.isValid()) {
				formattedDob = parsedDate.format('YYYY-MM-DD');
			} else {
				console.warn('Invalid date format for dob:', business.dob);
			}
		} catch (error) {
			console.error('Error formatting date of birth:', error, 'dob:', business.dob);
			// If parsing fails, use default
		}
	}

	// Step 1: Submit search request
	const submitUrl = 'https://gateway.ppsrcloud.com/api/b2b/ausearch/submit-grantor-session-cmd';
	const requestData = {
		customerRequestId: `flexcollect-001`,
		clientReference: "Credion Company Search",
		pointInTime: null,
		criteria: [
			{
				grantorType: "individual",
				individualDateOfBirth: formattedDob,
				individualFamilyName: business.lname,
				individualGivenNames: business.fname,
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

async function rego_ppsr_report(business) {
	try {

		const ppsrToken = await getToken('ppsr');

		// Extract rego number and state from business object
		const registrationPlate = business?.regoNumber || '';
		const registrationPlateState = business?.regoState || '';

		// Step 1: Call vehicle lookup API
		const lookupApiUrl = 'https://gateway.ppsrcloud.com/api/b2b/auvehicle/lookup-mv-info';
		const lookupRequestData = {
			registrationPlate: registrationPlate.trim(),
			registrationPlateState: registrationPlateState.trim(),
			advanceResultDetails: true
		};

		let lookupResponse;
		try {
			lookupResponse = await axios.post(lookupApiUrl, lookupRequestData, {
				headers: {
					'Authorization': `Bearer ${ppsrToken}`,
					'Content-Type': 'application/json'
				},
				timeout: 60000 // 60 second timeout (increased from 30)
			});
			
		} catch (error) {
			throw new Error(`Failed to lookup vehicle info: ${error.message}`);
		}

		const lookupDetails = lookupResponse.data?.resource?.details;
		let ppsrCloudId = null;
		let vin = null;
		
		if (lookupDetails && Array.isArray(lookupDetails) && lookupDetails.length > 0) {
			ppsrCloudId = lookupDetails[0]?.ppsrCloudId;
			vin = lookupDetails[0]?.vin;
		}

		if (!ppsrCloudId) {
			throw new Error('No ppsrCloudId found in response details. Please check the vehicle registration details.');
		}

		if (!vin) {
			throw new Error('No VIN found in response details. Please check the vehicle registration details.');
		}

		// Step 2: Call submit-mv API with VIN
		let submitMvResponse = null;
		try {
			const submitMvApiUrl = 'https://gateway.ppsrcloud.com/api/b2b/AuSearch/submit-mv';
			const submitMvRequestData = {
				vin: vin.trim()
			};

			submitMvResponse = await axios.post(submitMvApiUrl, submitMvRequestData, {
				headers: {
					'Authorization': `Bearer ${ppsrToken}`,
					'Content-Type': 'application/json'
				},
				timeout: 30000 // 30 second timeout
			});
		} catch (error) {
			console.error('Error calling submit-mv API:', error?.response?.data || error.message);
			
		}

		// Combine both responses in the report data
		const reportData = {
			status: true,
			data: {
				lookupResponse: lookupResponse.data, 
				submitMvResponse: submitMvResponse?.data || null, 
				uuid: ppsrCloudId,
				vin: vin
			}
		};
		
		return reportData;
	} catch (error) {
		console.error('Error in rego_ppsr_report:', error);
		throw error;
	}
}

async function director_bankrupcty_report(business) {
	reportData = null;

	if (!business || !business.bankruptcySelection) {
		reportData = {
			data: {
				uuid: null
			}
		};
		return reportData;
	}

	reportData = {
		data: business.bankruptcySelection
	};
	reportData.data.uuid = business.bankruptcySelection.extractId;
	return reportData;
}

async function director_related_report(business, isHistorical = false) {
	const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
	
	// Check if directorRelatedSelection exists in business object
	if (!business || !business.directorRelatedSelection) {
		// Return proper structure when no selection is available
		return {
			data: {
				uuid: null
			}
		};
	}

	// Extract values from directorRelatedSelection
	const directorRelatedSelection = business.directorRelatedSelection;
	const dob = directorRelatedSelection.dob || '';
	const name = directorRelatedSelection.name || '';
	const person_id = directorRelatedSelection.person_id || '';
	const acs_search_id = directorRelatedSelection.search_id || '';
	
	// Convert dob to DD-MM-YYYY format
	let formattedDob = "01-03-1993"; // Default fallback
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
				formattedDob = parsedDate.format('DD-MM-YYYY');
			} else {
				console.warn('Invalid date format for dob:', dob);
			}
		} catch (error) {
			console.error('Error formatting date of birth:', error, 'dob:', dob);
			// If parsing fails, use default
		}
	}

	const apiUrl = 'https://alares.com.au/api/reports/create';
	const params = {
	    type: 'individual',
	    name: name,
	    dob: formattedDob,
	    person_id: person_id,
	    acs_search_id: acs_search_id
	};
	
	// Add asic_current or asic_historical based on isHistorical parameter
	if (isHistorical) {
		params.asic_historical = '1';
	} else {
		params.asic_current = '1';
	}
	
	let createResponse;
	try {
		createResponse = await axios.post(apiUrl, null, {
		    params: params,
		    headers: {
		        'Authorization': `Bearer ${bearerToken}`,
		        'Content-Type': 'application/json'
		    },
		    timeout: 30000 // 30 second timeout
		});
	} catch (error) {
		console.error('Error calling director related report API:', error);
		return {
			status: false,
			data: null,
			message: error.message || 'Failed to create director related report'
		};
	}

	reportData = await asic_report_data(createResponse.data.uuid);
	return reportData;
}

// Helper function to fetch all pages of court records
async function fetchAllCourtRecords(apiUrl, params, bearerToken, totalRecords) {
	const recordsPerPage = 20;
	const totalPages = totalRecords ? Math.ceil(parseInt(totalRecords) / recordsPerPage) : 1;
	
	let allRecords = [];
	let total = 0;
	let responseStructure = null; // Track the response structure from first page
	
	for (let page = 1; page <= totalPages; page++) {
		try {
			// Try different pagination parameter formats
			const pageParams = {
				...params
			};
			
			// Try common pagination parameter names
			if (page > 1) {
				// Try different pagination parameter formats
				pageParams.page = page;
				pageParams.per_page = recordsPerPage;
				// Also try alternative parameter names
				// pageParams.pageNumber = page;
				// pageParams.pageSize = recordsPerPage;
				// pageParams.offset = (page - 1) * recordsPerPage;
				// pageParams.limit = recordsPerPage;
			}
			
			const response = await axios.get(apiUrl, {
				params: pageParams,
				headers: {
					'Api-Key': bearerToken,
					'accept': 'application/json',
					'X-CSRF-TOKEN': ''
				},
				timeout: 30000
			});
			
			// Extract records from response - handle different response structures
			const responseData = response.data || {};
			let pageRecords = [];
			
			// Try different response structures
			if (responseData.data?.records && Array.isArray(responseData.data.records)) {
				pageRecords = responseData.data.records;
				if (!responseStructure) responseStructure = 'data.records';
			} else if (responseData.records && Array.isArray(responseData.records)) {
				pageRecords = responseData.records;
				if (!responseStructure) responseStructure = 'records';
			} else if (responseData.data && Array.isArray(responseData.data)) {
				pageRecords = responseData.data;
				if (!responseStructure) responseStructure = 'data';
			} else if (Array.isArray(responseData)) {
				pageRecords = responseData;
				if (!responseStructure) responseStructure = 'root';
			}
			
			if (Array.isArray(pageRecords)) {
				allRecords = allRecords.concat(pageRecords);
			}
			
			// Update total from first page response
			if (page === 1) {
				total = responseData.data?.total || responseData.total || pageRecords.length;
			}
			
			// If we got fewer records than expected, we've reached the last page
			if (pageRecords.length < recordsPerPage) {
				break;
			}
			
			// Small delay between requests to avoid rate limiting
			if (page < totalPages) {
				await delay(500);
			}
		} catch (error) {
			console.error(`Error fetching page ${page} of court records:`, error);
			// Continue with other pages even if one fails
			if (page === 1) {
				throw error; // Only throw on first page failure
			}
		}
	}
	
	// Return data in the same format as the API response structure
	// Match the structure from the first page
	if (responseStructure === 'data.records') {
		return {
			data: {
				records: allRecords,
				total: total || allRecords.length
			}
		};
	} else if (responseStructure === 'records') {
		return {
			records: allRecords,
			total: total || allRecords.length
		};
	} else {
		// Default structure
		return {
			data: {
				records: allRecords,
				total: total || allRecords.length
			}
		};
	}
}

async function director_court_report(business) {
	const bearerToken = '3eiXhUHT9G25QO9';

	// Get fullnames and totals from business object
	const criminalFullname = business?.criminalSelection?.fullname || business?.civilSelection?.fullname || '';
	const civilFullname = business?.civilSelection?.fullname || business?.criminalSelection?.fullname || '';
	const criminalTotal = business?.criminalSelection?.total ? parseInt(business.criminalSelection.total) : null;
	const civilTotal = business?.civilSelection?.total ? parseInt(business.civilSelection.total) : null;

	// Search Criminal Court
	let criminalResponse = null;
	let criminalError = null;
	if (criminalFullname) {
		try {
			const criminalApiUrl = 'https://corp-api.courtdata.com.au/api/search/criminal/record';
			const criminalParams = {
				fullname: criminalFullname,
			};

			// If total is more than 20, fetch all pages
			if (criminalTotal && criminalTotal > 20) {
				const fetchedData = await fetchAllCourtRecords(criminalApiUrl, criminalParams, bearerToken, criminalTotal);
				// Ensure structure matches: { data: { records: [...], total: ... } }
				criminalResponse = { data: fetchedData.data || fetchedData };
			} else {
				const response = await axios.get(criminalApiUrl, {
					params: criminalParams,
					headers: {
						'Api-Key': bearerToken,
						'accept': 'application/json',
						'X-CSRF-TOKEN': ''
					},
					timeout: 30000
				});
				// Ensure structure matches: { data: { records: [...], total: ... } }
				criminalResponse = { data: response.data?.data || response.data };
			}
		} catch (error) {
			console.error('Error fetching criminal court data:', error);
			criminalError = error;
		}
	}

	// Search Civil Court
	let civilResponse = null;
	let civilError = null;
	if (civilFullname) {
		try {
	const civilApiUrl = 'https://corp-api.courtdata.com.au/api/search/civil/record';
	const civilParams = {
				fullname: civilFullname,
			};

			// If total is more than 20, fetch all pages
			if (civilTotal && civilTotal > 20) {
				const fetchedData = await fetchAllCourtRecords(civilApiUrl, civilParams, bearerToken, civilTotal);
				// Ensure structure matches: { data: { records: [...], total: ... } }
				civilResponse = { data: fetchedData.data || fetchedData };
			} else {
				const response = await axios.get(civilApiUrl, {
		params: civilParams,
		headers: {
			'Api-Key': bearerToken,
			'accept': 'application/json',
			'X-CSRF-TOKEN': ''
		},
		timeout: 30000
	});
				// Ensure structure matches: { data: { records: [...], total: ... } }
				civilResponse = { data: response.data?.data || response.data };
			}
		} catch (error) {
			console.error('Error fetching civil court data:', error);
			civilError = error;
		}
	}

	// Merge both responses into one structured JSON
	// PDF expects: criminal_court: { data: { records: [...], total: ... } }
	const reportData = {
		status: true,
		data: {
			criminal_court: criminalResponse || null,
			civil_court: civilResponse || null
		}
	};
	reportData.data.uuid = 'abcdef';
	return reportData;
}

async function director_court_civil(business) {
	const bearerToken = '3eiXhUHT9G25QO9';

	// Civil Court API
	const civilApiUrl = 'https://corp-api.courtdata.com.au/api/search/civil/record';
	const civilParams = {
		fullname: business?.civilSelection?.fullname || '',
	};
	
	const civilTotal = business?.civilSelection?.total ? parseInt(business.civilSelection.total) : null;
	let civilResponse;

	// If total is more than 20, fetch all pages
	if (civilTotal && civilTotal > 20) {
		const fetchedData = await fetchAllCourtRecords(civilApiUrl, civilParams, bearerToken, civilTotal);
		// Ensure structure matches: { data: { records: [...], total: ... } }
		civilResponse = { data: fetchedData.data || fetchedData };
	} else {
		const response = await axios.get(civilApiUrl, {
			params: civilParams,
			headers: {
				'Api-Key': bearerToken,
				'accept': 'application/json',
				'X-CSRF-TOKEN': ''
			},
			timeout: 30000
		});
		// Ensure structure matches: { data: { records: [...], total: ... } }
		civilResponse = { data: response.data?.data || response.data };
	}

	// Return only civil court response
	// PDF expects: civil_court: { data: { records: [...], total: ... } }
	const reportData = {
		status: true,
		data: {
			civil_court: civilResponse
		}
	};
	reportData.data.uuid = 'abcdef';
	return reportData;
}

async function director_court_criminal(business) {
	const bearerToken = '3eiXhUHT9G25QO9';
	const criminalApiUrl = 'https://corp-api.courtdata.com.au/api/search/criminal/record';
	const criminalParams = {
		fullname: business?.criminalSelection?.fullname || '',
	};
	
	const criminalTotal = business?.criminalSelection?.total ? parseInt(business.criminalSelection.total) : null;
	let criminalResponse;

	// If total is more than 20, fetch all pages
	if (criminalTotal && criminalTotal > 20) {
		const fetchedData = await fetchAllCourtRecords(criminalApiUrl, criminalParams, bearerToken, criminalTotal);
		// Ensure structure matches: { data: { records: [...], total: ... } }
		criminalResponse = { data: fetchedData.data || fetchedData };
	} else {
		const response = await axios.get(criminalApiUrl, {
		params: criminalParams,
		headers: {
			'Api-Key': bearerToken,
			'accept': 'application/json',
			'X-CSRF-TOKEN': ''
		},
		timeout: 30000
	});
		// Ensure structure matches: { data: { records: [...], total: ... } }
		criminalResponse = { data: response.data?.data || response.data };
	}

	// Return only criminal court response
	// PDF expects: criminal_court: { data: { records: [...], total: ... } }
	const reportData = {
		status: true,
		data: {
			criminal_court: criminalResponse
		}
	};
	reportData.data.uuid = 'abcdef';
	return reportData;
}

async function sole_trader_check_report(business) {
	try {
		// Get first name and last name from business object
		const firstName = business?.fname || business?.firstName || '';
		const lastName = business?.lname || business?.lastName || '';

		if (!firstName || !lastName) {
			console.error('Missing first name or last name for sole trader check');
			return {
				status: false,
				data: {
					uuid: null,
					error: 'First name and last name are required for sole trader check'
				}
			};
		}


		const ABN_GUID = process.env.ABN_GUID || '250e9f55-f46e-4104-b0df-774fa28cff97';
		
		// Build search name with space, then encode it properly for URL query parameters
		// encodeURIComponent will convert space to %20, but for query params we want + for spaces
		const searchName = `${firstName} ${lastName}`.trim();
		const encodedName = encodeURIComponent(searchName).replace(/%20/g, '+');
		const apiUrl = `https://abr.business.gov.au/abrxmlsearch/AbrXmlSearch.asmx/ABRSearchByNameAdvancedSimpleProtocol2017?name=${encodedName}&postcode=&legalName=&tradingName=&businessName=&activeABNsOnly=y&NSW=&SA=&ACT=&VIC=&WA=&NT=&QLD=&TAS=&authenticationGuid=${ABN_GUID}&searchWidth=&minimumScore=&maxSearchResults=`;
		

		// Make the API call
		const response = await axios.get(apiUrl, {
			headers: {
				'Accept': 'application/xml, text/xml'
			},
			timeout: 30000
		});

		// Log raw XML response length to verify we got the full response
		const xmlString = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
		
		

		

		// Parse XML response to JSON with better configuration for nested structures and namespaces
		const xmlParser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: '@_',
			textNodeName: '#text',
			parseAttributeValue: true,
			trimValues: true,
			parseTrueNumberOnly: false,
			ignoreNameSpace: true,
			removeNSPrefix: true,
			parseNodeValue: true,
			arrayMode: false,
			alwaysCreateTextNode: false,
			preserveOrder: false,
			ignoreDeclaration: true,
			ignorePiTags: true,
			parseTagValue: true,
			processEntities: true,
			htmlEntities: false,

			isArray: (name, jPath, isLeafNode, isAttribute) => {
				
				if (name === 'searchResultsRecord') {
					return true;
				}
				return false;
			}
		});

		let jsonData;
		if (typeof response.data === 'string') {
			jsonData = xmlParser.parse(response.data);
		} else {
			jsonData = response.data;
		}
		

		// Filter results to only include records that contain ALL words from the search query
		const searchWords = searchName.toLowerCase().split(/\s+/).filter(word => word.length > 0);
		
		// Helper function to check if a text contains all search words
		const containsAllWords = (text) => {
			if (!text || typeof text !== 'string') return false;
			const lowerText = text.toLowerCase();
			return searchWords.every(word => lowerText.includes(word));
		};

		// Helper function to extract name from a record
		const extractNameFromRecord = (record) => {
			// Check multiple possible name fields
			const nameFields = [
				record?.legalName?.fullName,
				record?.mainTradingName?.organisationName,
				record?.mainName?.organisationName
			];
			
			// Return the first non-empty name found
			for (const name of nameFields) {
				if (name && typeof name === 'string' && name.trim()) {
					return name;
				}
			}
			return null;
		};

		// Filter the search results
		if (jsonData?.ABRPayloadSearchResults?.response?.searchResultsList?.searchResultsRecord) {
			const allRecords = Array.isArray(jsonData.ABRPayloadSearchResults.response.searchResultsList.searchResultsRecord)
				? jsonData.ABRPayloadSearchResults.response.searchResultsList.searchResultsRecord
				: [jsonData.ABRPayloadSearchResults.response.searchResultsList.searchResultsRecord];

			// Filter records that contain all search words
			const filteredRecords = allRecords.filter(record => {
				const recordName = extractNameFromRecord(record);
				return recordName && containsAllWords(recordName);
			});

			// Update the search results with filtered data
			jsonData.ABRPayloadSearchResults.response.searchResultsList.searchResultsRecord = filteredRecords;
			jsonData.ABRPayloadSearchResults.response.searchResultsList.numberOfRecords = filteredRecords.length;
			
			// Update exceedsMaximum flag if needed
			if (filteredRecords.length === 0) {
				jsonData.ABRPayloadSearchResults.response.searchResultsList.exceedsMaximum = 'N';
			}
		}
		const reportUuid = `sole-trader-${Date.now()}-${uuidv4().substring(0, 8)}`;

		// Structure the report data similar to other report types
		const reportData = {
			status: true,
			data: {
				uuid: reportUuid,
				searchName: `${firstName} ${lastName}`,
				firstName: firstName,
				lastName: lastName,
				abnSearchResults: jsonData,
				searchDate: new Date().toISOString()
			}
		};

		
		return reportData;

	} catch (error) {
		
		
		// Return error response in same format
		return {
			status: false,
			data: {
				uuid: null,
				error: error.message || 'Failed to fetch sole trader check data',
				searchName: `${business?.fname || ''} ${business?.lname || ''}`.trim()
			}
		};
	}
}

async function unclaimed_money_report(business) {

	// Get first name and last name from business object
	const firstName = business?.fname || business?.firstName || '';
	const lastName = business?.lname || business?.lastName || '';

	if (!firstName || !lastName) {
		console.error('Missing first name or last name for unclaimed money search');
		return {
			status: false,
			data: {
				uuid: null,
				error: 'First name and last name are required for unclaimed money search'
			}
		};
	}

	// // Build account name (full name) for the initial API call
	const accountName = `${firstName} ${lastName}`.trim();
	// const initialApiUrl = `https://moneysmart.gov.au/api/UnclaimedMoneyService/Simple?accountName=${accountName}`;


	const client = new OpenAI({
  		apiKey: process.env.OPENAI_API_KEY
	});

	const encoded = encodeURIComponent(accountName);
  	const url = `https://moneysmart.gov.au/api/UnclaimedMoneyService/Simple?accountName=${encoded}`;

	const response = await client.responses.create({
		model: "gpt-4o-mini",
		input: `Fetch this URL and return ONLY the raw JSON body as a string, with no extra text:\n${url}`,
		tools: [ { type: "web_search" } ]  // enables live browsing from OpenAI servers
	});

	const text = response.output_text; 
	const data = JSON.parse(text);
	
	// Generate a unique UUID for this report
	const reportUuid = `unclaimed-money-${Date.now()}-${uuidv4().substring(0, 8)}`;

	// Structure the report data
	const reportData = {
		status: true,
		data: {
			uuid: reportUuid,
			searchNames: accountName,
			unclaimedMoneyData: data
		}
	};
	return reportData;
}

async function property(abn, cname, ldata) {
	let cotalityData = null;
	let titleRefData = null;

	if (ldata.addOn === true) {
		cotalityData = await get_cotality_pid("56 Kings Road Vaucluse NSW 2030");
	}
	titleRefData = await createTitleOrder('NSW', '99/30539');
	const reportData = {
		status: true,
		data: {
			cotality: cotalityData,
			titleOrder: titleRefData,
		}
	};
	reportData.data.uuid = "12345678";
	return reportData;
}

async function director_property(business) {
	let cotalityData = null;
	let titleRefData = null;

	if (ldata.addOn === true) {
		cotalityData = await get_cotality_pid("56 Kings Road Vaucluse NSW 2030");
	}
	LocaterData = await createLocaterData('NSW', '99/30539');
	titleRefData = await createTitleOrder('NSW', '99/30539');
	const reportData = {
		status: true,
		data: {
			cotality: cotalityData,
			titleOrder: titleRefData,
		}
	};
	reportData.data.uuid = "12345678";
	return reportData;
}

async function land_title_address(ldata) {
	let cotalityData = null;
	let titleRefData = null;
	let titleRefDataArray = [];

	const bearerToken = await getToken('landtitle');
	const url = 'https://online.globalx.com.au/api/national-property/locator-orders';
	const details = ldata.addressDetails;

	const body = {
		OrderRequestBlock: {
			OrderReference: 'Credion',
		},
		ServiceRequestBlock: {
			Jurisdiction: details.state,
			Location: {
			StructuredAddress: {
				Unit: details.components.subpremise || '',
				StreetNumber: details.streetNumber,
				StreetName: details.route,
				City: details.locality,
				State: details.state,
				PostCode: details.postalCode
			}
			}
		}
	};
	try {
		const response = await axios.post(url, body, {
			headers: {
				'Authorization': `Bearer ${bearerToken}`,
				'Content-Type': 'application/json',
				'Accept': 'application/json'
			},
			timeout: 10000 // optional
		});

		orderIdentifier = response.data?.OrderResultBlock?.OrderIdentifier; // expected 201 with OrderResultBlock + ResultURI
		await delay(50000);
		durl = `https://online.globalx.com.au/api/national-property/locator-orders/${orderIdentifier}`;
		tdata = await axios.get(durl, {
			headers: {
				Authorization: `Bearer ${bearerToken}`,
				Accept: 'application/json',
			},
		});
		
		// Check if OrderStatus is INVALID
		if (tdata.data?.OrderResultBlock?.OrderStatus === 'INVALID') {
			throw new Error('Please enter a complete address, including the level or street number (if applicable). The title references you provided do not match this address.');
		}
		
		console.log(tdata.data.RealPropertySegment?.[0].IdentityBlock.TitleReference);
		titleRefData = await createTitleOrder(details.state, tdata.data.RealPropertySegment?.[0].IdentityBlock.TitleReference);
		titleRefDataArray.push(titleRefData);
		console.log(titleRefData);
		if (ldata.addOn === true) {
			cotalityData = await get_cotality_pid(ldata.address);
		}

		const reportData = {
			status: true,
			data: {
				cotality: cotalityData,
				titleOrder: titleRefDataArray,
			}
		};
		reportData.data.uuid = "12345678";
		return reportData;

	} catch (err) {
		if (err.response) {
			console.error('❌ API Error:', err.response.status, err.response.data);
		} else {
			console.error('❌ Request Error:', err.message);
		}
		// Rethrow the error so it can be caught by the calling function
		throw err;
	}
}

async function land_title_reference(ldata) {
	let cotalityData = null;
	let titleRefDataArray = [];

	// Loop through all states
	const states = ldata.states || ['NSW']; // Default to NSW if states array is not provided
	for (const state of states) {
		try {
			const titleRefData = await createTitleOrder(state, ldata.referenceId);
			titleRefDataArray.push(titleRefData);
		} catch (error) {
			console.error(`Error creating title order for state ${state}:`, error);
			// Continue with other states even if one fails
		}
	}

	// Use the first successful result for cotality data
	const firstTitleRefData = titleRefDataArray[0];
	const loc = firstTitleRefData?.LocationSegment?.[0]?.Address;
	const formattedAddress = loc ? `${loc.StreetNumber} ${loc.StreetName} ${loc.StreetType} ${loc.City} ${loc.State} ${loc.PostCode}` : null;
	if (ldata.addOn === true) {
		cotalityData = await get_cotality_pid(formattedAddress);
	}

	const reportData = {
		status: true,
		data: {
			cotality: cotalityData,
			titleOrder: titleRefDataArray,
		}
	};
	reportData.data.uuid = "12345678";
	return reportData;
}

async function land_title_organisation(ldata) {
	const titleOrders = [];
	const cotalityDataArray = [];
	const locatorDataArray = [];
	
	let abn = ldata?.Abn;
	let companyName = ldata?.Name;
	
	
	// Get titleReferences from landTitleSelection
	// Handle both old format (array) and new format (object with current/historical)
	let titleReferencesRaw = ldata.landTitleSelection?.titleReferences || [];
	let titleReferences = { current: [], historical: [] };
	
	// Normalize to new format
	if (Array.isArray(titleReferencesRaw)) {
		// Old format: flat array, put all in current
		titleReferences.current = titleReferencesRaw;
	} else if (titleReferencesRaw.current && Array.isArray(titleReferencesRaw.current)) {
		// New format: object with current/historical
		titleReferences = titleReferencesRaw;
	}
	
	const detail = ldata.landTitleSelection?.detail || 'ALL';
	
	let isNearMatch = false;
	try {
		const [storedData] = await sequelize.query(`
			SELECT rdata
			FROM api_data
			WHERE rtype = 'land-title-organisation-summary' AND abn = $1
			ORDER BY created_at DESC
			LIMIT 1
		`, {
			bind: [abn]
		});
		
		if (storedData && storedData.length > 0) {
			const rdata = typeof storedData[0].rdata === 'string' 
				? JSON.parse(storedData[0].rdata) 
				: storedData[0].rdata;
			
			// Check if the stored data has NEAR_MATCHES
			if (rdata?.ServiceResultBlock?.MatchType === 'NEAR_MATCHES') {
				isNearMatch = true;
			}
		}
	} catch (error) {
		console.error('Error checking for NEAR_MATCHES:', error);
	}
	
	// If it's NEAR_MATCHES, generate a "no data available" report
	if (isNearMatch) {
		const reportData = {
			status: true,
			data: {
				currentCount: 0,
				historicalCount: 0,
				allCount: 0,
				titleOrders: [],
				cotality: null,
				locatorData: null,
				storedLocatorData: [],
				isNearMatch: true,
				companyName: companyName || abn, // Fallback to ABN if companyName not found
				noDataAvailable: true // Flag to indicate no data available
			}
		};
		
		reportData.data.uuid = "12345678";
		return reportData;
	}
		
		

	// Filter titleReferences based on detail selection
	let filteredTitleReferences = [];
	if (detail === 'CURRENT') {
		// For CURRENT, use current array
		filteredTitleReferences = titleReferences.current || [];
	} else if (detail === 'PAST') {
		// For PAST, use historical array
		filteredTitleReferences = titleReferences.historical || [];
	} else if (detail === 'ALL') {
		// For ALL, combine current and historical
		filteredTitleReferences = [...(titleReferences.current || []), ...(titleReferences.historical || [])];
	} else if (detail === 'SUMMARY') {
		// For SUMMARY, still fetch all title references for Complete Property Portfolio
		filteredTitleReferences = [...(titleReferences.current || []), ...(titleReferences.historical || [])];
	}

	// Process each titleReference
	for (const titleRefItem of filteredTitleReferences) {
		try {
			// Call createTitleOrder for each titleReference
			// Pass ABN and company name if available from business data
			const titleOrderData = await createTitleOrder(titleRefItem.jurisdiction, titleRefItem.titleReference, abn, companyName);
			titleOrders.push(titleOrderData);

			// If addOn is enabled, get cotality data for each titleReference
			if (ldata.landTitleSelection.addOn === true && titleOrderData) {
				const loc = titleOrderData?.LocationSegment?.[0]?.Address;
				const formattedAddress = loc ? `${loc.StreetNumber} ${loc.StreetName} ${loc.StreetType} ${loc.City} ${loc.State} ${loc.PostCode}` : null;
				if (formattedAddress) {
					try {
						const cotalityData = await get_cotality_pid(formattedAddress);
						cotalityDataArray.push(cotalityData);
					} catch (error) {
						console.error(`Error fetching cotality data for ${titleRefItem.titleReference}:`, error);
					}
				}
			}
		} catch (error) {
			console.error(`Error processing titleReference ${titleRefItem.titleReference}:`, error);
			// Continue with other titleReferences even if one fails
		}
	}

	// Merge all results
	const reportData = {
		status: true,
		data: {
			currentCount: ldata.landTitleSelection?.currentCount || 0,
			historicalCount: ldata.landTitleSelection?.historicalCount || 0,
			allCount: (ldata.landTitleSelection?.currentCount || 0) + (ldata.landTitleSelection?.historicalCount || 0),
			titleOrders: titleOrders, // Array of all title orders
			cotality: cotalityDataArray.length > 0 ? cotalityDataArray : null, // Array of cotality data
			locatorData: locatorDataArray.length > 0 ? locatorDataArray : null, // Array of locator data
			storedLocatorData: [...(titleReferences.current || []), ...(titleReferences.historical || [])].map(tr => {
				// Return stored locator data structure
				return {
					titleReference: tr.titleReference,
					jurisdiction: tr.jurisdiction
				};
			}),
			// Include titleReferences in the data structure for PDF service to access
			titleReferences: titleReferences
		}
	};
	
	reportData.data.uuid = "12345678";
	return reportData;
}

async function land_title_individual(ldata) {
	const titleOrders = [];
	const cotalityDataArray = [];
	const locatorDataArray = [];

	// Get titleReferences from landTitleSelection
	// Handle both old format (array) and new format (object with current/historical)
	let titleReferencesRaw = ldata.landTitleSelection?.titleReferences || [];
	let titleReferences = { current: [], historical: [] };
	
	// Normalize to new format
	if (Array.isArray(titleReferencesRaw)) {
		// Old format: flat array, put all in current
		titleReferences.current = titleReferencesRaw;
	} else if (titleReferencesRaw.current && Array.isArray(titleReferencesRaw.current)) {
		// New format: object with current/historical
		titleReferences = titleReferencesRaw;
	}
	
	const detail = ldata.landTitleSelection?.detail || 'ALL';
	
	// Filter titleReferences based on detail selection
	let filteredTitleReferences = [];
	if (detail === 'CURRENT') {
		// For CURRENT, use current array
		filteredTitleReferences = titleReferences.current || [];
	} else if (detail === 'PAST') {
		// For PAST, use historical array
		filteredTitleReferences = titleReferences.historical || [];
	} else if (detail === 'ALL') {
		// For ALL, combine current and historical
		filteredTitleReferences = [...(titleReferences.current || []), ...(titleReferences.historical || [])];
	} else if (detail === 'SUMMARY') {
		// For SUMMARY, still fetch all title references for Complete Property Portfolio
		filteredTitleReferences = [...(titleReferences.current || []), ...(titleReferences.historical || [])];
	}

	// Process each titleReference
	for (const titleRefItem of filteredTitleReferences) {
		try {
			// Fetch stored data from api_data table
			const [storedData] = await sequelize.query(`
				SELECT rdata FROM api_data
				WHERE rtype = 'land-title-reference' AND uuid = $1
				ORDER BY created_at DESC
				LIMIT 1
			`, {
				bind: [titleRefItem.titleReference]
			});

			// Extract ABN and company name from business data for individual searches
			const abnForTitleOrder = ldata?.Abn || ldata?.abn || null;
			const companyNameForTitleOrder = ldata?.Name || ldata?.name || null;
			
			// Call createTitleOrder for each titleReference
			// Pass ABN and company name if available from business data
			const titleOrderData = await createTitleOrder(titleRefItem.jurisdiction, titleRefItem.titleReference, abnForTitleOrder, companyNameForTitleOrder);
			titleOrders.push(titleOrderData);

			// If addOn is enabled, get cotality data for each titleReference
			if (ldata.landTitleSelection.addOn === true && titleOrderData) {
				const loc = titleOrderData?.LocationSegment?.[0]?.Address;
				const formattedAddress = loc ? `${loc.StreetNumber} ${loc.StreetName} ${loc.StreetType} ${loc.City} ${loc.State} ${loc.PostCode}` : null;
				if (formattedAddress) {
					try {
						const cotalityData = await get_cotality_pid(formattedAddress);
						cotalityDataArray.push(cotalityData);
					} catch (error) {
						console.error(`Error fetching cotality data for ${titleRefItem.titleReference}:`, error);
					}
				}
			}
		} catch (error) {
			console.error(`Error processing titleReference ${titleRefItem.titleReference}:`, error);
			// Continue with other titleReferences even if one fails
		}
	}

	// Merge all results
	const reportData = {
		status: true,
		data: {
			currentCount: ldata.landTitleSelection?.currentCount || 0,
			historicalCount: ldata.landTitleSelection?.historicalCount || 0,
			allCount: (ldata.landTitleSelection?.currentCount || 0) + (ldata.landTitleSelection?.historicalCount || 0),
			titleOrders: titleOrders, // Array of all title orders
			cotality: cotalityDataArray.length > 0 ? cotalityDataArray : null, // Array of cotality data
			locatorData: locatorDataArray.length > 0 ? locatorDataArray : null, // Array of locator data
			storedLocatorData: [...(titleReferences.current || []), ...(titleReferences.historical || [])].map(tr => {
				// Return stored locator data structure
				return {
					titleReference: tr.titleReference,
					jurisdiction: tr.jurisdiction
				};
			}),
			// Include titleReferences in the data structure for PDF service to access
			titleReferences: titleReferences
		}
	};
	reportData.data.uuid = "12345678";
	return reportData;
}

async function createTitleOrder(jurisdiction, titleReference, abn = null, companyName = null) {
	// First, check if data already exists in api_data table for this titleReference
	const [existingData] = await sequelize.query(`
		SELECT rdata, id
		FROM api_data
		WHERE rtype = 'land-title-reference' AND uuid = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, {
		bind: [titleReference]
	});

	if (existingData && existingData.length > 0) {
		try {
			const rdata = typeof existingData[0].rdata === 'string' 
				? JSON.parse(existingData[0].rdata) 
				: existingData[0].rdata;
			
			// Return the cached data in the same format as the API response
			// The stored data should be the full API response from the title order
			return rdata;
		} catch (parseError) {
			console.error('Error parsing cached title order data:', parseError);
			// Fall through to API call if parsing fails
		}
	}
	
	bearerToken = await getToken('landtitle');

	url = 'https://online.globalx.com.au/api/national-property/title-orders';

	payload = {
		OrderRequestBlock: {
			OrderReference: 'orderReference',
		},
		ServiceRequestBlock: {
			Jurisdiction: jurisdiction,          // e.g. "NSW"
			TitleReference: titleReference,      // e.g. "99/30539"
			DontUseCachingProduct: true,
		},
	};

	rdata = await axios.post(url, payload, {
		headers: {
			Authorization: `Bearer ${bearerToken}`,
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
	});

	orderIdentifier = rdata.data?.OrderResultBlock?.OrderIdentifier; // expected 201 with OrderResultBlock + ResultURI
	await delay(50000);
	durl = `https://online.globalx.com.au/api/national-property/title-orders/${orderIdentifier}`;
	tdata = await axios.get(durl, {
		headers: {
			Authorization: `Bearer ${bearerToken}`,
			Accept: 'application/json',
		},
	});
	
	// Store the title order data in api_data table for future use
	if (tdata.data) {
		try {
			// Check if record already exists
			const [existingRecord] = await sequelize.query(`
				SELECT id FROM api_data
				WHERE rtype = 'land-title-reference' AND uuid = $1
				LIMIT 1
			`, {
				bind: [titleReference]
			});

			if (existingRecord && existingRecord.length > 0) {
				// Update existing record - update ABN and search_word if provided
				await sequelize.query(`
					UPDATE api_data
					SET rdata = $1, abn = $2, search_word = $3, updated_at = NOW()
					WHERE id = $4
				`, {
					bind: [
						JSON.stringify(tdata.data),
						abn || null,
						companyName || titleReference, // Use company name if available, otherwise titleReference
						existingRecord[0].id
					]
				});
				
			} else {
				// Insert new record - store ABN and company name if provided
				await sequelize.query(`
					INSERT INTO api_data (rtype, uuid, search_word, abn, acn, rdata, alert, created_at, updated_at)
					VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
				`, {
					bind: [
						'land-title-reference',
						titleReference,
						companyName || titleReference, // Use company name if available, otherwise titleReference
						abn || null, // Store ABN if provided
						null, // ACN
						JSON.stringify(tdata.data),
						false
					]
				});
			}
		} catch (storeError) {
			console.error(`Error storing title order data for ${titleReference}:`, storeError);
			// Continue even if storage fails
		}
	}
	
	return tdata.data;
}

async function get_cotality_pid(address) {
	try {
		if (!address || typeof address !== 'string') {
			throw new Error('A valid address is required to lookup property information');
		}

		const bearerToken = await getToken('corelogic');
		const matchResponse = await axios.get('https://api-sbox.corelogic.asia/search/au/matcher/address', {
			params: {
				q: address
			},
			headers: {
				'Authorization': `Bearer ${bearerToken}`,
				'accept': 'application/json',
			}
		});

		const propertyId = matchResponse?.data?.matchDetails?.propertyId;
		if (!propertyId) {
			throw new Error('Unable to determine propertyId from CoreLogic matcher response');
		}

		const [salesHistory, propertyData] = await Promise.all([
			get_cotality_saleshistory(propertyId),
			get_cotality_propertydata(propertyId)
		]);

		return {
			propertyId,
			matchDetails: matchResponse?.data?.matchDetails || null,
			salesHistory,
			propertyData
		};
	} catch (error) {
		console.error('Error fetching CoreLogic property ID:', error?.response?.data || error.message);
		throw error;
	}
}

async function get_cotality_saleshistory(propertyId) {
	const includeHistoric = false;
	const bearerToken = await getToken('corelogic');
	const url = `https://api-sbox.corelogic.asia/property-details/au/properties/${propertyId}/sales`;

	try {
		const response = await axios.get(url, {
			params: { includeHistoric },
			headers: {
				'accept': 'application/json',
				'Authorization': `Bearer ${bearerToken}`
			},
		});

		return response.data;
	} catch (error) {
		console.error('❌ Error:', error.response?.data || error.message);
		throw error;
	}
}

async function get_cotality_propertydata(propertyId) {
	const includeHistoric = false;
	const bearerToken = await getToken('corelogic');
	const url = `https://api-sbox.corelogic.asia/property-details/au/properties/${propertyId}/attributes/core`;

	try {
		const response = await axios.get(url, {
			params: { includeHistoric },
			headers: {
				'accept': 'application/json',
				'Authorization': `Bearer ${bearerToken}`
			},
		});
		return response.data;
	} catch (error) {
		console.error('❌ Error:', error.response?.data || error.message);
		throw error;
	}
}

async function trademark_report(business) {
	try {
		const bearerToken = await getToken('trademark');
		
		const apiUrl = 'https://test.api.ipaustralia.gov.au/public/australian-trade-mark-search-api/v1/search/quick';
		const requestBody = {
			query: business.Name,
			sort: {
				field: "NUMBER",
				direction: "ASCENDING"
			},
			filters: {
				quickSearchType: ["WORD"],
				status: ["REGISTERED"]
			}
		};

		const response = await axios.post(apiUrl, requestBody, {
			headers: {
				'Authorization': `Bearer ${bearerToken}`,
				'Content-Type': 'application/json'
			},
			timeout: 30000 // 30 second timeout
		});

		// Check if count is 0
		if (response.data.count === 0) {
			const reportUuid = `trademark-${Date.now()}-${uuidv4().substring(0, 8)}`;
			console.log('No trademarks found. Returning empty data with UUID:', reportUuid);
			return {
				status: true,
				data: {
					uuid: reportUuid,
					count: 0,
					trademarks: []
				}
			};
		}

		// If there are results, fetch details for each trademark ID
		const trademarkIds = response.data.trademarkIds || [];
		const trademarkDetails = [];

		for (const trademarkId of trademarkIds) {
			try {
				const detailUrl = `https://test.api.ipaustralia.gov.au/public/australian-trade-mark-search-api/v1/trade-mark/${trademarkId}`;
				console.log(`Fetching trademark details for ID: ${trademarkId}`);
				
				const detailResponse = await axios.get(detailUrl, {
					headers: {
						'Authorization': `Bearer ${bearerToken}`,
						'Content-Type': 'application/json'
					},
					timeout: 30000 // 30 second timeout
				});

				console.log(`Trademark ${trademarkId} Details:`, JSON.stringify(detailResponse.data, null, 2));
				trademarkDetails.push(detailResponse.data);
			} catch (error) {
				console.error(`❌ Error fetching trademark ${trademarkId}:`, error.response?.data || error.message);
				// Continue with other trademarks even if one fails
			}
		}

		const reportUuid = `trademark-${Date.now()}-${uuidv4().substring(0, 8)}`;
		console.log('Trademark Report UUID:', reportUuid);
		console.log('Total Trademarks Found:', trademarkDetails.length);
		
		return {
			status: true,
			data: {
				uuid: reportUuid,
				count: response.data.count,
				trademarkIds: trademarkIds,
				trademarks: trademarkDetails,
				aggregations: response.data.aggregations
			}
		};
	} catch (error) {
		console.error('❌ Trademark API Error:', error.response?.data || error.message);
		throw error;
	}
}

// Function to create report via external API
async function createReport({ business, type, userId, matterId, ispdfcreate, skipExistingCheck = false, userReportIdToUpdate = null, watchlistNotifications = null }) {
	try {
		let existingReport = null;
		let iresult = null;
		let reportId = null;
		let reportData = null;
		let pdffilename = null;
		let abn = null;
		let acn = null;
		
		if (business?.isCompany == "ORGANISATION") {
			abn = business?.Abn;
			if (abn && abn.length >= 2) {
				acn = abn.substring(2);
			}
			if (!abn) {
				throw new Error('ABN not found in business data');
			}
		}

		// Skip existing check if skipExistingCheck is true
		if (!skipExistingCheck && business?.isCompany == "ORGANISATION") {
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
			if (type == "asic-current" || type == "court" || type == "ato") {
				const apiUrl = 'https://alares.com.au/api/reports/create';
				const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
				const params = {
				    type: 'company',
				    abn: abn,
				    asic_current: '1'
				};
				createResponse = await axios.post(apiUrl, null, {
				    params: params,
				    headers: {
				        'Authorization': `Bearer ${bearerToken}`,
				        'Content-Type': 'application/json'
				    },
				    timeout: 30000 // 30 second timeout - report creation should be quick
				});

				// Now call GET API to fetch the report data
				reportData = await asic_report_data(createResponse.data.uuid);

			} else if (type == "asic-historical") {

				const apiUrl = 'https://alares.com.au/api/reports/create';
				const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
				const params = {
				    type: 'company',
				    abn: abn,
				    asic_historical: '1'
				};
				createResponse = await axios.post(apiUrl, null, {
				    params: params,
				    headers: {
				        'Authorization': `Bearer ${bearerToken}`,
				        'Content-Type': 'application/json'
				    },
				    timeout: 30000 // 30 second timeout - report creation should be quick
				});

				// Now call GET API to fetch the report data
				reportData = await asic_report_data(createResponse.data.uuid);

			} else if (type == "asic-company") {
				const apiUrl = 'https://alares.com.au/api/reports/create';
				const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
				const params = {
				    type: 'company',
				    abn: abn,
				    asic_relational: '1'
				};
				createResponse = await axios.post(apiUrl, null, {
				    params: params,
				    headers: {
				        'Authorization': `Bearer ${bearerToken}`,
				        'Content-Type': 'application/json'
				    },
				    timeout: 30000 // 30 second timeout - report creation should be quick
				});

				//Now call GET API to fetch the report data
				reportData = await asic_report_data(createResponse.data.uuid);
				
			} else if (type == "ppsr") {
				// Get dynamic token for PPSR
				const ppsrToken = await getToken('ppsr');

				// Step 1: Submit search request
				const submitUrl = 'https://gateway.ppsrcloud.com/api/b2b/ausearch/submit-grantor-session-cmd';
				const requestData = {
					customerRequestId: "flexcollect-001",
					clientReference: "Credion Company Search",
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
					timeout: 30000 // 30 second timeout
				});

				// Extract auSearchIdentifier from the response
				const auSearchIdentifier = submitResponse.data.resource?.ppsrCloudId;
				if (!auSearchIdentifier) {
					throw new Error('No auSearchIdentifier (ppsrCloudId) returned from PPSR submit request');
				}

				// Step 2: Fetch actual data using the auSearchIdentifier
				reportData = await fetchPpsrReportData(auSearchIdentifier);
			} else if (type == 'property') {
				reportData = await property(business.Abn, business.Name, business);
			} else if (type == "director-ppsr") {
				reportData = await director_ppsr_report(business);
			} else if (type == "director-bankruptcy") {
				reportData = await director_bankrupcty_report(business);
			} else if (type == "director-related") {
				reportData = await director_related_report(business, false);
			} else if (type == "director-related-historical") {
				reportData = await director_related_report(business, true);
			} else if (type == "director-court") {
				reportData = await director_court_report(business);
			} else if (type == "director-court-civil") {
				reportData = await director_court_civil(business);
			} else if (type == "director-court-criminal") {
				reportData = await director_court_criminal(business);
			}  else if (type == 'director-property') {
				reportData = await director_property(business);
			} else if (type == 'land-title-reference') {
				reportData = await land_title_reference(business);
			} else if (type == 'land-title-address') {
				reportData = await land_title_address(business);
			} else if (type == 'land-title-organisation') {
				reportData = await land_title_organisation(business);
			} else if (type == 'land-title-individual') {
				reportData = await land_title_individual(business);
			} else if (type == 'sole-trader-check') {
				reportData = await sole_trader_check_report(business);
			} else if(type == 'rego-ppsr'){
				reportData = await rego_ppsr_report(business);
			} else if(type == 'unclaimed-money'){
				reportData = await unclaimed_money_report(business);
			} else if(type == 'trademark'){
				reportData = await trademark_report(business);
			}

			if (!existingReport && reportData && reportData.status !== false && reportData.data) {
				// If watchlistNotifications are provided, merge them with reportData
				if (watchlistNotifications && Array.isArray(watchlistNotifications) && watchlistNotifications.length > 0) {
					// Initialize watchlist notifications array in reportData
					if (!reportData.data.watchlist_notifications) {
						reportData.data.watchlist_notifications = [];
					}
					
					// Process each notification and merge relevant data
					watchlistNotifications.forEach((watchlistNotification) => {
						// Add notification metadata
						const notificationData = {
							id: watchlistNotification.id,
							watchlist_id: watchlistNotification.watchlist_id,
							watchlist_entity_id: watchlistNotification.watchlist_entity_id,
							watchlist: watchlistNotification.watchlist || null,
							source: watchlistNotification.source || null,
							case_type: watchlistNotification.case_type || null,
							status: watchlistNotification.status || null,
							match_type: watchlistNotification.match_type || null,
							matched_on: watchlistNotification.matched_on || null,
							matched_party_role: watchlistNotification.matched_party_role || null,
							type: watchlistNotification.type || null,
							url: watchlistNotification.url || null,
							details: watchlistNotification.details || null,
							details_html: watchlistNotification.details_html || null,
							created_at: watchlistNotification.created_at || null,
							updated_at: watchlistNotification.updated_at || null
						};
						
						// Merge case data if available
						if (watchlistNotification.case && Array.isArray(watchlistNotification.case) && watchlistNotification.case.length > 0) {
							if (!reportData.data.cases || !Array.isArray(reportData.data.cases)) {
								reportData.data.cases = [];
							}
							// Merge cases, avoiding duplicates
							watchlistNotification.case.forEach(caseItem => {
								const exists = reportData.data.cases.some(existing => existing.id === caseItem.id);
								if (!exists) {
									reportData.data.cases.push(caseItem);
								}
							});
							notificationData.case = watchlistNotification.case;
						}
						
						// Merge licence_class if available
						if (watchlistNotification.licence_class !== null && watchlistNotification.licence_class !== undefined) {
							if (!reportData.data.licences || !Array.isArray(reportData.data.licences)) {
								reportData.data.licences = [];
							}
							// Add licence class info if not already present
							const licenceInfo = {
								class: watchlistNotification.licence_class,
								source: 'watchlist',
								notification_id: watchlistNotification.id
							};
							reportData.data.licences.push(licenceInfo);
							notificationData.licence_class = watchlistNotification.licence_class;
						}
						
						// Merge ASIC document if available
						if (watchlistNotification.asic_document) {
							// PDF service reads from asic_extracts[0].documents, so merge there
							if (!reportData.data.asic_extracts || !Array.isArray(reportData.data.asic_extracts) || reportData.data.asic_extracts.length === 0) {
								// If no asic_extracts, create one
								reportData.data.asic_extracts = [{
									type: 'Current',
									documents: []
								}];
							}
							
							const firstExtract = reportData.data.asic_extracts[0];
							if (!firstExtract.documents || !Array.isArray(firstExtract.documents)) {
								firstExtract.documents = [];
							}
							
							// Check if document already exists by uuid or document_number
							const existingDoc = firstExtract.documents.find(doc => 
								doc.uuid === watchlistNotification.asic_document.uuid ||
								(doc.document_number && watchlistNotification.asic_document.document_number && 
								 doc.document_number === watchlistNotification.asic_document.document_number)
							);
							
							if (!existingDoc) {
								// Convert watchlist asic_document format to Alares documents format
								const watchlistDoc = {
									type: 'Other',
									description: watchlistNotification.asic_document.description || 'ASIC Document',
									document_number: watchlistNotification.asic_document.uuid || null,
									form_code: null,
									page_count: null,
									effective_at: watchlistNotification.created_at || null,
									processed_at: watchlistNotification.created_at || null,
									received_at: watchlistNotification.created_at || null,
									created_at: watchlistNotification.created_at || null,
									updated_at: watchlistNotification.updated_at || null,
									uuid: watchlistNotification.asic_document.uuid || null,
									source: 'watchlist',
									notification_id: watchlistNotification.id
								};
								firstExtract.documents.push(watchlistDoc);
							}
							
							// Also store in asic_documents array for reference
							if (!reportData.data.asic_documents || !Array.isArray(reportData.data.asic_documents)) {
								reportData.data.asic_documents = [];
							}
							const existingDocInArray = reportData.data.asic_documents.find(doc => doc.uuid === watchlistNotification.asic_document.uuid);
							if (!existingDocInArray) {
								reportData.data.asic_documents.push({
									...watchlistNotification.asic_document,
									source: 'watchlist',
									notification_id: watchlistNotification.id
								});
							}
							
							notificationData.asic_document = watchlistNotification.asic_document;
						}
						
						// Merge notification-specific data (e.g., tax debt updates)
						if (watchlistNotification.data) {
							notificationData.notification_data = watchlistNotification.data;
							
							// If it's a tax debt notification, update current_tax_debt
							if (watchlistNotification.type === 'Tax Debt' && watchlistNotification.data.amount !== undefined) {
								if (!reportData.data.current_tax_debt) {
									reportData.data.current_tax_debt = {};
								}
								// Update tax debt with latest notification data
								reportData.data.current_tax_debt.date = watchlistNotification.data.date || reportData.data.current_tax_debt.date;
								reportData.data.current_tax_debt.amount = watchlistNotification.data.amount;
								if (watchlistNotification.data.previous_amount !== undefined) {
									reportData.data.current_tax_debt.previous_amount = watchlistNotification.data.previous_amount;
								}
								if (watchlistNotification.data.action) {
									reportData.data.current_tax_debt.action = watchlistNotification.data.action;
								}
								reportData.data.current_tax_debt.ato_updated_at = watchlistNotification.updated_at || reportData.data.current_tax_debt.ato_updated_at;
							}
						}
						
						// Overwrite insolvency_risk_factor if provided in notification
						if (watchlistNotification.insolvency_risk_factor !== null && watchlistNotification.insolvency_risk_factor !== undefined) {
							reportData.data.insolvency_risk_factor = watchlistNotification.insolvency_risk_factor;
							notificationData.insolvency_risk_factor = watchlistNotification.insolvency_risk_factor;
						}
						
						// Add notification to array
						reportData.data.watchlist_notifications.push(notificationData);
					});
					
		
				}
				
				// Extract search word dynamically from business object
				const searchWord = extractSearchWord(business, type);
				
				// Determine if this is an organization or individual based on report type
				// For landtitle reports, use the type to determine organization vs individual
				const isLandTitleOrg = type === 'land-title-organisation';
				const isLandTitleIndividual = type === 'land-title-individual';
				const isOrganization = isLandTitleOrg || 
				                     (business?.isCompany === "ORGANISATION" && !isLandTitleIndividual);
				
				// For landtitle organization reports, extract ABN if not already extracted
				if (isLandTitleOrg && !abn) {
					abn = business?.Abn || business?.abn || null;
					if (abn && abn.length >= 2) {
						acn = abn.substring(2);
					}
				}

				if (isOrganization) {
					[iresult] = await sequelize.query(`
                        INSERT INTO api_data ( rtype, uuid, search_word, abn, acn, rdata, alert, created_at, updated_at ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING id`,
						{
							bind: [
								type,
								reportData.data.uuid,
								searchWord || null,
								abn || null,
								acn || null,
								JSON.stringify(reportData.data) || null,
								false,
							]
						}
					);
				} else {
					[iresult] = await sequelize.query(`
                        INSERT INTO api_data ( rtype, uuid, search_word, abn, acn, rdata, alert, created_at, updated_at ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING id`,
						{
							bind: [
								type,
								reportData.data.uuid,
								searchWord || null,
								null,
								null,
								JSON.stringify(reportData.data) || null,
								false,
							]
						}
					);
				}
				reportId = iresult[0].id;
			}
		}

		if (!reportData.data && typeof reportData === 'object') {
			reportData = { data: reportData };
		}

		if (ispdfcreate) {
			// Extract search word and sanitize for filename
			const searchWord = extractSearchWord(business, type);
			const sanitizedSearchWord = searchWord 
				? searchWord.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
				: '';
			const filename = sanitizedSearchWord 
				? `${type}_${sanitizedSearchWord}_${uuidv4()}`
				: `${type}_${uuidv4()}`;
			pdffilename = await addDownloadReportInDB(
				reportData,
				userId,
				matterId,
				reportId,
				filename,
				type,
				business,
				userReportIdToUpdate || null
			);
			return {
				success: true,
				reportId,
				pdfFilename: pdffilename
			};
		} else {
			return {
				success: true,
				reportId
			}
		}

	} catch (error) {
		console.error('Error creating report:', error);
		console.error('Error stack:', error.stack);
		
		// If error already has a descriptive message, preserve it
		if (error.message && (
			error.message.includes('Failed to lookup vehicle info') ||
			error.message.includes('No ppsrCloudId found') ||
			error.message.includes('No VIN found') ||
			error.message.includes('Rego number and state are required')
		)) {
			throw error; // Re-throw with original message
		}
		
		if (error.response) {
			// API returned an error response
			throw new Error(`Report API error: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`);
		} else if (error.request) {
			// Request was made but no response received
			throw new Error(`Report API request failed - no response received. ${error.message || 'The API may be unavailable or timed out.'}`);
		} else {
			// Something else happened
			throw new Error(`Report creation failed: ${error.message}`);
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

async function searchLandTitleByOrganization(abn, state, companyName) {
	const bearerToken = await getToken('landtitle');
	const url = 'https://online.globalx.com.au/api/national-property/locator-orders';

	// If company name is not provided, get it from ABN lookup
	let organizationName = companyName;

	if (!organizationName) {
		throw new Error('Company name is required for organization search');
	}

	const body = {
		OrderRequestBlock: {
			OrderReference: 'Credion',
		},
		ServiceRequestBlock: {
			Jurisdiction: state,
			"Owner": {
				"Organisation": {
					"Name": organizationName
				}
			}
		}
	};
	
	try {
		const response = await axios.post(url, body, {
			headers: {
				'Authorization': `Bearer ${bearerToken}`,
				'Content-Type': 'application/json',
				'Accept': 'application/json'
			},
			timeout: 30000 // optional
		});

		const orderIdentifier = response.data?.OrderResultBlock?.OrderIdentifier;
		if (!orderIdentifier) {
			throw new Error('No order identifier received from API');
		}

		// Wait for order to complete
		await delay(50000);
		
		const durl = `https://online.globalx.com.au/api/national-property/locator-orders/${orderIdentifier}`;
		const tdata = await axios.get(durl, {
			headers: {
				Authorization: `Bearer ${bearerToken}`,
				Accept: 'application/json',
			},
		});
		
		// Check if MatchType is NEAR_MATCHES
		const matchType = tdata.data?.ServiceResultBlock?.MatchType;
		const isNearMatch = matchType === 'NEAR_MATCHES';
		
		// Count IdentityBlock items in RealPropertySegment and extract TitleReferences with jurisdiction
		const realPropertySegment = tdata.data?.RealPropertySegment || [];
		
		// If NEAR_MATCHES, set current to 0 and don't pass titleReferences
		let currentCount = 0;
		let historicalCount = 0; // Always 0 as per requirements
		let titleReferences = { current: [], historical: [] };
		
		if (!isNearMatch) {
			currentCount = realPropertySegment.length; // Total count of IdentityBlock items
			// Extract all TitleReferences with their jurisdictions from IdentityBlock
			// Put them in current array (historical is always empty for organizations)
			titleReferences.current = realPropertySegment
				.map(segment => ({
					titleReference: segment?.IdentityBlock?.TitleReference,
					jurisdiction: segment?.IdentityBlock?.Jurisdiction || state
				}))
				.filter(item => item.titleReference != null); // Filter out null/undefined values
		}

		return {
			current: currentCount,
			historical: historicalCount,
			titleReferences: titleReferences,
			fullApiResponse: tdata.data, // Return full API response for storage
			matchType: matchType, // Include matchType for reference
			isNearMatch: isNearMatch // Flag to indicate NEAR_MATCHES
		};
	} catch (err) {
		if (err.response) {
			console.error('❌ API Error:', err.response.status, err.response.data);
		} else {
			console.error('❌ Request Error:', err.message);
		}
		throw err;
	}
}

async function searchLandTitleByPerson(firstName, lastName, state) {
	const bearerToken = await getToken('landtitle');
	const url = 'https://online.globalx.com.au/api/national-property/locator-orders';

	if (!lastName) {
		throw new Error('Last name is required for individual search');
	}

	const body = {
		OrderRequestBlock: {
			OrderReference: 'Credion',
		},
		ServiceRequestBlock: {
			Jurisdiction: state,
			"Owner": {
				"Individual": {
					"FirstName": firstName || "",
					"LastName": lastName
				}
			}
		}
	};
	
	try {
		const response = await axios.post(url, body, {
			headers: {
				'Authorization': `Bearer ${bearerToken}`,
				'Content-Type': 'application/json',
				'Accept': 'application/json'
			},
			timeout: 10000 // optional
		});

		const orderIdentifier = response.data?.OrderResultBlock?.OrderIdentifier;
		if (!orderIdentifier) {
			throw new Error('No order identifier received from API');
		}

		// Wait for order to complete
		await delay(50000);
		
		const durl = `https://online.globalx.com.au/api/national-property/locator-orders/${orderIdentifier}`;
		const tdata = await axios.get(durl, {
			headers: {
				Authorization: `Bearer ${bearerToken}`,
				Accept: 'application/json',
			},
		});
		
		// Count IdentityBlock items in RealPropertySegment and extract TitleReferences with jurisdiction
		const realPropertySegment = tdata.data?.RealPropertySegment || [];
		const currentCount = realPropertySegment.length; // Total count of IdentityBlock items
		const historicalCount = 0; // Always 0 as per requirements
		
		// Extract all TitleReferences with their jurisdictions from IdentityBlock
		// Put them in current array (historical is always empty for individuals)
		const titleReferences = {
			current: realPropertySegment
				.map(segment => ({
					titleReference: segment?.IdentityBlock?.TitleReference,

					jurisdiction: segment?.IdentityBlock?.Jurisdiction || state
				}))
				.filter(item => item.titleReference != null), // Filter out null/undefined values
			historical: []
		};

		// Extract unique person names from OwnerNames
		const personNamesSet = new Set();
		realPropertySegment.forEach(segment => {
			const ownerNames = segment?.IdentityBlock?.OwnerNames || [];
			ownerNames.forEach(name => {
				if (name && name.trim()) {
					personNamesSet.add(name.trim());
				}
			});
		});
		const personNames = Array.from(personNamesSet);

		return {
			current: currentCount,
			historical: historicalCount,
			titleReferences: titleReferences,
			personNames: personNames, // Add person names to response
			fullApiResponse: tdata.data // Return full API response for storage
		};
	} catch (err) {
		if (err.response) {
			console.error('❌ API Error:', err.response.status, err.response.data);
		} else {
			console.error('❌ Request Error:', err.message);
		}
		throw err;
	}
}

// Land title counts endpoint
router.post('/land-title/counts', async (req, res) => {
	try {
		const { type, abn, companyName, firstName, lastName, dob, startYear, endYear, states } = req.body;

		if (!type || !['organization', 'individual'].includes(type)) {
			return res.status(400).json({
				success: false,
				error: 'INVALID_TYPE',
				message: 'Type must be either "organization" or "individual"'
			});
		}

		if (!states || !Array.isArray(states) || states.length === 0) {
			return res.status(400).json({
				success: false,
				error: 'MISSING_STATES',
				message: 'At least one state is required'
			});
		}

		let currentCount = 0;
		let historicalCount = 0;
		const allTitleReferences = { current: [], historical: [] }; // Collect all TitleReferences from all states, organized by current/historical
		const storedDataIds = []; // Collect stored data IDs
		let organizationName = null; // Declare organizationName in outer scope
		let searchTerm = null; // Declare searchTerm in outer scope

		try {
			if (type === 'organization') {
				if (!abn) {
					return res.status(400).json({
						success: false,
						error: 'MISSING_ABN',
						message: 'ABN is required for organization search'
					});
				}

				// Check if data already exists in api_data table for this ABN
				const [existingData] = await sequelize.query(`
					SELECT uuid, rdata, id
					FROM api_data
					WHERE rtype = 'land-title-organisation-summary-fullresult' AND abn = $1
					ORDER BY created_at DESC
				`, {
					bind: [abn]
				});

				if (existingData && existingData.length > 0) {
					
					// Extract data from the summary record (land-title-organisation)
					// This record contains the aggregated counts and titleReferences
					try {
						const summaryRecord = existingData[0]; // Get the most recent summary record
						// Parse rdata if it's a string (stored as JSON in PostgreSQL)
						const rdata = typeof summaryRecord.rdata === 'string' 
							? JSON.parse(summaryRecord.rdata) 
							: summaryRecord.rdata;
						
						// Extract counts and titleReferences from summary record
						currentCount = rdata?.currentCount || 0;
						historicalCount = rdata?.historicalCount || 0;
						
						// Extract titleReferences from summary record
						// Handle both old format (array) and new format (object with current/historical)
						
						if (rdata?.titleReferences) {
							if (Array.isArray(rdata.titleReferences)) {
								// Old format: flat array, put all in current
								allTitleReferences.current.push(...rdata.titleReferences);
							} else if (rdata.titleReferences.current && Array.isArray(rdata.titleReferences.current)) {
								// New format: object with current/historical
								allTitleReferences.current.push(...rdata.titleReferences.current);
								if (rdata.titleReferences.historical && Array.isArray(rdata.titleReferences.historical)) {
									allTitleReferences.historical.push(...rdata.titleReferences.historical);
								}
							}
						}
		
						// Return cached data
						return res.json({
							success: true,
							current: currentCount,
							historical: historicalCount,
							titleReferences: allTitleReferences,
							storedDataIds: summaryRecord.id,
							cached: true // Flag to indicate this is cached data
						});
					} catch (parseError) {
						console.error('Error parsing cached summary data:', parseError);
						// Fall through to API call if parsing fails
					}
				}

				// Get company name if not provided
				organizationName = companyName;
				if (!organizationName && abn) {
					try {
						const abnInfo = await getABNInfo(abn);
						organizationName = abnInfo?.EntityName || abnInfo?.Name || abn;
					} catch (error) {
						console.error('Error fetching company name from ABN:', error);
						organizationName = abn;
					}
				}

				// Search for land titles by organization/ABN across all states
				for (const state of states) {
					try {
						const searchResults = await searchLandTitleByOrganization(abn, state, organizationName);
						currentCount += searchResults.current || 0;
						historicalCount += searchResults.historical || 0;
						
						// Add titleReferences to the collection (merge current and historical)
						if (searchResults.titleReferences) {
							if (Array.isArray(searchResults.titleReferences)) {
								// Old format: flat array, put all in current
								allTitleReferences.current.push(...searchResults.titleReferences);
							} else if (searchResults.titleReferences.current && Array.isArray(searchResults.titleReferences.current)) {
								// New format: object with current/historical
								allTitleReferences.current.push(...searchResults.titleReferences.current);
								if (searchResults.titleReferences.historical && Array.isArray(searchResults.titleReferences.historical)) {
									allTitleReferences.historical.push(...searchResults.titleReferences.historical);
								}
							}
						}
						
						const titleRefsArray = searchResults.titleReferences?.current || (Array.isArray(searchResults.titleReferences) ? searchResults.titleReferences : []);
						if (searchResults.fullApiResponse && titleRefsArray.length > 0) {
							try {
								// Store the full API response once for this state search
								const [result] = await sequelize.query(`
									INSERT INTO api_data (rtype, uuid, search_word, abn, acn, rdata, alert, created_at, updated_at)
									VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`, {
									bind: [
										'land-title-organisation-summary',
										organizationName || abn,
										organizationName || abn,
										abn,
										null,
										JSON.stringify(searchResults.fullApiResponse),
										false
									]
								});
								
								if (result && result.length > 0) {
									// Add only one storedDataId per state search
									storedDataIds.push({
										dataId: result[0].id,
										matchType: searchResults.matchType, // Store matchType for reference
										isNearMatch: searchResults.isNearMatch // Store isNearMatch flag
									});
								}
							} catch (dbError) {
								console.error(`Error storing data for state ${state}:`, dbError);
								// Continue even if storage fails
							}
						}
					} catch (error) {
						console.error(`Error searching land title for state ${state}:`, error);
						// Continue with other states even if one fails
					}
				}

				const summaryData = {
					uuid: abn,
					abn: abn, // Store ABN in rdata for easy retrieval
					companyName: organizationName || abn, // Store company name in rdata
					allCount: currentCount + historicalCount,
					currentCount: currentCount,
					historicalCount: historicalCount,
					titleReferences: allTitleReferences,
				};

				await sequelize.query(`
					INSERT INTO api_data (rtype, uuid, search_word, abn, acn, rdata, alert, created_at, updated_at)
					VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
				`, {
					bind: [
						'land-title-organisation-summary-fullresult',
						abn, // uuid = abn
						organizationName || abn, // search_word = company name
						abn, // abn field = abn (ensure this is properly stored)
						null, // ACN
						JSON.stringify(summaryData),
						false
					]
				});

			} else {
				// Individual search
				if (!lastName) {
					return res.status(400).json({
						success: false,
						error: 'MISSING_LAST_NAME',
						message: 'Last name is required for individual search'
					});
				}
				searchTerm = `${firstName || ''} ${lastName}`.trim();

				// Check if data already exists in api_data table for this individual
				// For individuals, we check by rtype and search_word (which contains firstName lastName dob)
				const [existingData] = await sequelize.query(`
					SELECT uuid, rdata, id
					FROM api_data
					WHERE rtype = 'land-title-individual-summary-fullresult' 
						AND search_word = $1
						AND abn IS NULL
					ORDER BY created_at DESC
				`, {
					bind: [searchTerm]
				});

				if (existingData && existingData.length > 0) {
					try {
						const summaryRecord = existingData[0]; // Get the most recent summary record
						// Parse rdata if it's a string (stored as JSON in PostgreSQL)
						const rdata = typeof summaryRecord.rdata === 'string' 
							? JSON.parse(summaryRecord.rdata) 
							: summaryRecord.rdata;
						
						// Extract counts and titleReferences from summary record
						currentCount = rdata?.currentCount || 0;
						historicalCount = rdata?.historicalCount || 0;
						
						// Extract titleReferences from summary record
						// Handle both old format (array) and new format (object with current/historical)
						if (rdata?.titleReferences) {
							if (Array.isArray(rdata.titleReferences)) {
								// Old format: flat array, put all in current
								allTitleReferences.current.push(...rdata.titleReferences);
							} else if (rdata.titleReferences.current && Array.isArray(rdata.titleReferences.current)) {
								// New format: object with current/historical
								allTitleReferences.current.push(...rdata.titleReferences.current);
								if (rdata.titleReferences.historical && Array.isArray(rdata.titleReferences.historical)) {
									allTitleReferences.historical.push(...rdata.titleReferences.historical);
								}
							}
						}

						// Extract search_word from summary record
						const searchWord = summaryRecord.search_word || searchTerm;
						
						// Return cached data
						return res.json({
							success: true,
							current: currentCount,
							historical: historicalCount,
							titleReferences: allTitleReferences,
							storedDataIds: summaryRecord.id,
							search_word: searchWord, // Return search word from counts response
							cached: true // Flag to indicate this is cached data
						});
					} catch (parseError) {
						console.error('Error parsing cached summary data:', parseError);
						// Fall through to API call if parsing fails
					}
				}

				// Search for land titles by individual name across all states
				for (const state of states) {
					try {
						const searchResults = await searchLandTitleByPerson(firstName, lastName, state);
						currentCount += searchResults.current || 0;
						historicalCount += searchResults.historical || 0;
						
						// Add titleReferences to the collection (merge current and historical)
						if (searchResults.titleReferences) {
							if (Array.isArray(searchResults.titleReferences)) {
								// Old format: flat array, put all in current
								allTitleReferences.current.push(...searchResults.titleReferences);
							} else if (searchResults.titleReferences.current && Array.isArray(searchResults.titleReferences.current)) {
								// New format: object with current/historical
								allTitleReferences.current.push(...searchResults.titleReferences.current);
								if (searchResults.titleReferences.historical && Array.isArray(searchResults.titleReferences.historical)) {
									allTitleReferences.historical.push(...searchResults.titleReferences.historical);
								}
							}
						}
						
						// Store API response once per state (not per titleReference)
						const titleRefsArray = searchResults.titleReferences?.current || (Array.isArray(searchResults.titleReferences) ? searchResults.titleReferences : []);
						if (searchResults.fullApiResponse && titleRefsArray.length > 0) {
							try {
								// Store the full API response once for this state search
								// Use the first titleReference as the uuid for this stored record
								const firstTitleRef = titleRefsArray[0];
								const [result] = await sequelize.query(`
									INSERT INTO api_data (rtype, uuid, search_word, abn, acn, rdata, alert, created_at, updated_at)
									VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`, {
									bind: [
										'land-title-individual-summary',
										searchTerm,
										searchTerm,
										null,
										null,
										JSON.stringify(searchResults.fullApiResponse),
										false
									]
								});
								
								if (result && result.length > 0) {
									// Add only one storedDataId per state search
									storedDataIds.push({
										dataId: result[0].id
									});
								}
							} catch (dbError) {
								console.error(`Error storing data for state ${state}:`, dbError);
								// Continue even if storage fails
							}
						}
					} catch (error) {
						console.error(`Error searching land title for state ${state}:`, error);
						// Continue with other states even if one fails
					}
				}

				const summaryData = {
					uuid: searchTerm,
					abn: null, // Store ABN in rdata for easy retrieval
					companyName: searchTerm, // Store company name in rdata
					allCount: currentCount + historicalCount,
					currentCount: currentCount,
					historicalCount: historicalCount,
					titleReferences: allTitleReferences,
				};

				await sequelize.query(`
					INSERT INTO api_data (rtype, uuid, search_word, abn, acn, rdata, alert, created_at, updated_at)
					VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
				`, {
					bind: [
						'land-title-individual-summary-fullresult',
						searchTerm, // uuid = abn
						searchTerm, // search_word = company name
						null, // abn field = abn (ensure this is properly stored)
						null, // ACN
						JSON.stringify(summaryData),
						false
					]
				});
			}
			return res.json({
				success: true,
				current: currentCount,
				historical: historicalCount,
				titleReferences: allTitleReferences,
				storedDataIds: storedDataIds // Return stored data IDs
			});

		} catch (apiError) {
			console.error('Error fetching land title counts from API:', apiError?.response?.data || apiError.message);
			throw apiError;
		}

	} catch (error) {
		console.error('Error in land title counts endpoint:', error?.response?.data || error.message);
		
		const status = error?.response?.status || 500;
		const message = error?.response?.data?.message || error?.message || 'Failed to fetch land title counts';

		return res.status(status).json({
			success: false,
			error: 'LAND_TITLE_COUNTS_ERROR',
			message: message
		});
	}
});

// Land title person name search endpoint
router.post('/land-title/search-person-names', async (req, res) => {
	try {
		const { firstName, lastName, state } = req.body;

		if (!lastName || !lastName.trim()) {
			return res.status(400).json({
				success: false,
				error: 'MISSING_LAST_NAME',
				message: 'Last name is required for person name search'
			});
		}

		if (!state || !state.trim()) {
			return res.status(400).json({
				success: false,
				error: 'MISSING_STATE',
				message: 'State is required for person name search'
			});
		}

		try {
			// Call the search function
			const result = await searchLandTitleByPerson(
				firstName?.trim() || "",
				lastName.trim(),
				state.trim(),
				null // dob not used in locator search
			);

			// Return person names from the result
			return res.json({
				success: true,
				personNames: result.personNames || [],
				fullApiResponse: result.fullApiResponse // Optionally return full response
			});

		} catch (apiError) {
			console.error('Error fetching person names from API:', apiError?.response?.data || apiError.message);
			throw apiError;
		}

	} catch (error) {
		console.error('Error in land title person name search endpoint:', error?.response?.data || error.message);
		
		const status = error?.response?.status || 500;
		const message = error?.response?.data?.message || error?.message || 'Failed to fetch person names';

		return res.status(status).json({
			success: false,
			error: 'LAND_TITLE_PERSON_SEARCH_ERROR',
			message: message
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