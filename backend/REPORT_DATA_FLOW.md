# Report Data Flow Documentation

## Overview
This document explains how data is retrieved and processed for the four main report types:
1. `ato-report.html` - ATO Tax Debt Report
2. `court-report.html` - Court Action Data Report  
3. `asic-current-report.html` - ASIC Current Report
4. `asic-current-historical-report.html` - ASIC Historical Report

## Current Data Retrieval Flow

### 1. API Data Retrieval (`backend/services/apiCacheService.js`)

**Current Implementation:**
- **ATO, Court, and ASIC-Current reports** all currently use the **same API endpoint**: `fetchAsicCurrentData(abn)`
  - This is because they're grouped together in the condition: `if (type === 'asic-current' || type === 'court' || type === 'ato')`
  - They all return data from the ASIC Current API endpoint
  
- **ASIC Historical reports** use: `fetchAsicHistoricalData(abn)`
  - This calls a different API endpoint for historical data

- **PPSR reports** use: `fetchPpsrData(abn, acn)`
  - This calls the PPSR-specific API endpoint

### 2. Data Processing (`backend/services/pdf.service.js`)

**Current Implementation:**
The `replaceVariables()` function currently processes all reports assuming a similar data structure:
- Extracts common fields like `entity`, `abn`, `acn`, `companyName`
- Processes court-specific data like `cases`, `insolvencies`, `hearings`, `documents`
- Processes ATO-specific data like `current_tax_debt`

**Issue:** All report types are processed with the same logic, which may not work correctly when different report types receive different response structures.

## Implementation Status

### ✅ Completed Changes:
1. **Conditional Data Processing**: Updated `replaceVariables()` to handle different data structures based on `reportype`
2. **Type-Specific Data Extraction**: Created separate extraction functions for each report type:
   - `extractAtoData(data)` - Extracts ATO-specific fields (entity + current_tax_debt)
   - `extractCourtData(data)` - Extracts court-specific fields (entity + cases + insolvencies + hearings + documents)
   - `extractAsicCurrentData(data)` - Extracts ASIC current-specific fields (placeholder - needs actual API response structure)
   - `extractAsicHistoricalData(data)` - Extracts ASIC historical-specific fields (placeholder - needs actual API response structure)

### How It Works Now:

1. **Report Type Detection**: The `replaceVariables(htmlContent, data, reportype)` function now checks the `reportype` parameter
2. **Conditional Processing**: Based on `reportype`, it calls the appropriate extraction function:
   - `reportype === 'ato'` → calls `extractAtoData(data)`
   - `reportype === 'court'` → calls `extractCourtData(data)`
   - `reportype === 'asic-current'` → calls `extractAsicCurrentData(data)`
   - `reportype === 'asic-historical'` → calls `extractAsicHistoricalData(data)`
3. **Data Extraction**: Each extraction function returns a standardized object with all possible template variables
4. **Template Replacement**: All variables are replaced in the HTML template regardless of report type (unused variables get 'N/A' or empty strings)

## Report Type Mapping

| Report Type | Template File | Current API Endpoint | Data Extracted |
|------------|---------------|---------------------|----------------|
| `ato` | `ato-report.html` | `fetchAsicCurrentData()` | `entity` + `current_tax_debt` |
| `court` | `court-report.html` | `fetchAsicCurrentData()` | `entity` + `cases` + `insolvencies` + `hearings` + `documents` |
| `asic-current` | `asic-current-report.html` | `fetchAsicCurrentData()` | `entity` + ASIC company data (to be updated based on actual response) |
| `asic-historical` | `asic-current-historical-report.html` | `fetchAsicHistoricalData()` | Historical ASIC data (to be updated based on actual response) |

## Next Steps

1. **Update ASIC Data Extraction Functions**: When you receive sample API responses for `asic-current` and `asic-historical` reports, update the `extractAsicCurrentData()` and `extractAsicHistoricalData()` functions to extract the actual fields from those responses.

2. **Test Each Report Type**: Generate each report type to ensure data is being extracted correctly from the API responses.

3. **Update API Routing** (if needed): If different report types need different API endpoints, update `apiCacheService.js` accordingly.

