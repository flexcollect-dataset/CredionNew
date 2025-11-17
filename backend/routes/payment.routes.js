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

router.get('/bankruptcy/matches', async (req, res) => {
	try {
		const { firstName, lastName, dateOfBirth } = req.query;

		if (!lastName || typeof lastName !== 'string' || lastName.trim().length === 0) {
			return res.status(400).json({
				success: false,
				error: 'MISSING_SURNAME',
				message: 'Last name is required to search bankruptcy records'
			});
		}

		const rawData = await searchBankruptcyMatches({
			debtorSurname: lastName.trim(),
			debtorGivenName: firstName && typeof firstName === 'string' ? firstName.trim() : undefined,
			debtorDateOfBirth: dateOfBirth && typeof dateOfBirth === 'string' ? dateOfBirth.trim() : undefined
		});

		const matches = Array.isArray(rawData?.insolvencies) ? rawData.insolvencies : [];

		return res.json({
			success: true,
			resultCount: rawData?.resultCount ?? matches.length,
			resultLimitExceeded: rawData?.resultLimitExceeded ?? false,
			operationFeeAmount: rawData?.operationFeeAmount ?? null,
			matches
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
			message
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

async function searchBankruptcyMatches(params = {}) {
	const { debtorSurname, debtorGivenName, debtorDateOfBirth } = params;

	if (!debtorSurname) {
		throw new Error('debtorSurname is required');
	}

	const bearerToken = await getToken('bankruptcy');
	const apiUrl = 'https://services.afsa.gov.au/brs/api/v2/search-by-name';

	const requestParams = {
		debtorSurname,
	};

	if (debtorGivenName) {
		requestParams.debtorGivenName = debtorGivenName;
	}

	if (debtorDateOfBirth) {
		requestParams.debtorDateOfBirth = debtorDateOfBirth;
	}

	const response = await axios.get(apiUrl, {
		params: requestParams,
		headers: {
			Authorization: `Bearer ${bearerToken}`,
			Accept: 'application/json'
		},
		responseType: 'json',
		timeout: 30000
	});

	return response.data;
}

async function director_related_report(fname, lname, dob) {
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

async function searchDirectorRelatedMatches(params = {}) {
	const { firstName, lastName, dobFrom, dobTo } = params;

	if (!lastName) {
		throw new Error('lastName is required');
	}

	const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
	const apiUrl = 'https://alares.com.au/api/asic/search';

	const requestParams = {
		last_name: lastName,
	};

	if (firstName) {
		requestParams.first_name = firstName;
	}

	if (dobFrom) {
		requestParams.dob_from = dobFrom;
	}

	if (dobTo) {
		requestParams.dob_to = dobTo;
	}

	const response = await axios.get(apiUrl, {
		params: requestParams,
		headers: {
			Authorization: `Bearer ${bearerToken}`,
			Accept: 'application/json'
		},
		responseType: 'json',
		timeout: 30000
	});

	return response.data;
}

async function director_court_report(fname, lname, dob) {
	const bearerToken = '3eiXhUHT9G25QO9';
	const criminalApiUrl = 'https://corp-api.courtdata.com.au/api/search/criminal/record';
	const criminalParams = {
		state: 'NSW',
		fullname: 'ADGEMIS, Jon',
	};

	const criminalResponse = await axios.get(criminalApiUrl, {
		params: criminalParams,
		headers: {
			'Api-Key': bearerToken,
			'accept': 'application/json',
			'X-CSRF-TOKEN': ''
		},
		timeout: 30000
	});

	// Civil Court API (POST)
	const civilApiUrl = 'https://corp-api.courtdata.com.au/api/search/civil/record';
	const civilParams = {
		state: 'NSW',
		fullname: 'ADGEMIS, Jon',
		//fullname: 'ADGEMIS, Jon Angelo George',
	};

	const civilResponse = await axios.get(civilApiUrl, {
		params: civilParams,
		headers: {
			'Api-Key': bearerToken,
			'accept': 'application/json',
			'X-CSRF-TOKEN': ''
		},
		timeout: 30000
	});

	// Merge both responses into one structured JSON
	const reportData = {
		status: true,
		data: {
			criminal_court: criminalResponse.data,
			civil_court: civilResponse.data
		}
	};
	reportData.data.uuid = 'abcdef';
	return reportData;
}

async function director_court_civil(fname, lname, dob) {
	const bearerToken = '3eiXhUHT9G25QO9';

	// Civil Court API (POST)
	const civilApiUrl = 'https://corp-api.courtdata.com.au/api/search/civil/record';
	const civilParams = {
		state: 'NSW',
		fullname: 'ADGEMIS, Jon',
		//fullname: 'ADGEMIS, Jon Angelo George',
	};

	const civilResponse = await axios.get(civilApiUrl, {
		params: civilParams,
		headers: {
			'Api-Key': bearerToken,
			'accept': 'application/json',
			'X-CSRF-TOKEN': ''
		},
		timeout: 30000
	});

	// Merge both responses into one structured JSON
	const reportData = {
		status: true,
		data: {
			criminal_court: null,
			civil_court: civilResponse.data
		}
	};
	reportData.data.uuid = 'abcdef';
	return reportData;
}

async function director_court_criminal(fname, lname, dob) {
	const bearerToken = '3eiXhUHT9G25QO9';
	const criminalApiUrl = 'https://corp-api.courtdata.com.au/api/search/criminal/record';
	const criminalParams = {
		state: 'NSW',
		fullname: 'ADGEMIS, Jon',
	};

	const criminalResponse = await axios.get(criminalApiUrl, {
		params: criminalParams,
		headers: {
			'Api-Key': bearerToken,
			'accept': 'application/json',
			'X-CSRF-TOKEN': ''
		},
		timeout: 30000
	});

	// Merge both responses into one structured JSON
	const reportData = {
		status: true,
		data: {
			criminal_court: criminalResponse.data,
			civil_court: null
		}
	};
	reportData.data.uuid = 'abcdef';
	return reportData;
}

async function property(abn, cname, ldata) {
	console.log(abn);
	console.log(cname);
	console.log(ldata.addOn);

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

async function director_property(fname, lname, dob, ldata) {
	console.log(fname);
	console.log(lname);
	console.log(ldata.addOn);

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
		
		titleRefData = await createTitleOrder(details.state, tdata.data.RealPropertySegment?.[0].IdentityBlock.TitleReference);
		if (ldata.landTitleSelection.addOn === true) {
			cotalityData = await get_cotality_pid(ldata.address);
		}

		const reportData = {
			status: true,
			data: {
				cotality: cotalityData,
				titleOrder: titleRefData,
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
	}
}

async function land_title_reference(ldata) {
	let cotalityData = null;
	let titleRefData = null;

	titleRefData = await createTitleOrder('NSW', ldata.landTitleSelection.referenceId);
	const loc = titleRefData?.LocationSegment?.[0]?.Address;
	const formattedAddress = loc ? `${loc.StreetNumber} ${loc.StreetName} ${loc.StreetType} ${loc.City} ${loc.State} ${loc.PostCode}` : null;
	console.log(titleRefData);
	if (ldata.landTitleSelection.addOn === true) {
		cotalityData = await get_cotality_pid(formattedAddress);
	}

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

async function land_title_organisation(ldata) {
	const titleOrders = [];
	const cotalityDataArray = [];
	const locatorDataArray = [];
	
	// Extract ABN and company name from business data
	let abn = ldata?.Abn || ldata?.abn || null;
	let companyName = ldata?.Name || ldata?.name || null;
	
	// If ABN or company name is missing, try to get from summary record
	if (abn && (!companyName || companyName === 'Unknown')) {
		try {
			const [summaryRecord] = await sequelize.query(`
				SELECT rdata, search_word, abn
				FROM api_data
				WHERE rtype = 'land-title-organisation' AND abn = $1
				ORDER BY created_at DESC
				LIMIT 1
			`, {
				bind: [abn]
			});
			
			if (summaryRecord && summaryRecord.length > 0) {
				const record = summaryRecord[0];
				// Get company name from search_word or rdata
				if (!companyName || companyName === 'Unknown') {
					companyName = record.search_word || companyName;
				}
				
				// Also try to get from rdata if available
				if ((!companyName || companyName === 'Unknown') && record.rdata) {
					try {
						const rdata = typeof record.rdata === 'string' ? JSON.parse(record.rdata) : record.rdata;
						companyName = rdata?.companyName || companyName;
					} catch (parseError) {
						console.error('Error parsing rdata for company name:', parseError);
					}
				}
				
				// Ensure ABN is set from record if not already set
				if (!abn && record.abn) {
					abn = record.abn;
				}
			}
		} catch (error) {
			console.error('Error fetching ABN/company name from summary record:', error);
			// Continue with existing values
		}
	}
	
	console.log('==========================');
	console.log('land_title_organisation - ldata:', ldata);
	console.log('Extracted ABN:', abn);
	console.log('Extracted Company Name:', companyName);
	console.log('==========================');
	
	// Get titleReferences from landTitleSelection
	const titleReferences = ldata.landTitleSelection?.titleReferences || [];
	const detail = ldata.landTitleSelection?.detail || 'ALL';
	
	if (titleReferences.length === 0) {
		throw new Error('No title references found in land title selection');
	}

	// Filter titleReferences based on detail selection
	let filteredTitleReferences = titleReferences;
	if (detail === 'CURRENT') {
		// For CURRENT, we need to determine which are current - this will be handled by the stored data
		filteredTitleReferences = titleReferences;
	} else if (detail === 'PAST') {
		// For PAST, historical count is always 0, so this would be empty
		filteredTitleReferences = [];
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
			storedLocatorData: titleReferences.map(tr => {
				// Return stored locator data structure
				return {
					titleReference: tr.titleReference,
					jurisdiction: tr.jurisdiction
				};
			})
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
	const titleReferences = ldata.landTitleSelection?.titleReferences || [];
	const detail = ldata.landTitleSelection?.detail || 'ALL';
	
	if (titleReferences.length === 0) {
		throw new Error('No title references found in land title selection');
	}

	// Filter titleReferences based on detail selection
	let filteredTitleReferences = titleReferences;
	if (detail === 'CURRENT') {
		// For CURRENT, we need to determine which are current - this will be handled by the stored data
		filteredTitleReferences = titleReferences;
	} else if (detail === 'PAST') {
		// For PAST, historical count is always 0, so this would be empty
		filteredTitleReferences = [];
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
			storedLocatorData: titleReferences.map(tr => {
				// Return stored locator data structure
				return {
					titleReference: tr.titleReference,
					jurisdiction: tr.jurisdiction
				};
			})
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
		console.log(`✅ Found existing title order data for ${titleReference}, using cached data`);
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

	// No cached data found, proceed with API call
	console.log(`🔄 No cached data found for titleReference ${titleReference}, calling API`);
	
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
				console.log(`✅ Updated title order data for ${titleReference} with ABN: ${abn}, Company: ${companyName}`);
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
				console.log(`✅ Stored title order data for ${titleReference} with ABN: ${abn}, Company: ${companyName}`);
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

// Function to create report via external API
async function createReport({ business, type, userId, matterId, ispdfcreate }) {
	try {
		let existingReport = null;
		let iresult = null;
		let reportId = null;
		let reportData = null;
		let pdffilename = null;
		if (business?.isCompany == "ORGANISATION") {
			abn = business?.Abn;
			acn = abn.substring(2);
			if (!abn) {
				throw new Error('ABN not found in business data');
			}
		}

		if (business?.isCompany == "ORGANISATION") {
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

			} else if (type == "asic-historical") {

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

			} else if (type == "asic-company") {
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
			} else if (type == "ppsr") {
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
			} else if (type == "director-ppsr") {
				reportData = await director_ppsr_report(business.fname, business.lname, business.dob);
			} else if (type == "director-bankruptcy") {
				reportData = await director_bankrupcty_report(business.fname, business.lname, business.dob);
			} else if (type == "director-related") {
				reportData = await director_related_report(business.fname, business.lname, business.dob);
			} else if (type == "director-court") {
				reportData = await director_court_report(business.fname, business.lname, business.dob);
			} else if (type == "director-court-civil") {
				reportData = await director_court_civil(business.fname, business.lname, business.dob);
			} else if (type == "director-court-criminal") {
				reportData = await director_court_criminal(business.fname, business.lname, business.dob);
			} else if (type == 'property') {
				reportData = await property(business.Abn, business.Name, business);
			} else if (type == 'director-property') {
				reportData = await director_property(business.fname, business.lname, business.dob, business);
			} else if (type == 'land-title-reference') {
				reportData = await land_title_reference(business);
			} else if (type == 'land-title-address') {
				reportData = await land_title_address(business);
			} else if (type == 'land-title-organisation') {
				reportData = await land_title_organisation(business);
			} else if (type == 'land-title-individual') {
				reportData = await land_title_individual(business);
			}
			// Ensure reportData has the correct structure
			if (!existingReport && reportData) {
				if (business?.isCompany == "ORGANISATION") {
					[iresult] = await sequelize.query(`
                        INSERT INTO api_data ( rtype, uuid, search_word, abn, acn, rdata, alert, created_at, updated_at ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING id`,
						{
							bind: [
								type,
								reportData.data.uuid,
								null,
								abn,
								acn,
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
								null,
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

		// Validate reportData before proceeding
		if (!reportData) {
			throw new Error('Report data is missing. Failed to fetch or retrieve report data.');
		}

		// Ensure reportData has the correct structure for addDownloadReportInDB
		// It expects either { data: ... } or the data object directly
		if (!reportData.data && typeof reportData === 'object') {
			reportData = { data: reportData };
		}

		// For land title reports, include business object in reportData for PDF generation
		if ((type === 'land-title-organisation' || type === 'land-title-individual') && business) {
			reportData.business = business;
		}

		if (ispdfcreate) {
			pdffilename = await addDownloadReportInDB(reportData, userId, matterId, reportId, `${uuidv4()}`, type);
			return pdffilename;
		} else {
			return {
				success: true
			}
		}

	} catch (error) {
		console.error('Error creating report:', error);
		if (error.response) {
			// API returned an error response
			throw new Error(`Report API error: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`);
		} else if (error.request) {
			// Request was made but no response received
			throw new Error('Report API request failed - no response received');
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
	if (!organizationName && abn) {
		try {
			const abnInfo = await getABNInfo(abn);
			organizationName = abnInfo?.EntityName || abnInfo?.Name || null;
		} catch (error) {
			console.error('Error fetching company name from ABN:', error);
			// If ABN lookup fails, use ABN as fallback
			organizationName = abn;
		}
	}

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
		const titleReferences = realPropertySegment
			.map(segment => ({
				titleReference: segment?.IdentityBlock?.TitleReference,
				jurisdiction: segment?.IdentityBlock?.Jurisdiction || state
			}))
			.filter(item => item.titleReference != null); // Filter out null/undefined values

		return {
			current: currentCount,
			historical: historicalCount,
			titleReferences: titleReferences,
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

async function searchLandTitleByPerson(firstName, lastName, state, dob) {
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
		const titleReferences = realPropertySegment
			.map(segment => ({
				titleReference: segment?.IdentityBlock?.TitleReference,
				jurisdiction: segment?.IdentityBlock?.Jurisdiction || state
			}))
			.filter(item => item.titleReference != null); // Filter out null/undefined values

		return {
			current: currentCount,
			historical: historicalCount,
			titleReferences: titleReferences,
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
	console.log('✅ Land title counts endpoint hit!', req.body);
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
		const allTitleReferences = []; // Collect all TitleReferences from all states
		const storedDataIds = []; // Collect stored data IDs

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
					WHERE rtype = 'land-title-organisation' AND abn = $1
					ORDER BY created_at DESC
				`, {
					bind: [abn]
				});

				if (existingData && existingData.length > 0) {
					console.log(`✅ Found existing data for ABN ${abn}, using cached data`);
					
					// Extract data from the summary record (land-title-organisation)
					// This record contains the aggregated counts and titleReferences
					try {
						const summaryRecord = existingData[0]; // Get the most recent summary record
						const rdata = typeof summaryRecord.rdata === 'string' 
							? JSON.parse(summaryRecord.rdata) 
							: summaryRecord.rdata;
						
						// Extract counts and titleReferences from summary record
						currentCount = rdata?.currentCount || 0;
						historicalCount = rdata?.historicalCount || 0;
						
						// Extract titleReferences from summary record
						if (rdata?.titleReferences && Array.isArray(rdata.titleReferences)) {
							allTitleReferences.push(...rdata.titleReferences);
							
							// Build storedDataIds from titleReferences
							// We need to get the dataId from individual titleReference records
							for (const titleRef of rdata.titleReferences) {
								try {
									const [titleRefRecord] = await sequelize.query(`
										SELECT id FROM api_data
										WHERE rtype = 'land-title-reference' AND uuid = $1
										ORDER BY created_at DESC
										LIMIT 1
									`, {
										bind: [titleRef.titleReference]
									});
									
									if (titleRefRecord && titleRefRecord.length > 0) {
										storedDataIds.push({
											titleReference: titleRef.titleReference,
											jurisdiction: titleRef.jurisdiction,
											dataId: titleRefRecord[0].id
										});
									}
								} catch (idError) {
									console.error(`Error fetching dataId for ${titleRef.titleReference}:`, idError);
									// Continue even if we can't get the dataId
									storedDataIds.push({
										titleReference: titleRef.titleReference,
										jurisdiction: titleRef.jurisdiction,
										dataId: null
									});
								}
							}
						}
						
						// Return cached data
						return res.json({
							success: true,
							current: currentCount,
							historical: historicalCount,
							titleReferences: allTitleReferences,
							storedDataIds: storedDataIds,
							cached: true // Flag to indicate this is cached data
						});
					} catch (parseError) {
						console.error('Error parsing cached summary data:', parseError);
						// Fall through to API call if parsing fails
					}
				}

				// Get company name if not provided
				let organizationName = companyName;
				if (!organizationName && abn) {
					try {
						const abnInfo = await getABNInfo(abn);
						organizationName = abnInfo?.EntityName || abnInfo?.Name || abn;
					} catch (error) {
						console.error('Error fetching company name from ABN:', error);
						organizationName = abn;
					}
				}

				// No cached data found, proceed with API call
				console.log(`🔄 No cached data found for ABN ${abn}, calling API`);
				
				// Search for land titles by organization/ABN across all states
				for (const state of states) {
					try {
						const searchResults = await searchLandTitleByOrganization(abn, state, organizationName);
						currentCount += searchResults.current || 0;
						historicalCount += searchResults.historical || 0;
						
						// Store API response for each titleReference
						if (searchResults.titleReferences && Array.isArray(searchResults.titleReferences) && searchResults.fullApiResponse) {
							for (const titleRef of searchResults.titleReferences) {
								allTitleReferences.push(titleRef);
								
								// Store in api_data table
								try {
									const [result] = await sequelize.query(`
										INSERT INTO api_data (rtype, uuid, search_word, abn, acn, rdata, alert, created_at, updated_at)
										VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
										RETURNING id
									`, {
										bind: [
											'land-title-reference',
											titleRef.titleReference,
											organizationName || abn,
											abn, // Store ABN for business searches
											null, // ACN
											JSON.stringify(searchResults.fullApiResponse),
											false
										]
									});
									
									if (result && result.length > 0) {
										storedDataIds.push({
											titleReference: titleRef.titleReference,
											jurisdiction: titleRef.jurisdiction,
											dataId: result[0].id
										});
									}
								} catch (dbError) {
									console.error(`Error storing data for titleReference ${titleRef.titleReference}:`, dbError);
									// Continue even if storage fails
								}
							}
						}
					} catch (error) {
						console.error(`Error searching land title for state ${state}:`, error);
						// Continue with other states even if one fails
					}
				}

			} else {
				// Individual search
				if (!lastName) {
					return res.status(400).json({
						success: false,
						error: 'MISSING_LAST_NAME',
						message: 'Last name is required for individual search'
					});
				}

				// Build search term: firstName lastName date
				const searchTerm = `${firstName || ''} ${lastName} ${dob || ''}`.trim();

				// Check if data already exists in api_data table for this individual
				// For individuals, we check by rtype and search_word (which contains firstName lastName dob)
				const [existingData] = await sequelize.query(`
					SELECT uuid, rdata, id
					FROM api_data
					WHERE rtype = 'land-title-reference' 
						AND search_word = $1
						AND abn IS NULL
					ORDER BY created_at DESC
				`, {
					bind: [searchTerm]
				});

				if (existingData && existingData.length > 0) {
					console.log(`✅ Found existing data for individual ${searchTerm}, using cached data`);
					
					// Extract data from stored records
					const uniqueTitleRefs = new Map(); // Use Map to avoid duplicates
					
					for (const record of existingData) {
						try {
							const rdata = typeof record.rdata === 'string' ? JSON.parse(record.rdata) : record.rdata;
							const realPropertySegment = rdata?.RealPropertySegment || [];
							
							// Extract titleReferences from stored data
							realPropertySegment.forEach(segment => {
								const titleRef = segment?.IdentityBlock?.TitleReference;
								const jurisdiction = segment?.IdentityBlock?.Jurisdiction;
								
								if (titleRef && !uniqueTitleRefs.has(titleRef)) {
									uniqueTitleRefs.set(titleRef, {
										titleReference: titleRef,
										jurisdiction: jurisdiction || 'NSW', // Default jurisdiction
										dataId: record.id
									});
								}
							});
							
							// Add to counts
							currentCount += realPropertySegment.length;
							historicalCount += 0; // Always 0 as per requirements
						} catch (parseError) {
							console.error('Error parsing stored data:', parseError);
							// Continue with next record
						}
					}
					
					// Convert Map to array
					const titleRefsArray = Array.from(uniqueTitleRefs.values());
					allTitleReferences.push(...titleRefsArray);
					
					// Build storedDataIds from existing records
					titleRefsArray.forEach(tr => {
						storedDataIds.push({
							titleReference: tr.titleReference,
							jurisdiction: tr.jurisdiction,
							dataId: tr.dataId
						});
					});
					
					// Return cached data
					return res.json({
						success: true,
						current: currentCount,
						historical: historicalCount,
						titleReferences: allTitleReferences,
						storedDataIds: storedDataIds,
						cached: true // Flag to indicate this is cached data
					});
				}

				// No cached data found, proceed with API call
				console.log(`🔄 No cached data found for individual ${searchTerm}, calling API`);

				// Search for land titles by individual name across all states
				for (const state of states) {
					try {
						const searchResults = await searchLandTitleByPerson(firstName, lastName, state, dob);
						currentCount += searchResults.current || 0;
						historicalCount += searchResults.historical || 0;
						
						// Store API response for each titleReference
						if (searchResults.titleReferences && Array.isArray(searchResults.titleReferences) && searchResults.fullApiResponse) {
							for (const titleRef of searchResults.titleReferences) {
								allTitleReferences.push(titleRef);
								
								// Store in api_data table
								try {
									const [result] = await sequelize.query(`
										INSERT INTO api_data (rtype, uuid, search_word, abn, acn, rdata, alert, created_at, updated_at)
										VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
										RETURNING id
									`, {
										bind: [
											'land-title-reference',
											titleRef.titleReference,
											searchTerm,
											null, // ABN for individual
											null, // ACN for individual
											JSON.stringify(searchResults.fullApiResponse),
											false
										]
									});
									
									if (result && result.length > 0) {
										storedDataIds.push({
											titleReference: titleRef.titleReference,
											jurisdiction: titleRef.jurisdiction,
											dataId: result[0].id
										});
									}
								} catch (dbError) {
									console.error(`Error storing data for titleReference ${titleRef.titleReference}:`, dbError);
									// Continue even if storage fails
								}
							}
						}
					} catch (error) {
						console.error(`Error searching land title for state ${state}:`, error);
						// Continue with other states even if one fails
					}
				}
			}

			// Store summary record for organization searches with rtype = 'land-title-organisation'
			if (type === 'organization' && abn && allTitleReferences.length > 0) {
				try {
					// Validate ABN is not null/undefined
					if (!abn || abn === 'null' || abn === 'undefined') {
						console.error('❌ Invalid ABN value, skipping summary record storage');
						throw new Error('Invalid ABN value');
					}

					// Get company name if not provided
					let organizationName = companyName;
					if (!organizationName && abn) {
						try {
							const abnInfo = await getABNInfo(abn);
							organizationName = abnInfo?.EntityName || abnInfo?.Name || abn;
						} catch (error) {
							console.error('Error fetching company name from ABN:', error);
							organizationName = abn;
						}
					}

					// Store summary data with rtype = 'land-title-organisation'
					// Match the structure shown in the database: uuid, allCount, cotality, locatorData, titleOrders
					const summaryData = {
						uuid: abn,
						abn: abn, // Store ABN in rdata for easy retrieval
						companyName: organizationName || abn, // Store company name in rdata
						allCount: currentCount + historicalCount,
						currentCount: currentCount,
						historicalCount: historicalCount,
						titleReferences: allTitleReferences,
						cotality: null,
						locatorData: null,
						titleOrders: [] // Will be populated when reports are generated
					};

					// Check if summary record already exists
					const [existingSummary] = await sequelize.query(`
						SELECT id FROM api_data
						WHERE rtype = 'land-title-organisation' AND abn = $1
						LIMIT 1
					`, {
						bind: [abn]
					});

					if (existingSummary && existingSummary.length > 0) {
						// Update existing record - ensure ABN is updated too
						await sequelize.query(`
							UPDATE api_data
							SET rdata = $1, search_word = $2, abn = $3, uuid = $4, updated_at = NOW()
							WHERE id = $5
						`, {
							bind: [
								JSON.stringify(summaryData),
								organizationName || abn,
								abn, // Ensure ABN is updated
								abn, // Ensure uuid is also updated
								existingSummary[0].id
							]
						});
						console.log(`✅ Updated summary record for ABN ${abn} with rtype 'land-title-organisation'`);
					} else {
						// Insert new record - ensure ABN is properly stored
						console.log(`📝 Inserting summary record: rtype='land-title-organisation', uuid='${abn}', abn='${abn}', search_word='${organizationName || abn}'`);
						await sequelize.query(`
							INSERT INTO api_data (rtype, uuid, search_word, abn, acn, rdata, alert, created_at, updated_at)
							VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
						`, {
							bind: [
								'land-title-organisation',
								abn, // uuid = abn
								organizationName || abn, // search_word = company name
								abn, // abn field = abn (ensure this is properly stored)
								null, // ACN
								JSON.stringify(summaryData),
								false
							]
						});
						console.log(`✅ Stored new summary record for ABN ${abn} with rtype 'land-title-organisation'`);
					}
				} catch (summaryError) {
					console.error('Error storing summary record:', summaryError);
					// Continue even if summary storage fails
				}
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
			message
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