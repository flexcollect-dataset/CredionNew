const path = require('path');
const fs = require('fs').promises;
const moment = require('moment');
const puppeteer = require('puppeteer');
const { uploadToS3 } = require('./s3.service');
const UserReport = require('../models/UserReport');

// Create media directory if it doesn't exist
const mediaDir = path.join(__dirname, '../media');
async function ensureMediaDir() {
  try {
    await fs.access(mediaDir);
  } catch {
    await fs.mkdir(mediaDir, { recursive: true });
  }
}

// Helper function to format ACN
function fmtAcn(acnVal) {
  if (!acnVal) return '';
  const s = ('' + acnVal).replace(/\D/g, '');
  return s.length === 9 ? s.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : acnVal;
}

// Helper function to format dates
function fmtDate(date) {
  if (!date) return 'N/A';
  return moment(date).format('DD MMM YYYY');
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
		} else if (type === 'director-related' && business?.directorRelatedSelection?.name) {
			searchWord = business.directorRelatedSelection.name;
		} else if (type === 'director-court' || type === 'director-court-civil' || type === 'director-court-criminal') {
			// For court reports, prefer civilSelection.fullname, fallback to criminalSelection.fullname
			if (business?.civilSelection?.fullname) {
				searchWord = business.civilSelection.fullname;
			} else if (business?.criminalSelection?.fullname) {
				searchWord = business.criminalSelection.fullname;
			}
		} else if (type === 'land-title-individual') {
			searchWord = 'Mital Korat';
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

	return null;
}

function fmtDateTime(date) {
  if (!date) return 'N/A';
  return `${moment(date).format('DD MMM YYYY')}<br>${moment(date).format('h:mma')}`;
}

// Extract data for ATO Report
function extractAtoData(data) {
  const entity = data.entity || {};
  const current_tax_debt = data.current_tax_debt || {};
  
  return {
    company_type: 'ato',
    acn: data.acn || entity.acn || 'N/A',
    abn: data.abn || entity.abn || 'N/A',
    companyName: entity.name || 'N/A',
    entity_abn: entity.abn || 'N/A',
    entity_acn: entity.acn || 'N/A',
    entity_name: entity.name || 'N/A',
    entity_review_date: entity.review_date ? moment(entity.review_date).format('DD/MM/YYYY') : 'N/A',
    entity_registered_in: entity.registered_in || 'N/A',
    entity_abr_gst_status: entity.abr_gst_status || 'N/A',
    entity_document_number: entity.document_number || 'N/A',
    entity_organisation_type: entity.organisation_type || 'N/A',
    entity_asic_date_of_registration: entity.asic_date_of_registration ? moment(entity.asic_date_of_registration).format('DD/MM/YYYY') : 'N/A',
    abn_state: data.abn_state || 'N/A',
    abn_status: data.abn_status || 'N/A',
    current_tax_debt_amount: current_tax_debt.amount ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(current_tax_debt.amount) : 'N/A',
    current_tax_debt_ato_updated_at: current_tax_debt.ato_updated_at ? moment.utc(current_tax_debt.ato_updated_at).format('MMMM D, YYYY, [at] h:mm:ss A') : 'N/A',
    // ATO reports don't need court/insolvency data
    actionSummaryRows: '',
    insolvency_notice_id: 'N/A',
    insolvency_type: 'N/A',
    insolvency_publish_date: 'N/A',
    insolvency_status: 'N/A',
    insolvency_appointee: 'N/A',
    insolvency_parties_rows: '',
    insolvency_court: 'N/A',
    case_case_id: 'N/A',
    case_source: 'N/A',
    case_jurisdiction: 'N/A',
    case_type: 'N/A',
    case_status: 'N/A',
    case_location: 'N/A',
    case_most_recent_event: 'N/A',
    case_notification_date: 'N/A',
    case_next_event: 'N/A',
    orders_rows: '',
    case_parties_rows: '',
    hearings_rows: '',
    documents_rows: '',
    caseNumber: 'N/A'
  };
}

// Extract data for Court Report
function extractCourtData(data) {
  const entity = data.entity || {};
  const firstInsolv = data.insolvencies ? Object.values(data.insolvencies)[0] : null;
  const firstCase = data.cases ? (Array.isArray(data.cases) ? data.cases[0] : Object.values(data.cases)[0]) : null;
  
  // Extract case number
  let caseNumber = 'N/A';
  if (firstCase) {
    caseNumber = firstCase.case_number || firstCase.case_name || 'N/A';
  } else if (firstInsolv) {
    caseNumber = firstInsolv.case_number || firstInsolv.asic_notice_id || 'N/A';
  }
  
  // Action summary rows
  let actionSummaryRows = '';
  let rowIndex = 1;
  if (firstInsolv) {
    const date = firstInsolv.notification_time || firstInsolv.date_filed || firstInsolv.created_at;
    actionSummaryRows += `<tr><td>${rowIndex++}</td><td>${fmtDate(date)}<br><span style="font-size: 9px; color: #64748B;">(${moment(date).fromNow(true)} ago)</span></td><td>${firstInsolv.match_on || firstInsolv.name || 'N/A'}</td><td>${firstInsolv.court_name || firstInsolv.court || 'ASIC Insolvencies'}</td><td>${firstInsolv.case_type || firstInsolv.type || 'N/A'}</td><td>${firstInsolv.case_number || firstInsolv.asic_notice_id || 'N/A'}</td></tr>`;
  }
  if (firstCase) {
    const date = firstCase.notification_time || firstCase.most_recent_event || firstCase.created_at;
    actionSummaryRows += `<tr><td>${rowIndex++}</td><td>${fmtDate(date)}<br><span style="font-size: 9px; color: #64748B;">(${moment(date).fromNow(true)} ago)</span></td><td>${firstCase.match_on || firstCase.name || 'N/A'}</td><td>${firstCase.court_name || firstCase.source || 'N/A'}</td><td>${firstCase.case_type || firstCase.type || 'N/A'}</td><td>${firstCase.case_number || firstCase.case_name || 'N/A'}</td></tr>`;
  }
  
  // Insolvency details
  const insolvency_notice_id = firstInsolv?.asic_notice_id || firstInsolv?.case_number || 'N/A';
  const insolvency_type = firstInsolv?.case_type || firstInsolv?.type || 'N/A';
  const insolvency_publish_date = fmtDate(firstInsolv?.notification_time || firstInsolv?.date_filed || firstInsolv?.created_at);
  const insolvency_status = firstInsolv?.status || 'N/A';
  const insolvency_appointee = (firstInsolv?.parties && firstInsolv.parties[0]?.name) || 'N/A';
  const insolvency_court = firstInsolv?.court_name || firstInsolv?.court || 'ASIC Insolvencies';
  
  let insolvency_parties_rows = '';
  if (firstInsolv && Array.isArray(firstInsolv.parties)) {
    firstInsolv.parties.forEach(p => {
      insolvency_parties_rows += `<tr><td>${p.name || ''}</td><td>${fmtAcn(p.acn) || ''}</td></tr>`;
    });
  } else if (firstInsolv) {
    insolvency_parties_rows = `<tr><td>${firstInsolv.name || 'N/A'}</td><td></td></tr>`;
  }
  
  // Case details
  const case_case_id = firstCase?.case_number || firstCase?.case_name || 'N/A';
  const case_source = firstCase?.court_name || firstCase?.source || 'N/A';
  const case_jurisdiction = firstCase?.jurisdiction || 'N/A';
  const case_type = firstCase?.case_type || firstCase?.type || 'N/A';
  const case_status = (firstCase?.applications && firstCase.applications[0]?.status) || 'N/A';
  const case_location = firstCase?.suburb || firstCase?.registered_in || 'N/A';
  const case_most_recent_event = fmtDate(firstCase?.most_recent_event || firstCase?.last_event || firstCase?.updated_at);
  const case_notification_date = fmtDate(firstCase?.notification_time || firstCase?.applications?.[0]?.date_filed || firstCase?.created_at);
  const case_next_event = firstCase?.next_hearing_date ? fmtDate(firstCase.next_hearing_date) : 'N/A';
  
  let orders_rows = '';
  if (firstCase && Array.isArray(firstCase.judgments)) {
    firstCase.judgments.forEach(j => {
      orders_rows += `<tr><td style="padding: 8px;"><strong>${fmtDate(j.date)}</strong></td><td style="padding: 8px;"><strong>Title:</strong> ${j.title || ''}</td></tr>`;
    });
  }
  
  let case_parties_rows = '';
  if (firstCase && Array.isArray(firstCase.parties)) {
    firstCase.parties.forEach(p => {
      case_parties_rows += `<tr><td>${p.name || ''}</td><td>${p.role || ''}</td><td>${p.representative_firm || p.representative_name || ''}</td><td>${fmtAcn(p.acn) || ''}</td></tr>`;
    });
  }
  
  let hearings_rows = '';
  if (firstCase && Array.isArray(firstCase.hearings)) {
    firstCase.hearings.forEach(h => {
      hearings_rows += `<tr><td>${fmtDateTime(h.datetime)}</td><td>${h.officer || ''}</td><td>${h.court_room || ''}</td><td>${h.court_name || ''}</td><td>${h.type || ''}</td><td>${h.outcome || ''}</td></tr>`;
    });
  }
  
  let documents_rows = '';
  if (firstCase && Array.isArray(firstCase.documents)) {
    firstCase.documents.forEach(d => {
      documents_rows += `<tr><td>${fmtDate(d.datetime)}</td><td>${moment(d.datetime).format('h:mma')}</td><td>${d.title || ''}</td><td>${d.filed_by || ''}</td></tr>`;
    });
  }
  
  return {
    company_type: 'court',
    acn: data.acn || entity.acn || 'N/A',
    abn: data.abn || entity.abn || 'N/A',
    companyName: entity.name || 'N/A',
    entity_abn: entity.abn || 'N/A',
    entity_acn: entity.acn || 'N/A',
    entity_name: entity.name || 'N/A',
    entity_review_date: entity.review_date ? moment(entity.review_date).format('DD/MM/YYYY') : 'N/A',
    entity_registered_in: entity.registered_in || 'N/A',
    entity_abr_gst_status: entity.abr_gst_status || 'N/A',
    entity_document_number: entity.document_number || 'N/A',
    entity_organisation_type: entity.organisation_type || 'N/A',
    entity_asic_date_of_registration: entity.asic_date_of_registration ? moment(entity.asic_date_of_registration).format('DD/MM/YYYY') : 'N/A',
    abn_state: data.abn_state || 'N/A',
    abn_status: data.abn_status || 'N/A',
    actionSummaryRows,
    insolvency_notice_id,
    insolvency_type,
    insolvency_publish_date,
    insolvency_status,
    insolvency_appointee,
    insolvency_parties_rows,
    insolvency_court,
    case_case_id,
    case_source,
    case_jurisdiction,
    case_type,
    case_status,
    case_location,
    case_most_recent_event,
    case_notification_date,
    case_next_event,
    orders_rows,
    case_parties_rows,
    hearings_rows,
    documents_rows,
    caseNumber,
    current_tax_debt_amount: 'N/A',
    current_tax_debt_ato_updated_at: 'N/A'
  };
}

// Extract data for ASIC Current Report
function extractAsicCurrentData(data) {
  const entity = data.entity || {};
  const rdata = data.rdata || data; 
  
  const entityData = rdata.entity || entity;
  const formattedAcn = entityData.acn ? fmtAcn(entityData.acn) : 'N/A';
  const formattedAbn = entityData.abn ? entityData.abn.replace(/\D/g, '').replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4') : 'N/A';
  
  const currentDate = moment();
  const reportDate = currentDate.format('DD MMMM YYYY');
  const reportDateWithTime = `${currentDate.format('DD MMM YYYY')}, ${currentDate.format('h:mma')}`;
  
  const asicRegistrationDate = entityData.asic_date_of_registration 
    ? moment(entityData.asic_date_of_registration).format('DD/MM/YYYY') 
    : 'N/A';
  
  // Format review date
  const reviewDate = entityData.review_date 
    ? moment(entityData.review_date).format('DD/MM/YYYY') 
    : 'N/A';
  
  // Extract tax debt information
  let taxDebtAmount = 'N/A';
  let taxDebtUpdatedAt = 'N/A';
  let taxDebtSection = ''; // HTML for tax debt section
  
  if (rdata.current_tax_debt && rdata.current_tax_debt.amount !== null && rdata.current_tax_debt.amount !== undefined) {
    const amount = parseFloat(rdata.current_tax_debt.amount);
    taxDebtAmount = new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
    
    if (rdata.current_tax_debt.ato_updated_at) {
      taxDebtUpdatedAt = moment.utc(rdata.current_tax_debt.ato_updated_at).format('DD/MM/YYYY [at] h:mm:ss A');
    }
    
    // Generate tax debt section HTML
    taxDebtSection = `
            <div style="margin-top: 60px;">
                <div class="card" style="border: 2px solid #CBD5E1; background: #F8FAFC;">
                    <div style="font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 16px; display: flex; align-items: center;">
                        ⚠ CRITICAL: ATO TAX DEBT
                    </div>
                    <div style="font-size: 20px; font-weight: 700; color: #0F172A; margin-bottom: 12px;">
                        ${taxDebtAmount}
                    </div>
                    <div style="font-size: 11px; color: #64748B;">
                        Outstanding/Updated as of ${taxDebtUpdatedAt}
                    </div>
                </div>
            </div>
    `;
	}

	// Get status values (with fallbacks)
	const asicStatus = entityData.asic_status || data.asic_status || 'N/A';
	const abnStatus = entityData.abr_status || data.abn_status || 'N/A';
	const gstStatus = entityData.abr_gst_status || data.abn_gst_status || 'N/A';

	// Document number for header
	const documentNumber = entityData.document_number || data.document_number || 'N/A';

	// Extract data from asic_extracts for Pages 3 and 4
	const asicExtracts = rdata.asic_extracts || data.asic_extracts || [];
	const firstExtract = asicExtracts.length > 0 ? asicExtracts[0] : null;

	// Page 3 - ASIC Extract Summary
	const extractType = firstExtract?.type || 'Current';
	const addresses = firstExtract?.addresses || [];
	const contactAddresses = firstExtract?.contact_addresses || [];
	const directors = firstExtract?.directors || [];
	const secretaries = firstExtract?.secretaries || [];
	const shareholders = firstExtract?.shareholders || [];
	const shareholdings = firstExtract?.shareholdings || [];

	// Check if this is a Current & Historical report
	// Check extract type first, then fallback to checking if there are ceased records
	let isCurrentAndHistorical = extractType === 'Current & Historical' || extractType === 'Current and Historical';

	// Fallback: If extract type doesn't indicate historical, check if there are any ceased records
	if (!isCurrentAndHistorical) {
		const hasCeasedAddresses = addresses.some(addr => addr.status === 'Ceased') ||
			contactAddresses.some(addr => addr.status === 'Ceased');
		const hasCeasedDirectors = directors.some(d => d.status === 'Ceased');
		const hasCeasedSecretaries = secretaries.some(s => s.status === 'Ceased');
		const hasCeasedShareholders = shareholders.some(sh => sh.status === 'Ceased' || sh.end_date) ||
			shareholdings.some(sh => sh.status === 'Ceased' || sh.end_date);

		// If we have any ceased records, treat it as a Current & Historical report
		if (hasCeasedAddresses || hasCeasedDirectors || hasCeasedSecretaries || hasCeasedShareholders) {
			isCurrentAndHistorical = true;
		}
	}

	// Counts for Page 3 - separate Current and Historic counts if it's Current & Historical
	let totalAddresses, totalDirectors, totalSecretaries, totalShareholders;
	let currentAddressesCount, historicAddressesCount;
	let currentDirectorsCount, historicDirectorsCount;
	let currentSecretariesCount, historicSecretariesCount;
	let currentShareholdersCount, historicShareholdersCount;

	if (isCurrentAndHistorical) {
		// Calculate Current counts (status === 'Current')
		currentAddressesCount = addresses.filter(addr => addr.status === 'Current').length +
			contactAddresses.filter(addr => addr.status === 'Current').length;
		historicAddressesCount = addresses.filter(addr => addr.status === 'Ceased').length +
			contactAddresses.filter(addr => addr.status === 'Ceased').length;

		currentDirectorsCount = directors.filter(d => d.status === 'Current').length;
		historicDirectorsCount = directors.filter(d => d.status === 'Ceased').length;

		currentSecretariesCount = secretaries.filter(s => s.status === 'Current').length;
		historicSecretariesCount = secretaries.filter(s => s.status === 'Ceased').length;

		// For shareholders, check both shareholders and shareholdings arrays
		const allShareholders = [...shareholders, ...shareholdings];
		currentShareholdersCount = allShareholders.filter(sh => sh.status === 'Current' || (!sh.status && !sh.end_date)).length;
		historicShareholdersCount = allShareholders.filter(sh => sh.status === 'Ceased' || sh.end_date).length;

		// Total counts (for backward compatibility)
		totalAddresses = currentAddressesCount + historicAddressesCount;
		totalDirectors = currentDirectorsCount + historicDirectorsCount;
		totalSecretaries = currentSecretariesCount + historicSecretariesCount;
		totalShareholders = currentShareholdersCount + historicShareholdersCount;
	} else {
		// For regular Current reports, use total counts
		totalAddresses = addresses.length + contactAddresses.length;
		totalDirectors = directors.length;
		totalSecretaries = secretaries.length;
		totalShareholders = shareholders.length || shareholdings.length;

		// Set Current and Historic counts to same values for non-historical reports
		currentAddressesCount = totalAddresses;
		historicAddressesCount = 0;
		currentDirectorsCount = totalDirectors;
		historicDirectorsCount = 0;
		currentSecretariesCount = totalSecretaries;
		historicSecretariesCount = 0;
		currentShareholdersCount = totalShareholders;
		historicShareholdersCount = 0;
	}

	// Get 2 addresses for Page 3 (prefer "Current" status, then first 2)
	const currentAddresses = addresses.filter(addr => addr.status === 'Current');
	const page3Addresses = currentAddresses.length >= 2
		? currentAddresses.slice(0, 2)
		: addresses.slice(0, 2);

	// Generate address boxes HTML for Page 3
	let addressBoxesHtml = '';
	page3Addresses.forEach((addr, index) => {
		const addressLines = [];
		if (addr.care_of) addressLines.push(`'${addr.care_of}'`);
		if (addr.address_1) addressLines.push(addr.address_1);
		if (addr.address_2) addressLines.push(`'${addr.address_2}'`);
		if (addr.suburb) addressLines.push(addr.suburb);
		if (addr.state && addr.postcode) addressLines.push(`${addr.state} ${addr.postcode}`);

		const addressText = addressLines.join('<br>');
		const startDate = addr.start_date ? moment(addr.start_date).format('DD/MM/YYYY') : 'N/A';
		const docNo = addr.document_number || 'N/A';

		addressBoxesHtml += `
                <div class="card">
                    <div class="card-header">${addr.type || 'Address'}</div>
                    <div style="font-size: 11px; line-height: 1.6;">
                        ${addr.care_of ? `<strong>Name:</strong> ${addr.care_of}<br>` : ''}
                        <strong>Address:</strong><br>
                        ${addressText}<br><br>
                        <strong>Start Date:</strong> ${startDate}<br>
                        <strong>Document No:</strong> ${docNo}
                    </div>
                </div>
    `;
	});

	// Get first contact address for ASIC
	const firstContactAddress = contactAddresses.length > 0 ? contactAddresses[0] : null;
	let contactAddressHtml = '';
	if (firstContactAddress) {
		const contactAddressLines = [];
		if (firstContactAddress.address_1) contactAddressLines.push(firstContactAddress.address_1);
		if (firstContactAddress.address_2) contactAddressLines.push(firstContactAddress.address_2);
		if (firstContactAddress.suburb) contactAddressLines.push(firstContactAddress.suburb);
		if (firstContactAddress.state && firstContactAddress.postcode) {
			contactAddressLines.push(`${firstContactAddress.state} ${firstContactAddress.postcode}`);
		}

		const contactAddressText = contactAddressLines.join(' ');
		const contactStartDate = firstContactAddress.start_date
			? moment(firstContactAddress.start_date).format('DD/MM/YYYY')
			: 'N/A';
		const contactEndDate = firstContactAddress.end_date
			? moment(firstContactAddress.end_date).format('DD/MM/YYYY')
			: 'Current';

		contactAddressHtml = `
            <div class="card info" style="margin-top: 30px;">
                <div class="card-header" style="color: #0F172A;">Contact Address for ASIC</div>
                <div class="card warning" style="margin: 10px 0; font-size: 10px;">
                    ⚠️ This address is to be used by ASIC and not for delivery of documents to the company
                </div>
                <div style="font-size: 14px; font-weight: 700; margin: 12px 0; color: #0F172A;">
                    ${contactAddressText}
                </div>
                <div style="font-size: 10px; color: #64748B;">
                    <strong>Type:</strong> ${firstContactAddress.type || 'Contact Address for ASIC use only'}<br>
                    <strong>Start Date:</strong> ${contactStartDate} | <strong>End Date:</strong> ${contactEndDate}
                </div>
            </div>
    `;
	}

	// Page 4 - Address Change History (get ceased addresses, limit to 2)
	const ceasedAddresses = addresses.filter(addr => addr.status === 'Ceased').slice(0, 2);
	let addressChangeHistoryRows = '';
	ceasedAddresses.forEach(addr => {
		const addressText = addr.address || `${addr.address_1 || ''} ${addr.suburb || ''} ${addr.state || ''} ${addr.postcode || ''}`.trim();
		const changeDate = addr.end_date
			? moment(addr.end_date).format('DD/MM/YYYY')
			: (addr.start_date ? moment(addr.start_date).format('DD/MM/YYYY') : 'N/A');
		const docNo = addr.document_number || 'N/A';

		addressChangeHistoryRows += `
                    <tr>
                        <td>${addressText}</td>
                        <td>${changeDate}</td>
                        <td>${docNo}</td>
                    </tr>
    `;
	});

	// Page 4 - Key Personnel Summary
	// Directors HTML
	let directorsHtml = '';
	directors.forEach(dir => {
		const dirAddress = dir.address ? dir.address.address : 'N/A';
		const dirStartDate = dir.start_date ? moment(dir.start_date).format('DD/MM/YYYY') : 'N/A';
		const dirStatus = dir.status === 'Current' ? '<span class="risk-low">Current</span>' : '<span class="risk-high">Ceased</span>';

		directorsHtml += `
            <div class="card" style="padding: 14px 20px; margin-bottom: 12px;">
                <div class="card-header" style="margin-bottom: 10px;">Director</div>
                <div style="font-size: 11px;">
                    <strong>${dir.name || 'N/A'}</strong><br>
                    Appointment Date: ${dirStartDate} | Address: ${dirAddress}<br>
                    Status: ${dirStatus}
                </div>
            </div>
    `;
	});

	// Secretaries HTML
	let secretariesHtml = '';
	secretaries.forEach(sec => {
		const secAddress = sec.address ? sec.address.address : 'N/A';
		const secStartDate = sec.start_date ? moment(sec.start_date).format('DD/MM/YYYY') : 'N/A';
		const secStatus = sec.status === 'Current' ? '<span class="risk-low">Current</span>' : '<span class="risk-high">Ceased</span>';

		secretariesHtml += `
            <div class="card" style="padding: 14px 20px; margin-bottom: 12px;">
                <div class="card-header" style="margin-bottom: 10px;">Secretary</div>
                <div style="font-size: 11px;">
                    <strong>${sec.name || 'N/A'}</strong><br>
                    Appointment Date: ${secStartDate} | Address: ${secAddress}<br>
                    Status: ${secStatus}
                </div>
            </div>
    `;
	});

	// Shareholders HTML
	let shareholdersHtml = '';
	if (shareholders.length > 0) {
		shareholders.forEach(shareholder => {
			const shareAddress = shareholder.address ? shareholder.address.address : 'N/A';
			shareholdersHtml += `
            <div class="card" style="padding: 14px 20px; margin-bottom: 12px;">
                <div class="card-header" style="margin-bottom: 10px;">Shareholder</div>
                <div style="font-size: 11px;">
                    <strong>${shareholder.name || 'N/A'}</strong><br>
                    Address: ${shareAddress}
                </div>
            </div>
      `;
		});
	} else if (shareholdings.length > 0) {
		// Group shareholdings by name
		const shareholderGroups = {};
		shareholdings.forEach(sh => {
			const name = sh.name || 'Unknown';
			if (!shareholderGroups[name]) {
				shareholderGroups[name] = [];
			}
			shareholderGroups[name].push(sh);
		});

		Object.keys(shareholderGroups).forEach(name => {
			const holdings = shareholderGroups[name];
			let sharesInfo = '';
			holdings.forEach(h => {
				const shareClass = h.share_class || 'N/A';
				const shares = h.shares || 0;
				sharesInfo += `${shareClass}: ${shares} shares | `;
			});
			sharesInfo = sharesInfo.replace(/\s\|\s$/, '');

			shareholdersHtml += `
            <div class="card" style="padding: 14px 20px; margin-bottom: 12px;">
                <div class="card-header" style="margin-bottom: 10px;">Shareholder</div>
                <div style="font-size: 11px;">
                    <strong>${name}</strong><br>
                    ${sharesInfo}
                </div>
            </div>
      `;
		});
	}

	// Page 5 & 6 - ASIC Documents & Filings
	const documents = firstExtract?.documents || [];
	const totalDocuments = documents.length;

	// Calculate date range
	let minYear = null;
	let maxYear = null;
	let filings2025 = 0;
	const formTypesSet = new Set();

	documents.forEach(doc => {
		// Get year from received_at, effective_at, or processed_at
		let docYear = null;
		if (doc.received_at) {
			docYear = moment(doc.received_at).year();
		} else if (doc.effective_at) {
			docYear = moment(doc.effective_at).year();
		} else if (doc.processed_at) {
			docYear = moment(doc.processed_at).year();
		}

		if (docYear) {
			if (minYear === null || docYear < minYear) minYear = docYear;
			if (maxYear === null || docYear > maxYear) maxYear = docYear;
			if (docYear === 2025) filings2025++;
		}

		// Track form types
		if (doc.form_code) {
			formTypesSet.add(doc.form_code);
		}
	});

	const dateRange = minYear && maxYear ? `${minYear}-${maxYear}` : 'N/A';
	const formTypesCount = formTypesSet.size;

	// Sort documents by date (most recent first) - use received_at, effective_at, or processed_at
	const sortedDocuments = [...documents].sort((a, b) => {
		const dateA = a.received_at || a.effective_at || a.processed_at || '';
		const dateB = b.received_at || b.effective_at || b.processed_at || '';
		return moment(dateB).valueOf() - moment(dateA).valueOf(); // Descending order
	});

	// Generate documents table rows
	let documentsRowsHtml = '';
	sortedDocuments.forEach(doc => {
		const formCode = doc.form_code || 'N/A';
		const description = doc.description || 'N/A';
		// Use received_at, effective_at, or processed_at for date
		const docDate = doc.received_at || doc.effective_at || doc.processed_at;
		const formattedDate = docDate ? moment(docDate).format('DD/MM/YYYY') : 'N/A';
		const docNumber = doc.document_number || 'N/A';

		documentsRowsHtml += `
                    <tr>
                        <td><strong>${formCode}</strong></td>
                        <td>${description}</td>
                        <td>${formattedDate}</td>
                        <td>${docNumber}</td>
                    </tr>
    `;
	});

	// Page 7 - Board of Directors & Shareholders
	// Get current directors and secretaries
	const currentDirectors = directors.filter(d => d.status === 'Current');
	const currentSecretaries = secretaries.filter(s => s.status === 'Current');

	// Generate Directors & Secretaries table rows
	let directorsSecretariesRowsHtml = '';

	// Combine directors and secretaries, mark positions and detect duplicates
	const allOfficeholders = [];
	const processedNames = new Set();

	// Process directors first
	currentDirectors.forEach(dir => {
		const name = dir.name || '';
		// Check if this person is also a secretary
		const isAlsoSecretary = currentSecretaries.some(sec => sec.name === name);

		if (isAlsoSecretary && !processedNames.has(name)) {
			allOfficeholders.push({ ...dir, position: 'Director & Secretary' });
			processedNames.add(name);
		} else if (!processedNames.has(name)) {
			allOfficeholders.push({ ...dir, position: 'Director' });
			processedNames.add(name);
		}
	});

	// Process secretaries (excluding those already added as Director & Secretary)
	currentSecretaries.forEach(sec => {
		const name = sec.name || '';
		if (!processedNames.has(name)) {
			allOfficeholders.push({ ...sec, position: 'Secretary' });
			processedNames.add(name);
		}
	});

	allOfficeholders.forEach(holder => {
		const dob = holder.dob ? moment(holder.dob).format('DD/MM/YYYY') : 'N/A';
		const placeOfBirth = holder.place_of_birth || 'N/A';
		const address = holder.address ? holder.address.address : 'N/A';
		const appointedDate = holder.start_date ? moment(holder.start_date).format('DD/MM/YYYY') : 'N/A';

		directorsSecretariesRowsHtml += `
                    <tr>
                        <td><strong>${holder.name || 'N/A'}</strong></td>
                        <td>${holder.position || 'N/A'}</td>
                        <td>${appointedDate}</td>
                        <td>${address}</td>
                        <td>${dob}</td>
                        <td>${placeOfBirth}</td>
                    </tr>
    `;
	});

	// Shareholders & Ownership section - only show if data exists
	const shareStructures = firstExtract?.share_structures || [];
	const hasShareholderData = (shareholders.length > 0 || shareholdings.length > 0 || shareStructures.length > 0);

	let shareholdersOwnershipSection = '';

	if (hasShareholderData) {
		// Calculate stats
		const uniqueShareholders = new Set();
		// Use shareholders array first (preferred), then shareholdings
		shareholdings.forEach(sh => {
			if (sh.name) uniqueShareholders.add(sh.name);
		});
		shareholders.forEach(sh => {
			if (sh.name) uniqueShareholders.add(sh.name);
		});
		const totalShareholdersCount = uniqueShareholders.size || shareholders.length || shareholdings.length;

		const shareClassesSet = new Set();
		shareStructures.forEach(ss => {
			if (ss.class_code) shareClassesSet.add(ss.class_code);
			if (ss.class) shareClassesSet.add(ss.class);
		});
		shareholdings.forEach(sh => {
			if (sh.share_class) shareClassesSet.add(sh.share_class);
			if (sh.class) shareClassesSet.add(sh.class);
		});
		shareholders.forEach(sh => {
			if (sh.class) shareClassesSet.add(sh.class);
		});
		const shareClassesCount = shareClassesSet.size;

		// Calculate ownership concentration (if we have share data)
		let ownershipConcentration = 'N/A';
		let totalShares = 0;
		const shareholderShares = {};

		// Use shareholders array first, then shareholdings
		shareholders.forEach(sh => {
			const name = sh.name || 'Unknown';
			const shares = parseInt(sh.number_held || sh.shares || 0);
			totalShares += shares;
			if (!shareholderShares[name]) {
				shareholderShares[name] = 0;
			}
			shareholderShares[name] += shares;
		});

		shareholdings.forEach(sh => {
			const name = sh.name || 'Unknown';
			const shares = parseInt(sh.shares || sh.number_held || 0);
			totalShares += shares;
			if (!shareholderShares[name]) {
				shareholderShares[name] = 0;
			}
			shareholderShares[name] += shares;
		});

		if (totalShares > 0) {
			const maxShares = Math.max(...Object.values(shareholderShares));
			ownershipConcentration = `${Math.round((maxShares / totalShares) * 100)}%`;
		}

		// Calculate share capital from share_structures
		// Note: amount_paid appears to be in cents, so we divide by 100
		let shareCapital = 0;
		shareStructures.forEach(ss => {
			const paid = parseFloat(ss.amount_paid || ss.total_paid || ss.total_paid_up || 0);
			shareCapital += paid / 100; // Convert cents to dollars
		});
		const formattedShareCapital = shareCapital > 0
			? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 }).format(shareCapital)
			: 'N/A';

		// Generate Share Register table rows
		// Prefer shareholders array, fallback to shareholdings
		let shareRegisterRowsHtml = '';
		const allShareholderData = shareholders.length > 0 ? shareholders : shareholdings;

		allShareholderData.forEach(sh => {
			const name = sh.name || 'N/A';
			const address = sh.address ? sh.address.address : 'N/A';
			const shareClass = sh.class || sh.share_class || 'N/A';
			const shares = sh.number_held || sh.shares || 0;
			const fullyPaid = sh.fully_paid === true || sh.fully_paid === 'Yes' ? 'Yes' : (sh.fully_paid === false || sh.fully_paid === 'No' ? 'No' : 'N/A');
			const docNo = sh.document_number || 'N/A';

			shareRegisterRowsHtml += `
                    <tr>
                        <td><strong>${name}</strong></td>
                        <td>${address}</td>
                        <td>${shareClass}</td>
                        <td>${shares}</td>
                        <td>${fullyPaid}</td>
                        <td>${docNo}</td>
                    </tr>
      `;
		});

		shareholdersOwnershipSection = `
            <div class="page-title" style="margin-top: 30px;">Shareholders &amp; Ownership</div>
            
            <div class="stats-grid">
                <div class="stat-box">
                    <div class="stat-label">Total Shareholders</div>
                    <div class="stat-value">${totalShareholdersCount}</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">Share Classes</div>
                    <div class="stat-value">${shareClassesCount}</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">Ownership Concentration</div>
                    <div class="stat-value alert">${ownershipConcentration}</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">Share Capital</div>
                    <div class="stat-value">${formattedShareCapital}</div>
                </div>
            </div>
            
            <div class="section-title">Share Register</div>
            <table>
                <thead>
                    <tr>
                        <th>Shareholder Name</th>
                        <th>Address</th>
                        <th>Share Class</th>
                        <th>Shares Held</th>
                        <th>Fully Paid</th>
                        <th>Document No</th>
                    </tr>
                </thead>
                <tbody>
                    ${shareRegisterRowsHtml}
                </tbody>
            </table>
    `;
	}

	// Page 8 - Share Structure (only show if share_structures data exists)
	let shareStructureSection = '';

	if (shareStructures.length > 0) {
		let shareStructureRowsHtml = '';

		shareStructures.forEach(ss => {
			const classCode = ss.class_code || ss.class || 'N/A';
			const description = ss.class_description || ss.description || 'N/A';
			const numberIssued = ss.share_count || ss.number_issued || 0;
			const amountPaid = parseFloat(ss.amount_paid || ss.total_paid || 0);
			const formattedAmountPaid = amountPaid > 0
				? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 }).format(amountPaid / 100)
				: '$0.00';
			const docNo = ss.document_number || 'N/A';

			shareStructureRowsHtml += `
                        <tr>
                            <td><strong>${classCode}</strong></td>
                            <td>${description}</td>
                            <td>${numberIssued}</td>
                            <td>${formattedAmountPaid}</td>
                            <td>${docNo}</td>
                        </tr>
      `;
		});

		shareStructureSection = `
            <div class="section-title">Share Structure</div>
            <div class="card">
                <div class="card-header">Issued Share Classes</div>
                <table style="margin-top: 12px;">
                    <thead>
                        <tr>
                            <th>Class</th>
                            <th>Description</th>
                            <th>Number Issued</th>
                            <th>Total Paid</th>
                            <th>Document No</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${shareStructureRowsHtml}
                    </tbody>
                </table>
                <div class="card warning" style="margin-top: 12px; font-size: 10px;">
                    <strong>Note:</strong> For each class of shares issued by a proprietary company, ASIC records the details of the twenty members of the class based on shareholdings.
                </div>
            </div>
    `;
	}

	// Generate ASIC Extract Summary HTML based on report type
	let extractSummaryHtml = '';
	if (isCurrentAndHistorical) {
		// Two-row table for Current & Historical
		extractSummaryHtml = `
                <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 8px; font-size: 11px; font-weight: 600; color: #475569; border-bottom: 1px solid #E2E8F0;">REPORT TYPE</th>
                            <th style="text-align: center; padding: 8px; font-size: 11px; font-weight: 600; color: #475569; border-bottom: 1px solid #E2E8F0;">ADDRESSES</th>
                            <th style="text-align: center; padding: 8px; font-size: 11px; font-weight: 600; color: #475569; border-bottom: 1px solid #E2E8F0;">DIRECTORS</th>
                            <th style="text-align: center; padding: 8px; font-size: 11px; font-weight: 600; color: #475569; border-bottom: 1px solid #E2E8F0;">SECRETARIES</th>
                            <th style="text-align: center; padding: 8px; font-size: 11px; font-weight: 600; color: #475569; border-bottom: 1px solid #E2E8F0;">SHAREHOLDERS</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="padding: 8px; font-size: 12px; font-weight: 700; color: #0F172A;">Current</td>
                            <td style="text-align: center; padding: 8px; font-size: 18px; font-weight: 700; color: #0F172A;">${currentAddressesCount}</td>
                            <td style="text-align: center; padding: 8px; font-size: 18px; font-weight: 700; color: #0F172A;">${currentDirectorsCount}</td>
                            <td style="text-align: center; padding: 8px; font-size: 18px; font-weight: 700; color: #0F172A;">${currentSecretariesCount}</td>
                            <td style="text-align: center; padding: 8px; font-size: 18px; font-weight: 700; color: #0F172A;">${currentShareholdersCount}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; font-size: 12px; font-weight: 700; color: #0F172A;">Historic</td>
                            <td style="text-align: center; padding: 8px; font-size: 18px; font-weight: 700; color: #0F172A;">${historicAddressesCount}</td>
                            <td style="text-align: center; padding: 8px; font-size: 18px; font-weight: 700; color: #0F172A;">${historicDirectorsCount}</td>
                            <td style="text-align: center; padding: 8px; font-size: 18px; font-weight: 700; color: #0F172A;">${historicSecretariesCount}</td>
                            <td style="text-align: center; padding: 8px; font-size: 18px; font-weight: 700; color: #0F172A;">${historicShareholdersCount}</td>
                        </tr>
                    </tbody>
                </table>
    `;
	} else {
		// Single-row grid for regular Current reports
		extractSummaryHtml = `
                <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;">
                    <div style="text-align: center;">
                        <div class="stat-label">Report Type</div>
                        <div style="font-size: 12px; font-weight: 700; color: #0F172A; margin-top: 6px;">${extractType}</div>
                    </div>
                    <div style="text-align: center;">
                        <div class="stat-label">Addresses</div>
                        <div style="font-size: 18px; font-weight: 700; color: #0F172A;">${totalAddresses}</div>
                    </div>
                    <div style="text-align: center;">
                        <div class="stat-label">Directors</div>
                        <div style="font-size: 18px; font-weight: 700; color: #0F172A;">${totalDirectors}</div>
                    </div>
                    <div style="text-align: center;">
                        <div class="stat-label">Secretaries</div>
                        <div style="font-size: 18px; font-weight: 700; color: #0F172A;">${totalSecretaries}</div>
                    </div>
                    <div style="text-align: center;">
                        <div class="stat-label">Shareholders</div>
                        <div style="font-size: 18px; font-weight: 700; color: #0F172A;">${totalShareholders}</div>
                    </div>
                </div>
    `;
	}

	// Calculate total pages dynamically
	// Base pages: 1 (Cover), 2 (Report Summary), 3 (Company Info), 4 (Address History), 5 (Documents Part 1), 7 (Directors)
	// Conditional: 8 (Share Structure) - only if shareStructures exist
	// Note: Page 6 is just a continuation of Page 5 table, not a separate page
	let totalPages = 7; // Base pages
	if (shareStructures.length > 0) {
		totalPages = 8; // Add Share Structure page if data exists
	}

	// Generate page number strings for each page
	const page1Number = `Page 1 of ${totalPages}`;
	const page2Number = `Page 2 of ${totalPages}`;
	const page3Number = `Page 3 of ${totalPages}`;
	const page4Number = `Page 4 of ${totalPages}`;
	const page5Number = `Page 5 of ${totalPages}`;
	const page7Number = `Page 7 of ${totalPages}`;
	const page8Number = shareStructures.length > 0 ? `Page 8 of ${totalPages}` : '';

	return {
		company_type: 'asic-current',
		acn: formattedAcn,
		abn: formattedAbn,
		companyName: entityData.name || 'N/A',

		// Page 1 - Cover Page variables
		cover_company_name: (entityData.name || 'N/A').toUpperCase(),
		cover_report_title: 'ASIC Current Report',
		cover_report_date: reportDate,
		cover_acn: formattedAcn,
		cover_abn: formattedAbn,
		cover_document_number: documentNumber,

		// Page 2 - Report Summary variables
		entity_name: entityData.name || 'N/A',
		entity_abn: formattedAbn,
		entity_acn: formattedAcn,
		entity_asic_status: asicStatus,
		entity_abn_status: abnStatus,
		entity_gst_status: gstStatus,
		entity_organisation_type: entityData.organisation_type || 'N/A',
		entity_asic_date_of_registration: asicRegistrationDate,
		entity_review_date: reviewDate,
		entity_registered_in: entityData.registered_in || 'N/A',
		report_date: reportDateWithTime,
		tax_debt_section: taxDebtSection,
		current_tax_debt_amount: taxDebtAmount,
		current_tax_debt_ato_updated_at: taxDebtUpdatedAt,

		// Page 3 - ASIC Extract Summary
		extract_report_type: extractType,
		extract_addresses_count: totalAddresses,
		extract_directors_count: totalDirectors,
		extract_secretaries_count: totalSecretaries,
		extract_shareholders_count: totalShareholders,
		// Current & Historic counts for two-row summary
		extract_current_addresses_count: currentAddressesCount,
		extract_historic_addresses_count: historicAddressesCount,
		extract_current_directors_count: currentDirectorsCount,
		extract_historic_directors_count: historicDirectorsCount,
		extract_current_secretaries_count: currentSecretariesCount,
		extract_historic_secretaries_count: historicSecretariesCount,
		extract_current_shareholders_count: currentShareholdersCount,
		extract_historic_shareholders_count: historicShareholdersCount,
		is_current_and_historical: isCurrentAndHistorical,
		extract_summary_html: extractSummaryHtml, // Pre-generated HTML for the summary section
		address_boxes: addressBoxesHtml,
		contact_address_section: contactAddressHtml,

		// Page 4 - Address Change History & Key Personnel
		address_change_history_rows: addressChangeHistoryRows,
		directors_summary: directorsHtml,
		secretaries_summary: secretariesHtml,
		shareholders_summary: shareholdersHtml,

		// Page 5 & 6 - ASIC Documents & Filings
		documents_total_count: totalDocuments,
		documents_date_range: dateRange,
		documents_2025_filings: filings2025,
		documents_form_types_count: formTypesCount,
		documents_table_rows: documentsRowsHtml,

		// Page 7 - Board of Directors & Shareholders
		directors_secretaries_table_rows: directorsSecretariesRowsHtml,
		shareholders_ownership_section: shareholdersOwnershipSection,

		// Page 8 - Share Structure
		share_structure_section: shareStructureSection,

		// Page Numbers (dynamic)
		page_number_1: page1Number,
		page_number_2: page2Number,
		page_number_3: page3Number,
		page_number_4: page4Number,
		page_number_5: page5Number,
		page_number_7: page7Number,
		page_number_8: page8Number,
		total_pages: totalPages,

		// Legacy fields (kept for backward compatibility)
		entity_abr_gst_status: gstStatus,
		entity_document_number: documentNumber,
		abn_state: data.abn_state || entityData.abr_state || 'N/A',
		abn_status: abnStatus,

		// Placeholder fields for future pages
		actionSummaryRows: '',
		insolvency_notice_id: 'N/A',
		insolvency_type: 'N/A',
		insolvency_publish_date: 'N/A',
		insolvency_status: 'N/A',
		insolvency_appointee: 'N/A',
		insolvency_parties_rows: '',
		insolvency_court: 'N/A',
		case_case_id: 'N/A',
		case_source: 'N/A',
		case_jurisdiction: 'N/A',
		case_type: 'N/A',
		case_status: 'N/A',
		case_location: 'N/A',
		case_most_recent_event: 'N/A',
		case_notification_date: 'N/A',
		case_next_event: 'N/A',
		orders_rows: '',
		case_parties_rows: '',
		hearings_rows: '',
		documents_rows: '',
		caseNumber: 'N/A'
	};
}

// Extract data for ASIC Historical Report
function extractAsicHistoricalData(data) {
	// Ensure the extract type is set to 'Current & Historical' for proper data extraction
	const entity = data.entity || {};
	const rdata = data.rdata || data;
	const asicExtracts = rdata.asic_extracts || data.asic_extracts || [];
	if (asicExtracts.length > 0 && !asicExtracts[0].type) {
		asicExtracts[0].type = 'Current & Historical';
	} else if (asicExtracts.length > 0) {
		// Ensure type is set to Current & Historical if it's not already
		const currentType = asicExtracts[0].type;
		if (currentType !== 'Current & Historical' && currentType !== 'Current and Historical') {
			asicExtracts[0].type = 'Current & Historical';
		}
	}

	// For pages 1-8, use the same logic as extractAsicCurrentData
	const currentData = extractAsicCurrentData(data);

	const entityData = rdata.entity || entity;

	// Extract historical data for pages 9-11
	const firstExtract = asicExtracts.length > 0 ? asicExtracts[0] : null;

	// Page 9: Historical Company Names
	const formerNames = entityData.former_names || [];
	let historicalCompanyNamesRows = '';
	if (formerNames.length > 0) {
		// Assuming we have date info, otherwise just list names
		formerNames.forEach((name, index) => {
			// If name_start_at exists, use it; otherwise use registration date
			const effectiveFrom = entityData.name_start_at ? moment(entityData.name_start_at).format('DD/MM/YYYY') : (entityData.asic_date_of_registration ? moment(entityData.asic_date_of_registration).format('DD/MM/YYYY') : 'N/A');
			const effectiveTo = index === 0 && entityData.name ? 'Current' : (index > 0 && formerNames[index - 1] ? (entityData.name_start_at ? moment(entityData.name_start_at).format('DD/MM/YYYY') : 'N/A') : 'N/A');

			historicalCompanyNamesRows += `
                      <tr>
                          <td>${name}</td>
                          <td>${effectiveFrom}</td>
                          <td>${effectiveTo}</td>
                          <td>Name Change</td>
                      </tr>
      `;
		});
	} else {
		historicalCompanyNamesRows = `
                    <tr>
                        <td colspan="4" style="text-align: center; font-style: italic;">No former company names found</td>
                    </tr>
    `;
	}

	// Page 9-10: Historical Registered Addresses
	// Get all ceased addresses, sorted by end_date descending
	const allAddresses = firstExtract?.addresses || [];
	const historicalAddresses = allAddresses
		.filter(addr => addr.status === 'Ceased')
		.sort((a, b) => {
			const dateA = a.end_date || a.start_date || '';
			const dateB = b.end_date || b.start_date || '';
			return moment(dateB).valueOf() - moment(dateA).valueOf(); // Descending
		});

	let historicalAddressesRows = '';
	historicalAddresses.forEach(addr => {
		const addressText = addr.address || `${addr.address_1 || ''} ${addr.address_2 ? addr.address_2 + ' ' : ''}${addr.suburb || ''} ${addr.state || ''} ${addr.postcode || ''}`.trim();
		const fromDate = addr.start_date ? moment(addr.start_date).format('DD/MM/YYYY') : 'N/A';
		const toDate = addr.end_date ? moment(addr.end_date).format('DD/MM/YYYY') : 'Current';
		const addressType = addr.type || 'N/A';

		historicalAddressesRows += `
                    <tr>
                        <td>${addressText}</td>
                        <td>${addressType}</td>
                        <td>${fromDate}</td>
                        <td>${toDate}</td>
                    </tr>
    `;
	});

	// Page 10: Previous Officeholders (Ceased Directors & Secretaries)
	const directors = firstExtract?.directors || [];
	const secretaries = firstExtract?.secretaries || [];
	const ceasedDirectors = directors.filter(d => d.status === 'Ceased');
	const ceasedSecretaries = secretaries.filter(s => s.status === 'Ceased');

	let previousOfficeholdersRows = '';
	// Combine and sort by end_date descending
	const allCeasedOfficeholders = [
		...ceasedDirectors.map(d => ({ ...d, position: 'Director' })),
		...ceasedSecretaries.map(s => ({ ...s, position: 'Secretary' }))
	].sort((a, b) => {
		const dateA = a.end_date || a.start_date || '';
		const dateB = b.end_date || b.start_date || '';
		return moment(dateB).valueOf() - moment(dateA).valueOf(); // Descending
	});

	if (allCeasedOfficeholders.length > 0) {
		allCeasedOfficeholders.forEach(holder => {
			const appointedDate = holder.start_date ? moment(holder.start_date).format('DD/MM/YYYY') : 'N/A';
			const ceasedDate = holder.end_date ? moment(holder.end_date).format('DD/MM/YYYY') : 'Current';
			const reason = holder.end_date ? 'Resigned' : 'N/A';

			previousOfficeholdersRows += `
                      <tr>
                          <td>${holder.name || 'N/A'}</td>
                          <td>${holder.position || 'N/A'}</td>
                          <td>${appointedDate}</td>
                          <td>${ceasedDate}</td>
                          <td>${reason}</td>
                      </tr>
      `;
		});
	} else {
		previousOfficeholdersRows = `
                    <tr>
                        <td colspan="5" style="text-align: center; font-style: italic;">No former directors or secretaries found</td>
                    </tr>
    `;
	}

	// Page 10: Historical Shareholders
	const shareholders = firstExtract?.shareholders || [];
	const shareholdings = firstExtract?.shareholdings || [];
	const historicalShareholders = [...shareholders, ...shareholdings].filter(sh => sh.status === 'Ceased' || (!sh.status && sh.end_date));

	let historicalShareholdersRows = '';
	if (historicalShareholders.length > 0) {
		historicalShareholders.forEach(sh => {
			const shareClass = sh.class || sh.share_class || 'N/A';
			const shares = sh.number_held || sh.shares || 0;
			const docNo = sh.document_number || 'N/A';
			const status = sh.status || 'Ceased';

			historicalShareholdersRows += `
                      <tr>
                          <td>${sh.name || 'N/A'}</td>
                          <td>${shareClass}</td>
                          <td>${shares}</td>
                          <td>${docNo}</td>
                          <td>${status}</td>
                      </tr>
      `;
		});
	} else {
		// If no historical shareholders in data, show empty message
		historicalShareholdersRows = `
                    <tr>
                        <td colspan="5" style="text-align: center; font-style: italic;">No historical shareholder data available</td>
                    </tr>
    `;
	}

	// Page 11: Historical Share Structure Changes
	const shareStructures = firstExtract?.share_structures || [];
	let historicalShareStructureRows = '';
	// Sort by date descending
	const sortedShareStructures = [...shareStructures].sort((a, b) => {
		const dateA = a.effective_date || a.start_date || a.document_date || '';
		const dateB = b.effective_date || b.start_date || b.document_date || '';
		return moment(dateB).valueOf() - moment(dateA).valueOf();
	});

	if (sortedShareStructures.length > 0) {
		sortedShareStructures.forEach(ss => {
			const changeDate = ss.effective_date || ss.start_date || ss.document_date || 'N/A';
			const shareClass = ss.class_code || ss.class || ss.class_description || 'N/A';
			const shares = ss.share_count || ss.number_issued || 0;
			const amountPaid = parseFloat(ss.amount_paid || ss.total_paid || 0);
			const formattedAmountPaid = amountPaid > 0
				? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 }).format(amountPaid / 100)
				: '$0.00';
			const changeType = ss.change_type || 'Capital Increase';

			historicalShareStructureRows += `
                      <tr>
                          <td>${changeDate ? moment(changeDate).format('DD/MM/YYYY') : 'N/A'}</td>
                          <td>${shareClass}</td>
                          <td>${shares}</td>
                          <td>${formattedAmountPaid}</td>
                          <td>${changeType}</td>
                      </tr>
      `;
		});
	} else {
		historicalShareStructureRows = `
                    <tr>
                        <td colspan="5" style="text-align: center; font-style: italic;">No historical share structure changes found</td>
                    </tr>
    `;
	}

	// Page 11: ASIC Documents (already extracted in currentData, but we might want to show them separately)
	// The documents are already in currentData.documents_table_rows, so we can reuse or create a separate section

	// Extract Date for Historical Extract
	const extractDate = firstExtract?.created_at || entityData.asic_date_of_registration || new Date();
	const formattedExtractDate = moment(extractDate).format('DD/MM/YYYY');

	// Calculate total pages dynamically
	// Base pages: 1-8 (same as current), 9 (Historical Extract), 10 (Historical Continued), 11 (Historical Share Structure & Documents)
	let totalPages = 11;

	// Generate page number strings
	const page1Number = `Page 1 of ${totalPages}`;
	const page2Number = `Page 2 of ${totalPages}`;
	const page3Number = `Page 3 of ${totalPages}`;
	const page4Number = `Page 4 of ${totalPages}`;
	const page5Number = `Page 5 of ${totalPages}`;
	const page7Number = `Page 7 of ${totalPages}`;
	const page8Number = shareStructures.length > 0 ? `Page 8 of ${totalPages}` : '';
	const page9Number = `Page 9 of ${totalPages}`;
	const page10Number = `Page 10 of ${totalPages}`;
	const page11Number = `Page 11 of ${totalPages}`;

	return {
		...currentData, // Include all data from pages 1-8

		// Page 9 - Historical ASIC Extract
		historical_extract_date: formattedExtractDate,
		historical_company_names_rows: historicalCompanyNamesRows,
		historical_addresses_rows: historicalAddressesRows,

		// Page 10 - Historical Continued
		previous_officeholders_rows: previousOfficeholdersRows,
		historical_shareholders_rows: historicalShareholdersRows,

		// Page 11 - Historical Share Structure & Documents
		historical_share_structure_rows: historicalShareStructureRows,

		// Page Numbers (dynamic)
		page_number_1: page1Number,
		page_number_2: page2Number,
		page_number_3: page3Number,
		page_number_4: page4Number,
		page_number_5: page5Number,
		page_number_7: page7Number,
		page_number_8: page8Number,
		page_number_9: page9Number,
		page_number_10: page10Number,
		page_number_11: page11Number,
		total_pages: totalPages,
	};
}

// Extract data for ASIC Company (Related Entities) Report
function extractAsicCompanyData(data) {
	const entity = data.entity || {};
	const rdata = data.rdata || data;
	const entityData = rdata.entity || entity;

	// Extract ASIC extracts for shareholdings
	const asicExtracts = rdata.asic_extracts || data.asic_extracts || [];
	const firstExtract = asicExtracts.length > 0 ? asicExtracts[0] : null;
	const shareholdings = firstExtract?.shareholdings || [];

	// Count current and former shareholdings
	const currentShareholdings = shareholdings.filter(sh => sh.status === 'Current');
	const formerShareholdings = shareholdings.filter(sh => sh.status === 'Ceased');

	// Generate Current Shareholdings table rows
	let currentShareholdingsRows = '';
	if (currentShareholdings.length > 0) {
		currentShareholdings.forEach(sh => {
			const companyName = sh.name || 'N/A';
			const acn = sh.acn ? fmtAcn(sh.acn) : 'N/A';
			const shareClass = sh.class || 'N/A';
			const sharesHeld = sh.number_held ? parseInt(sh.number_held, 10).toLocaleString('en-US') : '0';
			const address = sh.address?.address || (sh.address ?
				`${sh.address.address_1 || ''} ${sh.address.address_2 ? sh.address.address_2 + ' ' : ''}${sh.address.suburb || ''} ${sh.address.state || ''} ${sh.address.postcode || ''}`.trim()
				: 'N/A');
			const status = sh.status || 'Current';

			currentShareholdingsRows += `
                    <tr>
                        <td>${companyName}</td>
                        <td>${acn}</td>
                        <td>${shareClass}</td>
                        <td>${sharesHeld}</td>
                        <td>${address}</td>
                        <td>${status}</td>
                    </tr>
      `;
		});
	} else {
		currentShareholdingsRows = `
                    <tr>
                        <td colspan="6" style="text-align: center; color: #64748B; font-style: italic;">No current shareholdings found</td>
                    </tr>
    `;
	}

	// Generate Former Shareholdings table rows
	let formerShareholdingsRows = '';
	if (formerShareholdings.length > 0) {
		formerShareholdings.forEach(sh => {
			const companyName = sh.name || 'N/A';
			const acn = sh.acn ? fmtAcn(sh.acn) : 'N/A';
			const shareClass = sh.class || 'N/A';
			const sharesHeld = sh.number_held ? parseInt(sh.number_held, 10).toLocaleString('en-US') : '0';
			const address = sh.address?.address || (sh.address ?
				`${sh.address.address_1 || ''} ${sh.address.address_2 ? sh.address.address_2 + ' ' : ''}${sh.address.suburb || ''} ${sh.address.state || ''} ${sh.address.postcode || ''}`.trim()
				: 'N/A');
			const status = sh.status || 'Ceased';

			formerShareholdingsRows += `
                    <tr>
                        <td>${companyName}</td>
                        <td>${acn}</td>
                        <td>${shareClass}</td>
                        <td>${sharesHeld}</td>
                        <td>${address}</td>
                        <td>${status}</td>
                    </tr>
      `;
		});
	} else {
		formerShareholdingsRows = `
                    <tr>
                        <td colspan="6" style="text-align: center; color: #64748B; font-style: italic;">No former shareholdings found</td>
                    </tr>
    `;
	}

	// Extract licences - can be from root level or asic_extracts
	const licences = data.licences || firstExtract?.licences || [];
	const currentLicences = licences.filter(l => !l.status || l.status === 'Current' || !l.end_date);

	// Generate Licences table rows
	let licencesRows = '';
	if (licences.length > 0) {
		licences.forEach(lic => {
			const licenceType = lic.type || lic.licence_type || 'N/A';
			const licenceNo = lic.number || lic.licence_number || lic.identifier || 'N/A';
			const status = lic.status || (lic.end_date ? 'Ceased' : 'Current');
			const address = lic.address?.address || (lic.address ?
				`${lic.address.address_1 || ''} ${lic.address.address_2 ? lic.address.address_2 + ' ' : ''}${lic.address.suburb || ''} ${lic.address.state || ''} ${lic.address.postcode || ''}`.trim()
				: 'N/A');
			const appointmentDate = lic.start_date || lic.appointment_date ? moment(lic.start_date || lic.appointment_date).format('DD/MM/YYYY') : 'N/A';
			const ceaseDate = lic.end_date ? moment(lic.end_date).format('DD/MM/YYYY') : 'N/A';
			const documentNo = lic.document_number || 'N/A';

			licencesRows += `
                    <tr>
                        <td>${licenceType}</td>
                        <td>${licenceNo}</td>
                        <td>${status}</td>
                        <td>${address}</td>
                        <td>${appointmentDate}</td>
                        <td>${ceaseDate}</td>
                        <td>${documentNo}</td>
                    </tr>
      `;
		});
	} else {
		licencesRows = `
                    <tr>
                        <td colspan="7" style="text-align: center; color: #64748B; font-style: italic;">No licences found</td>
                    </tr>
    `;
	}

	// Extract ASIC documents - convert object to array if needed
	let asicDocuments = [];
	if (data.asic_documents) {
		if (Array.isArray(data.asic_documents)) {
			asicDocuments = data.asic_documents;
		} else if (typeof data.asic_documents === 'object') {
			asicDocuments = Object.values(data.asic_documents);
		}
	}

	// Generate ASIC Documents table rows - sort by date descending
	let asicDocumentsRows = '';
	if (asicDocuments.length > 0) {
		// Sort by date descending (most recent first)
		const sortedDocuments = [...asicDocuments].sort((a, b) => {
			const dateA = a.date ? moment(a.date).valueOf() : 0;
			const dateB = b.date ? moment(b.date).valueOf() : 0;
			return dateB - dateA;
		});

		sortedDocuments.forEach(doc => {
			const docDate = doc.date ? moment(doc.date).format('DD/MM/YYYY') : 'N/A';
			const formCode = doc.form_code || 'N/A';
			const description = doc.description || 'N/A';
			const documentNo = doc.identifier || doc.document_number || 'N/A';

			asicDocumentsRows += `
                    <tr>
                        <td>${docDate}</td>
                        <td>${formCode}</td>
                        <td>${description}</td>
                        <td>${documentNo}</td>
                    </tr>
      `;
		});
	} else {
		asicDocumentsRows = `
                    <tr>
                        <td colspan="4" style="text-align: center; color: #64748B; font-style: italic;">No ASIC documents found</td>
                    </tr>
    `;
	}

	// Format ABN and ACN
	const abn = entityData.abn || data.abn || '';
	const acn = entityData.acn || data.acn || '';
	const formattedAbn = abn && abn.length === 11 && /^\d+$/.test(abn.replace(/\s/g, ''))
		? abn.replace(/\D/g, '').replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4')
		: abn;
	const formattedAcn = acn && acn.length === 9 && /^\d+$/.test(acn.replace(/\s/g, ''))
		? acn.replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')
		: acn;

	// Format document number for cover
	const documentNumber = entityData.document_number || data.document_number || formattedAcn || 'N/A';
	const coverDocumentNumber = formattedAcn ? `ACN ${formattedAcn}` : (documentNumber !== 'N/A' ? documentNumber : '');

	// Location: abr_state + abr_postcode
	const location = [entityData.abr_state || data.abr_state, entityData.abr_postcode || data.abr_postcode]
		.filter(Boolean)
		.join(' ') || 'N/A';

	// Report date - current date
	const reportDate = moment().format('DD MMM YYYY');
	const reportDateTime = moment().format('DD MMM YYYY, h:mma');

	// Calculate total pages (base 4 pages for now)
	const totalPages = 4;
	const page2Number = `Page 2 of ${totalPages}`;
	const page3Number = `Page 3 of ${totalPages}`;
	const page4Number = `Page 4 of ${totalPages}`;

	return {
		// Cover page (Page 1)
		cover_company_name: entityData.name || 'N/A', // CSS will handle uppercase transformation
		cover_report_title: 'Company Related Entities Report',
		cover_report_date: moment().format('DD MMMM YYYY'),
		cover_abn: formattedAbn || 'N/A',
		cover_acn: formattedAcn || 'N/A',
		cover_document_number: coverDocumentNumber,

		// Page 2 - Company Details
		entity_name: entityData.name || 'N/A',
		entity_abn: formattedAbn || 'N/A',
		entity_acn: formattedAcn || 'N/A',
		entity_asic_status: entityData.asic_status || data.asic_status || 'N/A',
		entity_abn_status: entityData.abr_status || data.abn_status || 'N/A',
		entity_gst_status: entityData.abr_gst_status || data.abn_gst_status || 'N/A',
		entity_registration_date: entityData.asic_date_of_registration ? moment(entityData.asic_date_of_registration).format('DD/MM/YYYY') : 'N/A',
		entity_location: location,
		report_date: reportDateTime,

		// Entity Statistics
		current_shareholdings_count: currentShareholdings.length,
		former_shareholdings_count: formerShareholdings.length,
		current_licences_count: currentLicences.length,

		// ASIC Documents count
		asic_documents_count: asicDocuments.length,

		// Page 3 - Shareholdings
		current_shareholdings_rows: currentShareholdingsRows,
		former_shareholdings_rows: formerShareholdingsRows,

		// Page 4 - Licences & ASIC Documents
		licences_rows: licencesRows,
		asic_documents_rows: asicDocumentsRows,

		// Page numbers
		page_number_2: page2Number,
		page_number_3: page3Number,
		page_number_4: page4Number,

		// Legacy/placeholder fields
		company_type: 'asic-company',
		acn: formattedAcn,
		abn: formattedAbn,
		companyName: entityData.name || 'N/A',
		entity_review_date: entityData.review_date ? moment(entityData.review_date).format('DD/MM/YYYY') : 'N/A',
		entity_registered_in: entityData.registered_in || 'N/A',
		entity_abr_gst_status: entityData.abr_gst_status || 'N/A',
		entity_document_number: documentNumber,
		entity_organisation_type: entityData.organisation_type || 'N/A',
		entity_asic_date_of_registration: entityData.asic_date_of_registration ? moment(entityData.asic_date_of_registration).format('DD/MM/YYYY') : 'N/A',
		abn_state: entityData.abr_state || data.abn_state || 'N/A',
		abn_status: entityData.abr_status || data.abn_status || 'N/A',
	};
}

// Extract data for Director Bankruptcy Report
function extractBankruptcyData(data, business) {
	const rdata = data.rdata || data.data || data;

	// Extract search metadata
	const searchId = rdata.uuid || rdata.extractId || rdata.insolvencySearchId || data.uuid || 'N/A';

	// Handle two possible data structures:
	// 1. Array format: rdata.insolvencies = [{debtor: {...}, ...}]
	// 2. Single record format: rdata.debtor = {...}
	let insolvencies = [];
	let debtor = null;

	if (Array.isArray(rdata.insolvencies)) {
		// Multiple records format
		insolvencies = rdata.insolvencies;
	} else if (rdata.debtor) {
		// Single record format - wrap it in an array structure
		debtor = rdata.debtor;
		insolvencies = [{
			debtor: debtor,
			extractId: rdata.extractId || rdata.uuid,
			uuid: rdata.uuid || rdata.extractId,
			startDate: debtor.startDate || rdata.startDate
		}];
	}

	// Calculate result count - if we have debtor or insolvencies, count is at least 1
	const resultCount = rdata.resultCount !== undefined
		? rdata.resultCount
		: (insolvencies.length > 0 || debtor ? 1 : 0);

	// Extract person information from first insolvency record (if available)
	let surname = '';
	let givenNames = '';
	let dateOfBirth = '';
	let occupation = '';
	let addressSuburb = '';
	let startDate = '';

	if (insolvencies.length > 0) {
		const firstInsolvency = insolvencies[0];
		const firstDebtor = firstInsolvency.debtor || firstInsolvency || debtor || {};
		surname = firstDebtor.surname || '';
		givenNames = firstDebtor.givenNames || '';
		dateOfBirth = firstDebtor.dateOfBirth || '';
		occupation = firstDebtor.occupation || '';
		addressSuburb = firstDebtor.addressSuburb || '';
		startDate = firstDebtor.startDate || firstInsolvency.startDate || '';
	} else if (rdata.debtor) {
		// Direct debtor object
		debtor = rdata.debtor;
		surname = debtor.surname || '';
		givenNames = debtor.givenNames || '';
		dateOfBirth = debtor.dateOfBirth || '';
		occupation = debtor.occupation || '';
		addressSuburb = debtor.addressSuburb || '';
		startDate = debtor.startDate || '';
	}

	// Get search word from business parameter - use it even if results are empty
	const searchWord = extractSearchWord(business, 'director-bankruptcy');

	// Format full name - prefer search word from business, fallback to extracted data
	let fullName = 'N/A';
	if (searchWord) {
		fullName = searchWord.toUpperCase();
	} else {
		fullName = [surname, givenNames].filter(Boolean).join(' ').toUpperCase() || 'N/A';
	}

	// Format date of birth
	const formattedDateOfBirth = dateOfBirth ? moment(dateOfBirth).format('DD MMMM YYYY') : 'N/A';

	// Search date - current date/time
	const searchDate = moment().format('DD MMMM YYYY');
	const searchDateTime = moment().format('DD MMMM YYYY, h:mm A [AEDT]');

	// Determine status based on result count
	let statusText = '';
	let statusBadge = '';
	let verificationText = '';
	let whatThisMeansItems = '';

	if (resultCount === 0) {
		statusText = '✓ No Insolvency Records Found';
		statusBadge = 'ok';
		verificationText = 'CLEAR — No bankruptcy or personal insolvency on record';
		whatThisMeansItems = `
        <li>Has not declared bankruptcy</li>
        <li>No debt agreements recorded</li>
        <li>No personal insolvency agreements on record</li>
        <li>Not subject to any registered insolvency proceedings</li>
    `;
	} else {
		statusText = `${resultCount} Insolvency Record${resultCount > 1 ? 's' : ''} Found`;
		statusBadge = 'critical';
		verificationText = `⚠️ ${resultCount} active or historical insolvency record${resultCount > 1 ? 's' : ''} found`;
		whatThisMeansItems = `
        <li>${resultCount} insolvency record${resultCount > 1 ? 's' : ''} found on the National Personal Insolvency Index</li>
        <li>Review details in the insolvency records section</li>
        <li>Verify current status of each insolvency proceeding</li>
        <li>Consider impact on current financial standing</li>
    `;
	}

	// Generate search details HTML
	let searchDetailsRows = '';
	if (insolvencies.length > 0 || debtor) {
		const firstDebtor = insolvencies.length > 0
			? (insolvencies[0].debtor || insolvencies[0])
			: (debtor || rdata.debtor || {});

		const searchSurname = firstDebtor.surname || surname || 'N/A';
		const searchGivenNames = firstDebtor.givenNames || givenNames || 'N/A';
		const searchMiddleName = firstDebtor.middleName ? firstDebtor.middleName : 'Any (including none)';
		const searchDateOfBirth = (firstDebtor.dateOfBirth || dateOfBirth) ? moment(firstDebtor.dateOfBirth || dateOfBirth).format('DD MMMM YYYY') : 'N/A';
		const searchDateOfBirthMatch = (firstDebtor.dateOfBirth || dateOfBirth) ? '(Exact match)' : '';

		searchDetailsRows = `
        <div class="data-item"><div class="data-label">Search Date</div><div class="data-value">${searchDateTime}</div></div>
        <div class="data-item"><div class="data-label">Search ID</div><div class="data-value">${searchId}</div></div>
        <div class="data-item"><div class="data-label">Family Name</div><div class="data-value">${searchSurname} (Exact match)</div></div>
        <div class="data-item"><div class="data-label">Given Name</div><div class="data-value">${searchGivenNames.split(' ')[0] || 'N/A'} (Exact match)</div></div>
        <div class="data-item"><div class="data-label">Middle Name</div><div class="data-value">${searchMiddleName}</div></div>
        <div class="data-item"><div class="data-label">Date of Birth</div><div class="data-value">${searchDateOfBirth} ${searchDateOfBirthMatch}</div></div>
        <div class="data-item" style="grid-column:1 / -1;"><div class="data-label">Insolvency Records Searched</div><div class="data-value">All records</div></div>
    `;
	} else {
		searchDetailsRows = `
        <div class="data-item"><div class="data-label">Search Date</div><div class="data-value">${searchDateTime}</div></div>
        <div class="data-item"><div class="data-label">Search ID</div><div class="data-value">${searchId}</div></div>
        <div class="data-item" style="grid-column:1 / -1;"><div class="data-label">Insolvency Records Searched</div><div class="data-value">All records</div></div>
    `;
	}

	// Calculate total pages (base 4 pages + pages for each insolvency record if any)
	const basePages = 4;
	const totalPages = basePages;

	return {
		// Cover page (Page 1)
		cover_search_id: searchId,
		cover_full_name: fullName,
		cover_search_date: searchDateTime,
		cover_date_of_birth: formattedDateOfBirth,

		// Page 2 - Summary
		result_status_text: statusText,
		result_status_badge: statusBadge,
		verification_text: verificationText,
		search_time: searchDateTime,
		what_this_means_items: whatThisMeansItems,
		search_details_rows: searchDetailsRows,

		// Page 3 - Document Information
		document_search_id: searchId,
		document_search_date: searchDateTime,

		// Page numbers
		page_number_2: `Page 2 of ${totalPages}`,
		page_number_3: `Page 3 of ${totalPages}`,
		page_number_4: `Page 4 of ${totalPages}`,

		// Legacy/placeholder fields
		company_type: 'director-bankruptcy',
		acn: 'N/A', // Not applicable for bankruptcy reports but required for replaceVariables
		abn: 'N/A', // Not applicable for bankruptcy reports but required for replaceVariables
		companyName: fullName, // Use person's name as companyName for compatibility
		resultCount: resultCount,
		insolvencies: insolvencies
	};
}

// Extract data for Director Related Entities Report
function extractDirectorRelatedEntitiesData(data, business) {
	// Handle different data structures (could be rdata or data)
	const rdata = data.rdata || data;

	// Get search word from business parameter - use it even if results are empty
	const searchWord = extractSearchWord(business, 'director-related');

	// Extract entity information
	const entity = rdata.entity || {};
	// Prefer search word from business, fallback to entity name
	const directorName = searchWord || entity.name || 'N/A';
	const dateOfBirth = entity.date_of_birth && entity.date_of_birth !== '0000-00-00'
		? moment(entity.date_of_birth).format('DD/MM/YYYY')
		: 'N/A';
	const address = entity.address || 'N/A';

	// Extract ASIC extracts
	const asicExtracts = rdata.asic_extracts || [];

	// Process directorships and shareholdings from asic_extracts
	let currentDirectorships = [];
	let ceasedDirectorships = [];
	let currentShareholdingsNameAndDOB = [];
	let ceasedShareholdingsNameAndDOB = [];
	let currentShareholdingsNameOnly = [];
	let ceasedShareholdingsNameOnly = [];

	asicExtracts.forEach(extract => {
		// Process directorships
		if (extract.directorships) {
			extract.directorships.forEach(directorship => {
				const dir = {
					companyName: directorship.company_name || directorship.name || 'N/A',
					acn: directorship.acn ? fmtAcn(directorship.acn) : 'N/A',
					status: directorship.status || 'Current',
					appointmentDate: directorship.appointment_date || directorship.start_date
						? moment(directorship.appointment_date || directorship.start_date).format('DD/MM/YYYY')
						: 'N/A'
				};

				if (directorship.status === 'Ceased' || directorship.status === 'Former') {
					ceasedDirectorships.push(dir);
				} else {
					currentDirectorships.push(dir);
				}
			});
		}

		// Process shareholdings
		if (extract.shareholdings) {
			extract.shareholdings.forEach(shareholding => {
				const sh = {
					companyName: shareholding.company_name || shareholding.name || 'N/A',
					acn: shareholding.acn ? fmtAcn(shareholding.acn) : 'N/A',
					shareClass: shareholding.class || shareholding.share_class || 'N/A',
					shares: shareholding.number_held || shareholding.shares || '0',
					address: shareholding.address?.address || (shareholding.address ?
						`${shareholding.address.address_1 || ''} ${shareholding.address.address_2 ? shareholding.address.address_2 + ' ' : ''}${shareholding.address.suburb || ''} ${shareholding.address.state || ''} ${shareholding.address.postcode || ''}`.trim()
						: 'N/A'),
					status: shareholding.status || 'Current',
					hasDOB: shareholding.date_of_birth ? true : false
				};

				const isCurrent = sh.status === 'Current';
				const hasDOB = sh.hasDOB;

				if (isCurrent && hasDOB) {
					currentShareholdingsNameAndDOB.push(sh);
				} else if (!isCurrent && hasDOB) {
					ceasedShareholdingsNameAndDOB.push(sh);
				} else if (isCurrent && !hasDOB) {
					currentShareholdingsNameOnly.push(sh);
				} else {
					ceasedShareholdingsNameOnly.push(sh);
				}
			});
		}
	});

	// Generate Current Directorships table rows
	let currentDirectorshipsRows = '';
	if (currentDirectorships.length > 0) {
		currentDirectorships.forEach(dir => {
			currentDirectorshipsRows += `
                    <tr>
                        <td>${dir.companyName}</td>
                        <td>${dir.acn}</td>
                        <td>${dir.status}</td>
                        <td>${dir.appointmentDate}</td>
                    </tr>
      `;
		});
	} else {
		currentDirectorshipsRows = `
                    <tr>
                        <td colspan="4" style="text-align: center; color: #64748B; font-style: italic;">No current directorships found</td>
                    </tr>
    `;
	}

	// Generate Ceased Directorships table rows
	let ceasedDirectorshipsRows = '';
	if (ceasedDirectorships.length > 0) {
		ceasedDirectorships.forEach(dir => {
			ceasedDirectorshipsRows += `
                    <tr>
                        <td>${dir.companyName}</td>
                        <td>${dir.acn}</td>
                        <td style="color: #DC2626;">${dir.status}</td>
                        <td>${dir.appointmentDate}</td>
                    </tr>
      `;
		});
	} else {
		ceasedDirectorshipsRows = `
                    <tr>
                        <td colspan="4" style="text-align: center; color: #64748B; font-style: italic;">No ceased directorships found</td>
                    </tr>
    `;
	}

	// Generate Current Shareholdings (Name and DOB) table rows
	let currentShareholdingsNameAndDOBRows = '';
	if (currentShareholdingsNameAndDOB.length > 0) {
		currentShareholdingsNameAndDOB.forEach(sh => {
			currentShareholdingsNameAndDOBRows += `
                    <tr>
                        <td>${sh.companyName}</td>
                        <td>${sh.acn}</td>
                        <td>${sh.shareClass}</td>
                        <td>${parseInt(sh.shares, 10).toLocaleString('en-US')}</td>
                        <td>${sh.address}</td>
                        <td>${sh.status}</td>
                    </tr>
      `;
		});
	} else {
		currentShareholdingsNameAndDOBRows = `
                    <tr>
                        <td colspan="6" style="text-align: center; color: #64748B; font-style: italic;">No current shareholdings found</td>
                    </tr>
    `;
	}

	// Generate Ceased Shareholdings (Name and DOB) table rows
	let ceasedShareholdingsNameAndDOBRows = '';
	if (ceasedShareholdingsNameAndDOB.length > 0) {
		ceasedShareholdingsNameAndDOB.forEach(sh => {
			ceasedShareholdingsNameAndDOBRows += `
                    <tr>
                        <td>${sh.companyName}</td>
                        <td>${sh.acn}</td>
                        <td>${sh.shareClass}</td>
                        <td>${parseInt(sh.shares, 10).toLocaleString('en-US')}</td>
                        <td>${sh.address}</td>
                        <td style="color: #DC2626;">${sh.status}</td>
                    </tr>
      `;
		});
	} else {
		ceasedShareholdingsNameAndDOBRows = `
                    <tr>
                        <td colspan="6" style="text-align: center; color: #64748B; font-style: italic;">No ceased shareholdings found</td>
                    </tr>
    `;
	}

	// Generate Current Shareholdings (Name Only) table rows
	let currentShareholdingsNameOnlyRows = '';
	if (currentShareholdingsNameOnly.length > 0) {
		currentShareholdingsNameOnly.forEach(sh => {
			currentShareholdingsNameOnlyRows += `
                    <tr>
                        <td>${sh.companyName}</td>
                        <td>${sh.acn}</td>
                        <td>${sh.shareClass}</td>
                        <td>${parseInt(sh.shares, 10).toLocaleString('en-US')}</td>
                        <td>${sh.address}</td>
                        <td>${sh.status}</td>
                    </tr>
      `;
		});
	} else {
		currentShareholdingsNameOnlyRows = `
                    <tr>
                        <td colspan="6" style="text-align: center; color: #64748B; font-style: italic;">No current shareholdings found</td>
                    </tr>
    `;
	}

	// Generate Ceased Shareholdings (Name Only) table rows
	let ceasedShareholdingsNameOnlyRows = '';
	if (ceasedShareholdingsNameOnly.length > 0) {
		ceasedShareholdingsNameOnly.forEach(sh => {
			ceasedShareholdingsNameOnlyRows += `
                    <tr>
                        <td>${sh.companyName}</td>
                        <td>${sh.acn}</td>
                        <td>${sh.shareClass}</td>
                        <td>${parseInt(sh.shares, 10).toLocaleString('en-US')}</td>
                        <td>${sh.address}</td>
                        <td style="color: #DC2626;">${sh.status}</td>
                    </tr>
      `;
		});
	} else {
		ceasedShareholdingsNameOnlyRows = `
                    <tr>
                        <td colspan="6" style="text-align: center; color: #64748B; font-style: italic;">No ceased shareholdings found</td>
                    </tr>
    `;
	}

	// Calculate counts
	const directorshipsCount = currentDirectorships.length;
	const shareholdingsCount = currentShareholdingsNameAndDOB.length + currentShareholdingsNameOnly.length;

	// Report date
	const reportDate = moment().format('DD MMMM YYYY');
	const reportDateTime = moment().format('DD MMMM YYYY, h:mma');

	// Calculate total pages (base 4 pages)
	const totalPages = 4;

	// Extract company info for cover (from first directorship or entity)
	const companyName = currentDirectorships.length > 0
		? currentDirectorships[0].companyName
		: (entity.reference || 'N/A');
	const companyAcn = currentDirectorships.length > 0
		? currentDirectorships[0].acn
		: 'N/A';

	return {
		// Cover page (Page 1)
		cover_director_name: directorName,
		cover_report_date: reportDate,
		cover_company_name: companyName,
		cover_company_acn: companyAcn,

		// Page 2 - Director Search
		director_name: directorName,
		director_date_of_birth: dateOfBirth,
		director_address: address,
		director_report_date: reportDateTime,
		directorships_count: directorshipsCount,
		shareholdings_count: shareholdingsCount,
		data_extract_date: reportDateTime,
		current_directorships_rows: currentDirectorshipsRows,

		// Page 3
		ceased_directorships_rows: ceasedDirectorshipsRows,
		current_shareholdings_name_dob_rows: currentShareholdingsNameAndDOBRows,

		// Page 4
		ceased_shareholdings_name_dob_rows: ceasedShareholdingsNameAndDOBRows,
		current_shareholdings_name_only_rows: currentShareholdingsNameOnlyRows,
		ceased_shareholdings_name_only_rows: ceasedShareholdingsNameOnlyRows,

		// Page numbers
		page_number_2: `Page 2 of ${totalPages}`,
		page_number_3: `Page 3 of ${totalPages}`,
		page_number_4: `Page 4 of ${totalPages}`,

		// Document ID (using UUID or director name)
		document_id: rdata.uuid || directorName,

		// Legacy/placeholder fields (required for replaceVariables function)
		company_type: 'director-related',
		acn: 'N/A', // Not applicable for director-related reports (individual search)
		abn: 'N/A', // Not applicable for director-related reports (individual search)
		companyName: directorName // Use director name as companyName for compatibility
	};
}

// Extract data for PPSR Report
function extractPpsrData(data, business, reportype) {
	// Handle different data structures (could be rdata.resource or data.resource)
	const resource = data.resource || data.rdata?.resource || data;
	const searchCriteriaSummary = resource.searchCriteriaSummaries?.[0] || {};
	const items = resource.items || [];

	// Extract search metadata
	const searchNumber = searchCriteriaSummary.searchNumber || data.searchNumber || 'N/A';
	const criteriaSummary = searchCriteriaSummary.criteriaSummary || '';
	const resultCount = searchCriteriaSummary.resultCount || items.length || 0;

	// Extract entity information from first grantor
	let entityName = '';
	let entityAcn = '';
	let entityAbn = '';



	// For director-ppsr reports, use search word from business parameter
	if (reportype === 'director-ppsr' && business) {
		const searchWord = extractSearchWord(business, 'director-ppsr');
		if (searchWord) {
			entityName = searchWord;
		}
	} else {
		entityName = business.Name;
		entityAcn = business.Abn.substring(2);
		entityAbn = business.Abn;
	}

	// Format ACN
	const formattedAcn = entityAcn ? fmtAcn(entityAcn) : '';

	// Extract search date - use current date for now, or from data if available
	const searchDate = data.searchDate || moment().format('DD MMMM YYYY');
	const searchDateTime = data.searchDateTime || moment().format('DD MMMM YYYY, HH:mm [AEDT]');

	// Analyze registrations
	const registrations = items || [];
	const activeRegistrations = registrations.filter(r => {
		if (!r.registrationEndTime) return true; // No end time = active
		return moment(r.registrationEndTime).isAfter(moment());
	});

	// Count by collateral class type
	const collateralTypeCounts = {};
	registrations.forEach(r => {
		const type = r.collateralClassType || 'Unknown';
		collateralTypeCounts[type] = (collateralTypeCounts[type] || 0) + 1;
	});

	// Identify blanket security (All Pap No Except)
	const blanketSecurities = registrations.filter(r =>
		r.collateralClassType === 'All Pap No Except' ||
		r.collateralClassType === 'All Pap No Except'
	);

	// Count motor vehicles
	const motorVehicles = registrations.filter(r =>
		r.collateralClassType === 'Motor Vehicle'
	);

	// Build security breakdown text
	let securityBreakdown = '';
	if (blanketSecurities.length > 0) {
		securityBreakdown += `${blanketSecurities.length} × BLANKET SECURITY (All Assets)\n`;
	}
	if (motorVehicles.length > 0) {
		securityBreakdown += `${motorVehicles.length} × MOTOR VEHICLE SECURITIES`;
	}
	if (securityBreakdown === '') {
		securityBreakdown = 'No data available';
	}

	// Build secured parties summary
	const securedPartiesMap = new Map();
	registrations.forEach(r => {
		const partySummary = r.securedPartySummary || 'Unknown';
		const collateralType = r.collateralClassType || 'Unknown';
		const count = securedPartiesMap.get(partySummary) || { total: 0, types: new Set() };
		count.total += 1;
		count.types.add(collateralType);
		securedPartiesMap.set(partySummary, count);
	});

	// Generate secured parties at a glance HTML
	let securedPartiesRows = '';
	let partyIndex = 0;
	for (const [partyName, info] of securedPartiesMap.entries()) {
		if (partyIndex >= 4) break; // Limit to 4 parties on page 2

		const assetCount = info.total;
		const hasVehicles = motorVehicles.filter(r => r.securedPartySummary === partyName).length > 0;
		const assetText = assetCount === 1 ? 'All Company Assets' :
			hasVehicles
				? `${motorVehicles.filter(r => r.securedPartySummary === partyName).length} Vehicles`
				: `${assetCount} Assets`;

		const priority = blanketSecurities.some(r => r.securedPartySummary === partyName)
			? 'CRITICAL'
			: 'HIGH';

		const typeLabel = hasVehicles ? 'Vehicle Finance' : 'General Security';

		securedPartiesRows += `
                <div class="data-grid" style="grid-template-columns: 2fr 1.5fr 1fr 1fr; gap: 12px;">
                    <div class="data-value">${partyName}</div>
                    <div class="data-value">${typeLabel}</div>
                    <div class="data-value">${assetText}</div>
                    <div><span class="badge ${priority.toLowerCase()}">${priority}</span></div>
                </div>
    `;
		if (partyIndex < securedPartiesMap.size - 1 && partyIndex < 3) {
			securedPartiesRows += '<div class="divider" style="margin: 12px 0;"></div>';
		}
		partyIndex++;
	}
	if (securedPartiesRows === '') {
		securedPartiesRows = '<div class="data-value" style="text-align: center; color: #64748B; font-style: italic; grid-column: 1 / -1;">No data available</div>';
	}

	// Find critical blanket security for Page 3
	const criticalSecurity = blanketSecurities[0] || null;
	let criticalSecurityHtml = '';
	if (criticalSecurity) {
		const startDate = criticalSecurity.registrationStartTime
			? moment(criticalSecurity.registrationStartTime).format('MMMM YYYY')
			: 'N/A';
		const endDate = criticalSecurity.registrationEndTime
			? moment(criticalSecurity.registrationEndTime).format('DD MMMM YYYY')
			: 'No expiry date';

		criticalSecurityHtml = `
      <div class="card alert">
          <div class="card-header">[CRITICAL] - Blanket Security Interest</div>
          <div style="font-size: 11px; line-height: 1.7; color: #1E293B; margin-bottom: 16px;">
              <strong>${criticalSecurity.securedPartySummary || 'N/A'}</strong> holds an unrestricted security over <strong>ALL present and after-acquired property</strong> with <strong>${endDate === 'No expiry date' ? 'no end date' : 'end date: ' + endDate}</strong>. This is the most significant security interest on the register.
          </div>
          <div class="data-grid" style="grid-template-columns: repeat(2, 1fr);">
              <div class="data-item">
                  <div class="data-label">Registration</div>
                  <div class="data-value">${criticalSecurity.registrationNumber || 'N/A'}</div>
              </div>
              <div class="data-item">
                  <div class="data-label">Started</div>
                  <div class="data-value">${startDate}</div>
              </div>
              <div class="data-item">
                  <div class="data-label">Expires</div>
                  <div class="data-value">${endDate}</div>
              </div>
              <div class="data-item">
                  <div class="data-label">Scope</div>
                  <div class="data-value">Everything the company owns or will own</div>
              </div>
          </div>
      </div>
    `;
	} else {
		criticalSecurityHtml = '<div class="card" style="border: 2px solid #E2E8F0;"><div class="data-value" style="text-align: center; color: #64748B; font-style: italic; padding: 20px;">No data available</div></div>';
	}

	// Group motor vehicles by expiry year
	const vehicleExpiryGroups = {};
	motorVehicles.forEach(v => {
		if (v.registrationEndTime) {
			const year = moment(v.registrationEndTime).year();
			vehicleExpiryGroups[year] = (vehicleExpiryGroups[year] || 0) + 1;
		}
	});

	let vehicleExpiryTimeline = '';
	const sortedYears = Object.keys(vehicleExpiryGroups).sort((a, b) => a - b);
	sortedYears.forEach(year => {
		vehicleExpiryTimeline += `• <strong>${year}:</strong> ${vehicleExpiryGroups[year]} vehicles<br>`;
	});
	if (vehicleExpiryTimeline === '') {
		vehicleExpiryTimeline = 'No data available';
	}

	// Calculate total pages: 3 base pages + registration pages (max 7) + 2 (glossary + document info) = max 12
	const numRegistrationPages = registrations.length === 0 ? 1 : Math.min(registrations.length, 7); // If no registrations, add 1 page for "No data available"
	const totalPages = 3 + numRegistrationPages + 2; // Always include Pages 11 and 12

	// Generate registration detail pages HTML (one page per registration, starting from page 4)
	let registrationPagesHtml = '';
	if (registrations.length === 0) {
		registrationPagesHtml = `
        <!-- PAGE 4: NO REGISTRATIONS -->
        <div class="page">
            <div class="brand-header">
                <div class="logo"><img src="data:image/webp;base64,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" alt="Credion"></div>
                <div class="doc-id">${searchNumber}</div>
            </div>
            
            <div class="section-title">Registration Details</div>
            
            <div class="card" style="border: 2px solid #E2E8F0;">
                <div class="data-value" style="text-align: center; color: #64748B; font-style: italic; padding: 40px;">No data available</div>
            </div>
            
            <div class="page-number">Page 4 of ${totalPages}</div>
        </div>
    `;
	}
	registrations.slice(0, 7).forEach((reg, index) => { // Limit to 7 registrations (pages 4-10)
		const regNum = index + 1;
		const isBlanket = reg.collateralClassType === 'All Pap No Except';
		const isVehicle = reg.collateralClassType === 'Motor Vehicle';

		// Format dates
		const regStart = reg.registrationStartTime
			? moment(reg.registrationStartTime).format('DD MMMM YYYY, HH:mm')
			: 'N/A';
		const regEnd = reg.registrationEndTime
			? moment(reg.registrationEndTime).format('DD MMMM YYYY, HH:mm:ss')
			: 'No stated end time';
		const lastChanged = reg.registrationChangeTime
			? moment(reg.registrationChangeTime).format('DD MMMM YYYY, HH:mm:ss')
			: 'N/A';

		// Get secured party ACN
		const securedParty = reg.securedParties?.[0];
		const securedPartyAcn = securedParty?.organisationNumberType === 'ACN'
			? fmtAcn(securedParty.organisationNumber)
			: 'N/A';

		// Get address for service
		const addressForService = reg.addressForService || {};
		const contactEmail = addressForService.emailAddress || 'N/A';
		const contactFax = addressForService.faxNumber || '';
		const mailingAddress = addressForService.mailingAddress || {};
		const contactAddress = [
			mailingAddress.line1,
			mailingAddress.line2,
			mailingAddress.line3,
			mailingAddress.locality,
			mailingAddress.state,
			mailingAddress.postcode
		].filter(Boolean).join(', ') || 'N/A';

		const collateralType = reg.collateralClassType || 'N/A';
		const collateralDesc = reg.collateralDescription || (isBlanket ? 'All present and after-acquired property - No exceptions' : 'N/A');
		const proceedsDesc = reg.proceedsClaimedDescription || 'N/A';
		const pmsi = reg.isPmsi ? 'Yes' : 'No';

		// Vehicle-specific fields
		const vin = reg.serialNumber || '';
		const serialNumberType = reg.serialNumberType || '';
		const vehicleDescription = reg.vehicleDescriptiveText || 'Unknown/Unknown/Unknown';

		const pageNum = 4 + index; // Pages start at 4

		registrationPagesHtml += `
        <!-- PAGE ${pageNum}: REGISTRATION #${regNum} -->
        <div class="page">
            <div class="brand-header">
                <div class="logo"><img src="data:image/webp;base64,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" alt="Credion"></div>
                <div class="doc-id">${searchNumber}</div>
            </div>
            
            <div class="section-title">Registration #${regNum} - ${isVehicle ? 'Motor Vehicle' : (isBlanket ? 'General Security' : collateralType)}</div>
            ${isVehicle && motorVehicles.filter(v => v.securedPartySummary === reg.securedPartySummary).length > 1
				? `<div class="section-subtitle">${reg.securedPartySummary} (Vehicle ${motorVehicles.filter(v => v.securedPartySummary === reg.securedPartySummary && registrations.indexOf(v) <= registrations.indexOf(reg)).length} of ${motorVehicles.filter(v => v.securedPartySummary === reg.securedPartySummary).length})</div>`
				: `<div class="section-subtitle">${reg.securedPartySummary || 'N/A'}</div>`
			}
            
            ${isBlanket ? `
            <div class="card alert" style="margin-bottom: 20px;">
                <div style="font-size: 11px; line-height: 1.7; color: #1E293B;">
                    <strong>IMPORTANT:</strong> This registration provides ${reg.securedPartySummary || 'the secured party'} with security over EVERYTHING the company owns or acquires. This is the most comprehensive security interest on file.
                </div>
            </div>
            ` : ''}
            
            <div class="card" style="border: 2px solid #CBD5E1;">
                <div class="data-grid" style="grid-template-columns: repeat(2, 1fr);">
                    <div class="data-item">
                        <div class="data-label">Registration Number</div>
                        <div class="data-value">${reg.registrationNumber || 'N/A'}</div>
                    </div>
                    <div class="data-item">
                        <div class="data-label">Secured Party</div>
                        <div class="data-value">${reg.securedPartySummary || 'N/A'}</div>
                    </div>
                    ${securedPartyAcn !== 'N/A' ? `
                    <div class="data-item">
                        <div class="data-label">ACN</div>
                        <div class="data-value">${securedPartyAcn}</div>
                    </div>
                    ` : ''}
                    ${isVehicle && vin ? `
                    <div class="data-item">
                        <div class="data-label">${serialNumberType || 'VIN'}</div>
                        <div class="data-value">${vin}</div>
                    </div>
                    ` : ''}
                    ${isVehicle && !vin && serialNumberType ? `
                    <div class="data-item">
                        <div class="data-label">Serial Number</div>
                        <div class="data-value">${reg.serialNumber || 'N/A'}</div>
                    </div>
                    <div class="data-item" style="grid-column: 1 / -1;">
                        <div class="data-label">Serial Number Type</div>
                        <div class="data-value">${serialNumberType}</div>
                    </div>
                    ` : ''}
                    <div class="data-item">
                        <div class="data-label">Registration Start</div>
                        <div class="data-value">${regStart}</div>
                    </div>
                    <div class="data-item">
                        <div class="data-label">Registration End</div>
                        <div class="data-value" style="${!reg.registrationEndTime ? 'font-weight: 700;' : ''}">${regEnd}</div>
                    </div>
                    ${lastChanged !== 'N/A' ? `
                    <div class="data-item">
                        <div class="data-label">Last Changed</div>
                        <div class="data-value">${lastChanged}</div>
                    </div>
                    ` : ''}
                    <div class="data-item">
                        <div class="data-label">Collateral Type</div>
                        <div class="data-value">${reg.collateralSummary || collateralType}</div>
                    </div>
                    <div class="data-item">
                        <div class="data-label">PMSI</div>
                        <div class="data-value">${pmsi}</div>
                    </div>
                    ${collateralDesc !== 'N/A' && !isBlanket ? `
                    <div class="data-item" style="grid-column: 1 / -1;">
                        <div class="data-label">Collateral Description</div>
                        <div class="data-value">${collateralDesc}</div>
                    </div>
                    ` : ''}
                    ${isBlanket ? `
                    <div class="data-item" style="grid-column: 1 / -1;">
                        <div class="data-label">Collateral Type</div>
                        <div class="data-value" style="font-weight: 600;">All present and after-acquired property - No exceptions</div>
                    </div>
                    ` : ''}
                    ${proceedsDesc !== 'N/A' ? `
                    <div class="data-item" style="grid-column: 1 / -1;">
                        <div class="data-label">Proceeds</div>
                        <div class="data-value">${proceedsDesc}</div>
                    </div>
                    ` : ''}
                    ${isVehicle && vehicleDescription ? `
                    <div class="data-item" style="grid-column: 1 / -1;">
                        <div class="data-label">Vehicle Description</div>
                        <div class="data-value">${vehicleDescription}</div>
                    </div>
                    ` : ''}
                    <div class="data-item">
                        <div class="data-label">Contact Email</div>
                        <div class="data-value">${contactEmail}</div>
                    </div>
                    ${contactFax ? `
                    <div class="data-item" style="grid-column: 1 / -1;">
                        <div class="data-label">Contact Email / Fax</div>
                        <div class="data-value">${contactEmail} / Fax: ${contactFax}</div>
                    </div>
                    ` : ''}
                    <div class="data-item">
                        <div class="data-label">Contact Address</div>
                        <div class="data-value">${contactAddress}</div>
                    </div>
                </div>
            </div>
            
            <div class="page-number">Page ${pageNum} of ${totalPages}</div>
        </div>
    `;
	});

	// Generate secured party contacts for Page 11
	const uniqueSecuredParties = new Map();
	registrations.forEach(r => {
		const partySummary = r.securedPartySummary || '';
		const addressForService = r.addressForService || {};
		if (!uniqueSecuredParties.has(partySummary)) {
			uniqueSecuredParties.set(partySummary, {
				name: partySummary,
				email: addressForService.emailAddress || '-',
				fax: addressForService.faxNumber || '-'
			});
		}
	});

	let securedPartyContactsRows = '';
	uniqueSecuredParties.forEach(party => {
		const faxDisplay = party.fax !== '-' ? `Fax: ${party.fax}` : '-';
		securedPartyContactsRows += `
                <div class="data-grid" style="grid-template-columns: 2fr 2fr 1.5fr; gap: 12px; margin-bottom: 12px;">
                    <div class="data-value">${party.name}</div>
                    <div class="data-value" style="font-size: ${party.email.length > 30 ? '9px' : '10px'};">${party.email}</div>
                    <div class="data-value" style="font-size: ${faxDisplay.length > 15 ? '9px' : '10px'};">${faxDisplay}</div>
                </div>
    `;
	});

	// Generate Page 11 - Glossary & Contacts
	const glossaryPageHtml = `
        <!-- PAGE 11: GLOSSARY & CONTACTS -->
        <div class="page">
            <div class="brand-header">
                <div class="logo"><img src="data:image/webp;base64,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" alt="Credion"></div>
                <div class="doc-id">${searchNumber}</div>
            </div>
            
            <div class="page-title" style="font-size: 18px; margin-bottom: 16px;">Glossary of Terms</div>
            
            <div class="card info" style="margin-bottom: 10px;">
                <div class="data-label" style="margin-bottom: 6px;">PPSR - Personal Property Securities Register</div>
                <div class="text-sm">A national online register of security interests in personal property in Australia</div>
            </div>
            
            <div class="card info" style="margin-bottom: 10px;">
                <div class="data-label" style="margin-bottom: 6px;">PMSI - Purchase Money Security Interest</div>
                <div class="text-sm">A special type of security where the lender financed the specific purchase of the asset</div>
            </div>
            
            <div class="card info" style="margin-bottom: 10px;">
                <div class="data-label" style="margin-bottom: 6px;">Grantor</div>
                <div class="text-sm">The party granting the security interest (${entityName || 'N/A'})</div>
            </div>
            
            <div class="card info" style="margin-bottom: 10px;">
                <div class="data-label" style="margin-bottom: 6px;">Secured Party</div>
                <div class="text-sm">The lender or financier holding the security interest</div>
            </div>
            
            <div class="card info" style="margin-bottom: 10px;">
                <div class="data-label" style="margin-bottom: 6px;">Collateral</div>
                <div class="text-sm">The property securing the debt</div>
            </div>
            
            <div class="card info" style="margin-bottom: 10px;">
                <div class="data-label" style="margin-bottom: 6px;">After-Acquired Property</div>
                <div class="text-sm">Property obtained after the security agreement, but still covered by it</div>
            </div>
            
            <div class="card info" style="margin-bottom: 10px;">
                <div class="data-label" style="margin-bottom: 6px;">Proceeds</div>
                <div class="text-sm">What's received when collateral is sold, including insurance payouts</div>
            </div>
            
            <div class="section-title" style="margin-top: 24px;">Secured Party Contacts</div>
            
            <div class="card" style="border: 2px solid #E2E8F0;">
                <div class="data-grid" style="grid-template-columns: 2fr 2fr 1.5fr; gap: 12px;">
                    <div class="data-label">Institution</div>
                    <div class="data-label">Email</div>
                    <div class="data-label">Phone / Fax</div>
                </div>
                <div class="divider" style="margin: 12px 0;"></div>
                ${securedPartyContactsRows || '<div class="data-value" style="text-align: center; color: #64748B; font-style: italic; grid-column: 1 / -1;">No secured party contacts available</div>'}
            </div>
            
            <div class="page-number">Page 11 of ${totalPages}</div>
        </div>
  `;

	// Generate Page 12 - Document Information
	const documentInfoPageHtml = `
        <!-- PAGE 12: DOCUMENT INFORMATION -->
        <div class="page">
            <div class="brand-header">
                <div class="logo"><img src="data:image/webp;base64,UklGRhwNAABXRUJQVlA4WAoAAAAgAAAASgEAewAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggLgsAADA6AJ0BKksBfAA+USiQRiOioaEmMokgcAoJZ27hdgD9v4+ufkdxAPffn3zu9eX7LcAP0b/u32McID+G/3n9UOwt6AH+A/xnWLegB5ZP7h/CD+2n7XezBqq/kn+tdmv91+rntzfU3sBk+nvn9j8v/8Z/LfFP1QeoF6l/wn5TfmBx82ieYF7AfTv8xxl+IB+rP/G41qgH/PP7p/2v7b7rv8n/2f8d+aHtB/N/8b/4/8d8Bn8x/rn/M/vHaK/b72Wf13//5B0C4TijRaQWRayoJBacJxRotILItY6Ba3Et5WSMdAFhU1OSlQLqzNtwMZe7qxPjI0wejVqirrcpWk0Tws5o4WEUoLmn3gnl+MYVa7FoZH+2xS2a79Lg0jv+5EjM0yNxJF4wp/f/86PEixJ6e3xek1i7p7csjSchWNVvysKAIE7TpOSTZ2svir8WE8mtmfQhy23oaqG49knz3SupB5H5tK3YCMg5W8zZqxP/Vu4xbwQTqsAHhN9fVv6aM3UHfTk6Q28miMp0ZV4zmd1+57pol6a2vNXFIybPFttE6j8ylJqSo6+yVG6R65s0oI2K0DyUV5UK4RtjmeoikAJFn9PralZ5JBZFrKgkFpwnFGi0gsi1lQSC04TZAAD+/9uZAAABDT3B52ZvoCMruepaKrRROENx5WKFJFIjc5alRPtNcv+r/bYVl1/ATfbYE//Hu67TthoWJJ5tOsWiQ6AaFqN/OUM8E5VHiVAcu4dAqJaaHaRG2e9uB9RJGI97TmfZhcv5cRTeXek8zT7wl7b9RKrNtTkiAWN9mr56x9FKpOhH/kPwovovmP85hsIK1n1/HY09sSaFlZ66m3NtrIMl11kw/kLV2+1eL4AIJ0EF+8UMXFgNNknOWXBEEVtkxGcENf82TJeoInxp+s3yM7q/V5ID6UEI7SrOSrOIraP3W1rfEYLXffGb9A1QCvx8ia4o1tnz/4uZkFTWC92qm1RH8gUt5gDTSAA9FF6RBNXKofpGukof7a3e8D4i2KE/VT2tXD3775dFCsi95h/8K9KP7/0aCm5QyuHmqu7R1N81W36EPfF5OGUPP7TX80fzRflu9NCotw8zLs0gm/FcEQA1H8KfCpjvf0brT5T+0iAM7tDhEe6js1Aj9Pf1KfdTzk7qhHCj1L4Y22zV5N3E1hbKQazZ7vfVms5bMFQEJzdu//xZ35P40SUJEuJFDpBzzRjgNOoXNaHTqN1u0RtgSMu7lUX/fYMQ9pM2bAj4gWX/MnWNbte5LMTziRv8xd35djfxSuEkfIGATmbe1H5vJHkY5f6EzeTCD4H56mZjo9SIfUK2fh9rbfaJo2pOax/8qgwdFZ5viBY2q2wAvd+wVeqMlM6R/imiS58gU3dJaPGC8RwP7Zz85bn8aPcIpOf47RTYxtUKbbYliEIJ8ZyoBS6c5mmCnQUeR9CdwJRYRufr/m/UQGW+ovXZa7+LALuRhll8IAucpdT7Sj+o4wBA+4t9YQUCu85+S57MBeFjlVIK/vm6jKp2DeH/yMgkG/yLYbva2DEeme+9xll/Wyx/nFAycWB36rot/+H9KvUJxdmXlC4cK7RKkwybGFyX5kTPzkd3LK9KCxP50jHyqtCDW6rf7nyzJzfiDGvEhBkYM+cNAMmKuW5065Jxf7ANRk9ciHyI+TquBZd4P/Z2IVhTHMBrCz/6pGthtRxIyaOwv4+1GkkstkiKY288lEiSA7ADFnO+sRp3fgtXDgCyVREXmeI2rhOCwHiLXsPiyIHNykMS8VaxPcXpcmai7lxJdPHvKrPIgnT7FjS8dH1ARRM9/NILiv7ndaMlNVMeacn3OY1Qvevqlv0h7wIzpe69MBaH4FawVk/VJCdF9ZAJtZ/nTNjR94PLlcGAAiRgTIrS2bWxP7VY7AIXudd9tVScEior1gjnPd9Z4arMs08Ih74RhvZiKONlnVPOP1mVsR8AFCYdwdB3QbJrpeha8t5k6ZP0sCfoeXX/JpoU+hfTZVG9Z+jp47XafxCp1amokS8j+FHv+l1V63fIF3qYIF7/qB4wFivo09ciUzvQVu4fBK4r14YUgcI1+9oCwdaeLAEXVFqkHzP69jE/e+jIrpvcZHbfd3Do9x+/dJMd1ggnhqcOpSAmx8SSKL8R69+lwnPViC/vcUvbD5DGW+EuT8vneX14xgayuNV5QtKLUfSCdLQVID3jpdYlv34vzPeVz0lJsVN3d9xIFL1BhjuoVB9/azvJWeXBM170Fapd42fwiV0KqPIHsLpWtxy4aZER8vskJ8QPINHrKQHIdNy+9kHO0P7lr6yhHUf/8dqS97tCFU/skdvTiV0hAe7VdrIF8YlIZ5kmXI0vofthFcFF89omxdaCr6MQEz1qiVVqfaPH1zWpv+C7EnRLAJpW6SZ8YHu15fEUB1sn4c8/4gBEKMlmILL7q7rzRGPMfh+4LWaobjY6xlP94v4HxY7x2HF+PQQux0hXg5spxOVEgW94mfzp6kHSMHkKAfbIPO21TlfUAcBBTuEwETt3//juGcZId2iL++JQ7gVKik39rWZ+c0mYyHwHpmbKf1224zyO1Kx03eIiIRMVvsA9nsl36+P7FvRl29OuGqbJQSWhIlUoFH7k+gTbZAMYXXriU3+MXRH8Sp4lBQL0ShvsxF+dffPyZCxyStMgwooIX1vx5kKV4pcYsh71Tme4Q8OC9D6LU3puu6qhCagxdF0wHZWPtsACUgl7B6XX9xozO5cdzAlc1Qaod7M7Mdxx9Rd8xnN/fkpNzeinvKpVpdYLIaIlP2q+LJbNDhU+90sZ5nw9wY/8CnwSWWU4a+//iimn05K6zGJSXCnYPno+Pvp/csn9i1Wgq5/CA9ZCSXmOfb+EMrKCGn/B0M8f4dEJjgOefo9v2nX/jA9fpbZx12Fv+oQLNqvm63lnvpfagTZJKCzTe0Xx0yEh/z9NXFse90LIwEFDWhqXqk/2zo4uyaEDPp1jWkvUCqXvnl8XzRltrgzO9yA5r0PKxHAnMSuuguxsS/qpPCzW5/UQDM0h4f6gRg1j5kOZLOzOmu3dWfMTj1HEZ3sgx63CIig6hcXvsbPsb2dqtiPU5L+84fmVJC0mRi+LMT4xft/n7gA3602NMwqLfKw0f3Vedbotod9vb9MQpKz43NwlgJrgtvM10mEifukBoUrycbhic52cZOIUPdYDVTLiTzC+OFf7q5NBJLGPTS17FIEOTu2HQ+78OKfd4yiePB+PWriQccjyOUJqYC4O3c/hyvF85rDPVoBEgLLCHKQpW+XMAIp1zzB1dSKXeNR3aEbjLZ0T5GWZw+bKWaWX6yQojRVEqMoMmv7SZNBaj0mFc7+D2ky0mCobBHWyIkNPKtRG4oGSzgUpq6fd7miS+D023+wzxtlVCOj3ANoqFQpMkdB0dPaH90lFLmVXTA1UcXdFqbAeVhfO/fcuTJ+ujrwJG7VyaTOywocRemY+F03p68O6bxUKTai/4GK2p6/Zba368UHbiBU9AX164ZOFYlMdYBKGHtKnXrJ0YCHCdJh74diK2NxKVAsSAgUjlHE+cYrEvN4Mpe/nFJO6jd5JFmzpTJHLKVKTkmhp0axMUSroSmnJ72JI2uSQd9GMR38EeBGrbR5vH9A7L5K9/wAo1DitQLMYgdHyTQRMw1Bc9vkTtIzfRk3aAzGAwQwvXR/wdcZV0jkbB8NyjG+MiL0NQ4fyX9LXpLEYcWwchq/UWKrlCRxDDy2/AAwat/G0nrRVWZ7Bwm/ji7iF99dJsxEFaI7aIGdhXqx9QAbWEKH/bwH7GlCRPQsE5GHwWPinFkqEjvYAAAAAAAAAAA==" alt="Credion"></div>
                <div class="doc-id">${searchNumber}</div>
            </div>
            
            <div class="page-title">Document Information</div>
            
            <div class="card primary">
                <div class="card-header">SEARCH DETAILS</div>
                <div class="data-grid" style="grid-template-columns: repeat(2, 1fr);">
                    <div class="data-item">
                        <div class="data-label">Source</div>
                        <div class="data-value">Australian Financial Security Authority (AFSA)</div>
                    </div>
                    <div class="data-item">
                        <div class="data-label">Register</div>
                        <div class="data-value">Personal Property Securities Register (PPSR)</div>
                    </div>
                    <div class="data-item">
                        <div class="data-label">Search Number</div>
                        <div class="data-value">${searchNumber}</div>
                    </div>
                    <div class="data-item">
                        <div class="data-label">Search Performed</div>
                        <div class="data-value">${searchDateTime} (Canberra Time)</div>
                    </div>
                </div>
            </div>
            
            <div class="section-title" style="margin-top: 30px;">Contact PPSR</div>
            
            <div class="card" style="border: 2px solid #CBD5E1;">
                <div class="data-grid" style="grid-template-columns: 1fr;">
                    <div class="data-item">
                        <div class="data-label">Email</div>
                        <div class="data-value">enquiries@ppsr.gov.au</div>
                    </div>
                    <div class="data-item">
                        <div class="data-label">Phone</div>
                        <div class="data-value">1300 00 77 77</div>
                    </div>
                    <div class="data-item">
                        <div class="data-label">Website</div>
                        <div class="data-value">www.ppsr.gov.au</div>
                    </div>
                    <div class="data-item">
                        <div class="data-label">Mail</div>
                        <div class="data-value">GPO Box 1944, Adelaide SA 5001</div>
                    </div>
                </div>
            </div>
            
            <div class="card warning" style="margin-top: 30px;">
                <div class="text-sm" style="line-height: 1.8;">
                    <strong>Important Notice:</strong> This report is based on PPSR data current as at the search date. Security interests may have been added, removed, or modified since this search was performed.
                </div>
            </div>
            
            <div class="page-number">Page 12 of ${totalPages}</div>
        </div>
  `;

	return {
		// Cover page
		cover_company_name: entityName || 'N/A',
		cover_report_date: searchDate,
		cover_entity_name: entityName || 'N/A',
		cover_acn: formattedAcn || 'N/A',
		cover_document_id: searchNumber,

		// Page 2 - Executive Summary
		search_date: searchDateTime,
		total_security_interests: `${activeRegistrations.length} active registrations`,
		search_status: activeRegistrations.length === resultCount ? 'All registrations current and valid' : `${activeRegistrations.length} active, ${resultCount - activeRegistrations.length} expired`,
		security_breakdown: securityBreakdown,
		secured_parties_rows: securedPartiesRows,
		page_number_2: `Page 2 of ${totalPages}`,

		// Page 3 - Key Risk Indicators
		critical_security_section: criticalSecurityHtml,
		vehicle_finance_count: motorVehicles.length,
		vehicle_finance_financiers_count: new Set(motorVehicles.map(v => v.securedPartySummary)).size,
		vehicle_expiry_timeline: vehicleExpiryTimeline,
		page_number_3: `Page 3 of ${totalPages}`,

		// Registration pages (4-10) + Glossary (11) + Document Info (12)
		registration_pages: registrationPagesHtml + glossaryPageHtml + documentInfoPageHtml,

		// Common fields
		company_type: 'ppsr',
		acn: formattedAcn,
		abn: entityAbn,
		companyName: entityName || 'N/A'
	};
}

// Extract data for Director Court Report
function extractDirectorCourtData(data, business) {
	const criminalCourtSection = data.criminal_court;
	const civilCourtSection = data.civil_court;

	const isCriminalNotOrdered = criminalCourtSection == null;
	const isCivilNotOrdered = civilCourtSection == null;

	// Handle the new API response structure with separate criminal_court and civil_court
	const criminalCourtData = isCriminalNotOrdered ? {} : (criminalCourtSection?.data || {});
	const civilCourtData = isCivilNotOrdered ? {} : (civilCourtSection?.data || {});

	const criminalRecords = Array.isArray(criminalCourtData.records) ? criminalCourtData.records : [];
	const civilRecords = Array.isArray(civilCourtData.records) ? civilCourtData.records : [];

	const totalCriminalRecords = criminalCourtData.total || criminalRecords.length;
	const totalCivilRecords = civilCourtData.total || civilRecords.length;
	const totalRecords = totalCriminalRecords + totalCivilRecords;

	// Get first record for cover page details (try criminal first, then civil)
	const firstRecord = criminalRecords[0] || civilRecords[0] || {};

	// Get search word from business parameter - use it even if results are empty
	// Determine report type for search word extraction
	const reportType = business?.type || 'director-court';
	const searchWord = extractSearchWord(business, reportType);

	// Prefer search word from business, fallback to extracted data
	let directorName = 'N/A';
	if (searchWord) {
		directorName = searchWord;
	} else {
		directorName = firstRecord.fullname || (firstRecord.given_name + ' ' + firstRecord.surname) || 'N/A';
	}

	const reportDate = moment().format('DD MMMM YYYY');

	// Build criminal court rows
	let criminalCourtRows = '';
	if (isCriminalNotOrdered) {
		criminalCourtRows = `
                    <tr>
                        <td colspan="8" style="text-align: center; padding: 20px; color: #94A3B8;">Criminal court search not ordered</td>
                    </tr>`;
	} else if (criminalRecords.length > 0) {
		criminalRecords.forEach((record, index) => {
			const formattedDate = record.date ? moment(record.date).format('DD MMM YYYY') : 'N/A';
			criminalCourtRows += `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${record.state || 'N/A'}</td>
                        <td>${formattedDate}</td>
                        <td>${record.listing_type || 'N/A'}</td>
                        <td>${record.court || 'N/A'}</td>
                        <td>${record.court_room || record.location || 'N/A'}</td>
                        <td>${record.case_no || 'N/A'}</td>
                        <td>${record.case_title || 'N/A'}</td>
                    </tr>`;
		});
	} else {
		criminalCourtRows = `
                    <tr>
                        <td colspan="8" style="text-align: center; padding: 20px; color: #94A3B8;">No criminal court records found</td>
                    </tr>`;
	}

	// Build civil court rows
	let civilCourtRows = '';
	if (isCivilNotOrdered) {
		civilCourtRows = `
                    <tr>
                        <td colspan="8" style="text-align: center; padding: 20px; color: #94A3B8;">Civil court search not ordered</td>
                    </tr>`;
	} else if (civilRecords.length > 0) {
		civilRecords.forEach((record, index) => {
			const formattedDate = record.date ? moment(record.date).format('DD MMM YYYY') : 'N/A';
			const additionalInfo = record.additional_info1 || record.additional_info || 'N/A';
			civilCourtRows += `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${record.state || 'N/A'}</td>
                        <td>${formattedDate}</td>
                        <td>${record.listing_type || 'N/A'}</td>
                        <td>${record.court || 'N/A'}</td>
                        <td>${record.case_title || 'N/A'}</td>
                        <td>${record.case_no || 'N/A'}</td>
                        <td>${additionalInfo}</td>
                    </tr>`;
		});
	} else {
		civilCourtRows = `
                    <tr>
                        <td colspan="8" style="text-align: center; padding: 20px; color: #94A3B8;">No civil court records found</td>
                    </tr>`;
	}

	// Extract given name and surname from search word if available, otherwise from first record
	let directorGivenName = 'N/A';
	let directorSurname = 'N/A';

	if (searchWord) {
		// Try to parse the search word (format: "SURNAME, Given Names" or "Given Names SURNAME")
		const nameParts = searchWord.split(',').map(part => part.trim());
		if (nameParts.length === 2) {
			// Format: "SURNAME, Given Names"
			directorSurname = nameParts[0] || 'N/A';
			directorGivenName = nameParts[1] || 'N/A';
		} else {
			// Format: "Given Names SURNAME" or just "Name"
			const words = searchWord.split(' ').filter(w => w.trim());
			if (words.length > 1) {
				directorSurname = words[words.length - 1] || 'N/A';
				directorGivenName = words.slice(0, -1).join(' ') || 'N/A';
			} else {
				directorGivenName = searchWord;
			}
		}
	} else {
		directorGivenName = firstRecord.given_name || 'N/A';
		directorSurname = firstRecord.surname || 'N/A';
	}

	return {
		director_name: directorName,
		report_date: reportDate,
		director_given_name: directorGivenName,
		director_surname: directorSurname,
		total_records: totalRecords,
		total_criminal_records: isCriminalNotOrdered ? 0 : totalCriminalRecords,
		total_civil_records: isCivilNotOrdered ? 0 : totalCivilRecords,
		criminal_court_rows: criminalCourtRows,
		civil_court_rows: civilCourtRows,
		companyName: directorName, // For compatibility with existing template system
		acn: 'N/A',
		abn: 'N/A',
		company_type: 'director-court'
	};
}

// Extract data for Property Title Reference report
function extractpropertyData(data) {
	const propertyData = data?.cotality?.propertyData || {};
	const salesHistoryList = Array.isArray(data?.cotality?.salesHistory?.saleList)
		? data.cotality.salesHistory.saleList
		: [];
	const titleOrder = data?.titleOrder || {};
	const orderResultBlock = titleOrder.OrderResultBlock || {};
	const dataSources = Array.isArray(orderResultBlock.DataSources) ? orderResultBlock.DataSources : [];
	const primaryDataSource = dataSources[0] || {};
	const serviceResultBlock = titleOrder.ServiceResultBlock || {};
	const locationSegment = Array.isArray(titleOrder.LocationSegment) ? titleOrder.LocationSegment[0] || {} : {};
	const locationAddress = locationSegment.Address || {};
	const resourceSegment = Array.isArray(titleOrder.ResourceSegment) ? titleOrder.ResourceSegment[0] || {} : {};
	const realPropertySegment = Array.isArray(titleOrder.RealPropertySegment)
		? titleOrder.RealPropertySegment[0] || {}
		: {};
	const identityBlock = realPropertySegment.IdentityBlock || {};
	const registryBlock = realPropertySegment.RegistryBlock || {};
	const ownership = registryBlock.Ownership || {};
	const owners = Array.isArray(ownership.Owners) ? ownership.Owners : [];

	const escapeHtml = (value) => {
		if (value === null || value === undefined) {
			return '';
		}
		return String(value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	};

	const formatDate = (value, format = 'DD MMMM YYYY') => {
		if (!value) return 'N/A';
		const m = moment(value);
		return m.isValid() ? m.format(format) : 'N/A';
	};

	const formatDateTime = (value, format = 'DD MMMM YYYY, h:mma') => {
		if (!value) return 'N/A';
		const m = moment(value);
		return m.isValid() ? m.format(format) : 'N/A';
	};

	const formatCurrency = (value) => {
		if (value === null || value === undefined || value === '') {
			return 'N/A';
		}
		const numericValue = Number(value);
		if (Number.isNaN(numericValue)) {
			return String(value);
		}
		try {
			return new Intl.NumberFormat('en-AU', {
				style: 'currency',
				currency: 'AUD',
				maximumFractionDigits: 0
			}).format(numericValue);
		} catch (error) {
			return String(value);
		}
	};

	const formatLandArea = (value) => {
		if (value === null || value === undefined || value === '') {
			return 'N/A';
		}
		const numericValue = Number(value);
		if (Number.isNaN(numericValue)) {
			return String(value);
		}
		return `${numericValue.toLocaleString('en-AU')} m²`;
	};

	const formatBoolean = (value) => {
		if (typeof value === 'boolean') {
			return value ? 'Yes' : 'No';
		}
		if (value === null || value === undefined) {
			return 'N/A';
		}
		if (typeof value === 'string') {
			const trimmed = value.trim().toLowerCase();
			if (trimmed === 'true' || trimmed === 'yes') return 'Yes';
			if (trimmed === 'false' || trimmed === 'no') return 'No';
		}
		return String(value);
	};

	const ownerNames = owners
		.map((owner) => {
			if (owner?.Name) {
				return owner.Name;
			}
			if (owner?.Individual) {
				return [owner.Individual.FirstName, owner.Individual.LastName].filter(Boolean).join(' ');
			}
			return '';
		})
		.filter(Boolean);
	const propertyOwnerName = ownerNames.length ? ownerNames.join(', ') : 'N/A';

	const addressFromIdentity = identityBlock.AddressString;
	const streetParts = [locationAddress.StreetNumber, locationAddress.StreetName, locationAddress.StreetType]
		.filter(Boolean)
		.join(' ');
	const localityParts = [
		locationAddress.City || identityBlock.Locality,
		locationAddress.State,
		locationAddress.PostCode
	]
		.filter(Boolean)
		.join(' ');
	const fallbackAddress = [streetParts, localityParts].filter(Boolean).join(', ');
	const propertyAddress = addressFromIdentity || fallbackAddress || 'N/A';

	const zoningFromSales = salesHistoryList.find((sale) => sale?.zoneDescriptionLocal)?.zoneDescriptionLocal;
	const propertyZoning =
		zoningFromSales || propertyData.zoneDescriptionLocal || propertyData.zoneCodeLocal || 'N/A';

	const reportDate = formatDate(orderResultBlock.OrderCompletedDateTime);
	const searchDateTime = formatDateTime(primaryDataSource.SearchDateTime);
	const editionDate = formatDate(primaryDataSource.EditionIssuedDateTime);

	const estimatedRange = propertyData.estimatedRange;
	const propertyEstimatedRange =
		estimatedRange && estimatedRange.low != null && estimatedRange.high != null
			? `${formatCurrency(estimatedRange.low)} – ${formatCurrency(estimatedRange.high)}`
			: 'N/A';

	const plans = Array.isArray(registryBlock.Plans) ? registryBlock.Plans : [];
	const scheduleRows = plans.length
		? plans
			.map((plan) => {
				const planReference =
					plan.Reference && plan.Type === 'DEPOSITED_PLAN'
						? `DP${plan.Reference}`
						: [plan.Type, plan.Reference].filter(Boolean).join(' ');
				const lotReference = plan.LotReference ? `Lot ${plan.LotReference}` : '';
				const parcelDescription = plan.ParcelDescription || identityBlock.ParcelDescription?.[0] || '';
				const lotText = parcelDescription || [lotReference, planReference && `in ${planReference}`]
					.filter(Boolean)
					.join(' ');
				return `<tr><td>${escapeHtml(lotText || 'N/A')}</td><td>${escapeHtml(planReference || 'N/A')}</td></tr>`;
			})
			.join('')
		: '<tr><td colspan="2" style="text-align:center; padding: 12px; color: #94A3B8;">No parcel information available</td></tr>';

	const interests = Array.isArray(registryBlock.Interests) ? registryBlock.Interests : [];
	const encumbrancesList = interests.length
		? interests
			.map((interest) => {
				const description = interest.Description || interest.SubType || interest.Type || 'Encumbrance';
				const dealingReferences = Array.isArray(interest.Dealing)
					? interest.Dealing.map((d) => d.Reference).filter(Boolean)
					: [];
				const dealingText = dealingReferences.length ? ` (${dealingReferences.join(', ')})` : '';
				return `<li>${escapeHtml(description)}${escapeHtml(dealingText)}</li>`;
			})
			.join('')
		: '<li style="color:#94A3B8;">No encumbrances recorded</li>';

	const salesHistoryRows = salesHistoryList.length
		? salesHistoryList
			.slice()
			.sort((a, b) => {
				const dateA = a?.contractDate ? moment(a.contractDate).valueOf() : 0;
				const dateB = b?.contractDate ? moment(b.contractDate).valueOf() : 0;
				return dateB - dateA;
			})
			.map((sale) => {
				const saleDate = formatDate(sale?.contractDate);
				const price = sale?.isPriceWithheld ? 'Price Withheld' : formatCurrency(sale?.price);
				const saleType = sale?.saleMethod || sale?.type || 'N/A';
				return `<tr><td>${escapeHtml(saleDate)}</td><td>${escapeHtml(price)}</td><td>${escapeHtml(saleType)}</td></tr>`;
			})
			.join('')
		: '<tr><td colspan="3" style="text-align:center; padding: 12px; color: #94A3B8;">No sales history available</td></tr>';

	const dealings = Array.isArray(ownership.Dealings) ? ownership.Dealings : [];
	const transferReference = dealings
		.map((dealing) => dealing.Reference)
		.filter(Boolean)
		.join(', ');

	const hasCotalityData = data?.cotality != null && typeof data.cotality === 'object';
	const propertyBedsValue = propertyData.beds ?? 'N/A';
	const propertyBathsValue = propertyData.baths ?? 'N/A';
	const propertyLockupGaragesValue = propertyData.lockUpGarages ?? 'N/A';
	const propertyCarSpacesValue =
		propertyData.carSpaces != null
			? propertyData.carSpaces
			: propertyData.lockUpGarages != null
				? propertyData.lockUpGarages
				: 'N/A';
	const propertyLandAreaValue = formatLandArea(propertyData.landArea);
	const propertyLandAreaSourceValue = propertyData.landAreaSource || 'N/A';
	const propertyTypeValue = propertyData.propertyType || 'N/A';
	const propertySubTypeValue = propertyData.propertySubType || 'N/A';
	const propertyIsActiveValue = formatBoolean(propertyData.isActiveProperty);
	const propertyLocalGovernmentValue = locationAddress.City || identityBlock.Locality || 'N/A';
	const propertyYearBuiltValue =
		propertyData.yearBuilt != null && propertyData.yearBuilt !== '' ? propertyData.yearBuilt : 'N/A';
	const propertyAvmEstimateValue =
		propertyData.avmEstimate != null ? formatCurrency(propertyData.avmEstimate) : 'N/A';
	const propertyConfidenceLevelValue = propertyData.confidenceLevel || 'N/A';
	const propertyValuationDateValue = propertyData.valuationDate ? formatDate(propertyData.valuationDate) : 'N/A';
	const propertyEstimatedRangeValue = propertyEstimatedRange;
	const propertySalesHistoryRows = salesHistoryRows;

	const includeValuation = hasCotalityData;

	const totalPages = 4 + (includeValuation ? 1 : 0);

	const pageNumber2 = `Page 2 of ${totalPages}`;
	const pageNumber3 = `Page 3 of ${totalPages}`;
	const pageNumber4 = includeValuation ? `Page 4 of ${totalPages}` : '';
	const pageNumber5 = includeValuation ? `Page 5 of ${totalPages}` : `Page 4 of ${totalPages}`;

	const logoHtml = `<div class="logo"><img src="data:image/webp;base64,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" alt="Credion"></div>`;

	const ownerTenancyValue = ownership.Tenancy || 'N/A';
	const ownerTypeValue = ownership.Owners?.[0]?.Type || 'N/A';
	const ownerNamesHtml = ownerNames.length
		? ownerNames.map((name) => escapeHtml(name)).join('<br>')
		: 'N/A';

	const propertyAttributesCard = hasCotalityData
		? `
    <div class="card">
      <div class="card-header">PROPERTY DETAILS</div>
      <div class="data-grid" style="grid-template-columns: repeat(4, 1fr);">
        <div class="data-item"><div class="data-label">Bedrooms</div><div class="data-value">${escapeHtml(String(propertyBedsValue))}</div></div>
        <div class="data-item"><div class="data-label">Bathrooms</div><div class="data-value">${escapeHtml(String(propertyBathsValue))}</div></div>
        <div class="data-item"><div class="data-label">Car Spaces</div><div class="data-value">${escapeHtml(String(propertyCarSpacesValue))}</div></div>
        <div class="data-item"><div class="data-label">Lock-Up Garages</div><div class="data-value">${escapeHtml(String(propertyLockupGaragesValue))}</div></div>
        <div class="data-item"><div class="data-label">Land Area</div><div class="data-value">${escapeHtml(propertyLandAreaValue)}</div></div>
        <div class="data-item"><div class="data-label">Land Area Source</div><div class="data-value">${escapeHtml(propertyLandAreaSourceValue)}</div></div>
        <div class="data-item"><div class="data-label">Property Type</div><div class="data-value">${escapeHtml(propertyTypeValue)}</div></div>
        <div class="data-item"><div class="data-label">Property Subtype</div><div class="data-value">${escapeHtml(propertySubTypeValue)}</div></div>
        <div class="data-item"><div class="data-label">Zoning</div><div class="data-value">${escapeHtml(propertyZoning)}</div></div>
        <div class="data-item"><div class="data-label">Local Government</div><div class="data-value">${escapeHtml(propertyLocalGovernmentValue)}</div></div>
        <div class="data-item"><div class="data-label">Active Property</div><div class="data-value">${escapeHtml(propertyIsActiveValue)}</div></div>
        <div class="data-item"><div class="data-label">Year Built</div><div class="data-value">${escapeHtml(String(propertyYearBuiltValue))}</div></div>
      </div>
    </div>
`
		: '';

	const propertyOverviewPage = `
  <div class="page">
    <div class="brand-header">
      ${logoHtml}
      <div class="doc-id">Report Date: ${escapeHtml(reportDate)}</div>
    </div>
    <div class="page-title">Property Overview</div>
    <div class="card">
      <div class="card-header">REGISTERED PROPRIETOR</div>
      <div class="data-grid" style="grid-template-columns: repeat(2, 1fr);">
        <div class="data-item"><div class="data-label">Property Address</div><div class="data-value">${escapeHtml(propertyAddress)}</div></div>
        <div class="data-item"><div class="data-label">Owner(s)</div><div class="data-value">${ownerNamesHtml}</div></div>
        <div class="data-item"><div class="data-label">Tenancy</div><div class="data-value">${escapeHtml(ownerTenancyValue)}</div></div>
        <div class="data-item"><div class="data-label">Owner Type</div><div class="data-value">${escapeHtml(ownerTypeValue)}</div></div>
      </div>
    </div>
    ${propertyAttributesCard}
    <div class="page-number">${escapeHtml(pageNumber2)}</div>
  </div>
`;

	const propertyValuationPage = includeValuation
		? `
  <div class="page">
    <div class="brand-header">
      <div class="doc-id">Report Date: ${escapeHtml(reportDate)}</div>
    </div>
    <div class="page-title">Property Valuation</div>
    <div class="card">
      <div class="data-grid" style="grid-template-columns: repeat(3, 1fr);">
        <div class="data-item"><div class="data-label">Automated Valuation Estimate</div><div class="data-value">${escapeHtml(propertyAvmEstimateValue)}</div></div>
        <div class="data-item"><div class="data-label">Estimated Price Range</div><div class="data-value">${escapeHtml(propertyEstimatedRangeValue)}</div></div>
        <div class="data-item"><div class="data-label">Valuation Date</div><div class="data-value">${escapeHtml(propertyValuationDateValue)}</div></div>
      </div>
      <div class="data-item" style="margin-top:10px;"><div class="data-label">Confidence Level</div><div class="data-value"><span class="pill">${escapeHtml(propertyConfidenceLevelValue)}</span></div></div>
      <div class="section-subtitle" style="margin-top:12px;">Important</div>
      <div class="text-sm">
        An automated valuation model estimate is statistically derived and should not be relied upon as a professional valuation or an accurate representation of market value.
      </div>
    </div>

    <div class="section-title">Sales History</div>
    <div class="card">
      <table>
        <thead><tr><th style="width:160px;">Sale Date</th><th style="width:160px;">Sale Price</th><th>Sale Type</th></tr></thead>
        <tbody>
          ${propertySalesHistoryRows}
        </tbody>
      </table>
    </div>
    <div class="page-number">${escapeHtml(pageNumber4)}</div>
  </div>
`
		: '';

	return {
		report_date: reportDate,
		property_report_title: 'Property Title Report',
		property_owner_name: propertyOwnerName,
		property_address: propertyAddress,
		property_beds: propertyBedsValue,
		property_baths: propertyBathsValue,
		property_car_spaces: propertyCarSpacesValue,
		property_lockup_garages: propertyLockupGaragesValue,
		property_land_area: propertyLandAreaValue,
		property_land_area_source: propertyLandAreaSourceValue,
		property_type: propertyTypeValue,
		property_sub_type: propertySubTypeValue,
		property_zoning: propertyZoning,
		property_local_government: propertyLocalGovernmentValue,
		property_is_active: propertyIsActiveValue,
		property_year_built: propertyYearBuiltValue,
		property_folio: registryBlock.Folio || 'N/A',
		property_title_reference: identityBlock.TitleReference || 'N/A',
		property_volume: registryBlock.Volume || 'N/A',
		property_search_date: searchDateTime,
		property_search_obtained: searchDateTime,
		property_edition_date: editionDate,
		property_parish: identityBlock.Parish || 'N/A',
		property_county: identityBlock.County || 'N/A',
		property_transfer_reference: transferReference || 'N/A',
		property_title_type: identityBlock.TitleType || registryBlock.TitleType || 'N/A',
		property_estate_type: identityBlock.EstateType || registryBlock.EstateType || 'N/A',
		property_title_result_status: serviceResultBlock.TitleResultStatus || 'N/A',
		property_schedule_parcels_rows: scheduleRows,
		property_encumbrances_list: encumbrancesList,
		property_sales_history_rows: propertySalesHistoryRows,
		property_avm_estimate: propertyAvmEstimateValue,
		property_estimated_range: propertyEstimatedRangeValue,
		property_valuation_date: propertyValuationDateValue,
		property_confidence_level: propertyConfidenceLevelValue,
		property_order_reference: orderResultBlock.OrderReference || 'N/A',
		property_order_identifier: orderResultBlock.OrderIdentifier || 'N/A',
		property_title_resource_identifier:
			serviceResultBlock.TitleResourceIdentifier || resourceSegment.ResourceURI || 'N/A',
		property_overview_page: propertyOverviewPage,
		property_valuation_page: propertyValuationPage,
		page_number_2: pageNumber2,
		page_number_3: pageNumber3,
		page_number_4: pageNumber4,
		page_number_5: pageNumber5,
		total_pages: totalPages
	};
}

// Extract data for Land Title Organisation Report
function extractLandTitleOrganisationData(data) {
	console.log('🔍 [extractLandTitleOrganisationData] Data:', data);
	const reportType = 'land-title-organisation';
	// Handle different data structures (could be rdata or data)
	const rdata = data.rdata || data;

	// Check if "Title References Only" (summary) is selected
	// Check for summary flag in business.landTitleSelection or data structure
	const businessObj = data.business || rdata.business || {};
	let landTitleSelection = businessObj.landTitleSelection || {};

	// Also check if landTitleSelection is directly in data or rdata
	if (!landTitleSelection || Object.keys(landTitleSelection).length === 0) {
		landTitleSelection = data.landTitleSelection || rdata.landTitleSelection || {};
	}

	// Get titleReferences from landTitleSelection or rdata
	let titleReferences = { current: [], historical: [] };
	if (landTitleSelection.titleReferences) {
		if (Array.isArray(landTitleSelection.titleReferences)) {
			titleReferences.current = landTitleSelection.titleReferences;
		} else if (landTitleSelection.titleReferences.current && Array.isArray(landTitleSelection.titleReferences.current)) {
			titleReferences = landTitleSelection.titleReferences;
		}
	}

	// Also check rdata.titleReferences if titleReferences is empty (for SUMMARY mode)
	if ((!titleReferences.current || titleReferences.current.length === 0) &&
		(!titleReferences.historical || titleReferences.historical.length === 0)) {
		if (rdata.titleReferences) {
			if (Array.isArray(rdata.titleReferences)) {
				titleReferences.current = rdata.titleReferences;
			} else if (rdata.titleReferences.current && Array.isArray(rdata.titleReferences.current)) {
				titleReferences = rdata.titleReferences;
			}
		}
	}

	// Check if summary is true OR detail is 'SUMMARY'
	const isTitleReferencesOnly = landTitleSelection.summary === true ||
		landTitleSelection.detail === 'SUMMARY' ||
		rdata.summary === true ||
		rdata.detail === 'SUMMARY' ||
		data.summary === true ||
		data.detail === 'SUMMARY';

	if (isTitleReferencesOnly) {
		console.log('🔍 [extractLandTitleOrganisationData] Title References Only mode detected - will show only title reference list');
		console.log('🔍 [extractLandTitleOrganisationData] Title References from rdata:', rdata.titleReferences);
		console.log('🔍 [extractLandTitleOrganisationData] Title References resolved:', titleReferences);
	}


	// Get titleOrders array
	const titleOrders = Array.isArray(rdata.titleOrders) ? rdata.titleOrders : [];

	// Extract owner name from first property for title
	let propertyOwnerName = 'N/A';
	if (titleOrders.length > 0) {
		const firstOrder = titleOrders[0];
		const realPropertySegment = Array.isArray(firstOrder.RealPropertySegment)
			? firstOrder.RealPropertySegment[0]
			: null;

		if (realPropertySegment && realPropertySegment.RegistryBlock) {
			const ownership = realPropertySegment.RegistryBlock.Ownership || {};
			const owners = Array.isArray(ownership.Owners) ? ownership.Owners : [];

			if (owners.length > 0) {
				const firstOwner = owners[0];
				if (firstOwner.Name) {
					propertyOwnerName = firstOwner.Name;
				} else if (firstOwner.Individual) {
					const firstName = firstOwner.Individual.FirstName || '';
					const lastName = firstOwner.Individual.LastName || '';
					propertyOwnerName = [firstName, lastName].filter(Boolean).join(' ') || 'N/A';
				}
			}
		}
	}
	// Check if this is a "no data available" report (NEAR_MATCHES)
	if (rdata.noDataAvailable === true || rdata.isNearMatch === true) {

		const reportDate = moment().format('DD MMMM YYYY');
		const reportDateTime = moment().format('DD MMMM YYYY, h:mma');

		return {
			property_owner_name: propertyOwnerName,
			report_date: reportDate,
			report_date_time: reportDateTime,
			current_properties_count: '0 properties currently owned',
			past_properties_count: '0 properties previously owned',
			title_search_information_sections: [],
			complete_property_portfolio_page: '',
			no_data_available: true,
			company_name: companyName
		};
	}

	// Report date
	const reportDate = moment().format('DD MMMM YYYY');
	const reportDateTime = moment().format('DD MMMM YYYY, h:mma');

	// Get counts
	const currentCount = rdata.currentCount || titleOrders.length || 0;
	const historicalCount = rdata.historicalCount || 0;

	// Extract primary property address from first titleOrder
	let primaryPropertyAddress = 'N/A';
	if (titleOrders.length > 0) {
		const firstOrder = titleOrders[0];
		const locationSegment = Array.isArray(firstOrder.LocationSegment)
			? firstOrder.LocationSegment[0]
			: null;

		if (locationSegment && locationSegment.Address) {
			const address = locationSegment.Address;
			const addressParts = [];

			// Add unit if present
			if (address.Unit) {
				addressParts.push(`UNIT ${address.Unit}`);
			}

			// Add street number and name
			if (address.StreetNumber && address.StreetName) {
				addressParts.push(`${address.StreetNumber} ${address.StreetName}`);
			} else if (address.StreetName) {
				addressParts.push(address.StreetName);
			}

			// Add street type
			if (address.StreetType) {
				addressParts[addressParts.length - 1] += ` ${address.StreetType}`;
			}

			// Add city/suburb, state, and postcode
			const localityParts = [];
			if (address.City) {
				localityParts.push(address.City);
			}
			if (address.State) {
				localityParts.push(address.State);
			}
			if (address.PostCode) {
				localityParts.push(address.PostCode);
			}

			if (localityParts.length > 0) {
				addressParts.push(localityParts.join(' '));
			}

			if (addressParts.length > 0) {
				primaryPropertyAddress = addressParts.join(', ');
			}
		}
	}

	// Generate Title Search Information pages for each titleOrder
	// Skip this section if isTitleReferencesOnly is true
	let titleSearchInformationSections = '';
	const logoHtml = `<div class="logo"><img src="data:image/webp;base64,UklGRhwNAABXRUJQVlA4WAoAAAAgAAAASgEAewAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggLgsAADA6AJ0BKksBfAA+USiQRiOioaEmMokgcAoJZ27hdgD9v4+ufkdxAPffn3zu9eX7LcAP0b/u32McID+G/3n9UOwt6AH+A/xnWLegB5ZP7h/CD+2n7XezBqq/kn+tdmv91+rntzfU3sBk+nvn9j8v/8Z/LfFP1QeoF6l/wn5TfmBx82ieYF7AfTv8xxl+IB+rP/G41qgH/PP7p/2v7b7rv8n/2f8d+aHtB/N/8b/4/8d8Bn8x/rn/M/vHaK/b72Wf13//5B0C4TijRaQWRayoJBacJxRotILItY6Ba3Et5WSMdAFhU1OSlQLqzNtwMZe7qxPjI0wejVqirrcpWk0Tws5o4WEUoLmn3gnl+MYVa7FoZH+2xS2a79Lg0jv+5EjM0yNxJF4wp/f/86PEixJ6e3xek1i7p7csjSchWNVvysKAIE7TpOSTZ2svir8WE8mtmfQhy23oaqG49knz3SupB5H5tK3YCMg5W8zZqxP/Vu4xbwQTqsAHhN9fVv6aM3UHfTk6Q28miMp0ZV4zmd1+57pol6a2vNXFIybPFttE6j8ylJqSo6+yVG6R65s0oI2K0DyUV5UK4RtjmeoikAJFn9PralZ5JBZFrKgkFpwnFGi0gsi1lQSC04TZAAD+/9uZAAABDT3B52ZvoCMruepaKrRROENx5WKFJFIjc5alRPtNcv+r/bYVl1/ATfbYE//Hu67TthoWJJ5tOsWiQ6AaFqN/OUM8E5VHiVAcu4dAqJaaHaRG2e9uB9RJGI97TmfZhcv5cRTeXek8zT7wl7b9RKrNtTkiAWN9mr56x9FKpOhH/kPwovovmP85hsIK1n1/HY09sSaFlZ66m3NtrIMl11kw/kLV2+1eL4AIJ0EF+8UMXFgNNknOWXBEEVtkxGcENf82TJeoInxp+s3yM7q/V5ID6UEI7SrOSrOIraP3W1rfEYLXffGb9A1QCvx8ia4o1tnz/4uZkFTWC92qm1RH8gUt5gDTSAA9FF6RBNXKofpGukof7a3e8D4i2KE/VT2tXD3775dFCsi95h/8K9KP7/0aCm5QyuHmqu7R1N81W36EPfF5OGUPP7TX80fzRflu9NCotw8zLs0gm/FcEQA1H8KfCpjvf0brT5T+0iAM7tDhEe6js1Aj9Pf1KfdTzk7qhHCj1L4Y22zV5N3E1hbKQazZ7vfVms5bMFQEJzdu//xZ35P40SUJEuJFDpBzzRjgNOoXNaHTqN1u0RtgSMu7lUX/fYMQ9pM2bAj4gWX/MnWNbte5LMTziRv8xd35djfxSuEkfIGATmbe1H5vJHkY5f6EzeTCD4H56mZjo9SIfUK2fh9rbfaJo2pOax/8qgwdFZ5viBY2q2wAvd+wVeqMlM6R/imiS58gU3dJaPGC8RwP7Zz85bn8aPcIpOf47RTYxtUKbbYliEIJ8ZyoBS6c5mmCnQUeR9CdwJRYRufr/m/UQGW+ovXZa7+LALuRhll8IAucpdT7Sj+o4wBA+4t9YQUCu85+S57MBeFjlVIK/vm6jKp2DeH/yMgkG/yLYbva2DEeme+9xll/Wyx/nFAycWB36rot/+H9KvUJxdmXlC4cK7RKkwybGFyX5kTPzkd3LK9KCxP50jHyqtCDW6rf7nyzJzfiDGvEhBkYM+cNAMmKuW5065Jxf7ANRk9ciHyI+TquBZd4P/Z2IVhTHMBrCz/6pGthtRxIyaOwv4+1GkkstkiKY288lEiSA7ADFnO+sRp3fgtXDgCyVREXmeI2rhOCwHiLXsPiyIHNykMS8VaxPcXpcmai7lxJdPHvKrPIgnT7FjS8dH1ARRM9/NILiv7ndaMlNVMeacn3OY1Qvevqlv0h7wIzpe69MBaH4FawVk/VJCdF9ZAJtZ/nTNjR94PLlcGAAiRgTIrS2bWxP7VY7AIXudd9tVScEior1gjnPd9Z4arMs08Ih74RhvZiKONlnVPOP1mVsR8AFCYdwdB3QbJrpeha8t5k6ZP0sCfoeXX/JpoU+hfTZVG9Z+jp47XafxCp1amokS8j+FHv+l1V63fIF3qYIF7/qB4wFivo09ciUzvQVu4fBK4r14YUgcI1+9oCwdaeLAEXVFqkHzP69jE/e+jIrpvcZHbfd3Do9x+/dJMd1ggnhqcOpSAmx8SSKL8R69+lwnPViC/vcUvbD5DGW+EuT8vneX14xgayuNV5QtKLUfSCdLQVID3jpdYlv34vzPeVz0lJsVN3d9xIFL1BhjuoVB9/azvJWeXBM170Fapd42fwiV0KqPIHsLpWtxy4aZER8vskJ8QPINHrKQHIdNy+9kHO0P7lr6yhHUf/8dqS97tCFU/skdvTiV0hAe7VdrIF8YlIZ5kmXI0vofthFcFF89omxdaCr6MQEz1qiVVqfaPH1zWpv+C7EnRLAJpW6SZ8YHu15fEUB1sn4c8/4gBEKMlmILL7q7rzRGPMfh+4LWaobjY6xlP94v4HxY7x2HF+PQQux0hXg5spxOVEgW94mfzp6kHSMHkKAfbIPO21TlfUAcBBTuEwETt3//juGcZId2iL++JQ7gVKik39rWZ+c0mYyHwHpmbKf1224zyO1Kx03eIiIRMVvsA9nsl36+P7FvRl29OuGqbJQSWhIlUoFH7k+gTbZAMYXXriU3+MXRH8Sp4lBQL0ShvsxF+dffPyZCxyStMgwooIX1vx5kKV4pcYsh71Tme4Q8OC9D6LU3puu6qhCagxdF0wHZWPtsACUgl7B6XX9xozO5cdzAlc1Qaod7M7Mdxx9Rd8xnN/fkpNzeinvKpVpdYLIaIlP2q+LJbNDhU+90sZ5nw9wY/8CnwSWWU4a+//iimn05K6zGJSXCnYPno+Pvp/csn9i1Wgq5/CA9ZCSXmOfb+EMrKCGn/B0M8f4dEJjgOefo9v2nX/jA9fpbZx12Fv+oQLNqvm63lnvpfagTZJKCzTe0Xx0yEh/z9NXFse90LIwEFDWhqXqk/2zo4uyaEDPp1jWkvUCqXvnl8XzRltrgzO9yA5r0PKxHAnMSuuguxsS/qpPCzW5/UQDM0h4f6gRg1j5kOZLOzOmu3dWfMTj1HEZ3sgx63CIig6hcXvsbPsb2dqtiPU5L+84fmVJC0mRi+LMT4xft/n7gA3602NMwqLfKw0f3Vedbotod9vb9MQpKz43NwlgJrgtvM10mEifukBoUrycbhic52cZOIUPdYDVTLiTzC+OFf7q5NBJLGPTS17FIEOTu2HQ+78OKfd4yiePB+PWriQccjyOUJqYC4O3c/hyvF85rDPVoBEgLLCHKQpW+XMAIp1zzB1dSKXeNR3aEbjLZ0T5GWZw+bKWaWX6yQojRVEqMoMmv7SZNBaj0mFc7+D2ky0mCobBHWyIkNPKtRG4oGSzgUpq6fd7miS+D023+wzxtlVCOj3ANoqFQpMkdB0dPaH90lFLmVXTA1UcXdFqbAeVhfO/fcuTJ+ujrwJG7VyaTOywocRemY+F03p68O6bxUKTai/4GK2p6/Zba368UHbiBU9AX164ZOFYlMdYBKGHtKnXrJ0YCHCdJh74diK2NxKVAsSAgUjlHE+cYrEvN4Mpe/nFJO6jd5JFmzpTJHLKVKTkmhp0axMUSroSmnJ72JI2uSQd9GMR38EeBGrbR5vH9A7L5K9/wAo1DitQLMYgdHyTQRMw1Bc9vkTtIzfRk3aAzGAwQwvXR/wdcZV0jkbB8NyjG+MiL0NQ4fyX9LXpLEYcWwchq/UWKrlCRxDDy2/AAwat/G0nrRVWZ7Bwm/ji7iF99dJsxEFaI7aIGdhXqx9QAbWEKH/bwH7GlCRPQsE5GHwWPinFkqEjvYAAAAAAAAAAA==" alt="Credion"></div>`;

	// Search date format: DD-MMM-YYYY HH:MM AM/PM
	const searchDateFormatted = moment().format('DD-MMM-YYYY hh:mm A');

	// Only generate title search information sections if NOT in title references only mode
	if (!isTitleReferencesOnly) {
		titleOrders.forEach((titleOrder, index) => {
			// Extract data from this titleOrder
			const realPropertySegment = Array.isArray(titleOrder.RealPropertySegment)
				? titleOrder.RealPropertySegment[0]
				: null;

			const registryBlock = realPropertySegment?.RegistryBlock || {};
			const identityBlock = realPropertySegment?.IdentityBlock || {};
			const locationSegment = Array.isArray(titleOrder.LocationSegment)
				? titleOrder.LocationSegment[0]
				: null;
			const orderResultBlock = titleOrder.OrderResultBlock || {};
			const dataSources = Array.isArray(orderResultBlock.DataSources) ? orderResultBlock.DataSources : [];
			const primaryDataSource = dataSources[0] || {};

			// Extract values
			const folio = registryBlock.Folio || 'N/A';
			const titleReference = identityBlock.TitleReference || 'N/A';
			const editionIssuedDateTime = primaryDataSource.EditionIssuedDateTime;
			const editionDate = editionIssuedDateTime
				? moment(editionIssuedDateTime).format('DD-MM-YYYY')
				: 'N/A';
			const parish = locationSegment?.Address?.City || 'N/A';
			const country = 'AUSTRALIA'; // Static as requested
			const transferNumber = 'N/A'; // Static for now as requested

			// Calculate page number (Page 3 + index, but will be adjusted based on total pages)
			// Base pages: 1 (Cover), 2 (Executive Summary), then title search pages start at 3
			const pageNumber = 3 + index;

			// Generate HTML for this title search information page
			titleSearchInformationSections += `
  <!-- PAGE ${pageNumber}: TITLE SEARCH INFORMATION #${index + 1} -->
  <div class="page">
    <div class="brand-header">
      ${logoHtml}
      <div class="doc-id">Report Date: ${reportDate}</div>
    </div>
    <div class="page-title">Title Search Information</div>
    <div class="card">
      <div class="card-header">Property Title Details</div>
      <div class="data-grid" style="grid-template-columns: repeat(3, 1fr);">
        <div class="data-item"><div class="data-label">Folio</div><div class="data-value">${folio}</div></div>
        <div class="data-item"><div class="data-label">Title Reference</div><div class="data-value">${titleReference}</div></div>
        <div class="data-item"><div class="data-label">Search Date</div><div class="data-value">${searchDateFormatted}</div></div>
        <div class="data-item"><div class="data-label">Edition Date</div><div class="data-value">${editionDate}</div></div>
        <div class="data-item"><div class="data-label">Parish</div><div class="data-value">${parish}</div></div>
        <div class="data-item"><div class="data-label">County</div><div class="data-value">${country}</div></div>
        <div class="data-item"><div class="data-label">Transfer Number</div><div class="data-value">${transferNumber}</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">Schedule of Parcels</div>
      <table>
        <thead><tr><th>Lot Description</th><th>Title Diagram</th></tr></thead>
        <tbody>
          <tr><td>LOT 97 IN DP10293</td><td>DP10293</td></tr>
          <tr><td>LOT 3 IN DP334904</td><td>DP334904</td></tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="card-header">Encumbrances and Notifications</div>
      <ol class="text-sm" style="margin-left:18px; line-height:1.8;">
        <li>Reservations and conditions in the Crown Grant(s)</li>
        <li>A953076 — Covenant</li>
        <li>A945964 — Covenant</li>
        <li>AP800137 — Mortgage to National Australia Bank Limited</li>
      </ol>
    </div>
    <div class="page-number">Page ${pageNumber} of {{total_pages}}</div>
  </div>
`;
		});
	}

	// Generate Current Ownership table rows from titleOrders
	let currentOwnershipRows = '';
	titleOrders.forEach((titleOrder) => {
		const realPropertySegment = Array.isArray(titleOrder.RealPropertySegment)
			? titleOrder.RealPropertySegment[0]
			: null;
		const locationSegment = Array.isArray(titleOrder.LocationSegment)
			? titleOrder.LocationSegment[0]
			: null;

		const titleReference = realPropertySegment?.IdentityBlock?.TitleReference || 'N/A';
		const locality = locationSegment?.Address?.City || 'N/A';
		const ownershipType = 'Owner';

		// Extract transfer number from Ownership.Dealings
		let transferNumber = 'N/A';
		if (realPropertySegment?.RegistryBlock?.Ownership?.Dealings) {
			const dealings = Array.isArray(realPropertySegment.RegistryBlock.Ownership.Dealings)
				? realPropertySegment.RegistryBlock.Ownership.Dealings
				: [];
			if (dealings.length > 0 && dealings[0].Reference) {
				transferNumber = `T ${dealings[0].Reference}`;
			}
		}

		const status = 'Current';

		currentOwnershipRows += `          <tr><td>${titleReference}</td><td>${locality}</td><td>${ownershipType}</td><td>${transferNumber}</td><td>${status}</td></tr>\n`;
	});

	// Generate Past Ownership table rows from historicalTitleOrders (if exists)
	let pastOwnershipRows = '';
	const historicalTitleOrders = Array.isArray(rdata.historicalTitleOrders) ? rdata.historicalTitleOrders : [];

	if (historicalTitleOrders.length > 0) {
		historicalTitleOrders.forEach((titleOrder) => {
			const realPropertySegment = Array.isArray(titleOrder.RealPropertySegment)
				? titleOrder.RealPropertySegment[0]
				: null;
			const locationSegment = Array.isArray(titleOrder.LocationSegment)
				? titleOrder.LocationSegment[0]
				: null;

			const titleReference = realPropertySegment?.IdentityBlock?.TitleReference || 'N/A';
			const locality = locationSegment?.Address?.City || 'N/A';
			const ownershipType = 'Owner (Past)';

			// Extract transfer number from Ownership.Dealings
			let transferNumber = 'N/A';
			if (realPropertySegment?.RegistryBlock?.Ownership?.Dealings) {
				const dealings = Array.isArray(realPropertySegment.RegistryBlock.Ownership.Dealings)
					? realPropertySegment.RegistryBlock.Ownership.Dealings
					: [];
				if (dealings.length > 0 && dealings[0].Reference) {
					transferNumber = `T ${dealings[0].Reference}`;
				}
			}

			const status = 'PAST';

			pastOwnershipRows += `          <tr><td>${titleReference}</td><td>${locality}</td><td>${ownershipType}</td><td>${transferNumber}</td><td>${status}</td></tr>\n`;
		});
	}

	// Generate Complete Property Portfolio page HTML
	// If title references only, portfolio page is page 3 (after cover and executive summary)
	// Otherwise, it's after title search pages (3 + titleOrders.length)
	const portfolioPageNumber = isTitleReferencesOnly ? 3 : (3 + titleOrders.length);
	const completePropertyPortfolioPage = `
  <!-- PAGE ${portfolioPageNumber}: COMPLETE PROPERTY PORTFOLIO -->
  <div class="page">
    <div class="brand-header">
      ${logoHtml}
      <div class="doc-id">Report Date: ${reportDate}</div>
    </div>
    <div class="page-title">Complete Property Portfolio</div>

    <div class="card">
      <div class="card-header">Current Ownership</div>
      <table>
        <thead><tr><th style="width:140px;">Title Reference</th><th style="width:140px;">Locality</th><th style="width:160px;">Type</th><th style="width:140px;">Transfer</th><th>Status</th></tr></thead>
        <tbody>
${currentOwnershipRows || '          <tr><td colspan="5">No current properties found</td></tr>\n'}
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="card-header">Past Ownership (${historicalCount} ${historicalCount === 1 ? 'Property' : 'Properties'})</div>
      <table>
        <thead><tr><th style="width:140px;">Title Reference</th><th style="width:160px;">Locality</th><th style="width:160px;">Type</th><th style="width:160px;">Transfer</th><th>Status</th></tr></thead>
        <tbody>
${pastOwnershipRows || '          <tr><td colspan="5">No past properties found</td></tr>\n'}
        </tbody>
      </table>
    </div>
    <div class="page-number">Page ${portfolioPageNumber} of {{total_pages}}</div>
  </div>
`;

	// Calculate total pages
	// Base pages: 1 (Cover), 2 (Executive Summary), 6 (Document Information)
	// Dynamic pages: titleOrders.length (Title Search Information pages) - skip if title references only
	// Optional: 1 (Property Valuation) if cotality data exists
	const basePages = 3; // Cover, Executive Summary, Document Information
	const titleSearchPages = isTitleReferencesOnly ? 0 : titleOrders.length;
	const hasValuation = rdata.cotality != null; // Check if cotality data exists
	const valuationPage = hasValuation ? 1 : 0;
	const portfolioPage = 1; // Complete Property Portfolio page
	const totalPages = basePages + titleSearchPages + portfolioPage + valuationPage;

	// Basic return structure - will be expanded with more fields
	return {
		property_owner_name: propertyOwnerName,
		report_date: reportDate,
		report_date_time: reportDateTime,
		current_properties_count: currentCount > 0 ? `${currentCount} propert${currentCount === 1 ? 'y' : 'ies'} currently owned` : '0 properties currently owned',
		past_properties_count: historicalCount > 0 ? `${historicalCount} propert${historicalCount === 1 ? 'y' : 'ies'} previously owned` : '0 properties previously owned',
		primary_property_address: primaryPropertyAddress,
		primary_property_value: '$0.00', // Keep as 0.0 for now as requested
		title_search_information_sections: titleSearchInformationSections,
		complete_property_portfolio_page: completePropertyPortfolioPage,
		portfolio_page_number: portfolioPageNumber,
		total_pages: totalPages,
		title_references_only: isTitleReferencesOnly,

		// Legacy/placeholder fields (required for replaceVariables function)
		company_type: reportType || 'land-title-organisation',
		acn: 'N/A',
		abn: 'N/A',
		companyName: propertyOwnerName
	};
}

// Extract data for Sole Trader Check Report
function extractSoleTraderCheckData(data, bussiness) {

  const rdata = data.rdata || data || {};
  console.log('rdata keys:', Object.keys(rdata || {}));
  
  const firstName = rdata.firstName || 
                    rdata.fname || 
                    bussiness?.fname || 
                    bussiness?.firstName || 
                    '';
  
  const lastName = rdata.lastName || 
                   rdata.lname || 
                   bussiness?.lname || 
                   bussiness?.lastName || 
                   '';
  
  const searchName = rdata.searchName || 
                     `${firstName} ${lastName}`.trim() || 
                     'N/A';
  

  const reportDate = rdata.searchDate ? 
                     moment(rdata.searchDate).format('DD MMMM YYYY') : 
                     moment().format('DD MMMM YYYY');
  
  const abnSearchResults = rdata.abnSearchResults || {};

  
  // Extract searchResultsRecord from the ABN search results
  let searchResultsRecords = [];
  

  
  if (abnSearchResults && abnSearchResults.ABRPayloadSearchResults) {
   
    const response = abnSearchResults.ABRPayloadSearchResults.response || {};

    

    if (response.searchResultsList) {
     
      const searchResultsList = response.searchResultsList;
    
      
      
      if (searchResultsList.searchResultsRecord) {
        
        const records = searchResultsList.searchResultsRecord;
        const isArray = Array.isArray(records);
     
      
        searchResultsRecords = Array.isArray(records) ? records : [records];
       
        
      } else if (Array.isArray(searchResultsList)) {
       
        searchResultsRecords = searchResultsList;
       
      }
    } else if (response.searchResultsRecord) {
     
      const records = response.searchResultsRecord;
      const isArray = Array.isArray(records);
    
      searchResultsRecords = Array.isArray(records) ? records : [records];
     
    }
  }
   

  let soleTraderTableRows = '';
  
  if (searchResultsRecords && searchResultsRecords.length > 0) {
    searchResultsRecords.forEach((record, index) => {
     
      const abn = record.ABN || {};
      const abnValue = abn.identifierValue || abn.ABN?.identifierValue || 'N/A';
      const abnStatus = abn.identifierStatus || abn.ABN?.identifierStatus || 'N/A';
      
     
      let businessName = record.businessName || record.legalName || record.mainName || record.mainTradingName || record.otherTradingName || {};
      let orgName = businessName.organisationName || businessName.OrganisationName || businessName.fullName || businessName.FullName || 'N/A';
      let score = businessName.score || businessName.Score || 'N/A';
      let isCurrent = businessName.isCurrentIndicator || businessName.IsCurrentIndicator || 'N/A';
      
     
      const address = record.mainBusinessPhysicalAddress || record.MainBusinessPhysicalAddress || {};
      const stateCode = address.stateCode || address.StateCode || 'N/A';
      const postcode = address.postcode || address.Postcode || 'N/A';
      const addressIsCurrent = address.isCurrentIndicator || address.IsCurrentIndicator || 'N/A';
      

      let formattedAbn = abnValue;
      if (abnValue && abnValue !== 'N/A' && typeof abnValue === 'string') {
        const cleanAbn = abnValue.replace(/\s/g, '');
        if (cleanAbn.length === 11 && /^\d+$/.test(cleanAbn)) {
          formattedAbn = cleanAbn.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4');
        }
      }
      
      soleTraderTableRows += `
        <tr>
          <td><strong>${formattedAbn}</strong></td>
          <td>${abnStatus}</td>
          <td>${orgName}</td>
          <td>${score}</td>
          <td>${isCurrent}</td>
          <td>${stateCode}</td>
          <td>${postcode}</td>
          <td>${addressIsCurrent}</td>
        </tr>
      `;
    });
  } else {
    soleTraderTableRows = `
      <tr>
        <td colspan="8" style="text-align: center; font-style: italic;">No search results found</td>
      </tr>
    `;
  }
  
  return {
    firstName: firstName,
    lastName: lastName,
    searchName: searchName,
    fullName: `${firstName} ${lastName}`.trim() || 'N/A',
    reportDate: reportDate,
    companyName: searchName,
    company_type: 'Sole Trader Check',
    acn: 'N/A',
    abn: 'N/A',
    abnSearchResults: abnSearchResults,
    soleTraderTableRows: soleTraderTableRows,
    totalRecords: searchResultsRecords.length
  };
}

// Extract data for Land Title Individual Report
function extractLandTitleIndividualData(data, bussiness) {
	const reportType = 'land-title-individual';
	const rdata = data.rdata || data;

}

// Function to replace variables in HTML
function replaceVariables(htmlContent, data, reportype, bussiness) {
	// Extract report-specific data based on report type
	let extractedData;

	if (reportype === 'ato') {
		extractedData = extractAtoData(data);
	} else if (reportype === 'court') {
		extractedData = extractCourtData(data);
	} else if (reportype === 'asic-current') {
		extractedData = extractAsicCurrentData(data);
	} else if (reportype === 'asic-historical') {
		extractedData = extractAsicHistoricalData(data);
	} else if (reportype === 'asic-company') {
		extractedData = extractAsicCompanyData(data);
	} else if (reportype === 'ppsr') {
		extractedData = extractPpsrData(data, bussiness, reportype);
	} else if (reportype === 'director-ppsr') {
		extractedData = extractPpsrData(data, bussiness, reportype);
	} else if (reportype === 'director-bankruptcy') {
		extractedData = extractBankruptcyData(data, bussiness);
	} else if (reportype === 'director-related') {
		extractedData = extractDirectorRelatedEntitiesData(data, bussiness);
	} else if (reportype === 'director-court' || reportype === 'director-court-civil' || reportype === 'director-court-criminal') {
		extractedData = extractDirectorCourtData(data, bussiness);
	} else if (reportype === 'property') {
		extractedData = extractpropertyData(data);
	} else if (reportype === 'director-property') {
		extractedData = extractpropertyData(data);
	} else if (reportype === 'land-title-reference') {
		extractedData = extractpropertyData(data);
	} else if (reportype === 'land-title-address') {
		extractedData = extractpropertyData(data);
	} else if (reportype === 'land-title-organisation') {
		extractedData = extractLandTitleOrganisationData(data, bussiness);
	} else if (reportype === 'land-title-individual') {
		extractedData = extractLandTitleIndividualData(data, bussiness);
  } else if (reportype === 'sole-trader-check' ) {
    extractedData = extractSoleTraderCheckData(data, bussiness);
  } else {
    // Default fallback - try to extract common fields
    const entity = data.entity || {};
    extractedData = {
      company_type: reportype || 'N/A',
      acn: data.acn || entity.acn || 'N/A',
      abn: data.abn || entity.abn || 'N/A',
      companyName: entity.name || 'N/A',
      entity_abn: entity.abn || 'N/A',
      entity_acn: entity.acn || 'N/A',
      entity_name: entity.name || 'N/A',
      entity_review_date: entity.review_date ? moment(entity.review_date).format('DD/MM/YYYY') : 'N/A',
      entity_registered_in: entity.registered_in || 'N/A',
      entity_abr_gst_status: entity.abr_gst_status || 'N/A',
      entity_document_number: entity.document_number || 'N/A',
      entity_organisation_type: entity.organisation_type || 'N/A',
      entity_asic_date_of_registration: entity.asic_date_of_registration ? moment(entity.asic_date_of_registration).format('DD/MM/YYYY') : 'N/A',
      abn_state: data.abn_state || 'N/A',
      abn_status: data.abn_status || 'N/A',
      actionSummaryRows: '',
      insolvency_notice_id: 'N/A',
      insolvency_type: 'N/A',
      insolvency_publish_date: 'N/A',
      insolvency_status: 'N/A',
      insolvency_appointee: 'N/A',
      insolvency_parties_rows: '',
      insolvency_court: 'N/A',
      case_case_id: 'N/A',
      case_source: 'N/A',
      case_jurisdiction: 'N/A',
      case_type: 'N/A',
      case_status: 'N/A',
      case_location: 'N/A',
      case_most_recent_event: 'N/A',
      case_notification_date: 'N/A',
      case_next_event: 'N/A',
      orders_rows: '',
      case_parties_rows: '',
      hearings_rows: '',
      documents_rows: '',
      caseNumber: 'N/A',
      current_tax_debt_amount: 'N/A',
      current_tax_debt_ato_updated_at: 'N/A'
    };
  }

	// Ensure extractedData has required fields
	if (!extractedData) {
		throw new Error(`Failed to extract data for report type: ${reportype}`);
	}

	// For land title address reports, show the searched address in the cover header
	if (reportype === 'land-title-address') {
		const headerIdentifier = extractedData.property_address && extractedData.property_address !== 'N/A'
			? extractedData.property_address
			: extractedData.property_title_reference || '';
		if (headerIdentifier) {
			const safeHeaderIdentifier = String(headerIdentifier);
			htmlContent = htmlContent.replace('{{property_title_reference}}', safeHeaderIdentifier);
			htmlContent = htmlContent.replace('${property_title_reference}', safeHeaderIdentifier);
		}
	}

	// Ensure acn and abn fields ALWAYS exist - set defaults if missing
	// Use hasOwnProperty to check if property exists, then check value
	if (!extractedData.hasOwnProperty('acn') || extractedData.acn === undefined || extractedData.acn === null) {
		extractedData.acn = 'N/A';
	}
	if (!extractedData.hasOwnProperty('abn') || extractedData.abn === undefined || extractedData.abn === null) {
		extractedData.abn = 'N/A';
	}

	// Now safely format ACN and ABN - they are guaranteed to be strings at this point
	// For bankruptcy reports, they're 'N/A', so the formatting check will fail and return 'N/A'
	let formattedAcn = 'N/A';
	let formattedAbn = 'N/A';

	// Only format if they're valid numbers (not 'N/A')
	if (extractedData.acn && typeof extractedData.acn === 'string' && extractedData.acn !== 'N/A') {
		const cleanAcn = extractedData.acn.replace(/\s/g, '');
		if (cleanAcn.length === 9 && /^\d+$/.test(cleanAcn)) {
			formattedAcn = cleanAcn.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
		} else {
			formattedAcn = extractedData.acn;
		}
	}

	if (extractedData.abn && typeof extractedData.abn === 'string' && extractedData.abn !== 'N/A') {
		const cleanAbn = extractedData.abn.replace(/\s/g, '');
		if (cleanAbn.length === 11 && /^\d+$/.test(cleanAbn)) {
			formattedAbn = cleanAbn.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4');
		} else {
			formattedAbn = extractedData.abn;
		}
	}

	// Current date for report
	const reportDate = new Date().toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});

	const current_date_and_time = moment().format('DD MMMM YYYY');

	// For land title reports, get company name from extractedData
	const companyNameForLog = reportype === 'land-title-organisation' || reportype === 'land-title-individual'
		? (extractedData.property_owner_name || extractedData.companyName || 'N/A')
		: (extractedData.companyName || 'N/A');

	// Replace all variables in HTML
	// Support both ${variable} and {{variable}} syntax
	let updatedHtml = htmlContent;

	// Helper function to replace variables in both syntaxes
	const replaceVar = (pattern, value) => {
		// Convert value to string, handle undefined/null safely
		const safeValue = value != null ? String(value) : '';
		// Replace ${variable} syntax
		updatedHtml = updatedHtml.replace(new RegExp(`\\$\\{${pattern}\\}`, 'g'), safeValue);
		// Replace {{variable}} syntax
		updatedHtml = updatedHtml.replace(new RegExp(`\\{\\{${pattern}\\}\\}`, 'g'), safeValue);
	};

	// Replace common variables
	replaceVar('acn', formattedAcn);
	replaceVar('abn', formattedAbn);
	replaceVar('companyName', extractedData.companyName || 'N/A');
	replaceVar('company_type', extractedData.company_type || 'N/A');
	replaceVar('reportDate', reportDate);
	replaceVar('current_date_and_time', current_date_and_time);

	// Replace entity variables
	replaceVar('abn_state', extractedData.abn_state || '');
	replaceVar('abn_status', extractedData.abn_status || '');
	replaceVar('entity_abn', extractedData.entity_abn || '');
	replaceVar('entity_acn', extractedData.entity_acn || '');
	replaceVar('entity_name', extractedData.entity_name || '');
	replaceVar('entity_review_date', extractedData.entity_review_date || '');
	replaceVar('entity_registered_in', extractedData.entity_registered_in || '');
	replaceVar('entity_abr_gst_status', extractedData.entity_abr_gst_status || '');
	replaceVar('entity_document_number', extractedData.entity_document_number || '');
	replaceVar('entity_organisation_type', extractedData.entity_organisation_type || '');
	replaceVar('entity_asic_date_of_registration', extractedData.entity_asic_date_of_registration || '');

	// ASIC Current specific variables
	replaceVar('entity_asic_status', extractedData.entity_asic_status || '');
	replaceVar('entity_abn_status', extractedData.entity_abn_status || '');
	replaceVar('entity_gst_status', extractedData.entity_gst_status || '');
	replaceVar('report_date', extractedData.report_date || '');
	replaceVar('cover_company_name', extractedData.cover_company_name || '');
	replaceVar('cover_report_title', extractedData.cover_report_title || '');
	replaceVar('cover_report_date', extractedData.cover_report_date || '');
	replaceVar('cover_acn', extractedData.cover_acn || '');
	replaceVar('cover_abn', extractedData.cover_abn || '');
	replaceVar('cover_document_number', extractedData.cover_document_number || '');
	replaceVar('tax_debt_section', extractedData.tax_debt_section || '');

	// Page 3 - ASIC Extract Summary variables
	replaceVar('extract_report_type', extractedData.extract_report_type || '');
	replaceVar('extract_addresses_count', extractedData.extract_addresses_count || '0');
	replaceVar('extract_directors_count', extractedData.extract_directors_count || '0');
	replaceVar('extract_secretaries_count', extractedData.extract_secretaries_count || '0');
	replaceVar('extract_shareholders_count', extractedData.extract_shareholders_count || '0');
	// Current & Historic counts
	replaceVar('extract_current_addresses_count', extractedData.extract_current_addresses_count || '0');
	replaceVar('extract_historic_addresses_count', extractedData.extract_historic_addresses_count || '0');
	replaceVar('extract_current_directors_count', extractedData.extract_current_directors_count || '0');
	replaceVar('extract_historic_directors_count', extractedData.extract_historic_directors_count || '0');
	replaceVar('extract_current_secretaries_count', extractedData.extract_current_secretaries_count || '0');
	replaceVar('extract_historic_secretaries_count', extractedData.extract_historic_secretaries_count || '0');
	replaceVar('extract_current_shareholders_count', extractedData.extract_current_shareholders_count || '0');
	replaceVar('extract_historic_shareholders_count', extractedData.extract_historic_shareholders_count || '0');
	// Pre-generated summary HTML
	replaceVar('extract_summary_html', extractedData.extract_summary_html || '');
	replaceVar('address_boxes', extractedData.address_boxes || '');
	replaceVar('contact_address_section', extractedData.contact_address_section || '');

	// Page 4 - Address Change History & Key Personnel variables
	replaceVar('address_change_history_rows', extractedData.address_change_history_rows || '');
	replaceVar('directors_summary', extractedData.directors_summary || '');
	replaceVar('secretaries_summary', extractedData.secretaries_summary || '');
	replaceVar('shareholders_summary', extractedData.shareholders_summary || '');

	// Page 5 & 6 - ASIC Documents & Filings variables
	replaceVar('documents_total_count', extractedData.documents_total_count || '0');
	replaceVar('documents_date_range', extractedData.documents_date_range || 'N/A');
	replaceVar('documents_2025_filings', extractedData.documents_2025_filings || '0');
	replaceVar('documents_form_types_count', extractedData.documents_form_types_count || '0');
	replaceVar('documents_table_rows', extractedData.documents_table_rows || '');

	// Page 7 - Board of Directors & Shareholders variables
	replaceVar('directors_secretaries_table_rows', extractedData.directors_secretaries_table_rows || '');
	replaceVar('shareholders_ownership_section', extractedData.shareholders_ownership_section || '');

	// Page 8 - Share Structure variables
	replaceVar('share_structure_section', extractedData.share_structure_section || '');

	// Page Numbers (dynamic)
	replaceVar('page_number_1', extractedData.page_number_1 || 'Page 1 of 7');
	replaceVar('page_number_2', extractedData.page_number_2 || 'Page 2 of 7');
	replaceVar('page_number_3', extractedData.page_number_3 || 'Page 3 of 7');
	replaceVar('page_number_4', extractedData.page_number_4 || 'Page 4 of 7');
	replaceVar('page_number_5', extractedData.page_number_5 || 'Page 5 of 7');
	replaceVar('page_number_7', extractedData.page_number_7 || 'Page 7 of 7');
	replaceVar('page_number_8', extractedData.page_number_8 || '');
	replaceVar('page_number_9', extractedData.page_number_9 || 'Page 9 of 11');
	replaceVar('page_number_10', extractedData.page_number_10 || 'Page 10 of 11');
	replaceVar('page_number_11', extractedData.page_number_11 || 'Page 11 of 11');
	replaceVar('total_pages', extractedData.total_pages || '7');

	// ASIC Historical specific variables (Pages 9-11)
	replaceVar('historical_extract_date', extractedData.historical_extract_date || 'N/A');
	replaceVar('historical_company_names_rows', extractedData.historical_company_names_rows || '');
	replaceVar('historical_addresses_rows', extractedData.historical_addresses_rows || '');
	replaceVar('previous_officeholders_rows', extractedData.previous_officeholders_rows || '');
	replaceVar('historical_shareholders_rows', extractedData.historical_shareholders_rows || '');
	replaceVar('historical_share_structure_rows', extractedData.historical_share_structure_rows || '');

	// ASIC Company specific variables (Pages 1-4)
	replaceVar('entity_location', extractedData.entity_location || 'N/A');
	replaceVar('entity_registration_date', extractedData.entity_registration_date || 'N/A');
	replaceVar('current_shareholdings_count', extractedData.current_shareholdings_count || '0');
	replaceVar('former_shareholdings_count', extractedData.former_shareholdings_count || '0');
	replaceVar('current_licences_count', extractedData.current_licences_count || '0');
	replaceVar('asic_documents_count', extractedData.asic_documents_count || '0');
	replaceVar('current_shareholdings_rows', extractedData.current_shareholdings_rows || '');
	replaceVar('former_shareholdings_rows', extractedData.former_shareholdings_rows || '');
	replaceVar('licences_rows', extractedData.licences_rows || '');
	replaceVar('asic_documents_rows', extractedData.asic_documents_rows || '');
	replaceVar('page_number_3', extractedData.page_number_3 || 'Page 3 of 4');
	replaceVar('page_number_4', extractedData.page_number_4 || 'Page 4 of 4');

	// PPSR specific variables
	replaceVar('cover_entity_name', extractedData.cover_entity_name || 'N/A');
	replaceVar('cover_document_id', extractedData.cover_document_id || 'N/A');
	replaceVar('search_date', extractedData.search_date || 'N/A');
	replaceVar('total_security_interests', extractedData.total_security_interests || '0 active registrations');
	replaceVar('search_status', extractedData.search_status || 'N/A');
	replaceVar('security_breakdown', extractedData.security_breakdown || '');
	replaceVar('secured_parties_rows', extractedData.secured_parties_rows || '');
	replaceVar('critical_security_section', extractedData.critical_security_section || '');
	replaceVar('vehicle_finance_count', extractedData.vehicle_finance_count || '0');
	replaceVar('vehicle_finance_financiers_count', extractedData.vehicle_finance_financiers_count || '0');
	replaceVar('vehicle_expiry_timeline', extractedData.vehicle_expiry_timeline || '');
	replaceVar('registration_pages', extractedData.registration_pages || '');
	replaceVar('secured_party_contacts_rows', extractedData.secured_party_contacts_rows || '');
	replaceVar('search_number', extractedData.search_number || 'N/A');
	replaceVar('search_performed', extractedData.search_performed || 'N/A');

	// Bankruptcy specific variables
	replaceVar('cover_search_id', extractedData.cover_search_id || 'N/A');
	replaceVar('cover_full_name', extractedData.cover_full_name || 'N/A');
	replaceVar('cover_search_date', extractedData.cover_search_date || 'N/A');
	replaceVar('cover_date_of_birth', extractedData.cover_date_of_birth || 'N/A');
	replaceVar('result_status_text', extractedData.result_status_text || 'N/A');
	replaceVar('result_status_badge', extractedData.result_status_badge || 'ok');
	replaceVar('verification_text', extractedData.verification_text || 'N/A');
	replaceVar('search_time', extractedData.search_time || 'N/A');
	replaceVar('what_this_means_items', extractedData.what_this_means_items || '');
	replaceVar('search_details_rows', extractedData.search_details_rows || '');
	replaceVar('document_search_id', extractedData.document_search_id || 'N/A');
	replaceVar('document_search_date', extractedData.document_search_date || 'N/A');

	// Director Related Entities specific variables
	replaceVar('cover_director_name', extractedData.cover_director_name || 'N/A');
	replaceVar('cover_report_date', extractedData.cover_report_date || 'N/A');
	replaceVar('cover_company_name', extractedData.cover_company_name || 'N/A');
	replaceVar('cover_company_acn', extractedData.cover_company_acn || 'N/A');
	replaceVar('director_name', extractedData.director_name || 'N/A');
	replaceVar('director_date_of_birth', extractedData.director_date_of_birth || 'N/A');
	replaceVar('director_address', extractedData.director_address || 'N/A');
	replaceVar('director_report_date', extractedData.director_report_date || 'N/A');
	replaceVar('directorships_count', extractedData.directorships_count || '0');
	replaceVar('shareholdings_count', extractedData.shareholdings_count || '0');
	replaceVar('data_extract_date', extractedData.data_extract_date || 'N/A');
	replaceVar('current_directorships_rows', extractedData.current_directorships_rows || '');
	replaceVar('ceased_directorships_rows', extractedData.ceased_directorships_rows || '');
	replaceVar('current_shareholdings_name_dob_rows', extractedData.current_shareholdings_name_dob_rows || '');
	replaceVar('ceased_shareholdings_name_dob_rows', extractedData.ceased_shareholdings_name_dob_rows || '');
	replaceVar('current_shareholdings_name_only_rows', extractedData.current_shareholdings_name_only_rows || '');
	replaceVar('ceased_shareholdings_name_only_rows', extractedData.ceased_shareholdings_name_only_rows || '');
	replaceVar('document_id', extractedData.document_id || 'N/A');

	// Replace ATO-specific variables
	replaceVar('current_tax_debt_amount', extractedData.current_tax_debt_amount || '');
	replaceVar('current_tax_debt_ato_updated_at', extractedData.current_tax_debt_ato_updated_at || '');

	// Replace court-specific variables
	replaceVar('caseNumber', extractedData.caseNumber || '');
	replaceVar('actionSummaryRows', extractedData.actionSummaryRows || '');
	replaceVar('insolvency_notice_id', extractedData.insolvency_notice_id || '');
	replaceVar('insolvency_type', extractedData.insolvency_type || '');
	replaceVar('insolvency_publish_date', extractedData.insolvency_publish_date || '');
	replaceVar('insolvency_status', extractedData.insolvency_status || '');
	replaceVar('insolvency_appointee', extractedData.insolvency_appointee || '');
	replaceVar('insolvency_parties_rows', extractedData.insolvency_parties_rows || '');
	replaceVar('insolvency_court', extractedData.insolvency_court || '');
	replaceVar('case_case_id', extractedData.case_case_id || '');
	replaceVar('case_source', extractedData.case_source || '');
	replaceVar('case_jurisdiction', extractedData.case_jurisdiction || '');
	replaceVar('case_type', extractedData.case_type || '');
	replaceVar('case_status', extractedData.case_status || '');
	replaceVar('case_location', extractedData.case_location || '');
	replaceVar('case_most_recent_event', extractedData.case_most_recent_event || '');
	replaceVar('case_notification_date', extractedData.case_notification_date || '');
	replaceVar('case_next_event', extractedData.case_next_event || '');
	replaceVar('orders_rows', extractedData.orders_rows || '');
	replaceVar('case_parties_rows', extractedData.case_parties_rows || '');
	replaceVar('hearings_rows', extractedData.hearings_rows || '');
	replaceVar('documents_rows', extractedData.documents_rows || '');

	// Replace director-court specific variables
	replaceVar('director_name', extractedData.director_name || '');
	replaceVar('director_given_name', extractedData.director_given_name || '');
	replaceVar('director_surname', extractedData.director_surname || '');
	replaceVar('total_records', extractedData.total_records || '0');
	replaceVar('total_criminal_records', extractedData.total_criminal_records || '0');
	replaceVar('total_civil_records', extractedData.total_civil_records || '0');
	replaceVar('criminal_court_rows', extractedData.criminal_court_rows || '');
	replaceVar('civil_court_rows', extractedData.civil_court_rows || '');

	// Land Title Organisation/Individual specific variables
	if (reportype === 'land-title-organisation' || reportype === 'land-title-individual') {
		console.log('🔍 Processing land title report - extractedData keys:', Object.keys(extractedData));

		// For land-title-individual, replace person name on cover page
		if (reportype === 'land-title-individual') {
			const personNameRegex = /INDRA BUDIMAN/gi;
			updatedHtml = updatedHtml.replace(personNameRegex, extractedData.person_name || extractedData.property_owner_name || 'N/A');

			// Replace person name variable
			replaceVar('person_name', extractedData.person_name || extractedData.property_owner_name || 'N/A');
		}

		// Handle "Title References Only" mode (summary = on)
		if (extractedData.title_references_only === true) {
			console.log('🔍 Title References Only mode detected - replacing entire template');

			// Replace entire HTML with simple title references page
			if (extractedData.title_references_only_page && extractedData.title_references_only_page.length > 0) {
				// Find the page container and replace all content inside it
				// Match from <div class="page-container"> to </div></body></html>
				const pageContainerRegex = /<div class="page-container">[\s\S]*?<\/div>\s*<\/body>\s*<\/html>/i;
				const replacement = `<div class="page-container">\n${extractedData.title_references_only_page}\n</div>\n</body>\n</html>`;

				const beforeLength = updatedHtml.length;
				updatedHtml = updatedHtml.replace(pageContainerRegex, replacement);
				const afterLength = updatedHtml.length;

				if (beforeLength !== afterLength) {
					console.log('✅ Replaced entire template with Title References Only page (length changed:', beforeLength, '->', afterLength, ')');
				} else {
					console.log('⚠️ Page container regex did not match, trying alternative approach');
					// Alternative: replace everything after <body> tag
					const bodyRegex = /<body[^>]*>[\s\S]*/i;
					updatedHtml = updatedHtml.replace(bodyRegex, `<body>\n<div class="page-container">\n${extractedData.title_references_only_page}\n</div>\n</body>\n</html>`);
				}
			} else {
				console.log('⚠️ title_references_only_page not found in extractedData');
			}

			// Replace variables in the title references page
			replaceVar('property_owner_name', extractedData.property_owner_name || 'N/A');
			replaceVar('report_date', extractedData.report_date || reportDate);
			replaceVar('total_pages', '2');
		} else if (extractedData.no_data_available === true) {
			// Handle "no data available" case (NEAR_MATCHES)
			// Replace hardcoded owner name on cover page with company name
			const ownerNameRegex = /INDRA BUDIMAN/gi;
			updatedHtml = updatedHtml.replace(ownerNameRegex, extractedData.company_name || extractedData.property_owner_name || 'N/A');

			// Replace the content sections with "No data available" message
			// This will show just the company name in the header and a message that no data is available
			const noDataMessage = `
        <div style="padding: 40px; text-align: center;">
          <h2 style="color: #666; margin-bottom: 20px;">No Data Available</h2>
          <p style="color: #999; font-size: 14px;">No matching property records were found for this search.</p>
        </div>
      `;

			// Replace title search information section with no data message
			const titleSearchRegex = /<!-- PAGE 3: TITLE SEARCH INFORMATION -->[\s\S]*?<!-- PAGE 4: COMPLETE PROPERTY PORTFOLIO -->/;
			updatedHtml = updatedHtml.replace(titleSearchRegex, `<!-- PAGE 3: TITLE SEARCH INFORMATION -->${noDataMessage}<!-- PAGE 4: COMPLETE PROPERTY PORTFOLIO -->`);

			// Replace portfolio section with empty content
			const portfolioRegex = /<!-- PAGE 4: COMPLETE PROPERTY PORTFOLIO -->[\s\S]*?<!-- PAGE 5: PROPERTY DETAILS -->/;
			updatedHtml = updatedHtml.replace(portfolioRegex, `<!-- PAGE 4: COMPLETE PROPERTY PORTFOLIO -->${noDataMessage}<!-- PAGE 5: PROPERTY DETAILS -->`);

			// Replace hardcoded report date on cover page
			const reportDateRegex = /Report Date: 20 October 2025/gi;
			updatedHtml = updatedHtml.replace(reportDateRegex, `Report Date: ${extractedData.report_date || reportDate}`);

			// Replace hardcoded counts in executive summary
			const currentCountRegex = /1 property currently owned/gi;
			updatedHtml = updatedHtml.replace(currentCountRegex, extractedData.current_properties_count || '0 properties currently owned');

			const pastCountRegex = /12 properties previously owned/gi;
			updatedHtml = updatedHtml.replace(pastCountRegex, extractedData.past_properties_count || '0 properties previously owned');
		} else {
			// Replace hardcoded owner name on cover page
			const ownerNameRegex = /INDRA BUDIMAN/gi;
			updatedHtml = updatedHtml.replace(ownerNameRegex, extractedData.property_owner_name || 'N/A');

			// Replace hardcoded report date on cover page
			const reportDateRegex = /Report Date: 20 October 2025/gi;
			updatedHtml = updatedHtml.replace(reportDateRegex, `Report Date: ${extractedData.report_date || reportDate}`);

			// Replace hardcoded counts in executive summary
			const currentCountRegex = /1 property currently owned/gi;
			updatedHtml = updatedHtml.replace(currentCountRegex, extractedData.current_properties_count || '0 properties currently owned');

			const pastCountRegex = /12 properties previously owned/gi;
			updatedHtml = updatedHtml.replace(pastCountRegex, extractedData.past_properties_count || '0 properties previously owned');

			// Handle Title References Only mode (summary = on) - show only Complete Property Portfolio
			if (extractedData.title_references_only === true) {
				console.log('🔍 Title References Only mode - removing title search information sections and Current Property Overview');

				// Remove the "Current Property Overview" section from page 2 (keep only Executive Summary card)
				// Match from "Current Property Overview" section title to the end of the card, but keep the page number
				const currentPropertyOverviewRegex = /<div class="section-title">Current Property Overview<\/div>[\s\S]*?<\/div>\s*<\/div>\s*(<div class="page-number">Page 2 of \d+<\/div>)/;
				updatedHtml = updatedHtml.replace(currentPropertyOverviewRegex, '$1');

				// Update page 2 total pages to reflect correct count
				const page2NumberRegex = /<div class="page-number">Page 2 of \d+<\/div>/;
				updatedHtml = updatedHtml.replace(page2NumberRegex, `<div class="page-number">Page 2 of ${extractedData.total_pages || 3}</div>`);

				// Remove the entire Title Search Information page (page 3)
				// Match from the comment to the closing </div> of the page, up to the next comment
				const titleSearchPageRegex = /<!-- PAGE 3: TITLE SEARCH INFORMATION -->[\s\S]*?<\/div>\s*(<!-- PAGE 4: COMPLETE PROPERTY PORTFOLIO -->)/;
				updatedHtml = updatedHtml.replace(titleSearchPageRegex, '<!-- PAGE 3: COMPLETE PROPERTY PORTFOLIO -->\n  $1');

				// Also try to remove the entire page div if the above didn't catch it
				// This matches the full page div structure
				const titleSearchFullPageRegex = /<div class="page">[\s\S]*?<div class="page-title">Title Search Information<\/div>[\s\S]*?<div class="page-number">Page 3 of \d+<\/div>\s*<\/div>\s*(<!-- PAGE 4: COMPLETE PROPERTY PORTFOLIO -->)/;
				if (titleSearchFullPageRegex.test(updatedHtml)) {
					updatedHtml = updatedHtml.replace(titleSearchFullPageRegex, '$1');
				}

				// Update page number in portfolio page from 4 to 3 (handle both template variables and hardcoded values)
				const portfolioPageNumRegex = /<div class="page-number">Page \d+ of \{\{total_pages\}\}/;
				updatedHtml = updatedHtml.replace(portfolioPageNumRegex, `<div class="page-number">Page 3 of ${extractedData.total_pages || 3}`);

				// Also update any hardcoded page numbers in the portfolio section
				const portfolioPageNumRegex2 = /<div class="page-number">Page \d+ of \d+<\/div>\s*<\/div>\s*(<!-- PAGE 5: PROPERTY VALUATION|<!-- PAGE 6: DOCUMENT INFORMATION)/;
				updatedHtml = updatedHtml.replace(portfolioPageNumRegex2, (match, nextComment) => {
					return `<div class="page-number">Page 3 of ${extractedData.total_pages || 3}</div>\n  </div>\n\n  ${nextComment}`;
				});
			} else {
				// Not in summary mode - handle Current Property Overview based on addon flag
				if (reportype === 'land-title-individual') {
					if (extractedData.has_addon === true && extractedData.current_property_overview_section) {
						// Insert Current Property Overview section after Executive Summary card, before page number
						const executiveSummaryRegex = /(<div class="card">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>)\s*(<div class="page-number">Page 2 of)/;
						const replacement = `$1\n${extractedData.current_property_overview_section}\n    $2`;
						updatedHtml = updatedHtml.replace(executiveSummaryRegex, replacement);
					} else {
						// Remove Current Property Overview section if addon is false
						const currentPropertyOverviewRegex = /<div class="section-title">Current Property Overview<\/div>[\s\S]*?<\/div>\s*<\/div>\s*(<div class="page-number">Page 2 of \d+<\/div>)/;
						updatedHtml = updatedHtml.replace(currentPropertyOverviewRegex, '$1');
					}
				}

				// Replace the static Title Search Information section with dynamic sections
				// Match from PAGE 3 comment to PAGE 4 comment (including any comment text in between)
				const titleSearchRegex = /<!-- PAGE 3: TITLE SEARCH INFORMATION -->[\s\S]*?<!-- PAGE 4: COMPLETE PROPERTY PORTFOLIO -->/;
				if (extractedData.title_search_information_sections && extractedData.title_search_information_sections.length > 0) {
					const replacement = extractedData.title_search_information_sections + '\n\n  <!-- PAGE 4: COMPLETE PROPERTY PORTFOLIO -->';
					const beforeLength = updatedHtml.length;
					updatedHtml = updatedHtml.replace(titleSearchRegex, replacement);
					const afterLength = updatedHtml.length;
					if (beforeLength !== afterLength) {
						console.log('✅ Replaced Title Search Information section (length changed:', beforeLength, '->', afterLength, ')');
					} else {
						console.log('⚠️ Title Search Information regex did not match');
					}
				} else {
					console.log('⚠️ No title_search_information_sections found in extractedData or it is empty');
					console.log('   title_search_information_sections type:', typeof extractedData.title_search_information_sections);
					console.log('   title_search_information_sections length:', extractedData.title_search_information_sections?.length || 0);
				}
			}

			// Replace the static Complete Property Portfolio section with dynamic content
			// Match from PAGE 3 or PAGE 4 comment to PAGE 5 comment or PAGE 6 comment (PAGE 3 if title references only)
			// Use a more flexible regex that matches any page number
			const portfolioRegex = /<!-- PAGE \d+: COMPLETE PROPERTY PORTFOLIO -->[\s\S]*?(<!-- PAGE \d+: PROPERTY VALUATION|<!-- PAGE \d+: DOCUMENT INFORMATION)/;
			if (extractedData.complete_property_portfolio_page && extractedData.complete_property_portfolio_page.length > 0) {
				// Replace {{total_pages}} and {{portfolio_page_number}} in portfolio page
				// Also update the PAGE comment to match the correct page number
				let portfolioPageHtml = extractedData.complete_property_portfolio_page
					.replace(/\{\{total_pages\}\}/g, String(extractedData.total_pages || 6))
					.replace(/\{\{portfolio_page_number\}\}/g, String(extractedData.portfolio_page_number || 4));

				// Update the PAGE comment in the portfolio page HTML to match the correct page number
				if (extractedData.title_references_only === true) {
					portfolioPageHtml = portfolioPageHtml.replace(/<!-- PAGE \d+: COMPLETE PROPERTY PORTFOLIO -->/, '<!-- PAGE 3: COMPLETE PROPERTY PORTFOLIO -->');
				}

				const replacement = portfolioPageHtml + '\n\n  ' + (extractedData.has_valuation ? '<!-- PAGE 5: PROPERTY VALUATION' : '<!-- PAGE 6: DOCUMENT INFORMATION');
				const beforeLength = updatedHtml.length;
				const matchResult = updatedHtml.match(portfolioRegex);
				if (matchResult) {
					updatedHtml = updatedHtml.replace(portfolioRegex, replacement);
					const afterLength = updatedHtml.length;
					console.log('✅ Replaced Complete Property Portfolio section (length changed:', beforeLength, '->', afterLength, ')');
				} else {
					// Try alternative regex patterns if the first one didn't match
					const portfolioRegexAlt1 = /<!-- PAGE \d+: COMPLETE PROPERTY PORTFOLIO -->[\s\S]*?<div class="page-number">Page \d+ of \d+<\/div>\s*<\/div>\s*(<!-- PAGE \d+: PROPERTY VALUATION|<!-- PAGE \d+: DOCUMENT INFORMATION)/;
					const portfolioRegexAlt2 = /<!-- PAGE \d+: COMPLETE PROPERTY PORTFOLIO -->[\s\S]*?<\/div>\s*(<!-- PAGE \d+: PROPERTY VALUATION|<!-- PAGE \d+: DOCUMENT INFORMATION)/;

					if (portfolioRegexAlt1.test(updatedHtml)) {
						updatedHtml = updatedHtml.replace(portfolioRegexAlt1, replacement);
						console.log('✅ Replaced Complete Property Portfolio section (using alt1 regex)');
					} else if (portfolioRegexAlt2.test(updatedHtml)) {
						updatedHtml = updatedHtml.replace(portfolioRegexAlt2, replacement);
						console.log('✅ Replaced Complete Property Portfolio section (using alt2 regex)');
					} else {
						console.log('⚠️ Complete Property Portfolio regex did not match - trying to find and replace manually');
						// Last resort: find the comment and replace everything until the next major section
						const manualReplaceRegex = /(<!-- PAGE \d+: COMPLETE PROPERTY PORTFOLIO -->)[\s\S]*?(<!-- PAGE \d+: (PROPERTY VALUATION|DOCUMENT INFORMATION))/;
						if (manualReplaceRegex.test(updatedHtml)) {
							updatedHtml = updatedHtml.replace(manualReplaceRegex, (match, startComment, endComment) => {
								return portfolioPageHtml + '\n\n  ' + endComment;
							});
							console.log('✅ Replaced Complete Property Portfolio section (using manual replace)');
						} else {
							console.log('⚠️ Could not find Complete Property Portfolio section to replace');
						}
					}
				}
			} else {
				console.log('⚠️ No complete_property_portfolio_page found in extractedData or it is empty');
				console.log('   complete_property_portfolio_page type:', typeof extractedData.complete_property_portfolio_page);
				console.log('   complete_property_portfolio_page length:', extractedData.complete_property_portfolio_page?.length || 0);
			}

			// Replace the static Property Valuation section with dynamic content (if exists and addon is true)
			// For land-title-individual, only show if addon is true AND has_valuation is true
			// In summary mode (title_references_only), never show valuation
			const shouldShowValuation = extractedData.title_references_only === true
				? false
				: (reportype === 'land-title-individual'
					? (extractedData.has_addon === true && extractedData.has_valuation === true && extractedData.property_valuation_page && extractedData.property_valuation_page.length > 0)
					: (extractedData.property_valuation_page && extractedData.property_valuation_page.length > 0));

			if (shouldShowValuation) {
				// Replace {{total_pages}} and {{valuation_page_number}} in valuation page
				let valuationPageHtml = extractedData.property_valuation_page
					.replace(/\{\{total_pages\}\}/g, String(extractedData.total_pages || 6))
					.replace(/\{\{valuation_page_number\}\}/g, String(extractedData.valuation_page_number || 5));

				const valuationRegex = /<!-- PAGE 5: PROPERTY VALUATION & SALES HISTORY -->[\s\S]*?<!-- PAGE 6: DOCUMENT INFORMATION[^>]*>/;
				const replacement = valuationPageHtml + '\n\n  <!-- PAGE 6: DOCUMENT INFORMATION & DISCLAIMERS -->';
				const beforeLength = updatedHtml.length;
				updatedHtml = updatedHtml.replace(valuationRegex, replacement);
				const afterLength = updatedHtml.length;
				if (beforeLength !== afterLength) {
					console.log('✅ Replaced Property Valuation section (length changed:', beforeLength, '->', afterLength, ')');
				} else {
					console.log('⚠️ Property Valuation regex did not match');
				}
			} else {
				// Remove the valuation section if it doesn't exist or addon is false
				// Match from PAGE 5 comment (including the comment itself) to PAGE 6 comment
				// Use non-greedy match to stop at the first PAGE 6 comment
				const valuationRegex = /<!-- PAGE 5: PROPERTY VALUATION[\s\S]*?<!-- PAGE 6: DOCUMENT INFORMATION[^>]*>/;
				const beforeLength = updatedHtml.length;
				updatedHtml = updatedHtml.replace(valuationRegex, '<!-- PAGE 6: DOCUMENT INFORMATION & DISCLAIMERS -->');
				const afterLength = updatedHtml.length;
				const removed = beforeLength !== afterLength;

				if (reportype === 'land-title-individual' && extractedData.has_addon !== true) {
					if (removed) {
						console.log('✅ Addon is false - removed valuation section (length changed:', beforeLength, '->', afterLength, ')');
					} else {
						console.log('⚠️ Addon is false - valuation section regex did not match. Template may need manual check.');
						// Try alternative: remove by matching the page div containing Property Valuation
						const altRegex = /<div class="page">[\s\S]*?<div class="page-title">Property Valuation<\/div>[\s\S]*?<div class="page-number">Page \d+ of \d+<\/div>\s*<\/div>\s*(<!-- PAGE 6:)/;
						const altBefore = updatedHtml.length;
						updatedHtml = updatedHtml.replace(altRegex, '$1');
						const altAfter = updatedHtml.length;
						if (altBefore !== altAfter) {
							console.log('✅ Alternative regex matched - removed valuation section');
						}
					}
				} else {
					console.log('⚠️ No property_valuation_page found - removed valuation section', removed ? '(success)' : '(may need manual check)');
				}
			}

			// Replace page numbers in title search sections
			if (extractedData.title_search_information_sections) {
				updatedHtml = updatedHtml.replace(
					/Page \d+ of \{\{total_pages\}\}/g,
					(match) => {
						// Extract the page number and replace total_pages
						const pageMatch = match.match(/Page (\d+) of/);
						if (pageMatch) {
							return `Page ${pageMatch[1]} of ${extractedData.total_pages || 6}`;
						}
						return match.replace(/\{\{total_pages\}\}/g, String(extractedData.total_pages || 6));
					}
				);
			}

			// Replace cover page variables (using replaceVar for any remaining placeholders)
			replaceVar('property_owner_name', extractedData.property_owner_name || 'N/A');
			replaceVar('report_date', extractedData.report_date || reportDate);
			replaceVar('report_date_time', extractedData.report_date_time || reportDate);

			// Replace executive summary variables
			replaceVar('current_properties_count', extractedData.current_properties_count || '0 properties currently owned');
			replaceVar('past_properties_count', extractedData.past_properties_count || '0 properties previously owned');
			replaceVar('primary_property_address', extractedData.primary_property_address || 'N/A');
			replaceVar('primary_property_value', extractedData.primary_property_value || 'N/A');

			// Replace page number variables
			replaceVar('total_pages', String(extractedData.total_pages || 6));
			replaceVar('portfolio_page_number', String(extractedData.portfolio_page_number || 4));
			replaceVar('valuation_page_number', String(extractedData.valuation_page_number || 5));
			replaceVar('disclaimers_page_number', String(extractedData.disclaimers_page_number || 6));

			// Replace hardcoded primary property address in executive summary
			const primaryAddressRegex = /56 Kings Road, Vaucluse NSW 2030/gi;
			updatedHtml = updatedHtml.replace(primaryAddressRegex, extractedData.primary_property_address || 'N/A');

			// Replace hardcoded estimated value in executive summary
			const estimatedValueRegex = /\$11,300,000/gi;
			updatedHtml = updatedHtml.replace(estimatedValueRegex, extractedData.primary_property_value || 'N/A');

			// Replace disclaimers page number
			const disclaimersPageRegex = /Page 6 of 6/gi;
			updatedHtml = updatedHtml.replace(disclaimersPageRegex, `Page ${extractedData.disclaimers_page_number || extractedData.total_pages || 6} of ${extractedData.total_pages || 6}`);
		}
	}

	// Property title reference specific variables
	replaceVar('property_report_title', extractedData.property_report_title || 'Property Title Report');
	replaceVar('property_owner_name', extractedData.property_owner_name || 'N/A');
	replaceVar('property_address', extractedData.property_address || 'N/A');
	replaceVar('property_beds', extractedData.property_beds || 'N/A');
	replaceVar('property_baths', extractedData.property_baths || 'N/A');
	replaceVar('property_car_spaces', extractedData.property_car_spaces || 'N/A');
	replaceVar('property_lockup_garages', extractedData.property_lockup_garages || 'N/A');
	replaceVar('property_land_area', extractedData.property_land_area || 'N/A');
	replaceVar('property_land_area_source', extractedData.property_land_area_source || 'N/A');
	replaceVar('property_type', extractedData.property_type || 'N/A');
	replaceVar('property_sub_type', extractedData.property_sub_type || 'N/A');
	replaceVar('property_zoning', extractedData.property_zoning || 'N/A');
	replaceVar('property_local_government', extractedData.property_local_government || 'N/A');
	replaceVar('property_is_active', extractedData.property_is_active || 'N/A');
	replaceVar('property_year_built', extractedData.property_year_built || 'N/A');
	replaceVar('property_folio', extractedData.property_folio || 'N/A');
	replaceVar('property_title_reference', extractedData.property_title_reference || 'N/A');
	replaceVar('property_volume', extractedData.property_volume || 'N/A');
	replaceVar('property_search_date', extractedData.property_search_date || 'N/A');
	replaceVar('property_search_obtained', extractedData.property_search_obtained || 'N/A');
	replaceVar('property_edition_date', extractedData.property_edition_date || 'N/A');
	replaceVar('property_parish', extractedData.property_parish || 'N/A');
	replaceVar('property_county', extractedData.property_county || 'N/A');
	replaceVar('property_transfer_reference', extractedData.property_transfer_reference || 'N/A');
	replaceVar('property_title_type', extractedData.property_title_type || 'N/A');
	replaceVar('property_estate_type', extractedData.property_estate_type || 'N/A');
	replaceVar('property_title_result_status', extractedData.property_title_result_status || 'N/A');
	replaceVar('property_schedule_parcels_rows', extractedData.property_schedule_parcels_rows || '');
	replaceVar('property_encumbrances_list', extractedData.property_encumbrances_list || '');
	replaceVar('property_sales_history_rows', extractedData.property_sales_history_rows || '');
	replaceVar('property_avm_estimate', extractedData.property_avm_estimate || 'N/A');
	replaceVar('property_estimated_range', extractedData.property_estimated_range || 'N/A');
	replaceVar('property_valuation_date', extractedData.property_valuation_date || 'N/A');
	replaceVar('property_confidence_level', extractedData.property_confidence_level || 'N/A');
	replaceVar('property_order_reference', extractedData.property_order_reference || 'N/A');
	replaceVar('property_order_identifier', extractedData.property_order_identifier || 'N/A');
	replaceVar('property_title_resource_identifier', extractedData.property_title_resource_identifier || 'N/A');
	replaceVar('property_overview_page', extractedData.property_overview_page || '');
	replaceVar('property_valuation_page', extractedData.property_valuation_page || '');

	return updatedHtml;
}

// Function to generate PDF from HTML
async function generatePDF(htmlContent, outputPath) {
	let browser = null;

	try {
		console.log('Launching browser for PDF generation...');

		// Launch puppeteer browser
		browser = await puppeteer.launch({
			headless: 'new',
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--disable-gpu'
			]
		});

		const page = await browser.newPage();

		// Set viewport
		await page.setViewport({
			width: 1200,
			height: 800
		});

		// Set content with modified HTML
		await page.setContent(htmlContent, {
			waitUntil: 'networkidle0',
			timeout: 30000
		});

		// Count the number of page elements
		const pageCount = await page.evaluate(() => {
			return document.querySelectorAll('.page').length;
		});

		console.log(`Found ${pageCount} page elements`);

		// Generate PDF with proper settings
		const pdfBuffer = await page.pdf({
			format: 'A4',
			printBackground: true,
			margin: {
				top: '32mm',     // space reserved for header
				right: '10mm',
				bottom: '15mm',  // space reserved for footer
				left: '10mm'
			},
			displayHeaderFooter: true,
			headerTemplate: `
				 <div style="
    font-size: 9px;
    width: 100%;
    box-sizing: border-box;
    padding: 4mm 20mm 3mm 20mm; 
    border-bottom: 1px solid #E2E8F0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  "><img style="height: 60px;"
                        src="data:image/png;base64,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"
                        alt="Credion"></div>
			`,
			footerTemplate: `
				 <div style="
    font-size: 9px;
    width: 100%;
    box-sizing: border-box;
    padding: 3mm 20mm 0 20mm;
    text-align: right;
    color: #64748B;
  ">
    Page <span class="pageNumber"></span> of <span class="totalPages"></span>
  </div>
			`,
			preferCSSPageSize: true
		});

		console.log('PDF generated successfully');

		// Save locally
		await fs.writeFile(outputPath, pdfBuffer);
		console.log('PDF saved locally:', outputPath);

		await browser.close();
		browser = null;

		return {
			pdfBuffer,
			pageCount
		};
	} catch (error) {
		if (browser) {
			await browser.close();
		}
		throw error;
	}
}

// Function to add download report to DB
async function addDownloadReportInDB(rdata, userId, matterId, reportId, reportName, reportype, business) {
	let templateName;

	if (reportype == "asic-current") {
		templateName = 'asic-current-report.html';
	} else if (reportype == "asic-historical") {
		templateName = 'asic-current-historical-report.html';
	} else if (reportype == "asic-company") {
		templateName = 'asic-company-report.html';
	} else if (reportype == "court") {
		templateName = 'court-report.html';
	} else if (reportype == "ato") {
		templateName = 'ato-report.html';
	} else if (reportype == "ppsr") {
		templateName = 'abn-acn-ppsr-report.html';
	} else if (reportype == "director-ppsr") {
		templateName = 'director-ppsr-report.html';
	} else if (reportype == "director-bankruptcy") {
		templateName = 'director-bankruptcy-report.html';
	} else if (reportype == "director-related") {
		templateName = 'director-related-entities-report.html';
	} else if (reportype == "director-court" || reportype == "director-court-civil" || reportype == "director-court-criminal") {
		templateName = 'director-court-report.html';
	} else if (reportype == "property") {
		templateName = 'landtitle-report.html';
	} else if (reportype == "director-property") {
		templateName = 'landtitle-individual-report.html';
	} else if (reportype == "land-title-reference") {
		templateName = 'landtitle-titleref.html';
	} else if (reportype == "land-title-address") {
		templateName = 'landtitle-titleadd.html';
	} else if (reportype == "land-title-organisation") {
		templateName = 'landtitle-report.html';
	} else if (reportype == "land-title-individual") {
		templateName = 'landtitle-individual-report.html';
	} else {
		throw new Error(`Unknown report type: ${reportype}`);
	}

	await ensureMediaDir();

	const htmlTemplatePath = path.join(mediaDir, templateName);
	let htmlContent;

	try {
		htmlContent = await fs.readFile(htmlTemplatePath, 'utf-8');
	} catch (error) {
		throw new Error(`HTML template file '${templateName}' not found in media folder`);
	}

	// Replace variables in HTML - use rdata.data if rdata is an axios response object
	// But preserve the business object if it exists at the root level
	let dataForTemplate = rdata.data || rdata;
	const updatedHtml = replaceVariables(htmlContent, dataForTemplate, reportype, business);

	// Generate filename
	const timestamp = reportName || new Date().getTime();
	const pdfFilename = timestamp + '.pdf';
	const outputPath = path.join(mediaDir, pdfFilename);

	// Generate PDF
	const { pdfBuffer } = await generatePDF(updatedHtml, outputPath);

	// Upload to S3
	console.log('Uploading PDF to S3...');
	const s3UploadResult = await uploadToS3(pdfBuffer, pdfFilename);

	if (!s3UploadResult.success) {
		throw new Error(`S3 upload failed: ${s3UploadResult.error}`);
	}

	await UserReport.create({
		userId: userId || null,
		matterId: matterId || null,
		reportId: reportId || null,
		reportName: `${reportName}.pdf` || null,
		isPaid: true
	});

	return pdfFilename;
}

module.exports = {
	replaceVariables,
	addDownloadReportInDB,
	ensureMediaDir,
	generatePDF,
	mediaDir
};

