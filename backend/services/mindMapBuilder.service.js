/**
 * Mind Map Builder Service (DATABASE VERSION)
 * Extracts entities and relationships directly from PostgreSQL database
 * NO PDF PARSING REQUIRED - Much faster and more reliable!
 * 
 * Location: backend/services/mindMapBuilder.service.js
 */

const { ApiData } = require('../models');
const { sequelize } = require('../config/db');

/**
 * Extract company information from ASIC Current report data
 */
function extractCompanyFromReport(reportData, reportInfo) {
    if (!reportData || !reportData.rdata) {
        return null;
    }

    const data = reportData.rdata;
    
    // Extract company details from various possible structures
    const company = {
        id: `company_${reportData.acn || reportData.abn || reportData.id}`.replace(/\s/g, ''),
        name: data.organisationName || data.companyName || data.name || reportData.searchWord || 'Unknown Company',
        acn: reportData.acn || data.acn || data.ACN,
        abn: reportData.abn || data.abn || data.ABN,
        status: data.status || data.organisationStatus || data.companyStatus || 'Unknown',
        type: data.type || data.organisationType || data.companyType,
        registered: data.registrationDate || data.dateRegistered,
        address: data.registeredOffice || data.principalPlaceOfBusiness || data.address,
        reportType: reportData.rtype,
        reportId: reportData.id,
        searchWord: reportData.searchWord
    };

    return company;
}

/**
 * Extract directors from ASIC report data
 */
function extractDirectorsFromReport(reportData, companyId) {
    if (!reportData || !reportData.rdata) {
        return [];
    }

    // Check if asic_extracts exists and has data
    if (!reportData.rdata.asic_extracts || !Array.isArray(reportData.rdata.asic_extracts) || reportData.rdata.asic_extracts.length === 0) {
        return [];
    }

    const data = reportData.rdata.asic_extracts[0];
    if (!data) {
        return [];
    }

    const directors = [];
    // Check various possible director field names (excluding office_holders - handled separately)
    const directorSources = [
        data.directorships,
        data.directors
    ];

    for (const source of directorSources) {
        if (Array.isArray(source)) {
            source.forEach(director => {
                if (director && director.name) {
                    const directorName = director.name || director.fullName || (director.givenNames && director.familyName ? director.givenNames + ' ' + director.familyName : '');
                    const directorDOB = director.dateOfBirth || director.dob;
                    const directorId = `director_${normalizeName(directorName).replace(/\s+/g, '_')}_${normalizeDOB(directorDOB)}`;
                    if(director.status == 'Current') {
                        directors.push({
                            id: directorId,
                            name: directorName,
                            dob: directorDOB,
                            address: director.address || director.locality,
                            role: director.role || 'Director',
                            type: 'current_director',
                            companyIds: [companyId]
                        });
                    } else {
                        directors.push({
                            id: `director_ceased_${normalizeName(directorName).replace(/\s+/g, '_')}_${normalizeDOB(directorDOB)}`,
                            name: directorName,
                            dob: directorDOB,
                            address: director.address || director.locality,
                            ceasedDate: director.ceasedDate || director.dateResigned,
                            role: director.role || 'Former Director',
                            type: 'ceased_director',
                            companyIds: [companyId]
                        });
                    }
                }
            });
        }
    }

    return directors;
}

/**
 * Extract office holders from ASIC report data (separate from directors)
 */
function extractOfficeHoldersFromReport(reportData, companyId) {
    if (!reportData || !reportData.rdata) {
        return [];
    }

    // Check if asic_extracts exists and has data
    if (!reportData.rdata.asic_extracts || !Array.isArray(reportData.rdata.asic_extracts) || reportData.rdata.asic_extracts.length === 0) {
        return [];
    }

    const data = reportData.rdata.asic_extracts[0];
    if (!data) {
        return [];
    }

    const officeHolders = [];

    // Extract office_holders as a separate entity
    if (Array.isArray(data.office_holders)) {
        data.office_holders.forEach(holder => {
            if (holder && holder.name) {
                const isCurrent = holder.status === 'Current';
                const holderName = holder.name || holder.fullName || (holder.givenNames && holder.familyName ? holder.givenNames + ' ' + holder.familyName : '');
                const holderDOB = holder.dateOfBirth || holder.dob || holder.date_of_birth;
                const holderId = `officeholder_${isCurrent ? '' : 'ceased_'}${normalizeName(holderName).replace(/\s+/g, '_')}_${normalizeDOB(holderDOB)}`;
                
                officeHolders.push({
                    id: holderId,
                    name: holderName,
                    dob: holderDOB,
                    address: holder.address || holder.locality,
                    role: holder.role || 'Office Holder',
                    status: holder.status || 'Unknown',
                    type: isCurrent ? 'current_officeholder' : 'ceased_officeholder',
                    ceasedDate: holder.ceasedDate || holder.dateResigned,
                    companyIds: [companyId]
                });
            }
        });
    }

    return officeHolders;
}

/**
 * Extract shareholders from ASIC report data
 */
function extractShareholdersFromReport(reportData, companyId) {
    if (!reportData || !reportData.rdata) {
        return [];
    }

    // Check if asic_extracts exists and has data
    if (!reportData.rdata.asic_extracts || !Array.isArray(reportData.rdata.asic_extracts) || reportData.rdata.asic_extracts.length === 0) {
        return [];
    }

    const data = reportData.rdata.asic_extracts[0];
    if (!data) {
        return [];
    }

    const shareholders = [];

    // Check various possible shareholder field names
    const shareholderSources = [
        data.shareholders,
        data.shareholdings,
        data.additional_shareholdings
    ];
    
    for (const source of shareholderSources) {
        if (Array.isArray(source)) {
            source.forEach(shareholder => {
                if (shareholder && shareholder.name) {
                    const isCurrent = shareholder.status === 'Current';
                    const shareholderDOB = shareholder.dateOfBirth || shareholder.dob || shareholder.date_of_birth;
                    // Extract ACN if available (for company shareholders)
                    const shareholderACN = shareholder.acn || shareholder.ACN;
                    const shareholderABN = shareholder.abn || shareholder.ABN;
                    const shareholderId = `shareholder_${isCurrent ? '' : 'ceased_'}${normalizeName(shareholder.name).replace(/\s+/g, '_')}_${normalizeDOB(shareholderDOB)}`;
                    
                    shareholders.push({
                        id: shareholderId,
                        name: shareholder.name || shareholder.fullName,
                        shares: shareholder.shares || shareholder.numberOfShares || shareholder.shareCount,
                        shareClass: shareholder.shareClass || shareholder.class,
                        address: shareholder.address || shareholder.locality,
                        acn: shareholderACN, // Store ACN for matching with existing companies
                        abn: shareholderABN, // Store ABN for matching with existing companies
                        status: shareholder.status || 'Unknown',
                        ceasedDate: shareholder.ceasedDate || shareholder.dateResigned,
                        type: isCurrent ? 'current_shareholder' : 'ceased_shareholder',
                        companyIds: [companyId]
                    });
                }
            });
        }
    }

    return shareholders;
}


/**
 * Extract secretaries from ASIC report data
 */
function extractSecretaryFromReport(reportData, companyId) {
    if (!reportData || !reportData.rdata) {
        return [];
    }

    // Check if asic_extracts exists and has data
    if (!reportData.rdata.asic_extracts || !Array.isArray(reportData.rdata.asic_extracts) || reportData.rdata.asic_extracts.length === 0) {
        return [];
    }

    const data = reportData.rdata.asic_extracts[0];
    if (!data) {
        return [];
    }

    const secretaries = [];

    // Check various possible secretary field names
    const secretarySources = [
        data.secretaries,
    ];

    for (const source of secretarySources) {
        if (Array.isArray(source)) {
            source.forEach(secretaryItem => {
                if (secretaryItem && secretaryItem.name) {
                    const isCurrent = secretaryItem.status === 'Current';
                    const secretaryName = secretaryItem.name || secretaryItem.fullName || (secretaryItem.givenNames && secretaryItem.familyName ? secretaryItem.givenNames + ' ' + secretaryItem.familyName : '');
                    const secretaryDOB = secretaryItem.dateOfBirth || secretaryItem.dob || secretaryItem.date_of_birth;
                    const secretaryId = `secretary_${isCurrent ? '' : 'ceased_'}${normalizeName(secretaryName).replace(/\s+/g, '_')}_${normalizeDOB(secretaryDOB)}`;
                    
                    secretaries.push({
                        id: secretaryId,
                        name: secretaryName,
                        dob: secretaryDOB,
                        address: secretaryItem.address || secretaryItem.locality,
                        status: secretaryItem.status || 'Unknown',
                        ceasedDate: secretaryItem.ceasedDate || secretaryItem.dateResigned,
                        type: isCurrent ? 'current_secretary' : 'ceased_secretary',
                        companyIds: [companyId]
                    });
                }
            });
        }
    }

    return secretaries;
}

/**
 * Normalize name for comparison (lowercase, trim, remove extra spaces)
 */
function normalizeName(name) {
    if (!name) return '';
    // Ensure name is a string before calling string methods
    if (typeof name !== 'string') {
        // Try to convert to string
        name = String(name);
        // If conversion results in invalid string, return empty
        if (name === 'null' || name === 'undefined' || name === '[object Object]') {
            return '';
        }
    }
    return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Normalize date of birth for comparison (format: YYYY-MM-DD)
 */
function normalizeDOB(dob) {
    if (!dob) return '';
    // Handle various date formats
    if (typeof dob === 'string') {
        // If it's already in YYYY-MM-DD format, return as is
        if (/^\d{4}-\d{2}-\d{2}/.test(dob)) {
            return dob.split('T')[0]; // Remove time if present
        }
        // Try to parse other formats (DD/MM/YYYY, etc.)
        const date = new Date(dob);
        if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
        }
    }
    return '';
}

/**
 * Normalize address for comparison (remove extra spaces, convert to lowercase, etc.)
 */
function normalizeAddress(address) {
    if (!address) return '';
    if (typeof address !== 'string') {
        // If address is an object, try to build a string from components
        if (typeof address === 'object') {
            const parts = [
                address.address || address.address_1 || '',
                address.address_2 || '',
                address.suburb || '',
                address.state || '',
                address.postcode || ''
            ].filter(Boolean);
            address = parts.join(' ');
        } else {
            address = String(address);
        }
    }
    // Normalize: lowercase, remove extra spaces, remove punctuation
    return address
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .trim();
}

/**
 * Create a unique key for matching addresses
 */
function createAddressKey(address) {
    if (!address) return '';
    
    // Build address string from components or use full address
    let addressString = '';
    if (address.address) {
        addressString = address.address;
    } else {
        const parts = [
            address.address1 || address.address_1 || '',
            address.address2 || address.address_2 || '',
            address.suburb || '',
            address.state || '',
            address.postcode || ''
        ].filter(Boolean);
        addressString = parts.join(' ');
    }
    
    return normalizeAddress(addressString);
}

/**
 * Create a unique key for matching persons by name and DOB
 * If DOB is missing, use name only (for fallback matching)
 */
function createPersonKey(name, dob) {
    const normalizedName = normalizeName(name);
    const normalizedDOB = normalizeDOB(dob);
    // If DOB is missing, use name only for matching
    if (!normalizedDOB) {
        return normalizedName;
    }
    return `${normalizedName}|${normalizedDOB}`;
}

/**
 * Calculate similarity percentage between two persons based on available data
 * Returns a percentage (0-100) indicating confidence that they are the same person
 */
function calculateSimilarityPercentage(person1, person2) {
    // Safety checks
    if (!person1 || !person2) return 0;
    if (typeof person1 !== 'object' || typeof person2 !== 'object') return 0;
    
    let score = 0;
    let maxScore = 0;
    
    // Name matching (most important - 70% weight)
    const name1 = normalizeName(person1.name || '');
    const name2 = normalizeName(person2.name || '');
    maxScore += 70;
    
    if (name1 === name2) {
        score += 70; // Exact name match = 70 points
    } else {
        // Partial name match - check if name parts match
        const name1Parts = name1.split(' ').filter(p => p.length > 0);
        const name2Parts = name2.split(' ').filter(p => p.length > 0);
        
        if (name1Parts.length > 0 && name2Parts.length > 0) {
            // Check if last names match (usually most distinctive)
            const lastName1 = name1Parts[name1Parts.length - 1];
            const lastName2 = name2Parts[name2Parts.length - 1];
            
            if (lastName1 === lastName2 && lastName1.length > 2) {
                score += 40; // Last name match = 40 points
                
                // Check if first names match
                const firstName1 = name1Parts[0];
                const firstName2 = name2Parts[0];
                if (firstName1 === firstName2 && firstName1.length > 1) {
                    score += 20; // First name match = additional 20 points
                } else if (firstName1.substring(0, 1) === firstName2.substring(0, 1)) {
                    score += 5; // First initial match = 5 points
                }
            } else {
                // Use Levenshtein-like similarity for partial matches
                const similarity = calculateStringSimilarity(name1, name2);
                score += similarity * 30; // Up to 30 points for partial similarity
            }
        }
    }
    
    // Address matching (if available - 20% weight)
    if (person1.address && person2.address) {
        maxScore += 20;
        // Ensure addresses are strings before normalizing
        const addr1 = normalizeName(String(person1.address || ''));
        const addr2 = normalizeName(String(person2.address || ''));
        
        if (addr1 === addr2) {
            score += 20; // Exact address match = 20 points
        } else {
            // Check for partial address match (suburb, state, postcode)
            const addr1Parts = addr1.split(',').map(p => p.trim());
            const addr2Parts = addr2.split(',').map(p => p.trim());
            
            // Check if any address parts match
            let matchingParts = 0;
            addr1Parts.forEach(part1 => {
                if (part1.length > 3 && addr2Parts.some(part2 => part1 === part2)) {
                    matchingParts++;
                }
            });
            
            if (matchingParts > 0) {
                score += (matchingParts / Math.max(addr1Parts.length, addr2Parts.length)) * 10; // Up to 10 points
            }
        }
    } else {
        maxScore += 20; // Still count as max score even if not available
    }
    
    // DOB matching (if both have DOB - 10% weight, but this shouldn't happen in uncertain matches)
    if (person1.dob && person2.dob) {
        maxScore += 10;
        const dob1 = normalizeDOB(person1.dob);
        const dob2 = normalizeDOB(person2.dob);
        if (dob1 === dob2) {
            score += 10; // DOB match = 10 points (this would make it certain, not uncertain)
        }
    } else {
        maxScore += 10; // Still count as max score even if not available
    }
    
    // Calculate percentage
    const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    return Math.min(100, Math.max(0, percentage)); // Clamp between 0-100
}

/**
 * Calculate string similarity using a simple algorithm (0-1 scale)
 * Based on common characters and length similarity
 */
function calculateStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    // Ensure both are strings
    if (typeof str1 !== 'string') str1 = String(str1);
    if (typeof str2 !== 'string') str2 = String(str2);
    
    if (str1 === str2) return 1;
    
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1;
    
    // Count matching characters
    let matches = 0;
    const longerChars = longer.toLowerCase().split('');
    const shorterChars = shorter.toLowerCase().split('');
    
    shorterChars.forEach(char => {
        const index = longerChars.indexOf(char);
        if (index !== -1) {
            matches++;
            longerChars[index] = ''; // Remove to avoid double counting
        }
    });
    
    // Calculate similarity
    const similarity = (matches * 2) / (longer.length + shorter.length);
    return similarity;
}

/**
 * Extract director information from director-related report
 */
function extractDirectorFromDirectorRelatedReport(reportData) {
    if (!reportData || !reportData.rdata) {
        return null;
    }

    const rdata = reportData.rdata;
    const entity = rdata.entity || {};

    if (!entity.name) {
        return null;
    }

    return {
        id: `director_${normalizeName(entity.name).replace(/\s+/g, '_')}_${normalizeDOB(entity.date_of_birth)}`,
        name: entity.name,
        dob: entity.date_of_birth,
        address: entity.address,
        type: 'director_from_report',
        reportType: 'director-related',
        reportId: reportData.id,
        searchWord: reportData.searchWord
    };
}

/**
 * Extract bankruptcy data from director-bankruptcy report
 * Returns bankruptcy information or null if no bankruptcy
 */
function extractBankruptcyFromDirectorBankruptcyReport(reportData) {
    if (!reportData || !reportData.rdata) {
        return null;
    }

    const rdata = reportData.rdata;
    const data = rdata.data || rdata;

    // Check if uuid is null (no bankruptcy)
    if (!data.uuid || data.uuid === null) {
        return {
            hasBankruptcy: false,
            uuid: null,
            extractId: null,
            startDate: null,
            debtor: null
        };
    }

    // Extract bankruptcy information
    const debtor = data.debtor || {};
    const extractId = data.extractId || data.uuid;
    const startDate = debtor.startDate || null;

    return {
        hasBankruptcy: true,
        uuid: data.uuid,
        extractId: extractId,
        startDate: startDate,
        debtor: debtor,
        reportId: reportData.id,
        searchWord: reportData.searchWord
    };
}

/**
 * Extract directorships from director-related report
 * Returns array of company objects that the director is a director of
 */
function extractDirectorshipsFromDirectorRelatedReport(reportData, directorId) {
    if (!reportData || !reportData.rdata) {
        return [];
    }

    const rdata = reportData.rdata;
    const directorships = [];
    const asicExtracts = rdata.asic_extracts || [];

    for (const extract of asicExtracts) {
        if (!extract) {
            continue;
        }
        if (Array.isArray(extract.directorships)) {
            extract.directorships.forEach(directorship => {
                if (directorship && directorship.name) {
                    const companyId = `company_${directorship.acn || directorship.abn || directorship.name}`.replace(/\s/g, '');
                    directorships.push({
                        companyId: companyId,
                        companyName: directorship.name,
                        acn: directorship.acn,
                        abn: directorship.abn,
                        status: directorship.status || 'Unknown',
                        startDate: directorship.start_date,
                        endDate: directorship.end_date,
                        directorId: directorId
                    });
                }
            });
        }
    }

    return directorships;
}

/**
 * Extract shareholdings from director-related report
 */
function extractShareholdingsFromDirectorRelatedReport(reportData, directorId) {
    if (!reportData || !reportData.rdata) {
        return [];
    }

    const rdata = reportData.rdata;
    const shareholdings = [];
    const asicExtracts = rdata.asic_extracts || [];

    for (const extract of asicExtracts) {
        if (!extract) {
            continue;
        }
        if (Array.isArray(extract.shareholdings)) {
            extract.shareholdings.forEach(shareholding => {
                if (shareholding && shareholding.name) {
                    const companyId = `company_${shareholding.acn || shareholding.abn || shareholding.name}`.replace(/\s/g, '');
                    shareholdings.push({
                        companyId: companyId,
                        companyName: shareholding.name,
                        acn: shareholding.acn,
                        abn: shareholding.abn,
                        shares: shareholding.shares,
                        shareClass: shareholding.shareClass,
                        directorId: directorId
                    });
                }
            });
        }
    }

    return shareholdings;
}

/**
 * Extract addresses from ASIC report data and link to entities
 * Returns array of address objects with entity linking information
 */
function extractAddressesFromAsicReport(reportData, companyId, allEntities) {
    if (!reportData || !reportData.rdata) {
        return [];
    }

    const addresses = [];
    const rdata = reportData.rdata;

    // Extract addresses from asic_extracts
    if (rdata.asic_extracts && Array.isArray(rdata.asic_extracts) && rdata.asic_extracts.length > 0) {
        const extract = rdata.asic_extracts[0];
        
        // Extract company addresses (entity: "Company")
        if (Array.isArray(extract.addresses)) {
            extract.addresses.forEach(addr => {
                if (addr && addr.address) {
                    const addressId = `address_${normalizeName(addr.address).replace(/\s+/g, '_').substring(0, 50)}_${companyId}`;
                    addresses.push({
                        id: addressId,
                        address: addr.address,
                        address1: addr.address_1,
                        address2: addr.address_2,
                        suburb: addr.suburb,
                        state: addr.state,
                        postcode: addr.postcode,
                        country: addr.country,
                        type: addr.type || 'Address',
                        status: addr.status || 'Current',
                        startDate: addr.start_date,
                        endDate: addr.end_date,
                        entityType: 'Company',
                        entityId: companyId,
                        entityName: allEntities.companies.get(companyId)?.name || 'Unknown Company'
                    });
                }
            });
        }

        // Extract contact addresses (entity: "Contact" - usually for company)
        if (Array.isArray(extract.contact_addresses)) {
            extract.contact_addresses.forEach(addr => {
                if (addr && addr.address) {
                    const addressId = `address_${normalizeName(addr.address).replace(/\s+/g, '_').substring(0, 50)}_${companyId}_contact`;
                    addresses.push({
                        id: addressId,
                        address: addr.address,
                        address1: addr.address_1,
                        address2: addr.address_2,
                        suburb: addr.suburb,
                        state: addr.state,
                        postcode: addr.postcode,
                        country: addr.country,
                        type: addr.type || 'Contact Address',
                        status: addr.status || 'Current',
                        startDate: addr.start_date,
                        endDate: addr.end_date,
                        entityType: 'Company',
                        entityId: companyId,
                        entityName: allEntities.companies.get(companyId)?.name || 'Unknown Company'
                    });
                }
            });
        }

        // Extract director addresses (entity: "Direct" - person)
        if (Array.isArray(extract.directors)) {
            extract.directors.forEach(director => {
                if (director && director.address && director.address.address) {
                    const directorName = director.name || '';
                    const directorDOB = director.dob || director.dateOfBirth;
                    const directorKey = createPersonKey(directorName, directorDOB);
                    const directorId = `director_${normalizeName(directorName).replace(/\s+/g, '_')}_${normalizeDOB(directorDOB)}`;
                    
                    // Try to find existing person entity
                    let personId = directorId;
                    let personName = directorName;
                    
                    // Check if person exists in allEntities
                    if (allEntities.directors && allEntities.directors.has(directorId)) {
                        personId = directorId;
                    } else {
                        // Try to find in persons map if available
                        // This will be handled during processing
                    }
                    
                    const addr = director.address;
                    const addressId = `address_${normalizeName(addr.address || '').replace(/\s+/g, '_').substring(0, 50)}_${directorId}`;
                    addresses.push({
                        id: addressId,
                        address: addr.address,
                        address1: addr.address_1,
                        address2: addr.address_2,
                        suburb: addr.suburb,
                        state: addr.state,
                        postcode: addr.postcode,
                        country: addr.country,
                        type: addr.type || 'Director Address',
                        status: addr.status || 'Current',
                        startDate: addr.start_date,
                        endDate: addr.end_date,
                        entityType: 'Person',
                        entityId: personId,
                        entityName: personName,
                        personKey: directorKey // Store key for later matching
                    });
                }
            });
        }

        // Extract secretary addresses (entity: "Direct" - person)
        if (Array.isArray(extract.secretaries)) {
            extract.secretaries.forEach(secretary => {
                if (secretary && secretary.address && secretary.address.address) {
                    const secretaryName = secretary.name || '';
                    const secretaryDOB = secretary.dob || secretary.dateOfBirth;
                    const secretaryKey = createPersonKey(secretaryName, secretaryDOB);
                    const secretaryId = `secretary_${normalizeName(secretaryName).replace(/\s+/g, '_')}_${normalizeDOB(secretaryDOB)}`;
                    
                    const addr = secretary.address;
                    const addressId = `address_${normalizeName(addr.address || '').replace(/\s+/g, '_').substring(0, 50)}_${secretaryId}`;
                    addresses.push({
                        id: addressId,
                        address: addr.address,
                        address1: addr.address_1,
                        address2: addr.address_2,
                        suburb: addr.suburb,
                        state: addr.state,
                        postcode: addr.postcode,
                        country: addr.country,
                        type: addr.type || 'Secretary Address',
                        status: addr.status || 'Current',
                        startDate: addr.start_date,
                        endDate: addr.end_date,
                        entityType: 'Person',
                        entityId: secretaryId,
                        entityName: secretaryName,
                        personKey: secretaryKey // Store key for later matching
                    });
                }
            });
        }

        // Extract office holder addresses (entity: "Direct" - person)
        if (Array.isArray(extract.office_holders)) {
            extract.office_holders.forEach(holder => {
                if (holder && holder.address && holder.address.address) {
                    const holderName = holder.name || '';
                    const holderDOB = holder.dob || holder.dateOfBirth;
                    const holderKey = createPersonKey(holderName, holderDOB);
                    const holderId = `officeholder_${normalizeName(holderName).replace(/\s+/g, '_')}_${normalizeDOB(holderDOB)}`;
                    
                    const addr = holder.address;
                    const addressId = `address_${normalizeName(addr.address || '').replace(/\s+/g, '_').substring(0, 50)}_${holderId}`;
                    addresses.push({
                        id: addressId,
                        address: addr.address,
                        address1: addr.address_1,
                        address2: addr.address_2,
                        suburb: addr.suburb,
                        state: addr.state,
                        postcode: addr.postcode,
                        country: addr.country,
                        type: addr.type || 'Office Holder Address',
                        status: addr.status || 'Current',
                        startDate: addr.start_date,
                        endDate: addr.end_date,
                        entityType: 'Person',
                        entityId: holderId,
                        entityName: holderName,
                        personKey: holderKey // Store key for later matching
                    });
                }
            });
        }

        // Extract shareholder addresses (could be company or person)
        if (Array.isArray(extract.shareholders)) {
            extract.shareholders.forEach(shareholder => {
                if (shareholder && shareholder.address && shareholder.address.address) {
                    const shareholderName = shareholder.name || '';
                    const shareholderDOB = shareholder.dob || shareholder.dateOfBirth;
                    const normalizedName = normalizeName(shareholderName);
                    const isCompany = normalizedName.includes('pty') || normalizedName.includes('ltd') || 
                                     normalizedName.includes('limited') || normalizedName.includes('inc') ||
                                     normalizedName.includes('corporation') || normalizedName.includes('corp');
                    
                    const addr = shareholder.address;
                    let entityId, entityName, entityType;
                    
                    if (isCompany) {
                        // Company shareholder
                        entityType = 'Company';
                        entityId = `company_${shareholder.acn || shareholder.abn || shareholderName}`.replace(/\s/g, '');
                        entityName = shareholderName;
                    } else {
                        // Person shareholder
                        entityType = 'Person';
                        const shareholderKey = createPersonKey(shareholderName, shareholderDOB);
                        entityId = `shareholder_${normalizeName(shareholderName).replace(/\s+/g, '_')}_${normalizeDOB(shareholderDOB)}`;
                        entityName = shareholderName;
                        addresses.push({
                            id: `address_${normalizeName(addr.address || '').replace(/\s+/g, '_').substring(0, 50)}_${entityId}`,
                            address: addr.address,
                            address1: addr.address_1,
                            address2: addr.address_2,
                            suburb: addr.suburb,
                            state: addr.state,
                            postcode: addr.postcode,
                            country: addr.country,
                            type: addr.type || 'Shareholder Address',
                            status: addr.status || 'Current',
                            startDate: addr.start_date,
                            endDate: addr.end_date,
                            entityType: entityType,
                            entityId: entityId,
                            entityName: entityName,
                            personKey: shareholderKey // Store key for later matching
                        });
                        return; // Skip the company address push below
                    }
                    
                    const addressId = `address_${normalizeName(addr.address || '').replace(/\s+/g, '_').substring(0, 50)}_${entityId}`;
                    addresses.push({
                        id: addressId,
                        address: addr.address,
                        address1: addr.address_1,
                        address2: addr.address_2,
                        suburb: addr.suburb,
                        state: addr.state,
                        postcode: addr.postcode,
                        country: addr.country,
                        type: addr.type || 'Shareholder Address',
                        status: addr.status || 'Current',
                        startDate: addr.start_date,
                        endDate: addr.end_date,
                        entityType: entityType,
                        entityId: entityId,
                        entityName: entityName
                    });
                }
            });
        }
    }

    // // Extract addresses from court cases parties
    // if (rdata.cases && typeof rdata.cases === 'object') {
    //     Object.values(rdata.cases).forEach(caseItem => {
    //         if (caseItem && Array.isArray(caseItem.parties)) {
    //             caseItem.parties.forEach(party => {
    //                 if (party && party.address && party.address.trim() !== '') {
    //                     const partyName = party.name || '';
    //                     const partyType = party.type || 'Individual';
    //                     const normalizedName = normalizeName(partyName);
    //                     const isCompany = partyType === 'Company' || normalizedName.includes('pty') || 
    //                                      normalizedName.includes('ltd') || normalizedName.includes('limited');
                        
    //                     let entityId, entityName, entityType;
                        
    //                     if (isCompany) {
    //                         // Company party
    //                         entityType = 'Company';
    //                         // Try to match with existing company by ACN/ABN
    //                         if (party.acn) {
    //                             entityId = `company_${party.acn}`.replace(/\s/g, '');
    //                         } else if (party.abn) {
    //                             entityId = `company_${party.abn}`.replace(/\s/g, '');
    //                         } else {
    //                             entityId = `company_${partyName}`.replace(/\s/g, '');
    //                         }
    //                         entityName = partyName;
    //                     } else {
    //                         // Person party
    //                         entityType = 'Person';
    //                         // Try to match with existing person by name
    //                         // For now, create a generic ID - will be matched later
    //                         entityId = `person_${normalizeName(partyName).replace(/\s+/g, '_')}`;
    //                         entityName = partyName;
    //                     }
                        
    //                     const addressId = `address_${normalizeName(party.address).replace(/\s+/g, '_').substring(0, 50)}_${entityId}_court`;
    //                     addresses.push({
    //                         id: addressId,
    //                         address: party.address,
    //                         address1: null,
    //                         address2: null,
    //                         suburb: null,
    //                         state: null,
    //                         postcode: null,
    //                         country: null,
    //                         type: 'Court Case Party Address',
    //                         status: 'Current',
    //                         startDate: null,
    //                         endDate: null,
    //                         entityType: entityType,
    //                         entityId: entityId,
    //                         entityName: entityName,
    //                         caseUuid: caseItem.uuid,
    //                         partyRole: party.role
    //                     });
    //                 }
    //             });
    //         }
    //     });
    // }

    return addresses;
}

/**
 * Extract addresses from director-related report data
 */
function extractAddressesFromDirectorReport(reportData, directorId, allEntities) {
    if (!reportData || !reportData.rdata) {
        return [];
    }

    const addresses = [];
    const rdata = reportData.rdata;

    // Extract addresses from court cases parties
    // if (rdata.cases && typeof rdata.cases === 'object') {
    //     Object.values(rdata.cases).forEach(caseItem => {
    //         if (caseItem && Array.isArray(caseItem.parties)) {
    //             caseItem.parties.forEach(party => {
    //                 if (party && party.address && party.address.trim() !== '') {
    //                     const partyName = party.name || '';
    //                     const partyType = party.type || 'Individual';
    //                     const normalizedName = normalizeName(partyName);
    //                     const isCompany = partyType === 'Company' || normalizedName.includes('pty') || 
    //                                      normalizedName.includes('ltd') || normalizedName.includes('limited');
                        
    //                     let entityId, entityName, entityType;
                        
    //                     if (isCompany) {
    //                         // Company party
    //                         entityType = 'Company';
    //                         // Try to match with existing company by ACN/ABN
    //                         if (party.acn) {
    //                             entityId = `company_${party.acn}`.replace(/\s/g, '');
    //                         } else if (party.abn) {
    //                             entityId = `company_${party.abn}`.replace(/\s/g, '');
    //                         } else {
    //                             entityId = `company_${partyName}`.replace(/\s/g, '');
    //                         }
    //                         entityName = partyName;
    //                     } else {
    //                         // Person party - try to match with director
    //                         entityType = 'Person';
    //                         // Check if this party matches the director
    //                         const partyKey = createPersonKey(partyName, null);
    //                         const directorKey = createPersonKey(rdata.entity?.name || '', rdata.entity?.date_of_birth || null);
                            
    //                         if (normalizeName(partyName) === normalizeName(rdata.entity?.name || '')) {
    //                             entityId = directorId;
    //                             entityName = rdata.entity?.name || partyName;
    //                         } else {
    //                             entityId = `person_${normalizeName(partyName).replace(/\s+/g, '_')}`;
    //                             entityName = partyName;
    //                         }
    //                     }
                        
    //                     const addressId = `address_${normalizeName(party.address).replace(/\s+/g, '_').substring(0, 50)}_${entityId}_court`;
    //                     addresses.push({
    //                         id: addressId,
    //                         address: party.address,
    //                         address1: null,
    //                         address2: null,
    //                         suburb: null,
    //                         state: null,
    //                         postcode: null,
    //                         country: null,
    //                         type: 'Court Case Party Address',
    //                         status: 'Current',
    //                         startDate: null,
    //                         endDate: null,
    //                         entityType: entityType,
    //                         entityId: entityId,
    //                         entityName: entityName,
    //                         caseUuid: caseItem.uuid,
    //                         partyRole: party.role
    //                     });
    //                 }
    //             });
    //         }
    //     });
    // }

    return addresses;
}

/**
 * Merge persons with same name AND birthdate across different roles (director, office holder, secretary, shareholder)
 * Returns merged persons array and array of shareholders that were NOT merged (company shareholders)
 */
function mergePersonEntities(directors, officeHolders, secretaries, shareholders) {
    const mergedPersons = new Map(); // key: personKey (name|dob), value: merged person entity
    const mergedShareholderNames = new Set(); // Track which shareholders were merged

    // Process directors
    directors.forEach(director => {
        const personKey = createPersonKey(director.name, director.dob);
        
        // Try to find existing person by name+DOB, or by name only if DOB is missing
        let existingPersonKey = personKey;
        if (!mergedPersons.has(personKey)) {
            // If DOB is missing, try to find by name only (for merging with secretaries/office holders without DOB)
            if (!director.dob || !normalizeDOB(director.dob)) {
                const nameOnlyKey = normalizeName(director.name);
                // Check if there's already a person with this name (might have DOB or be a secretary/office holder)
                for (const [key, person] of mergedPersons.entries()) {
                    if (key.startsWith(nameOnlyKey + '|') || key === nameOnlyKey) {
                        existingPersonKey = key;
                        break;
                    }
                }
            }
        } else {
            existingPersonKey = personKey;
        }
        
        if (!mergedPersons.has(existingPersonKey)) {
            // Create merged person entity
            const personId = director.dob && normalizeDOB(director.dob) 
                ? `person_${normalizeName(director.name).replace(/\s+/g, '_')}_${normalizeDOB(director.dob)}`
                : `person_${normalizeName(director.name).replace(/\s+/g, '_')}`;
            
            mergedPersons.set(existingPersonKey, {
                id: personId,
                name: director.name,
                dob: director.dob,
                address: director.address,
                roles: [],
                companyIds: new Set(),
                type: director.type.includes('ceased') ? 'ceased_person' : 'current_person'
            });
        }
        
        const person = mergedPersons.get(existingPersonKey);
        person.roles.push({
            type: 'director',
            originalType: director.type,
            companyIds: director.companyIds
        });
        director.companyIds.forEach(id => person.companyIds.add(id));
        
        // If director has shareholdings (from director-related reports), add them as shareholder roles
        if (director.shareholdings && Array.isArray(director.shareholdings)) {
            director.shareholdings.forEach(sh => {
                person.roles.push({
                    type: 'shareholder',
                    originalType: 'shareholder',
                    shares: sh.shares,
                    shareClass: sh.shareClass,
                    companyIds: [sh.companyId]
                });
                person.companyIds.add(sh.companyId);
            });
        }
        
        // Update DOB if we found a match and the existing person didn't have DOB
        if (existingPersonKey !== personKey && !person.dob && director.dob) {
            person.dob = director.dob;
            // Update the key to include DOB for future matches
            const newKey = createPersonKey(person.name, person.dob);
            if (newKey !== existingPersonKey) {
                mergedPersons.set(newKey, person);
                mergedPersons.delete(existingPersonKey);
            }
        }
    });

    // Process office holders
    officeHolders.forEach(officeHolder => {
        const personKey = createPersonKey(officeHolder.name, officeHolder.dob);
        
        // Try to find existing person by name+DOB, or by name only if DOB is missing
        let existingPersonKey = personKey;
        if (!mergedPersons.has(personKey)) {
            // If DOB is missing, try to find by name only (for merging with directors/secretaries without DOB)
            if (!officeHolder.dob || !normalizeDOB(officeHolder.dob)) {
                const nameOnlyKey = normalizeName(officeHolder.name);
                // Check if there's already a person with this name (might have DOB or be a director/secretary)
                for (const [key, person] of mergedPersons.entries()) {
                    if (key.startsWith(nameOnlyKey + '|') || key === nameOnlyKey) {
                        existingPersonKey = key;
                        break;
                    }
                }
            }
        } else {
            existingPersonKey = personKey;
        }
        
        if (!mergedPersons.has(existingPersonKey)) {
            const personId = officeHolder.dob && normalizeDOB(officeHolder.dob) 
                ? `person_${normalizeName(officeHolder.name).replace(/\s+/g, '_')}_${normalizeDOB(officeHolder.dob)}`
                : `person_${normalizeName(officeHolder.name).replace(/\s+/g, '_')}`;
            
            mergedPersons.set(existingPersonKey, {
                id: personId,
                name: officeHolder.name,
                dob: officeHolder.dob,
                address: officeHolder.address,
                roles: [],
                companyIds: new Set(),
                type: officeHolder.type.includes('ceased') ? 'ceased_person' : 'current_person'
            });
        }
        
        const person = mergedPersons.get(existingPersonKey);
        person.roles.push({
            type: 'officeholder',
            originalType: officeHolder.type,
            role: officeHolder.role,
            companyIds: officeHolder.companyIds
        });
        officeHolder.companyIds.forEach(id => person.companyIds.add(id));
        
        // Update DOB if we found a match and the existing person didn't have DOB
        if (existingPersonKey !== personKey && !person.dob && officeHolder.dob) {
            person.dob = officeHolder.dob;
            // Update the key to include DOB for future matches
            const newKey = createPersonKey(person.name, person.dob);
            if (newKey !== existingPersonKey) {
                mergedPersons.set(newKey, person);
                mergedPersons.delete(existingPersonKey);
            }
        }
    });

    // Process secretaries
    secretaries.forEach(secretary => {
        const personKey = createPersonKey(secretary.name, secretary.dob);
        
        // Try to find existing person by name+DOB, or by name only if DOB is missing
        let existingPersonKey = personKey;
        if (!mergedPersons.has(personKey)) {
            // If DOB is missing, try to find by name only (for merging with directors/office holders without DOB)
            if (!secretary.dob || !normalizeDOB(secretary.dob)) {
                const nameOnlyKey = normalizeName(secretary.name);
                // Check if there's already a person with this name (might have DOB)
                for (const [key, person] of mergedPersons.entries()) {
                    if (key.startsWith(nameOnlyKey + '|') || key === nameOnlyKey) {
                        existingPersonKey = key;
                        break;
                    }
                }
            }
        }
        
        if (!mergedPersons.has(existingPersonKey)) {
            // Create new person entity
            const personId = secretary.dob && normalizeDOB(secretary.dob) 
                ? `person_${normalizeName(secretary.name).replace(/\s+/g, '_')}_${normalizeDOB(secretary.dob)}`
                : `person_${normalizeName(secretary.name).replace(/\s+/g, '_')}`;
            
            mergedPersons.set(existingPersonKey, {
                id: personId,
                name: secretary.name,
                dob: secretary.dob,
                address: secretary.address,
                roles: [],
                companyIds: new Set(),
                type: secretary.type === 'ceased_secretary' ? 'ceased_person' : 'current_person'
            });
        }
        
        const person = mergedPersons.get(existingPersonKey);
        person.roles.push({
            type: 'secretary',
            originalType: secretary.type, // This will be 'current_secretary' or 'ceased_secretary'
            companyIds: secretary.companyIds
        });
        secretary.companyIds.forEach(id => person.companyIds.add(id));
        
        // Update person type if secretary is ceased
        if (secretary.type === 'ceased_secretary' && person.type === 'current_person') {
            person.type = 'ceased_person';
        }
        
        // Update DOB if we found a match and the existing person didn't have DOB
        if (existingPersonKey !== personKey && !person.dob && secretary.dob) {
            person.dob = secretary.dob;
            // Update the key to include DOB for future matches
            const newKey = createPersonKey(person.name, person.dob);
            if (newKey !== existingPersonKey) {
                mergedPersons.set(newKey, person);
                mergedPersons.delete(existingPersonKey);
            }
        }
    });

    // Process shareholders - merge with existing persons if name AND DOB match
    // Also try name-only matching if DOB is missing (with uncertainty flag)
    shareholders.forEach(shareholder => {
        const personKey = createPersonKey(shareholder.name, shareholder.dob);
        const normalizedName = normalizeName(shareholder.name);
        const name = normalizeName(shareholder.name); // Use normalizeName instead of direct toLowerCase
        // Check if it's a company shareholder (not an individual)
        const isCompany = name.includes('pty') || name.includes('ltd') || name.includes('limited') || 
                         name.includes('inc') || name.includes('corporation') || name.includes('corp');
        
        // Check for exact match (name + DOB)
        if (mergedPersons.has(personKey)) {
            // Merge shareholder role into existing person (matched by name AND DOB) - CERTAIN match
            const person = mergedPersons.get(personKey);
            person.roles.push({
                type: 'shareholder',
                originalType: shareholder.type || 'shareholder', // This will be 'current_shareholder' or 'ceased_shareholder'
                shares: shareholder.shares,
                shareClass: shareholder.shareClass,
                companyIds: shareholder.companyIds,
                uncertain: false // Certain match (name + DOB)
            });
            shareholder.companyIds.forEach(id => person.companyIds.add(id));
            mergedShareholderNames.add(normalizedName);
            
            // Update person type if shareholder is ceased
            if (shareholder.type === 'ceased_shareholder' && person.type === 'current_person') {
                person.type = 'ceased_person';
            }
        } else if (!isCompany && (!shareholder.dob || !normalizeDOB(shareholder.dob))) {
            // No DOB available - try name-only matching for potential merge (UNCERTAIN match)
            let matchedPerson = null;
            let matchedPersonKey = null;
            
            // Search for existing person with same normalized name
            for (const [key, person] of mergedPersons.entries()) {
                const existingNormalizedName = normalizeName(person.name);
                if (existingNormalizedName === normalizedName) {
                    matchedPerson = person;
                    matchedPersonKey = key;
                    break;
                }
            }
            
            if (matchedPerson) {
                // Found a person with matching name but no DOB match - UNCERTAIN match
                // Calculate similarity percentage
                const similarityPercentage = calculateSimilarityPercentage(shareholder, matchedPerson);
                
                matchedPerson.roles.push({
                    type: 'shareholder',
                    originalType: shareholder.type || 'shareholder',
                    shares: shareholder.shares,
                    shareClass: shareholder.shareClass,
                    companyIds: shareholder.companyIds,
                    uncertain: true, // Uncertain match (name only, no DOB)
                    similarityPercentage: similarityPercentage // Store similarity percentage
                });
                shareholder.companyIds.forEach(id => matchedPerson.companyIds.add(id));
                mergedShareholderNames.add(normalizedName);
                
                // Update person type if shareholder is ceased
                if (shareholder.type === 'ceased_shareholder' && matchedPerson.type === 'current_person') {
                    matchedPerson.type = 'ceased_person';
                }
                
            } else if (!isCompany) {
            // Create new person entity for individual shareholder-only person (not a company)
                mergedPersons.set(personKey, {
                    id: `person_${normalizeName(shareholder.name).replace(/\s+/g, '_')}_${normalizeDOB(shareholder.dob)}`,
                    name: shareholder.name,
                    dob: shareholder.dob,
                    address: shareholder.address,
                    roles: [{
                        type: 'shareholder',
                        originalType: shareholder.type || 'shareholder', // This will be 'current_shareholder' or 'ceased_shareholder'
                        shares: shareholder.shares,
                        shareClass: shareholder.shareClass,
                        companyIds: shareholder.companyIds,
                        uncertain: false // New person, no uncertainty
                    }],
                    companyIds: new Set(shareholder.companyIds),
                    type: shareholder.type === 'ceased_shareholder' ? 'ceased_person' : 'current_person'
                });
                mergedShareholderNames.add(normalizedName);
            }
        } else if (!isCompany) {
            // Has DOB but no match found - create new person
            mergedPersons.set(personKey, {
                id: `person_${normalizeName(shareholder.name).replace(/\s+/g, '_')}_${normalizeDOB(shareholder.dob)}`,
                name: shareholder.name,
                dob: shareholder.dob,
                address: shareholder.address,
                roles: [{
                    type: 'shareholder',
                    originalType: shareholder.type || 'shareholder',
                    shares: shareholder.shares,
                    shareClass: shareholder.shareClass,
                    companyIds: shareholder.companyIds,
                    uncertain: false
                }],
                companyIds: new Set(shareholder.companyIds),
                type: shareholder.type === 'ceased_shareholder' ? 'ceased_person' : 'current_person'
            });
            mergedShareholderNames.add(normalizedName);
        }
        // If it's a company shareholder, don't merge - it will remain in remainingShareholders
    });

    // Convert Sets to Arrays
    mergedPersons.forEach(person => {
        person.companyIds = Array.from(person.companyIds);
    });

    // Return only shareholders that are companies (not individuals merged with persons)
    const remainingShareholders = shareholders.filter(sh => {
        const normalizedName = normalizeName(sh.name);
        // If it was merged into a person, exclude it
        if (mergedShareholderNames.has(normalizedName)) {
            return false;
        }
        // Keep company shareholders separate
        const name = normalizeName(sh.name); // Use normalizeName instead of direct toLowerCase
        const isCompany = name.includes('pty') || name.includes('ltd') || name.includes('limited') || 
                         name.includes('inc') || name.includes('corporation') || name.includes('corp');
        return isCompany;
    });

    return {
        persons: Array.from(mergedPersons.values()),
        remainingShareholders: remainingShareholders
    };
}

/**
 * Extract PPSR data from report and group by secured party + collateral type
 * Returns an array of grouped registrations with counts
 */
function extractPpsrDataFromReport(reportData) {
    if (!reportData || !reportData.rdata) {
        return [];
    }

    // Handle different data structures
    // The data might be stored as:
    // 1. {resource: {items: [...]}} - direct structure
    // 2. {uuid: "...", resource: {items: [...]}} - wrapped structure
    // 3. Just {items: [...]} - flat structure
    let resource = null;
    
    if (reportData.rdata.resource) {
        // Structure: {resource: {items: [...]}}
        resource = reportData.rdata.resource;
    } else if (reportData.rdata.items) {
        // Structure: {items: [...]} - flat
        resource = reportData.rdata;
    } else if (reportData.rdata.rdata && reportData.rdata.rdata.resource) {
        // Nested structure
        resource = reportData.rdata.rdata.resource;
    } else {
        // Try as-is
        resource = reportData.rdata;
    }
    
    if (!resource) {
        return [];
    }
    
    const items = resource.items || [];

    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }

    // Group by securedPartySummary + collateralClassType
    const groupedData = new Map(); // key: securedPartySummary|||collateralClassType, value: { count, collateralType, securedPartySummary, grantorACN, grantorName }
    items.forEach(item => {
        if (!item || !item.securedPartySummary || !item.collateralClassType) {
            return;
        }

        const securedPartySummary = item.securedPartySummary || '';
        const collateralClassType = item.collateralClassType || '';
        const key = `${securedPartySummary}|||${collateralClassType}`;

        // Extract grantor information (company that granted the security)
        // First try grantorSummary, then grantors array
        let grantorACN = '';
        let grantorName = '';
        
        if (item.grantorSummary) {
            // Parse grantorSummary: "ACN 642513773 FT FARMING MANAGEMENT PTY LTD"
            const acnMatch = item.grantorSummary.match(/ACN\s+(\d+)/i);
            if (acnMatch) {
                grantorACN = acnMatch[1];
                grantorName = item.grantorSummary.replace(/ACN\s+\d+\s*/i, '').trim();
            } else {
                grantorName = item.grantorSummary.trim();
            }
        } else if (item.grantors && item.grantors[0]) {
            const grantor = item.grantors[0];
            grantorACN = grantor.organisationNumber || '';
            grantorName = grantor.organisationName || '';
        }

        if (!groupedData.has(key)) {
            groupedData.set(key, {
                securedPartySummary: securedPartySummary,
                collateralClassType: collateralClassType,
                count: 0,
                grantorACN: grantorACN,
                grantorName: grantorName
            });
        }

        // Count each registration as 1
        groupedData.get(key).count += 1;
    });
    return Array.from(groupedData.values());
}

/**
 * Build relationships between entities
 */
function buildRelationships(entities, companyShareholderRelationships = [], addresses = [], ppsrRelationships = [], bankruptcyRelationships = []) {
    const relationships = [];

    // Link merged persons to their companies (multiple edges for multiple roles)
    entities.persons.forEach(person => {
        person.roles.forEach(role => {
            role.companyIds.forEach(companyId => {
                let label = '';
                if (role.type === 'director') {
                    label = role.originalType === 'ceased_director' ? 'Former Director' : 'Director';
                } else if (role.type === 'officeholder') {
                    label = role.originalType === 'ceased_officeholder' ? `Former ${role.role || 'Office Holder'}` : (role.role || 'Office Holder');
                } else if (role.type === 'secretary') {
                    label = role.originalType === 'ceased_secretary' ? 'Former Secretary' : 'Secretary';
                } else if (role.type === 'shareholder') {
                    const shareLabel = role.shares ? `${role.shares} shares` : 'Shareholder';
                    label = role.originalType === 'ceased_shareholder' ? `Former ${shareLabel}` : shareLabel;
                }

                relationships.push({
                    from: person.id,
                    to: companyId,
                    type: role.originalType || role.type,
                    label: label,
                    uncertain: role.uncertain || false, // Pass uncertainty flag to relationship
                    similarityPercentage: role.similarityPercentage || null // Pass similarity percentage if available
                });
            });
        });
    });

    // Link remaining shareholders (companies) to companies
    entities.shareholders.forEach(shareholder => {
        shareholder.companyIds.forEach(companyId => {
            const shareLabel = shareholder.shares ? `${shareholder.shares} shares` : 'Shareholder';
            const label = shareholder.type === 'ceased_shareholder' ? `Former ${shareLabel}` : shareLabel;
            relationships.push({
                from: shareholder.id,
                to: companyId,
                type: shareholder.type || 'shareholder',
                label: label
            });
        });
    });

    // Add company-to-company shareholder relationships (when shareholder has ACN matching existing company)
    companyShareholderRelationships.forEach(rel => {
        relationships.push({
            from: rel.from,
            to: rel.to,
            type: rel.type,
            label: rel.label
        });
    });

    // Add PPSR relationships (from grantor company to secured party)
    ppsrRelationships.forEach(rel => {
        relationships.push({
            from: rel.from,
            to: rel.to,
            type: rel.type,
            label: rel.label
        });
    });

    // Add bankruptcy relationships (from director to bankruptcy node)
    bankruptcyRelationships.forEach(rel => {
        relationships.push({
            from: rel.from,
            to: rel.to,
            type: rel.type,
            label: rel.label,
            extractId: rel.extractId
        });
    });


    // Link addresses to entities (companies or persons)
    // Addresses can be linked to multiple entities (deduplicated addresses)
    addresses.forEach(addr => {
        // Handle both old format (single linkedEntityId) and new format (array of linkedEntityIds)
        const entityIds = addr.linkedEntityIds || (addr.linkedEntityId ? [addr.linkedEntityId] : []);
        
        entityIds.forEach(entityId => {
            relationships.push({
                from: entityId,
                to: addr.id,
                type: 'has_address',
                label: addr.type || 'Address',
                addressType: addr.type,
                status: addr.status
            });
        });
    });

    // Deduplicate relationships - same from, to, and type should only appear once
    // Use a Set to track unique relationship keys
    const relationshipKeys = new Set();
    const uniqueRelationships = [];
    
    relationships.forEach(rel => {
        // Create a unique key for this relationship
        // For PPSR relationships, include label to allow multiple edges with different collateral types
        // For other relationships, from+to+type is enough
        let key;
        if (rel.type === 'ppsr_security' || rel.type === 'ppsr_director') {
            // For PPSR (both company and director), include label to distinguish different collateral types
            key = `${rel.from}|${rel.to}|${rel.type}|${rel.label}`;
        } else {
            // For other relationships, from+to+type is enough
            key = `${rel.from}|${rel.to}|${rel.type}`;
        }
        
        if (!relationshipKeys.has(key)) {
            relationshipKeys.add(key);
            uniqueRelationships.push(rel);
        }
    });

    return uniqueRelationships;
}

/**
 * Build mind map from database reports (NO PDF PARSING!)
 * This is the main function - much faster and more reliable
 */
async function buildMindMapFromDatabase(matterId, userId) {

    try {
        // Query database for all ASIC Current reports AND director-related reports for this matter
        const reports = await sequelize.query(`
            SELECT 
                ad.id,
                ad.rtype,
                ad.rdata,
                ad.acn,
                ad.abn,
                ad.search_word as "searchWord",
                ad.created_at as "createdAt"
            FROM user_reports ur
            JOIN api_data ad ON ur.report_id = ad.id
            WHERE ur.matter_id = :matterId 
              AND ur.user_id = :userId
              AND (ad.rtype = 'asic-current' OR ad.rtype LIKE '%asic%' OR ad.rtype = 'director-related')
            ORDER BY ad.created_at DESC
        `, {
            replacements: { matterId, userId },
            type: sequelize.QueryTypes.SELECT
        });

        // Query for court and ATO reports (check both rtype and reportName)
        const courtAtoReports = await sequelize.query(`
            SELECT 
                ad.id,
                ad.rtype,
                ad.rdata,
                ad.acn,
                ad.abn,
                ad.search_word as "searchWord",
                ur.report_name as "reportName",
                ad.created_at as "createdAt"
            FROM user_reports ur
            JOIN api_data ad ON ur.report_id = ad.id
            WHERE ur.matter_id = :matterId 
              AND ur.user_id = :userId
              AND (
                  ad.rtype = 'court' OR ad.rtype = 'ato' 
                  OR ur.report_name LIKE 'court_%' 
                  OR ur.report_name LIKE 'ato_%'
              )
            ORDER BY ad.created_at DESC
        `, {
            replacements: { matterId, userId },
            type: sequelize.QueryTypes.SELECT
        });

        // Query for PPSR reports (both company and director)
        const ppsrReports = await sequelize.query(`
            SELECT 
                ad.id,
                ad.rtype,
                ad.rdata,
                ad.acn,
                ad.abn,
                ad.search_word as "searchWord",
                ad.created_at as "createdAt"
            FROM user_reports ur
            JOIN api_data ad ON ur.report_id = ad.id
            WHERE ur.matter_id = :matterId 
              AND ur.user_id = :userId
              AND (ad.rtype = 'ppsr' OR ad.rtype = 'director-ppsr')
            ORDER BY ad.created_at DESC
        `, {
            replacements: { matterId, userId },
            type: sequelize.QueryTypes.SELECT
        });

        // Query for director-bankruptcy reports
        const bankruptcyReports = await sequelize.query(`
            SELECT 
                ad.id,
                ad.rtype,
                ad.rdata,
                ad.acn,
                ad.abn,
                ad.search_word as "searchWord",
                ad.created_at as "createdAt"
            FROM user_reports ur
            JOIN api_data ad ON ur.report_id = ad.id
            WHERE ur.matter_id = :matterId 
              AND ur.user_id = :userId
              AND ad.rtype = 'director-bankruptcy'
            ORDER BY ad.created_at DESC
        `, {
            replacements: { matterId, userId },
            type: sequelize.QueryTypes.SELECT
        });

        if (reports.length === 0) {
            return {
                entities: {
                    companies: [],
                    directors: [],
                    shareholders: [],
                    secretaries: [],
                    officeHolders: [],
                    addresses: []
                },
                relationships: [],
                stats: {
                    totalCompanies: 0,
                    totalDirectors: 0,
                    totalShareholders: 0,
                    totalSecretaries: 0,
                    totalOfficeHolders: 0,
                    totalAddresses: 0,
                    totalRelationships: 0
                }
            };
        }

        // Process entities from database
        const allEntities = {
            companies: new Map(),
            directors: new Map(),
            shareholders: new Map(),
            secretaries: new Map(),
            officeHolders: new Map(),
            addresses: new Map() // Store addresses
        };

        // Track ALL persons by name+DOB key to prevent duplicates across all roles
        const personsByKey = new Map(); // key: personKey (name|dob), value: person entity (can be director, secretary, office holder, or shareholder)
        const directorsByKey = new Map(); // key: personKey (name|dob), value: director entity (for backward compatibility)
        
        // Track company-to-company shareholder relationships (when shareholder has ACN matching existing company)
        const companyShareholderRelationships = []; // Array of {fromCompanyId, toCompanyId, shares, shareClass}
        const companyShareholderKeys = new Set(); // Track unique company shareholder relationships to prevent duplicates
        
        // Track PPSR relationships (from grantor company to secured party)
        const ppsrRelationships = []; // Array of {from, to, type, label}
        const ppsrRelationshipKeys = new Set(); // Track unique PPSR relationships to prevent duplicates

        // Track bankruptcy nodes and relationships
        const bankruptcyNodes = new Map(); // key: bankruptcyId, value: bankruptcy node
        const bankruptcyRelationships = []; // Array of {from, to, type, label, extractId}
        const bankruptcyRelationshipKeys = new Set(); // Track unique bankruptcy relationships to prevent duplicates

        // Helper function to find or create company by ACN/ABN
        function findOrCreateCompany(companyName, acn, abn, status, reportType, reportId, searchWord) {
            // Normalize ACN and ABN for comparison (remove spaces)
            const normalizeAcn = (acnValue) => acnValue ? String(acnValue).replace(/\s/g, '') : null;
            const normalizeAbn = (abnValue) => abnValue ? String(abnValue).replace(/\s/g, '') : null;
            
            const normalizedAcn = normalizeAcn(acn);
            const normalizedAbn = normalizeAbn(abn);
            
            // Try to find existing company by ACN or ABN first (with normalized comparison)
            let existingCompany = null;
            if (normalizedAcn) {
                for (const [id, company] of allEntities.companies.entries()) {
                    const companyAcn = normalizeAcn(company.acn);
                    if (companyAcn && companyAcn === normalizedAcn) {
                        existingCompany = company;
                        break;
                    }
                }
            }
            if (!existingCompany && normalizedAbn) {
                for (const [id, company] of allEntities.companies.entries()) {
                    const companyAbn = normalizeAbn(company.abn);
                    if (companyAbn && companyAbn === normalizedAbn) {
                        existingCompany = company;
                        break;
                    }
                }
            }

            if (existingCompany) {
                // Update company info if we have more details
                if (status && !existingCompany.status) existingCompany.status = status;
                return existingCompany.id;
            }

            // Create new company
            const companyId = `company_${acn || abn || companyName}`.replace(/\s/g, '');
            if (!allEntities.companies.has(companyId)) {
                allEntities.companies.set(companyId, {
                    id: companyId,
                    name: companyName,
                    acn: acn,
                    abn: abn,
                    status: status || 'Unknown',
                    type: null,
                    registered: null,
                    address: null,
                    reportType: reportType,
                    reportId: reportId,
                    searchWord: searchWord
                });
            }
            return companyId;
        }

        // Process each report
        for (const report of reports) {
            if (report.rtype === 'director-related') {
                // Process director-related report
                const director = extractDirectorFromDirectorRelatedReport(report);
                if (director) {

                    // Create director entity and link to companies
                    // Use consistent ID format with name+DOB
                    const directorEntityId = `director_${normalizeName(director.name).replace(/\s+/g, '_')}_${normalizeDOB(director.dob)}`;
                    const directorEntity = {
                        id: directorEntityId,
                        name: director.name,
                        dob: director.dob,
                        address: director.address,
                        role: 'Director',
                        type: 'current_director',
                        companyIds: []
                    };

                    // Extract directorships from this director-related report
                    const directorships = extractDirectorshipsFromDirectorRelatedReport(report, directorEntityId);

                    // Process each directorship
                    directorships.forEach(directorship => {
                        // Find or create company
                        const companyId = findOrCreateCompany(
                            directorship.companyName,
                            directorship.acn,
                            directorship.abn,
                            directorship.status,
                            'director-related',
                            report.id,
                            directorship.companyName
                        );

                        // Add company to director's company list
                        if (!directorEntity.companyIds.includes(companyId)) {
                            directorEntity.companyIds.push(companyId);
                        }
                    });

                    // Extract shareholdings from director-related report BEFORE storing director
                    // Store shareholdings as part of director entity (not as separate shareholder entities)
                    // This ensures the person appears only once with multiple roles
                    const shareholdings = extractShareholdingsFromDirectorRelatedReport(report, directorEntityId);
                    if (shareholdings.length > 0) {
                        directorEntity.shareholdings = [];
                        shareholdings.forEach(shareholding => {
                            const companyId = findOrCreateCompany(
                                shareholding.companyName,
                                shareholding.acn,
                                shareholding.abn,
                                null,
                                'director-related',
                                report.id,
                                shareholding.companyName
                            );

                            // Store shareholding info in director entity for later role assignment
                            directorEntity.shareholdings.push({
                                companyId: companyId,
                                shares: shareholding.shares,
                                shareClass: shareholding.shareClass
                            });
                        });
                    }

                    // Store director - merge by name+DOB key to prevent duplicates
                    const directorKey = createPersonKey(directorEntity.name, directorEntity.dob);
                    if (directorsByKey.has(directorKey)) {
                        // Merge with existing director (same person, different report)
                        const existing = directorsByKey.get(directorKey);
                        // Merge company IDs
                        directorEntity.companyIds.forEach(id => {
                            if (!existing.companyIds.includes(id)) {
                                existing.companyIds.push(id);
                            }
                        });
                        // Merge shareholdings
                        if (directorEntity.shareholdings && directorEntity.shareholdings.length > 0) {
                            if (!existing.shareholdings) {
                                existing.shareholdings = [];
                            }
                            directorEntity.shareholdings.forEach(sh => {
                                // Check if this shareholding already exists
                                const exists = existing.shareholdings.some(existingSh => existingSh.companyId === sh.companyId);
                                if (!exists) {
                                    existing.shareholdings.push(sh);
                                }
                            });
                        }
                        // Update the stored director with merged data (use existing ID to maintain consistency)
                        allEntities.directors.set(existing.id, existing);
                        // Also update personsByKey if it exists
                        if (personsByKey.has(directorKey)) {
                            const person = personsByKey.get(directorKey);
                            person.companyIds = existing.companyIds;
                            if (existing.shareholdings) {
                                person.shareholdings = existing.shareholdings;
                            }
                        }
                    } else {
                        // New director - store by both ID and key
                        directorsByKey.set(directorKey, directorEntity);
                        allEntities.directors.set(directorEntity.id, directorEntity);
                        // Also store in personsByKey for cross-role matching
                        personsByKey.set(directorKey, { ...directorEntity, type: directorEntity.type });
                    }
                }
            } else {
                // Process ASIC Current report (existing logic)
                const company = extractCompanyFromReport(report, report);
                if (company) {
                    // Use findOrCreateCompany to handle ACN/ABN matching
                    const companyId = findOrCreateCompany(
                        company.name,
                        company.acn,
                        company.abn,
                        company.status,
                        company.reportType,
                        company.reportId,
                        company.searchWord
                    );
                    
                    // Update company details if we found an existing one
                    const actualCompany = allEntities.companies.get(companyId);
                    if (actualCompany) {
                        if (company.type && !actualCompany.type) actualCompany.type = company.type;
                        if (company.registered && !actualCompany.registered) actualCompany.registered = company.registered;
                        if (company.address && !actualCompany.address) actualCompany.address = company.address;
                    }

                    // Extract directors for this company
                    const directors = extractDirectorsFromReport(report, companyId);
                    directors.forEach(director => {
                        // Use name+DOB key for matching to prevent duplicates
                        const directorKey = createPersonKey(director.name, director.dob);
                        const directorId = director.type.includes('ceased') 
                            ? `director_ceased_${normalizeName(director.name).replace(/\s+/g, '_')}_${normalizeDOB(director.dob)}`
                            : `director_${normalizeName(director.name).replace(/\s+/g, '_')}_${normalizeDOB(director.dob)}`;
                        director.id = directorId;

                        if (directorsByKey.has(directorKey)) {
                            // Merge with existing director (same person, different report)
                            const existing = directorsByKey.get(directorKey);
                            // Merge company IDs
                            if (!existing.companyIds.includes(companyId)) {
                                existing.companyIds.push(companyId);
                            }
                            // Merge shareholdings if director has them
                            if (director.shareholdings && Array.isArray(director.shareholdings)) {
                                if (!existing.shareholdings) {
                                    existing.shareholdings = [];
                                }
                                director.shareholdings.forEach(sh => {
                                    const exists = existing.shareholdings.some(existingSh => existingSh.companyId === sh.companyId);
                                    if (!exists) {
                                        existing.shareholdings.push(sh);
                                    }
                                });
                            }
                            // Update the stored director with merged data (use existing ID to maintain consistency)
                            allEntities.directors.set(existing.id, existing);
                            // Also update personsByKey if it exists
                            if (personsByKey.has(directorKey)) {
                                const person = personsByKey.get(directorKey);
                                person.companyIds = existing.companyIds;
                                if (existing.shareholdings) {
                                    person.shareholdings = existing.shareholdings;
                                }
                            }
                        } else {
                            // New director - store by both ID and key
                            directorsByKey.set(directorKey, director);
                            allEntities.directors.set(directorId, director);
                            // Also store in personsByKey for cross-role matching
                            personsByKey.set(directorKey, { ...director, type: director.type });
                        }
                    });

                // Extract shareholders for this company
                    const shareholders = extractShareholdersFromReport(report, companyId);
                shareholders.forEach(shareholder => {
                    // Check if shareholder has ACN/ABN and matches an existing company
                    let matchedCompanyId = null;
                    if (shareholder.acn) {
                        // Try to find existing company by ACN
                        for (const [id, company] of allEntities.companies.entries()) {
                            if (company.acn === shareholder.acn) {
                                matchedCompanyId = id;
                                break;
                            }
                        }
                    }
                    if (!matchedCompanyId && shareholder.abn) {
                        // Try to find existing company by ABN
                        for (const [id, company] of allEntities.companies.entries()) {
                            if (company.abn === shareholder.abn) {
                                matchedCompanyId = id;
                                break;
                            }
                        }
                    }
                    
                    // If shareholder has ACN/ABN and matches an existing company, create direct company-to-company relationship
                    if (matchedCompanyId) {
                        // Create unique key for this relationship to prevent duplicates
                        const relationshipKey = `${matchedCompanyId}|${companyId}|company_shareholder`;
                        
                        // Only add if not already present (prevents duplicates from different reports)
                        if (!companyShareholderKeys.has(relationshipKey)) {
                            companyShareholderKeys.add(relationshipKey);
                            companyShareholderRelationships.push({
                                from: matchedCompanyId, // The shareholder company
                                to: companyId, // The company being held
                                shares: shareholder.shares || shareholder.numberOfShares || shareholder.shareCount,
                                shareClass: shareholder.shareClass || shareholder.class,
                                type: 'company_shareholder',
                                label: shareholder.shares ? `${shareholder.shares} shares` : 'Shareholder'
                            });
                        }
                        return; // Skip creating shareholder entity
                    }
                    
                    // Use person key (name+DOB) for deduplication
                    // Note: shareholders might not have DOB, so we'll use name only as fallback
                    const personKey = createPersonKey(shareholder.name, shareholder.dob);
                    // Use the ID from extraction (already includes ceased prefix if applicable)
                    const shareholderId = shareholder.id;
                    
                    // Check if it's a company shareholder (not an individual person)
                    const name = normalizeName(shareholder.name); // Use normalizeName instead of direct toLowerCase
                    const isCompany = name.includes('pty') || name.includes('ltd') || name.includes('limited') || 
                                     name.includes('inc') || name.includes('corporation') || name.includes('corp');
                    
                    if (!isCompany && personsByKey.has(personKey)) {
                        // Person already exists (might be a director, secretary, etc.) - will be merged later
                        // Just ensure the shareholder entity exists for the merge process
                        if (!allEntities.shareholders.has(shareholderId)) {
                            allEntities.shareholders.set(shareholderId, shareholder);
                        } else {
                            const existing = allEntities.shareholders.get(shareholderId);
                            if (!existing.companyIds.includes(companyId)) {
                                existing.companyIds.push(companyId);
                            }
                        }
                    } else {
                        // New shareholder (or company shareholder) - store it
                        if (!isCompany) {
                            // Use the actual type from extraction (current_shareholder or ceased_shareholder)
                            personsByKey.set(personKey, { ...shareholder, type: shareholder.type });
                        }
                        if (!allEntities.shareholders.has(shareholderId)) {
                            allEntities.shareholders.set(shareholderId, shareholder);
                        } else {
                            const existing = allEntities.shareholders.get(shareholderId);
                            if (!existing.companyIds.includes(companyId)) {
                                existing.companyIds.push(companyId);
                            }
                        }
                    }
                });

                // Extract secretaries for this company
                    const secretaries = extractSecretaryFromReport(report, companyId);
                secretaries.forEach(secretary => {
                    // Use person key (name+DOB) for deduplication, not just ID
                    const personKey = createPersonKey(secretary.name, secretary.dob);
                    // Use the ID from extraction (already includes ceased prefix if applicable)
                    const secretaryId = secretary.id;
                    
                    if (personsByKey.has(personKey)) {
                        // Person already exists (might be a director, office holder, etc.) - merge company IDs
                        const existing = personsByKey.get(personKey);
                        if (existing.type === 'current_secretary' || existing.type === 'ceased_secretary' || existing.roles?.some(r => r.type === 'secretary')) {
                            // Already has secretary role, just merge company IDs
                            if (!existing.companyIds.includes(companyId)) {
                                existing.companyIds.push(companyId);
                            }
                            // Update the secretary in allEntities if it exists
                            if (allEntities.secretaries.has(secretaryId)) {
                                const secEntity = allEntities.secretaries.get(secretaryId);
                                if (!secEntity.companyIds.includes(companyId)) {
                                    secEntity.companyIds.push(companyId);
                                }
                            }
                        } else {
                            // Person exists but not as secretary - will be merged later in mergePersonEntities
                            if (!allEntities.secretaries.has(secretaryId)) {
                                allEntities.secretaries.set(secretaryId, secretary);
                            } else {
                                const existing = allEntities.secretaries.get(secretaryId);
                                if (!existing.companyIds.includes(companyId)) {
                                    existing.companyIds.push(companyId);
                                }
                            }
                        }
                    } else {
                        // New person - store by person key and secretary ID
                        // Use the actual type from extraction (current_secretary or ceased_secretary)
                        personsByKey.set(personKey, { ...secretary, type: secretary.type });
                        if (!allEntities.secretaries.has(secretaryId)) {
                            allEntities.secretaries.set(secretaryId, secretary);
                        } else {
                            const existing = allEntities.secretaries.get(secretaryId);
                            if (!existing.companyIds.includes(companyId)) {
                                existing.companyIds.push(companyId);
                            }
                        }
                    }
                });

                // Extract office holders for this company (separate from directors)
                    const officeHolders = extractOfficeHoldersFromReport(report, companyId);
                officeHolders.forEach(officeHolder => {
                    // Use person key (name+DOB) for deduplication, not just ID
                    const personKey = createPersonKey(officeHolder.name, officeHolder.dob);
                    const officeHolderId = `officeholder_${officeHolder.type.includes('ceased') ? 'ceased_' : ''}${normalizeName(officeHolder.name).replace(/\s+/g, '_')}_${normalizeDOB(officeHolder.dob)}`;
                    officeHolder.id = officeHolderId;
                    
                    if (personsByKey.has(personKey)) {
                        // Person already exists (might be a director, secretary, etc.) - merge company IDs
                        const existing = personsByKey.get(personKey);
                        if (existing.type === 'officeholder' || existing.roles?.some(r => r.type === 'officeholder')) {
                            // Already has office holder role, just merge company IDs
                            if (!existing.companyIds.includes(companyId)) {
                                existing.companyIds.push(companyId);
                            }
                            // Update the office holder in allEntities if it exists
                            if (allEntities.officeHolders.has(officeHolderId)) {
                                const ohEntity = allEntities.officeHolders.get(officeHolderId);
                                if (!ohEntity.companyIds.includes(companyId)) {
                                    ohEntity.companyIds.push(companyId);
                                }
                            }
                        } else {
                            // Person exists but not as office holder - will be merged later in mergePersonEntities
                            if (!allEntities.officeHolders.has(officeHolderId)) {
                                allEntities.officeHolders.set(officeHolderId, officeHolder);
                            } else {
                                const existing = allEntities.officeHolders.get(officeHolderId);
                                if (!existing.companyIds.includes(companyId)) {
                                    existing.companyIds.push(companyId);
                                }
                            }
                        }
                    } else {
                        // New person - store by person key and office holder ID
                        personsByKey.set(personKey, { ...officeHolder, type: 'officeholder' });
                        if (!allEntities.officeHolders.has(officeHolderId)) {
                            allEntities.officeHolders.set(officeHolderId, officeHolder);
                        } else {
                            const existing = allEntities.officeHolders.get(officeHolderId);
                            if (!existing.companyIds.includes(companyId)) {
                                existing.companyIds.push(companyId);
                            }
                        }
                    }
                });
                //console.log(officeHolders);
                // Extract addresses from ASIC report
                const addresses = extractAddressesFromAsicReport(report, companyId, allEntities);
                
                addresses.forEach(addr => {
                    // Link address to entity based on entity type
                    if (addr.entityType === 'Company') {
                        // Try to find company by ID
                        if (allEntities.companies.has(addr.entityId)) {
                            addr.linkedEntityId = addr.entityId;
                        } else {
                            // Try to find by ACN/ABN
                            for (const [id, company] of allEntities.companies.entries()) {
                                if (company.acn && addr.entityId.includes(company.acn.replace(/\s/g, ''))) {
                                    addr.linkedEntityId = id;
                                    break;
                                }
                                if (company.abn && addr.entityId.includes(company.abn.replace(/\s/g, ''))) {
                                    addr.linkedEntityId = id;
                                    break;
                                }
                            }
                        }
                    } else if (addr.entityType === 'Person') {
                        // Try to find person by ID or personKey
                        let foundPerson = false;
                        
                        // Check directors
                        if (allEntities.directors.has(addr.entityId)) {
                            addr.linkedEntityId = addr.entityId;
                            foundPerson = true;
                        }
                        
                        // Check secretaries
                        if (!foundPerson && allEntities.secretaries.has(addr.entityId)) {
                            addr.linkedEntityId = addr.entityId;
                            foundPerson = true;
                        }
                        
                        // Check office holders
                        if (!foundPerson && allEntities.officeHolders.has(addr.entityId)) {
                            addr.linkedEntityId = addr.entityId;
                            foundPerson = true;
                        }
                        
                        // Check shareholders
                        if (!foundPerson && allEntities.shareholders.has(addr.entityId)) {
                            addr.linkedEntityId = addr.entityId;
                            foundPerson = true;
                        }
                        
                        // Try to find by personKey
                        if (!foundPerson && addr.personKey && personsByKey.has(addr.personKey)) {
                            const person = personsByKey.get(addr.personKey);
                            addr.linkedEntityId = person.id || addr.entityId;
                            foundPerson = true;
                        }
                        
                        // If still not found, try to match by name in personsByKey
                        if (!foundPerson) {
                            const normalizedName = normalizeName(addr.entityName);
                            for (const [key, person] of personsByKey.entries()) {
                                if (normalizeName(person.name) === normalizedName) {
                                    addr.linkedEntityId = person.id || addr.entityId;
                                    break;
                                }
                            }
                        }
                    }
                    
                    // Store address if not already present
                    if (!allEntities.addresses.has(addr.id)) {
                        allEntities.addresses.set(addr.id, addr);
                    }
                    
                });
                //console.log(addresses);
                }
            }
        }

        // Process PPSR reports (both company and director)
        for (const ppsrReport of ppsrReports) {
            if (!ppsrReport || !ppsrReport.rdata) continue;

            const isDirectorPpsr = ppsrReport.rtype === 'director-ppsr';
            
            // Extract grouped PPSR data
            const ppsrGroupedData = extractPpsrDataFromReport(ppsrReport);
            
            // For director-ppsr reports, ensure director node exists even if no registrations
            if (isDirectorPpsr && ppsrGroupedData.length === 0) {
                // Extract director name from searchWord or searchCriteriaSummaries
                let directorName = ppsrReport.searchWord;
                
                if (!directorName && ppsrReport.rdata) {
                    // Try to extract from searchCriteriaSummaries
                    // Handle different data structures
                    let resource = null;
                    if (ppsrReport.rdata.resource) {
                        resource = ppsrReport.rdata.resource;
                    } else if (ppsrReport.rdata.searchCriteriaSummaries) {
                        resource = ppsrReport.rdata;
                    } else if (ppsrReport.rdata.rdata && ppsrReport.rdata.rdata.resource) {
                        resource = ppsrReport.rdata.rdata.resource;
                    } else {
                        resource = ppsrReport.rdata;
                    }
                    
                    const searchCriteriaSummary = resource?.searchCriteriaSummaries?.[0];
                    if (searchCriteriaSummary && searchCriteriaSummary.criteriaSummary) {
                        directorName = searchCriteriaSummary.criteriaSummary;
                    }
                }
                
                if (directorName) {
                    // Create director node even if no PPSR registrations exist
                    const normalizedDirectorName = normalizeName(directorName);
                    let grantorEntityId = null;
                    
                    // Check if person already exists in personsByKey
                    for (const [personKey, person] of personsByKey.entries()) {
                        if (normalizeName(person.name) === normalizedDirectorName) {
                            grantorEntityId = person.id; // Use existing person ID (should be person_ format)
                            break;
                        }
                    }
                    
                    // If not found, create a new director person entity with person_ ID format
                    if (!grantorEntityId) {
                        const personKey = createPersonKey(directorName, null);
                        // Use person_ format to match merged person entities
                        const personId = `person_${normalizeName(directorName).replace(/\s+/g, '_')}`;
                        
                        const directorEntity = {
                            id: personId, // Use person_ format
                            name: directorName,
                            dob: null,
                            address: null,
                            role: 'Director',
                            type: 'current_director',
                            companyIds: [],
                            roles: [{
                                type: 'director',
                                originalType: 'current_director',
                                companyIds: []
                            }]
                        };
                        
                        personsByKey.set(personKey, directorEntity);
                        // Also store in directors map with temp director ID for backward compatibility
                        const tempDirectorId = `director_${normalizeName(directorName).replace(/\s+/g, '_')}_${normalizeDOB(null)}`;
                        if (!allEntities.directors.has(tempDirectorId)) {
                            allEntities.directors.set(tempDirectorId, {
                                ...directorEntity,
                                id: tempDirectorId
                            });
                        }
                        
                        grantorEntityId = personId; // Use person_ format ID
                    }
                }
            }

            // Process each grouped registration
            for (const group of ppsrGroupedData) {
                const { securedPartySummary, collateralClassType, count, grantorACN, grantorName } = group;

                let grantorEntityId = null;

                if (isDirectorPpsr) {
                    // For director-ppsr: grantor is a person (director)
                    // Use searchWord (director name) from the report
                    const directorName = ppsrReport.searchWord || grantorName || 'Unknown Director';
                    const normalizedDirectorName = normalizeName(directorName);
                    
                    // Try to find existing person by name (check personsByKey first)
                    // Match by name only since PPSR director reports typically don't have DOB
                    let foundPerson = null;
                    let existingPersonId = null;
                    
                    // Check if person already exists in personsByKey (match by name, with or without DOB)
                    for (const [key, person] of personsByKey.entries()) {
                        if (normalizeName(person.name) === normalizedDirectorName) {
                            foundPerson = person;
                            existingPersonId = person.id; // Use existing person's ID (may include DOB)
                            break;
                        }
                    }
                    
                    // If found, use existing person ID
                    if (existingPersonId) {
                        grantorEntityId = existingPersonId;
                    } else {
                        // If not found, create person ID using the same format as mergePersonEntities
                        // Format: person_${normalizeName(name)}_${normalizeDOB(dob)} or person_${normalizeName(name)} if no DOB
                        // No DOB available from PPSR director reports typically
                        const directorDOB = null;
                        const personKey = createPersonKey(directorName, directorDOB);
                        
                        // Create person ID using the same format as mergePersonEntities
                        const personId = `person_${normalizeName(directorName).replace(/\s+/g, '_')}`;
                        
                        // Create director entity with person ID format (will be merged later)
                        const directorEntity = {
                            id: personId, // Use person_ format to match merged entities
                            name: directorName,
                            dob: directorDOB,
                            address: null,
                            role: 'Director',
                            type: 'current_director',
                            companyIds: [],
                            roles: [{
                                type: 'director',
                                originalType: 'current_director',
                                companyIds: []
                            }]
                        };
                        
                        // Store in personsByKey for later merging
                        personsByKey.set(personKey, directorEntity);
                        
                        // Also store in directors map with a temporary director ID for backward compatibility
                        // But the actual ID used will be the person_ format
                        const tempDirectorId = `director_${normalizeName(directorName).replace(/\s+/g, '_')}_${normalizeDOB(directorDOB)}`;
                        if (!allEntities.directors.has(tempDirectorId)) {
                            allEntities.directors.set(tempDirectorId, {
                                ...directorEntity,
                                id: tempDirectorId // Keep temp ID in directors map
                            });
                        }
                        
                        grantorEntityId = personId; // Use person_ format ID for relationships
                    }
                } else {
                    // For company ppsr: grantor is a company
                    // Priority: Use report's ACN/ABN first (most reliable), then fallback to extracted grantor info
                    
                    // First, try to use the report's ACN/ABN (this is the company the PPSR report was run for)
                    if (ppsrReport.acn || ppsrReport.abn) {
                        grantorEntityId = findOrCreateCompany(
                            ppsrReport.searchWord || grantorName || 'Unknown Company',
                            ppsrReport.acn || null,
                            ppsrReport.abn || null,
                            'Unknown',
                            'ppsr',
                            ppsrReport.id,
                            ppsrReport.searchWord || grantorName
                        );
                    } else if (grantorACN || grantorName) {
                        // Fallback to extracted grantor information
                        grantorEntityId = findOrCreateCompany(
                            grantorName || 'Unknown Company',
                            grantorACN || null,
                            null, // ABN not available from grantor
                            'Unknown',
                            'ppsr',
                            ppsrReport.id,
                            grantorName
                        );
                    }
                }

                if (!grantorEntityId) continue; // Skip if we can't identify the grantor

                // Parse secured party summary to extract organization details
                // securedPartySummary format: "ACN 004044937 NATIONAL AUSTRALIA BANK LIMITED | ACN ..."
                // We'll use the first organization in the summary for the node
                const securedPartyParts = securedPartySummary.split('|').map(s => s.trim());
                const firstSecuredParty = securedPartyParts[0] || securedPartySummary;

                // Extract ACN and name from secured party string
                // Pattern: "ACN 004044937 NATIONAL AUSTRALIA BANK LIMITED" or "ABN 49984541896 The Trustee for..."
                let securedPartyACN = null;
                let securedPartyABN = null;
                let securedPartyName = firstSecuredParty;

                // Try to extract ACN
                const acnMatch = firstSecuredParty.match(/ACN\s+(\d+)/i);
                if (acnMatch) {
                    securedPartyACN = acnMatch[1];
                    securedPartyName = firstSecuredParty.replace(/ACN\s+\d+\s*/i, '').trim();
                }

                // Try to extract ABN
                const abnMatch = firstSecuredParty.match(/ABN\s+(\d+)/i);
                if (abnMatch) {
                    securedPartyABN = abnMatch[1];
                    securedPartyName = firstSecuredParty.replace(/ABN\s+\d+\s*/i, '').trim();
                }

                // Find or create secured party company node
                const securedPartyCompanyId = findOrCreateCompany(
                    securedPartyName || 'Unknown Secured Party',
                    securedPartyACN,
                    securedPartyABN,
                    'Unknown',
                    'ppsr-secured-party',
                    ppsrReport.id,
                    securedPartyName
                );

                // Map collateral type to display format
                let collateralTypeLabel = collateralClassType;
                if (collateralClassType === 'Motor Vehicle') {
                    collateralTypeLabel = 'MOTOR VEHICLE';
                } else if (collateralClassType === 'Other Goods') {
                    collateralTypeLabel = 'OTHER GOODS';
                } else if (collateralClassType === 'All Pap No Except') {
                    collateralTypeLabel = 'BLANKET SECURITY';
                } else if (collateralClassType === 'Account') {
                    collateralTypeLabel = 'ACCOUNT SECURITY';
                } else {
                    // Convert to uppercase and replace spaces with underscores if needed
                    collateralTypeLabel = collateralClassType.toUpperCase().replace(/\s+/g, ' ');
                }

                // Create relationship label: "6 x MOTOR VEHICLE"
                const relationshipLabel = `${count} x ${collateralTypeLabel}`;
                
                // Create unique key for this relationship to prevent duplicates
                // Key format: grantorEntityId|securedPartyCompanyId|collateralClassType
                // This allows multiple edges between the same entities for different collateral types
                const relationshipKey = `${grantorEntityId}|${securedPartyCompanyId}|${collateralClassType}`;

                if (!ppsrRelationshipKeys.has(relationshipKey)) {
                    ppsrRelationshipKeys.add(relationshipKey);
                    ppsrRelationships.push({
                        from: securedPartyCompanyId,  // Secured party (lender)
                        to: grantorEntityId,          // Grantor (company or director that granted security)
                        type: isDirectorPpsr ? 'ppsr_director' : 'ppsr_security',
                        label: relationshipLabel,
                        collateralType: collateralClassType,
                        count: count
                    });
                }
            }
        }

        // Process director-bankruptcy reports
        for (const bankruptcyReport of bankruptcyReports) {
            if (!bankruptcyReport || !bankruptcyReport.rdata) continue;

            const bankruptcyData = extractBankruptcyFromDirectorBankruptcyReport(bankruptcyReport);
            if (!bankruptcyData) continue;

            // Extract director name from searchWord (format: "FirstName LastName" or similar)
            const directorName = bankruptcyReport.searchWord || '';
            if (!directorName) continue;

            // Try to find existing director/person by name
            let directorEntityId = null;
            const normalizedDirectorName = normalizeName(directorName);

            // Check if person already exists in personsByKey
            for (const [personKey, person] of personsByKey.entries()) {
                if (normalizeName(person.name) === normalizedDirectorName) {
                    directorEntityId = person.id;
                    break;
                }
            }

            // If not found, check directors map
            if (!directorEntityId) {
                for (const [directorId, director] of allEntities.directors.entries()) {
                    if (normalizeName(director.name) === normalizedDirectorName) {
                        directorEntityId = directorId;
                        break;
                    }
                }
            }

            // If still not found, create a director person entity
            if (!directorEntityId) {
                const personKey = createPersonKey(directorName, null);
                const personId = `person_${normalizeName(directorName).replace(/\s+/g, '_')}`;
                
                const directorEntity = {
                    id: personId,
                    name: directorName,
                    dob: null,
                    address: null,
                    role: 'Director',
                    type: 'current_director',
                    companyIds: [],
                    roles: [{
                        type: 'director',
                        originalType: 'current_director',
                        companyIds: []
                    }]
                };
                
                personsByKey.set(personKey, directorEntity);
                const tempDirectorId = `director_${normalizeName(directorName).replace(/\s+/g, '_')}_${normalizeDOB(null)}`;
                if (!allEntities.directors.has(tempDirectorId)) {
                    allEntities.directors.set(tempDirectorId, {
                        ...directorEntity,
                        id: tempDirectorId
                    });
                }
                
                directorEntityId = personId;
            }

            // Create bankruptcy node
            const bankruptcyId = `bankruptcy_${directorEntityId}_${bankruptcyReport.id}`;
            
            if (!bankruptcyNodes.has(bankruptcyId)) {
                const bankruptcyNode = {
                    id: bankruptcyId,
                    name: bankruptcyData.hasBankruptcy ? 'Bankruptcy' : 'No Bankruptcy',
                    type: 'bankruptcy',
                    from: bankruptcyData.hasBankruptcy ? bankruptcyData.startDate : null,
                    hasBankruptcy: bankruptcyData.hasBankruptcy,
                    uuid: bankruptcyData.uuid,
                    reportId: bankruptcyReport.id,
                    searchWord: bankruptcyReport.searchWord
                };
                
                bankruptcyNodes.set(bankruptcyId, bankruptcyNode);
            }

            // Create edge from director to bankruptcy node with extractId
            const relationshipKey = `${directorEntityId}|${bankruptcyId}|bankruptcy`;
            
            if (!bankruptcyRelationshipKeys.has(relationshipKey)) {
                bankruptcyRelationshipKeys.add(relationshipKey);
                bankruptcyRelationships.push({
                    from: directorEntityId,
                    to: bankruptcyId,
                    type: 'bankruptcy',
                    label: bankruptcyData.hasBankruptcy ? 'Bankruptcy' : 'No Bankruptcy',
                    extractId: bankruptcyData.extractId || null
                });
            }
        }

        // Process court and ATO reports to match with entities
        const atoDataByEntity = new Map(); // key: entity identifier (acn/abn/name), value: ATO data
        const courtDataByEntity = new Map(); // key: entity identifier (acn/abn/name), value: array of court cases

        for (const report of courtAtoReports) {
            if (!report.rdata) continue;

            const rdata = report.rdata;
            const entity = rdata.entity || {};
            const entityName = entity.name || report.searchWord || '';
            const entityACN = entity.acn || report.acn || entity.ACN;
            const entityABN = entity.abn || report.abn || entity.ABN;

            // Determine if this is a court or ATO report
            const isCourtReport = report.rtype === 'court' || (report.reportName && report.reportName.toLowerCase().startsWith('court_'));
            const isAtoReport = report.rtype === 'ato' || (report.reportName && report.reportName.toLowerCase().startsWith('ato_'));

            if (isAtoReport) {
                // Extract ATO data
                const currentTaxDebt = rdata.current_tax_debt || {};
                const taxDebtAmount = currentTaxDebt.amount || 0;
                const taxDebtStatus = currentTaxDebt.status || 'Unknown';
                const taxDebtDate = currentTaxDebt.date || null;
                const atoUpdatedAt = currentTaxDebt.ato_updated_at || null;

                // Create entity key for matching (prefer ACN, then ABN, then name)
                const entityKey = entityACN || entityABN || normalizeName(entityName);
                
                if (entityKey) {
                    // Store ATO data (keep the highest amount if multiple reports)
                    if (!atoDataByEntity.has(entityKey)) {
                        atoDataByEntity.set(entityKey, {
                            amount: taxDebtAmount,
                            status: taxDebtStatus,
                            date: taxDebtDate,
                            ato_updated_at: atoUpdatedAt
                        });
                    } else {
                        const existing = atoDataByEntity.get(entityKey);
                        // Keep the highest amount
                        if (taxDebtAmount > existing.amount) {
                            atoDataByEntity.set(entityKey, {
                                amount: taxDebtAmount,
                                status: taxDebtStatus,
                                date: taxDebtDate,
                                ato_updated_at: atoUpdatedAt
                            });
                        }
                    }
                }
            }

            if (isCourtReport) {
                // Extract court case data
                const cases = rdata.cases || {};
                
                // Create entity key for matching
                const entityKey = entityACN || entityABN || normalizeName(entityName);
                
                if (entityKey && Object.keys(cases).length > 0) {
                    if (!courtDataByEntity.has(entityKey)) {
                        courtDataByEntity.set(entityKey, []);
                    }
                    
                    // Add all cases from this report
                    Object.values(cases).forEach(caseItem => {
                        if (caseItem && caseItem.uuid) {
                            courtDataByEntity.get(entityKey).push({
                                uuid: caseItem.uuid,
                                type: caseItem.type || 'Court Case',
                                case_number: caseItem.case_number,
                                case_name: caseItem.case_name,
                                case_type: caseItem.case_type,
                                court_name: caseItem.court_name,
                                state: caseItem.state,
                                notification_time: caseItem.notification_time,
                                url: caseItem.url,
                                party_role: caseItem.party_role,
                                match_on: caseItem.match_on
                            });
                        }
                    });
                }
            }
        }

        // Match ATO and court data with companies
        allEntities.companies.forEach((company, companyId) => {
            // Try to match by ACN first
            let matchedKey = null;
            if (company.acn) {
                matchedKey = company.acn;
                if (atoDataByEntity.has(matchedKey)) {
                    company.atoData = atoDataByEntity.get(matchedKey);
                }
                if (courtDataByEntity.has(matchedKey)) {
                    company.courtCases = courtDataByEntity.get(matchedKey);
                }
            }
            
            // Try to match by ABN if not found
            if (!matchedKey && company.abn) {
                matchedKey = company.abn;
                if (atoDataByEntity.has(matchedKey)) {
                    company.atoData = atoDataByEntity.get(matchedKey);
                }
                if (courtDataByEntity.has(matchedKey)) {
                    company.courtCases = courtDataByEntity.get(matchedKey);
                }
            }
            
            // Try to match by normalized name as fallback
            if (!matchedKey && company.name) {
                matchedKey = normalizeName(company.name);
                if (atoDataByEntity.has(matchedKey)) {
                    company.atoData = atoDataByEntity.get(matchedKey);
                }
                if (courtDataByEntity.has(matchedKey)) {
                    company.courtCases = courtDataByEntity.get(matchedKey);
                }
            }

            // Also try matching with ACN/ABN from parties in court cases
            if (company.courtCases && company.courtCases.length > 0) {
                // Already matched
            } else {
                // Try to find court cases where company appears as a party
                for (const [key, cases] of courtDataByEntity.entries()) {
                    // Check if key contains company's ACN or ABN
                    if (company.acn && key.includes(company.acn.replace(/\s/g, ''))) {
                        company.courtCases = cases;
                        break;
                    }
                    if (company.abn && key.includes(company.abn.replace(/\s/g, ''))) {
                        company.courtCases = cases;
                        break;
                    }
                }
            }
        });

        // Convert Maps to arrays
        const directorsArray = Array.from(allEntities.directors.values());
        const officeHoldersArray = Array.from(allEntities.officeHolders.values());
        const secretariesArray = Array.from(allEntities.secretaries.values());
        const shareholdersArray = Array.from(allEntities.shareholders.values());

        // Add PPSR director entities to directors array so they get merged with existing persons
        // PPSR director entities were created and stored in personsByKey, but need to be in directors array for merging
        personsByKey.forEach((person, personKey) => {
            // Check if this is a PPSR director entity (has person_ ID format and director role)
            if (person.id && person.id.startsWith('person_') && person.roles && person.roles.some(r => r.type === 'director')) {
                // Check if it's not already in directorsArray
                const alreadyInDirectors = directorsArray.some(d => d.id === person.id || 
                    (normalizeName(d.name) === normalizeName(person.name) && 
                     normalizeDOB(d.dob) === normalizeDOB(person.dob)));
                
                if (!alreadyInDirectors) {
                    // Add to directors array so it gets merged
                    directorsArray.push({
                        id: person.id,
                        name: person.name,
                        dob: person.dob,
                        address: person.address,
                        role: person.role || 'Director',
                        type: person.type || 'current_director',
                        companyIds: person.companyIds || []
                    });
                }
            }
        });

        // Merge persons with same name across different roles (including shareholders)
        const mergeResult = mergePersonEntities(directorsArray, officeHoldersArray, secretariesArray, shareholdersArray);

        // Create a map of person keys to final person IDs for address linking
        const personKeyToFinalId = new Map();
        // Also create a map from old entity IDs (director_..., secretary_..., etc.) to final person IDs
        const oldEntityIdToFinalPersonId = new Map();
        
        mergeResult.persons.forEach(person => {
            const personKey = createPersonKey(person.name, person.dob);
            personKeyToFinalId.set(personKey, person.id);
            // Also add name-only key for fallback matching
            const nameOnlyKey = normalizeName(person.name);
            if (!personKeyToFinalId.has(nameOnlyKey)) {
                personKeyToFinalId.set(nameOnlyKey, person.id);
            }
        });

        // Map all old entity IDs (directors, secretaries, office holders, shareholders) to final person IDs
        // by matching person keys
        [allEntities.directors, allEntities.secretaries, allEntities.officeHolders, allEntities.shareholders].forEach(entityMap => {
            entityMap.forEach((entity, oldId) => {
                if (entity && entity.name) {
                    const entityKey = createPersonKey(entity.name, entity.dob);
                    if (personKeyToFinalId.has(entityKey)) {
                        oldEntityIdToFinalPersonId.set(oldId, personKeyToFinalId.get(entityKey));
                    } else {
                        // Try name-only matching
                        const nameOnlyKey = normalizeName(entity.name);
                        if (personKeyToFinalId.has(nameOnlyKey)) {
                            oldEntityIdToFinalPersonId.set(oldId, personKeyToFinalId.get(nameOnlyKey));
                        }
                    }
                }
            });
        });

        // Final linking of addresses to entities after person merging
        allEntities.addresses.forEach((addr, addrId) => {
            // First, try to update existing linkedEntityId if it's an old entity ID
            if (addr.linkedEntityId && oldEntityIdToFinalPersonId.has(addr.linkedEntityId)) {
                addr.linkedEntityId = oldEntityIdToFinalPersonId.get(addr.linkedEntityId);
            } else if (!addr.linkedEntityId) {
                // Try to link by personKey first (most reliable)
                if (addr.personKey && personKeyToFinalId.has(addr.personKey)) {
                    addr.linkedEntityId = personKeyToFinalId.get(addr.personKey);
                } else if (addr.entityType === 'Person') {
                    // Try to match by old entity ID
                    if (oldEntityIdToFinalPersonId.has(addr.entityId)) {
                        addr.linkedEntityId = oldEntityIdToFinalPersonId.get(addr.entityId);
                    } else {
                        // Try to match by normalized name
                        const normalizedName = normalizeName(addr.entityName);
                        if (personKeyToFinalId.has(normalizedName)) {
                            addr.linkedEntityId = personKeyToFinalId.get(normalizedName);
                        } else {
                            // Try to find person by matching name in merged persons
                            for (const person of mergeResult.persons) {
                                if (normalizeName(person.name) === normalizedName) {
                                    addr.linkedEntityId = person.id;
                                    break;
                                }
                            }
                        }
                    }
                } else if (addr.entityType === 'Company') {
                    // Try to find company by ACN/ABN or name
                    for (const [id, company] of allEntities.companies.entries()) {
                        if (company.acn && addr.entityId.includes(company.acn.replace(/\s/g, ''))) {
                            addr.linkedEntityId = id;
                            break;
                        }
                        if (company.abn && addr.entityId.includes(company.abn.replace(/\s/g, ''))) {
                            addr.linkedEntityId = id;
                            break;
                        }
                        if (normalizeName(company.name) === normalizeName(addr.entityName)) {
                            addr.linkedEntityId = id;
                            break;
                        }
                    }
                }
            }
        });

        //console.log(allEntities.addresses.values());

        // Deduplicate addresses - merge addresses with the same normalized address string
        const addressKeyToAddress = new Map(); // key: normalized address, value: merged address object
        const addressKeyToEntityIds = new Map(); // key: normalized address, value: Set of entity IDs linked to this address
        
        allEntities.addresses.forEach((addr, addrId) => {
            if (!addr.linkedEntityId) return; // Skip unlinked addresses
            
            const addressKey = createAddressKey(addr);
            if (!addressKey) return; // Skip addresses without valid address string
            
            if (!addressKeyToAddress.has(addressKey)) {
                // First occurrence of this address - create merged address
                const mergedAddress = {
                    id: `address_${addressKey.replace(/\s+/g, '_').substring(0, 50)}`,
                    address: addr.address,
                    address1: addr.address1 || addr.address_1,
                    address2: addr.address2 || addr.address_2,
                    suburb: addr.suburb,
                    state: addr.state,
                    postcode: addr.postcode,
                    country: addr.country,
                    type: addr.type || 'Address',
                    status: addr.status || 'Current',
                    startDate: addr.startDate || addr.start_date,
                    endDate: addr.endDate || addr.end_date,
                    linkedEntityIds: new Set(), // Track all entities linked to this address
                    entityTypes: new Set(), // Track entity types (Company, Person)
                    caseUuids: new Set(), // Track court case UUIDs if any
                    partyRoles: new Set() // Track party roles if any
                };
                addressKeyToAddress.set(addressKey, mergedAddress);
                addressKeyToEntityIds.set(addressKey, new Set());
            }
            
            // Add this entity to the merged address
            const mergedAddress = addressKeyToAddress.get(addressKey);
            mergedAddress.linkedEntityIds.add(addr.linkedEntityId);
            addressKeyToEntityIds.get(addressKey).add(addr.linkedEntityId);
            
            // Merge metadata
            if (addr.entityType) {
                mergedAddress.entityTypes.add(addr.entityType);
            }
            if (addr.caseUuid) {
                mergedAddress.caseUuids.add(addr.caseUuid);
            }
            if (addr.partyRole) {
                mergedAddress.partyRoles.add(addr.partyRole);
            }
            
            // Update status if any address is current (prefer current over ceased)
            if (addr.status === 'Current' || !addr.endDate) {
                mergedAddress.status = 'Current';
            } else if (mergedAddress.status !== 'Current' && addr.status === 'Ceased') {
                mergedAddress.status = 'Ceased';
            }
            
            // Merge dates (use earliest start date, latest end date)
            if (addr.startDate || addr.start_date) {
                const startDate = addr.startDate || addr.start_date;
                if (!mergedAddress.startDate || startDate < mergedAddress.startDate) {
                    mergedAddress.startDate = startDate;
                }
            }
            if (addr.endDate || addr.end_date) {
                const endDate = addr.endDate || addr.end_date;
                if (!mergedAddress.endDate || endDate > mergedAddress.endDate) {
                    mergedAddress.endDate = endDate;
                }
            }
        });

        // Convert merged addresses to array and convert Sets to Arrays
        const mergedAddresses = Array.from(addressKeyToAddress.values()).map(addr => {
            return {
                ...addr,
                linkedEntityIds: Array.from(addr.linkedEntityIds),
                entityTypes: Array.from(addr.entityTypes),
                caseUuids: Array.from(addr.caseUuids),
                partyRoles: Array.from(addr.partyRoles)
            };
        });

        // Map bankruptcy relationship IDs to final merged person IDs
        // Bankruptcy relationships were created before person merging, so we need to update the director entity IDs
        bankruptcyRelationships.forEach(rel => {
            // Check if the 'from' field (director) is a person ID that needs to be mapped
            if (rel.type === 'bankruptcy' && rel.from) {
                // Check if it's already a final person ID
                const isFinalPersonId = mergeResult.persons.some(p => p.id === rel.from);
                if (isFinalPersonId) {
                    // Already using final person ID, no need to update
                    return;
                }
                
                // Find the person entity we created for this director
                let directorName = null;
                for (const [key, person] of personsByKey.entries()) {
                    if (person.id === rel.from) {
                        directorName = person.name;
                        break;
                    }
                }
                
                // If we found the director name, look up the final merged person ID
                if (directorName) {
                    const normalizedName = normalizeName(directorName);
                    // Try to find in merged persons by name
                    for (const person of mergeResult.persons) {
                        if (normalizeName(person.name) === normalizedName) {
                            // Found the merged person - update the relationship
                            rel.from = person.id;
                            break;
                        }
                    }
                } else {
                    // Try to extract name from the ID and match
                    // ID format: person_indra_budiman or person_indra_budiman_1978-05-23
                    const idWithoutPrefix = rel.from.replace(/^person_/, '');
                    const nameFromId = idWithoutPrefix.replace(/_\d{4}-\d{2}-\d{2}$/, '').replace(/_/g, ' ');
                    
                    if (nameFromId) {
                        const normalizedNameFromId = normalizeName(nameFromId);
                        for (const person of mergeResult.persons) {
                            if (normalizeName(person.name) === normalizedNameFromId) {
                                rel.from = person.id;
                                break;
                            }
                        }
                    }
                }
            }
        });

        // Map PPSR director relationship IDs to final merged person IDs
        // PPSR relationships were created before person merging, so we need to update the grantor entity IDs
        ppsrRelationships.forEach(rel => {
            // Check if the 'to' field (grantor) is a person ID that needs to be mapped
            // For director-ppsr, the grantor is a person
            if (rel.type === 'ppsr_director' && rel.to) {
                // Check if it's already a final person ID
                const isFinalPersonId = mergeResult.persons.some(p => p.id === rel.to);
                if (isFinalPersonId) {
                    // Already using final person ID, no need to update
                    return;
                }
                
                // Find the person entity we created for this PPSR director
                let directorName = null;
                for (const [key, person] of personsByKey.entries()) {
                    if (person.id === rel.to) {
                        directorName = person.name;
                        break;
                    }
                }
                
                // If we found the director name, look up the final merged person ID
                if (directorName) {
                    const normalizedName = normalizeName(directorName);
                    // Try to find in merged persons by name
                    for (const person of mergeResult.persons) {
                        if (normalizeName(person.name) === normalizedName) {
                            // Found the merged person - update the relationship
                            rel.to = person.id;
                            break;
                        }
                    }
                } else {
                    // Try to extract name from the ID and match
                    // ID format: person_indra_budiman or person_indra_budiman_1978-05-23
                    const idWithoutPrefix = rel.to.replace(/^person_/, '');
                    const nameFromId = idWithoutPrefix.replace(/_\d{4}-\d{2}-\d{2}$/, '').replace(/_/g, ' ');
                    
                    if (nameFromId) {
                        const normalizedNameFromId = normalizeName(nameFromId);
                        for (const person of mergeResult.persons) {
                            if (normalizeName(person.name) === normalizedNameFromId) {
                                rel.to = person.id;
                                break;
                            }
                        }
                    }
                }
            }
        });

        // Build final entities structure
        const finalEntities = {
            companies: Array.from(allEntities.companies.values()),
            persons: mergeResult.persons, // Merged directors, office holders, secretaries, and individual shareholders
            shareholders: mergeResult.remainingShareholders, // Only company shareholders remain separate
            addresses: mergedAddresses, // Deduplicated addresses
            bankruptcies: Array.from(bankruptcyNodes.values()), // Bankruptcy nodes
            // Keep original arrays for stats calculation
            directors: directorsArray,
            secretaries: secretariesArray,
            officeHolders: officeHoldersArray
        };

        // Build relationships (including address relationships, PPSR relationships, and bankruptcy relationships)
        const relationships = buildRelationships(finalEntities, companyShareholderRelationships, finalEntities.addresses, ppsrRelationships, bankruptcyRelationships);

        console.log(relationships);
        return {
            entities: {
                companies: finalEntities.companies,
                persons: finalEntities.persons,
                shareholders: finalEntities.shareholders,
                addresses: finalEntities.addresses,
                bankruptcies: finalEntities.bankruptcies,
                // Keep for backward compatibility and stats
                directors: finalEntities.directors,
                secretaries: finalEntities.secretaries,
                officeHolders: finalEntities.officeHolders
            },
            relationships: relationships,
            stats: {
                totalCompanies: finalEntities.companies.length,
                totalPersons: finalEntities.persons.length,
                totalDirectors: finalEntities.directors.length,
                totalShareholders: finalEntities.shareholders.length,
                totalSecretaries: finalEntities.secretaries.length,
                totalOfficeHolders: finalEntities.officeHolders.length,
                totalAddresses: finalEntities.addresses.length,
                totalRelationships: relationships.length
            }
        };

    } catch (error) {
        console.error('[Mind Map] Error building from database:', error);
        throw error;
    }
}

module.exports = {
    buildMindMapFromDatabase,
    extractCompanyFromReport,
    extractDirectorsFromReport,
    extractOfficeHoldersFromReport,
    extractShareholdersFromReport,
    extractSecretaryFromReport,
    buildRelationships
};
