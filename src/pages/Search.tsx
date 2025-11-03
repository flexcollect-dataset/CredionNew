import React, { useState, useMemo, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { apiService } from '../services/api';

type CategoryType = 'ORGANISATION' | 'INDIVIDUAL' | 'LAND TITLE';
type SearchType = 'SELECT ALL' | 'ASIC' | 'COURT' | 'ATO' | 'ABN/ACN PPSR' | 'ADD DOCUMENT SEARCH' | 'BANKRUPTCY' | 'LAND TITLE';
type AsicType = 'SELECT ALL' | 'CURRENT' | 'CURRENT/HISTORICAL' | 'COMPANY';
type AdditionalSearchType = 'SELECT ALL' | 'ABN/ACN PPSR' | 'ABN/ACN PROPERTY TITLE' | 'DIRECTOR RELATED ENTITIES' | 'DIRECTOR PROPERTY TITLE' | 'DIRECTOR PPSR' | 'DIRECTOR BANKRUPTCY' | 'ABN/ACN COURT FILES' | 'ASIC-CURRENT';

interface SearchPrices {
  [key: string]: number;
}

interface ABNSuggestion {
  Abn?: string;
  Name?: string;
  AbnStatus?: string;
  Score?: number;
}

interface AdditionalSearchOption {
  name: AdditionalSearchType;
  available?: number;
  price: number;
}

const Search: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<CategoryType>('ORGANISATION');
  const [selectedSearches, setSelectedSearches] = useState<Set<SearchType>>(new Set());
  const [selectedAsicTypes, setSelectedAsicTypes] = useState<Set<AsicType>>(new Set());
  const [organisationSearchTerm, setOrganisationSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState<ABNSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimeoutRef = useRef<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hasSelectedRef = useRef(false); // Track if user selected from dropdown
  const [hasSelectedCompany, setHasSelectedCompany] = useState(false);
  const [selectedAdditionalSearches, setSelectedAdditionalSearches] = useState<Set<AdditionalSearchType>>(new Set());
  const [companyDetails, setCompanyDetails] = useState({ directors: 0, pastDirectors: 0, shareholders: 0 });
  const [isProcessingReports, setIsProcessingReports] = useState(false);
  // Individual search details
  const [individualFirstName, setIndividualFirstName] = useState('');
  const [individualLastName, setIndividualLastName] = useState('');
  const [individualDateOfBirth, setIndividualDateOfBirth] = useState('');
  
  // Data availability
  const [dataAvailable, setDataAvailable] = useState<boolean | null>(null);
  const [checkingData, setCheckingData] = useState(false);
  
  // Stepper state and refs
  const [activeStep, setActiveStep] = useState(0);
  const categoryCardRef = useRef<HTMLDivElement>(null);
  const searchesCardRef = useRef<HTMLDivElement>(null);
  const detailsCardRef = useRef<HTMLDivElement>(null);
  const additionalCardRef = useRef<HTMLDivElement>(null);

  // download report
  const [proccessReportStatus, setProccessReportStatus] = useState(false);
  const [totalDownloadReport, setTotalDownloadReports] = useState(0);

  const categories: CategoryType[] = ['ORGANISATION', 'INDIVIDUAL', 'LAND TITLE'];
  const asicTypes: AsicType[] = ['SELECT ALL', 'CURRENT', 'CURRENT/HISTORICAL', 'COMPANY'];
  
  const asicTypePrices: Record<string, number> = {
    'CURRENT': 25.00,
    'CURRENT/HISTORICAL': 40.00,
    'COMPANY': 30.00
  };
  
  // Base prices for additional searches (per director for director-related searches)
  const additionalSearchBasePrices: Record<string, number> = {
    'ABN/ACN PPSR': 50,
    'ABN/ACN PROPERTY TITLE': 100,
    'DIRECTOR RELATED ENTITIES': 75,
    'DIRECTOR PROPERTY TITLE': 80,
    'DIRECTOR PPSR': 50,
    'DIRECTOR BANKRUPTCY': 90,
    'ABN/ACN COURT FILES': 60,
    'ASIC-CURRENT': 25
  };
  
  // Dynamic additional search options based on number of directors and selected main searches
  const additionalSearchOptions: AdditionalSearchOption[] = useMemo(() => {
    const directorCount = companyDetails.directors || 0;
    
    // Check if ABN/ACN PPSR, ASIC, or COURT is selected in main searches
    const isAbnPpsrSelected = selectedSearches.has('ABN/ACN PPSR');
    const isAsicSelected = selectedSearches.has('ASIC');
    const isCourtSelected = selectedSearches.has('COURT');
    
    const allOptions: AdditionalSearchOption[] = [
      { name: 'SELECT ALL', price: 0 },
      { name: 'ABN/ACN PPSR', price: additionalSearchBasePrices['ABN/ACN PPSR'] },
      { name: 'ABN/ACN PROPERTY TITLE', price: additionalSearchBasePrices['ABN/ACN PROPERTY TITLE'] },
      { 
        name: 'DIRECTOR RELATED ENTITIES', 
        available: directorCount, 
        price: additionalSearchBasePrices['DIRECTOR RELATED ENTITIES'] * directorCount
      },
      { 
        name: 'DIRECTOR PROPERTY TITLE', 
        available: directorCount,
        price: additionalSearchBasePrices['DIRECTOR PROPERTY TITLE'] * directorCount
      },
      { 
        name: 'DIRECTOR PPSR', 
        available: directorCount,
        price: additionalSearchBasePrices['DIRECTOR PPSR'] * directorCount
      },
      { 
        name: 'DIRECTOR BANKRUPTCY', 
        available: directorCount,
        price: additionalSearchBasePrices['DIRECTOR BANKRUPTCY'] * directorCount
      },
      { name: 'ABN/ACN COURT FILES', available: 1, price: additionalSearchBasePrices['ABN/ACN COURT FILES'] },
      { name: 'ASIC-CURRENT', price: additionalSearchBasePrices['ASIC-CURRENT'] }
    ];
    
    // Filter out options based on selected main searches
    return allOptions.filter(option => {
      if (option.name === 'SELECT ALL') return true; // Always keep SELECT ALL
      if (isAbnPpsrSelected && option.name === 'ABN/ACN PPSR') return false;
      if (isAsicSelected && option.name === 'ASIC-CURRENT') return false;
      if (isCourtSelected && option.name === 'ABN/ACN COURT FILES') return false;
      return true;
    });
  }, [companyDetails.directors, selectedSearches]);
  
  // Dynamic searches based on category - CHANGES PER CATEGORY!
  const categorySearches: Record<CategoryType, SearchType[]> = {
    'ORGANISATION': ['SELECT ALL', 'ASIC', 'COURT', 'ATO', 'ABN/ACN PPSR', 'ADD DOCUMENT SEARCH'],
    'INDIVIDUAL': ['SELECT ALL', 'ASIC', 'BANKRUPTCY', 'COURT', 'LAND TITLE'],
    'LAND TITLE': [] // No options for Land Title as of now
  };
  
  const searches = useMemo(() => categorySearches[selectedCategory], [selectedCategory]);
  
  // Check if all searches are selected (excluding SELECT ALL)
  const allSearchesSelected = useMemo(() => {
    const individualSearches = searches.filter(s => s !== 'SELECT ALL');
    return individualSearches.length > 0 && individualSearches.every(s => selectedSearches.has(s));
  }, [searches, selectedSearches]);

  // Check if all ASIC types are selected (excluding SELECT ALL)
  const allAsicTypesSelected = useMemo(() => {
    const individualTypes = asicTypes.filter(t => t !== 'SELECT ALL');
    return individualTypes.length > 0 && individualTypes.every(t => selectedAsicTypes.has(t));
  }, [selectedAsicTypes]);

  // Check if all additional searches are selected (excluding SELECT ALL)
  const allAdditionalSearchesSelected = useMemo(() => {
    const individualSearches = additionalSearchOptions.filter(o => o.name !== 'SELECT ALL');
    return individualSearches.length > 0 && individualSearches.every(o => selectedAdditionalSearches.has(o.name));
  }, [selectedAdditionalSearches]);

  // Show "Enter Search Details" when ORGANISATION is selected (show by default)
  const showEnterSearchDetails = useMemo(() => {
    return selectedCategory === 'ORGANISATION';
  }, [selectedCategory]);
  
  const searchPrices: SearchPrices = {
    'ASIC': 50.00,
    'COURT': 60.00,
    'ATO': 55.00,
    'ABN/ACN PPSR': 50.00,
    'ADD DOCUMENT SEARCH': 35.00,
    'BANKRUPTCY': 90.00,
    'LAND TITLE': 80.00
  };

  const handleSearchToggle = (search: SearchType) => {
    const newSelected = new Set(selectedSearches);
    
    if (search === 'SELECT ALL') {
      if (selectedSearches.has('SELECT ALL')) {
        newSelected.clear();
        // If SELECT ALL is being deselected and ASIC was selected, clear ASIC types
        if (selectedSearches.has('ASIC')) {
          setSelectedAsicTypes(new Set());
        }
          } else {
        searches.forEach(s => newSelected.add(s));
          }
        } else {
      if (newSelected.has(search)) {
        newSelected.delete(search);
        newSelected.delete('SELECT ALL');
        
        // If ASIC is being deselected, clear all ASIC types
        if (search === 'ASIC') {
          setSelectedAsicTypes(new Set());
        }
    } else {
        newSelected.add(search);
        const allSelected = searches.filter(s => s !== 'SELECT ALL').every(s => newSelected.has(s) || s === search);
    if (allSelected) {
          newSelected.add('SELECT ALL');
        }
      }
    }
    
    setSelectedSearches(newSelected);
  };

  const calculateTotal = (): number => {
    let total = 0;

      // Add main searches
    selectedSearches.forEach(search => {
      if (search !== 'SELECT ALL' && search in searchPrices) {
        total += searchPrices[search];
      }
    });
    
    // Add ASIC type prices
        selectedAsicTypes.forEach(type => {
      if (type !== 'SELECT ALL' && type in asicTypePrices) {
        total += asicTypePrices[type];
      }
    });

      // Add additional searches
    selectedAdditionalSearches.forEach(search => {
      if (search !== 'SELECT ALL') {
        const option = additionalSearchOptions.find(o => o.name === search);
        if (option && option.price) {
          total += option.price;
        }
      }
    });
    
    return total;
  };

  // Debounced search for ABN/Company suggestions
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Don't search if user just selected from dropdown
    if (hasSelectedRef.current) {
      hasSelectedRef.current = false;
      return;
    }

    if (organisationSearchTerm.trim().length >= 2) {
      setIsLoadingSuggestions(true);
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const response = await apiService.searchABNByName(organisationSearchTerm);
          if (response.success && response.results) {
            setSuggestions(response.results);
            setShowSuggestions(true);
        }
      } catch (error) {
          console.error('Error fetching ABN suggestions:', error);
          setSuggestions([]);
      } finally {
          setIsLoadingSuggestions(false);
      }
      }, 500);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }

    return () => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    };
  }, [organisationSearchTerm]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // Update stepper based on scroll position
  useEffect(() => {
    const updateStepperProgress = () => {
      const viewportTrigger = window.innerHeight * 0.35;
      
      // Check which sections are visible
      const sections = [
        categoryCardRef.current,
        searchesCardRef.current,
        detailsCardRef.current,
        additionalCardRef.current
      ];
      
      let newActiveStep = 0;
      
      sections.forEach((section, index) => {
        if (section && section.offsetParent !== null) {
          const rect = section.getBoundingClientRect();
          if (rect.top <= viewportTrigger && rect.bottom > 0) {
            newActiveStep = index;
          }
        }
      });
      
      setActiveStep(newActiveStep);
    };
    
    // Update on scroll and resize
    window.addEventListener('scroll', updateStepperProgress);
    window.addEventListener('resize', updateStepperProgress);
    
    // Initial update
    updateStepperProgress();
    
    return () => {
      window.removeEventListener('scroll', updateStepperProgress);
      window.removeEventListener('resize', updateStepperProgress);
    };
  }, [hasSelectedCompany, selectedSearches, selectedCategory]);

  // Clean up selectedAdditionalSearches when options are filtered out
  useEffect(() => {
    const isAbnPpsrSelected = selectedSearches.has('ABN/ACN PPSR');
    const isAsicSelected = selectedSearches.has('ASIC');
    const isCourtSelected = selectedSearches.has('COURT');
    
    const filteredOptions = new Set(additionalSearchOptions.map(opt => opt.name));
    const newSelected = new Set(selectedAdditionalSearches);
    let hasChanges = false;
    
    // Remove selections that are no longer available
    selectedAdditionalSearches.forEach(selected => {
      if (!filteredOptions.has(selected)) {
        newSelected.delete(selected);
        hasChanges = true;
      }
    });
    
    // Also remove ABN/ACN PPSR if it's selected in main searches
    if (isAbnPpsrSelected && newSelected.has('ABN/ACN PPSR')) {
      newSelected.delete('ABN/ACN PPSR');
      newSelected.delete('SELECT ALL'); // Remove SELECT ALL if any item is removed
      hasChanges = true;
    }
    
    // Also remove ASIC-CURRENT if ASIC is selected in main searches
    if (isAsicSelected && newSelected.has('ASIC-CURRENT')) {
      newSelected.delete('ASIC-CURRENT');
      newSelected.delete('SELECT ALL'); // Remove SELECT ALL if any item is removed
      hasChanges = true;
    }
    
    // Also remove ABN/ACN COURT FILES if COURT is selected in main searches
    if (isCourtSelected && newSelected.has('ABN/ACN COURT FILES')) {
      newSelected.delete('ABN/ACN COURT FILES');
      newSelected.delete('SELECT ALL'); // Remove SELECT ALL if any item is removed
      hasChanges = true;
    }
    
    if (hasChanges) {
      setSelectedAdditionalSearches(newSelected);
    }
  }, [selectedSearches, additionalSearchOptions]);

  const handleSuggestionSelect = async (suggestion: ABNSuggestion) => {
    hasSelectedRef.current = true; // Mark as selected to prevent re-searching
    const displayText = suggestion.Name 
      ? `${suggestion.Name} ABN: ${suggestion.Abn}` 
      : `ABN: ${suggestion.Abn}`;
    setOrganisationSearchTerm(displayText);
    setShowSuggestions(false);
    setSuggestions([]);
    setHasSelectedCompany(true); // Show additional searches section
    
    // Check data availability and extract company details
    if (suggestion.Abn) {
      setCheckingData(true);
      setDataAvailable(null);
      try {
        const result = await apiService.checkDataAvailability(suggestion.Abn, 'asic-current');
        setDataAvailable(result.available);
        
        // Extract company details from rdata if available
        if (result.available && result.data?.rdata) {
          const rdata = result.data.rdata;
          const asicExtract = rdata.asic_extracts?.[0];
          
          if (asicExtract) {
            const currentDirectors = asicExtract.directors?.filter((d: any) => d.status === 'Current').length || 0;
            const pastDirectors = asicExtract.directors?.filter((d: any) => d.status !== 'Current').length || 0;
            const shareholders = asicExtract.shareholders?.length || 0;
            
            setCompanyDetails({
              directors: currentDirectors,
              pastDirectors: pastDirectors,
              shareholders: shareholders
            });
          }
          } else {
          // Reset to 0 if no data available
          setCompanyDetails({ directors: 0, pastDirectors: 0, shareholders: 0 });
        }
      } catch (error) {
        console.error('Error checking data:', error);
        setDataAvailable(null);
        setCompanyDetails({ directors: 0, pastDirectors: 0, shareholders: 0 });
      } finally {
        setCheckingData(false);
      }
    }
  };

  // Clear selections when category changes
  const handleCategoryChange = (category: CategoryType) => {
    setSelectedCategory(category);
    setSelectedSearches(new Set());
    setSelectedAsicTypes(new Set());
    setOrganisationSearchTerm('');
    setSuggestions([]);
    setShowSuggestions(false);
    hasSelectedRef.current = false;
    setHasSelectedCompany(false);
    setSelectedAdditionalSearches(new Set());
    setDataAvailable(null);
    setCheckingData(false);
    setCompanyDetails({ directors: 0, pastDirectors: 0, shareholders: 0 });
    
    // Clear individual details
    setIndividualFirstName('');
    setIndividualLastName('');
    setIndividualDateOfBirth('');
  };

  const handleAsicTypeToggle = (asicType: AsicType) => {
    const newSelected = new Set(selectedAsicTypes);
    
    if (asicType === 'SELECT ALL') {
      if (selectedAsicTypes.has('SELECT ALL')) {
        newSelected.clear();
          } else {
        asicTypes.forEach(t => newSelected.add(t));
          }
          } else {
      if (newSelected.has(asicType)) {
        newSelected.delete(asicType);
        newSelected.delete('SELECT ALL');
        } else {
        newSelected.add(asicType);
        const allIndividualSelected = asicTypes.filter(t => t !== 'SELECT ALL').every(t => newSelected.has(t) || t === asicType);
        if (allIndividualSelected) {
          newSelected.add('SELECT ALL');
        }
      }
    }
    setSelectedAsicTypes(newSelected);
  };

  const handleAdditionalSearchToggle = (searchName: AdditionalSearchType) => {
    const newSelected = new Set(selectedAdditionalSearches);
    
    if (searchName === 'SELECT ALL') {
      if (selectedAdditionalSearches.has('SELECT ALL')) {
        newSelected.clear();
          } else {
        additionalSearchOptions.forEach(option => newSelected.add(option.name));
      }
          } else {
      if (newSelected.has(searchName)) {
        newSelected.delete(searchName);
        newSelected.delete('SELECT ALL');
        } else {
        newSelected.add(searchName);
        const allIndividualSelected = additionalSearchOptions
          .filter(o => o.name !== 'SELECT ALL')
          .every(o => newSelected.has(o.name) || o.name === searchName);
        if (allIndividualSelected) {
          newSelected.add('SELECT ALL');
        }
      }
    }
    setSelectedAdditionalSearches(newSelected);
  };

  const addDownloadReportInDB = async (payload: any) => {
    const response = await apiService.addReportDownloadInPdf(payload);
    console.log("response", response);
  }

  const handleReportsDownload = async () => {

  }
  // Process reports handler
  const handleProcessReports = async () => {
    // Validation checks
    if (selectedCategory === 'ORGANISATION' && !hasSelectedCompany) {
      alert('Please select an organization first');
      return;
    }

    // Check if at least one search is selected
    const hasMainSearches = Array.from(selectedSearches).some(s => s !== 'SELECT ALL');
    const hasAdditionalSearches = Array.from(selectedAdditionalSearches).some(s => s !== 'SELECT ALL');
    const hasAsicTypes = Array.from(selectedAsicTypes).some(t => t !== 'SELECT ALL');
    
    if (!hasMainSearches && !hasAdditionalSearches && !hasAsicTypes) {
      alert('Please select at least one search option');
      return;
    }

    console.log('Processing reports...');
    setIsProcessingReports(true);
    
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (!user.userId) {
        alert('Please log in to continue');
        return;
      }

      // Get ABN and Name from the selected organization
      let abn = '';
      let companyName = '';
      
      if (selectedCategory === 'ORGANISATION' && organisationSearchTerm) {
        // Extract ABN from the format: "Company Name ABN: X" or "ABN: X"
        const abnMatch = organisationSearchTerm.match(/ABN:\s*(\d+)/i);
        if (abnMatch) {
          abn = abnMatch[1];
          companyName = organisationSearchTerm.replace(/\s*ABN:.*$/i, '').trim();
        } else {
          alert('Unable to extract ABN from selected organization');
          return;
        }
      }

      // Collect all reports to create
      const reportsToCreate: Array<{ type: string; name: string }> = [];

      // Add main searches
      Array.from(selectedSearches)
        .filter(search => search !== 'SELECT ALL')
        .forEach(search => {
          if (search === 'ASIC') {
            // Don't add generic ASIC if specific types are selected
            if (hasAsicTypes) {
              return;
            }
          }
          reportsToCreate.push({ type: search, name: search });
        });

      // Add ASIC types if selected
      if (selectedCategory === 'ORGANISATION' && selectedSearches.has('ASIC')) {
        Array.from(selectedAsicTypes)
          .filter(type => type !== 'SELECT ALL')
          .forEach(type => {
            reportsToCreate.push({ type: `ASIC: ${type}`, name: `ASIC ${type}` });
          });
      }

      // Add additional searches
      Array.from(selectedAdditionalSearches)
        .filter(search => search !== 'SELECT ALL')
        .forEach(search => {
          reportsToCreate.push({ type: search, name: search });
        });

      console.log('Reports to create:', reportsToCreate);

      // Process each report
      const createdReports = [];
      let company_type = 'N/A';
      for (const reportItem of reportsToCreate) {
        console.log('Processing report:', reportItem);
        company_type = reportItem.type
        
        // Map report display name to API type
        let reportType = '';
        if (reportItem.type.startsWith('ASIC:')) {
          const asicType = reportItem.type.split(':')[1].trim();
          if (asicType === 'CURRENT') {
            reportType = 'asic-current';
          } else if (asicType === 'CURRENT/HISTORICAL') {
            reportType = 'asic-historical';
          } else if (asicType === 'COMPANY') {
            reportType = 'asic-company';
          } else {
            reportType = 'asic-current'; // Default fallback
          }
        } else if (reportItem.type === 'COURT') {
          reportType = 'court';
        } else if (reportItem.type === 'ATO') {
          reportType = 'ato';
        } else if (reportItem.type === 'BANKRUPTCY') {
          reportType = 'bankruptcy';
        } else if (reportItem.type === 'LAND TITLE') {
          reportType = 'land';
        } else if (reportItem.type === 'ABN/ACN PPSR') {
          reportType = 'ppsr';
        } else if (reportItem.type === 'ABN/ACN PROPERTY TITLE') {
          reportType = 'property';
        } else if (reportItem.type === 'ABN/ACN COURT FILES') {
          reportType = 'court';
        } else if (reportItem.type === 'ASIC-CURRENT') {
          reportType = 'asic-current';
        } else if (reportItem.type.includes('DIRECTOR')) {
          if (reportItem.type.includes('PPSR')) {
            reportType = 'director-ppsr';
          } else if (reportItem.type.includes('BANKRUPTCY')) {
            reportType = 'director-bankruptcy';
          } else if (reportItem.type.includes('PROPERTY')) {
            reportType = 'director-property';
          } else {
            reportType = 'director-related';
          }
        } else if (reportItem.type === 'ADD DOCUMENT SEARCH') {
          reportType = 'asic-document-search';
        } else if ( reportItem.type === 'ASIC-CURRENT' ) {
          reportType = 'asic-current';
        } else {
          // Default fallback
          reportType = reportItem.type.toLowerCase().replace(/\s+/g, '-');
        }

        // Create report data
        const reportData = {
          business: {
            Abn: abn,
            Name: companyName || 'Unknown',
            isCompany: selectedCategory
          },
          type: reportType,
          userId: localStorage.getItem("user") ? JSON.parse(localStorage.getItem("user") || '{}').userId : null,
          matterId: localStorage.getItem('currentMatter') ? JSON.parse(localStorage.getItem('currentMatter') || '{}').matterId : null,
		  ispdfcreate: true
        };

        console.log('Creating report with data:', reportData);

        // Call backend to create report
        const reportResponse = await apiService.createReport(reportData);
        console.log('Report created:', reportResponse);
        
        createdReports.push({
          reportResponse
        });
      }

      // console.log('All reports created:', createdReports);
      setProccessReportStatus(true);
      setTotalDownloadReports(createdReports.length);
	  //console.log(createdReports.);
      // if(createdReports && createdReports.length > 0 && createdReports[0]?.response?.report?.existingReport){
      //   const reportId = createdReports[0]?.response?.report?.existingReport?.id
      //   const userId = localStorage.getItem("user") ? JSON.parse(localStorage.getItem("user") || '{}').userId : null;
      //   const matterId = localStorage.getItem('currentMatter') ? JSON.parse(localStorage.getItem('currentMatter') || '{}').matterId : null;
      //   await addDownloadReportInDB({
      //     ...createdReports[0]?.response?.report?.existingReport, company_type: company_type,
      //     userId: userId || null,
      //     matterId: matterId || null,
      //     reportId: reportId || null,
      //     reportName: `${uuidv4()}`,
      //     reportype: createdReports[0].type

      //   })
      // }
      // alert(`${createdReports.length} report(s) created successfully!`);
      
    } catch (error: any) {
      console.error('Error processing reports:', error);
      alert(`Error processing reports: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsProcessingReports(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-[1350px] mx-auto py-16 px-8 pr-[370px]">
        <div className="flex gap-12">
          {/* Left Sidebar - Vertical Stepper */}
          <div className="w-[200px] flex-shrink-0 sticky top-32 self-start">
            <div className="relative flex flex-col gap-9 pl-8 pr-4 py-3">
              {/* Progress Line Background */}
              <div className="absolute left-[14px] top-3 bottom-3 w-1 bg-gray-200 rounded-full"></div>
              
              {/* Progress Line Fill */}
              <div 
                className="absolute left-[14px] top-3 w-1 bg-gradient-to-b from-red-600 to-red-700 rounded-full transition-all duration-300"
                style={{ height: `${(activeStep / 3) * 100}%` }}
              ></div>

              {/* Step 1 */}
              <div className={`relative flex items-center gap-3 cursor-pointer ${activeStep === 0 ? '' : 'opacity-50'}`}>
                <div className={`w-[34px] h-[34px] rounded-full border-2 flex items-center justify-center font-bold shadow-md z-10 ${
                  activeStep === 0 
                    ? 'border-red-600 bg-gradient-to-br from-red-600 to-red-700 text-white shadow-lg shadow-red-600/35' 
                    : 'border-gray-300 bg-white text-gray-400'
                }`}>
                  1
          </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">STEP 1</span>
                  <span className={`text-sm font-semibold ${activeStep === 0 ? 'text-red-600' : 'text-gray-600'}`}>Select Category</span>
        </div>
            </div>

              {/* Step 2 */}
              <div className={`relative flex items-center gap-3 cursor-pointer ${activeStep === 1 ? '' : 'opacity-50'}`}>
                <div className={`w-[34px] h-[34px] rounded-full border-2 flex items-center justify-center font-bold shadow-md z-10 ${
                  activeStep === 1 
                    ? 'border-red-600 bg-gradient-to-br from-red-600 to-red-700 text-white shadow-lg shadow-red-600/35' 
                    : 'border-gray-300 bg-white text-gray-400'
                }`}>
                  2
            </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">STEP 2</span>
                  <span className={`text-sm font-semibold ${activeStep === 1 ? 'text-red-600' : 'text-gray-600'}`}>Select Searches</span>
          </div>
        </div>

              {/* Step 3 */}
              <div className={`relative flex items-center gap-3 cursor-pointer ${activeStep === 2 ? '' : 'opacity-50'}`}>
                <div className={`w-[34px] h-[34px] rounded-full border-2 flex items-center justify-center font-bold shadow-md z-10 ${
                  activeStep === 2 
                    ? 'border-red-600 bg-gradient-to-br from-red-600 to-red-700 text-white shadow-lg shadow-red-600/35' 
                    : 'border-gray-300 bg-white text-gray-400'
                }`}>
                  3
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">STEP 3</span>
                  <span className={`text-sm font-semibold ${activeStep === 2 ? 'text-red-600' : 'text-gray-600'}`}>Enter Details</span>
                </div>
                </div>

              {/* Step 4 */}
              <div className={`relative flex items-center gap-3 cursor-pointer ${activeStep === 3 ? '' : 'opacity-50'}`}>
                <div className={`w-[34px] h-[34px] rounded-full border-2 flex items-center justify-center font-bold shadow-md z-10 ${
                  activeStep === 3 
                    ? 'border-red-600 bg-gradient-to-br from-red-600 to-red-700 text-white shadow-lg shadow-red-600/35' 
                    : 'border-gray-300 bg-white text-gray-400'
                }`}>
                  4
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">STEP 4</span>
                  <span className={`text-sm font-semibold ${activeStep === 3 ? 'text-red-600' : 'text-gray-600'}`}>Additional Searches</span>
                </div>
              </div>
            </div>
                  </div>

          {/* Main Content */}
          <div className="flex-1">
            {/* Select Category Card */}
            <div ref={categoryCardRef} className="bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
              <h2 className="text-[32px] font-bold text-center mb-10 text-gray-900 tracking-tight">
                Select <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20">Category</span>
              </h2>

              <div className="flex justify-center gap-4 flex-wrap">
                {categories.map((category) => (
                  <label key={category} className="cursor-pointer">
                    <input
                      type="radio"
                      name="category"
                      value={category}
                      checked={selectedCategory === category}
                      onChange={(e) => handleCategoryChange(e.target.value as CategoryType)}
                      className="sr-only"
                    />
                    <div className={`
                      px-8 py-4 rounded-xl font-semibold text-sm uppercase tracking-wider
                      transition-all duration-300 shadow-md
                      ${selectedCategory === category
                        ? 'bg-red-600 text-white border-2 border-red-600 shadow-lg shadow-red-600/30 -translate-y-0.5'
                        : 'bg-gray-50 text-gray-600 border-2 border-gray-200 hover:border-red-600 hover:-translate-y-0.5 hover:shadow-lg'
                      }
                    `}>
                      {category}
                  </div>
                  </label>
                      ))}
                                  </div>
            </div>

            {/* Select Searches Card - Only show if searches are available */}
            {searches.length > 0 && (
            <div ref={searchesCardRef} className="bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
              <h2 className="text-[32px] font-bold text-center mb-10 text-gray-900 tracking-tight">
                Select <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20">Searches</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {searches.map((search) => {
                  const isSelected = selectedSearches.has(search);
                  const isSelectAll = search === 'SELECT ALL';
                  
                  return (
                  <button
                      key={search}
                      onClick={() => handleSearchToggle(search)}
                      className={`
                        px-6 py-5 rounded-xl font-semibold text-[13px] uppercase tracking-wide
                        transition-all duration-300 shadow-md min-h-[70px] flex items-center justify-center
                        ${isSelected
                          ? isSelectAll
                            ? 'bg-white text-red-600 border-2 border-red-600 hover:bg-red-50 shadow-lg shadow-red-600/20'
                            : 'bg-red-600 text-white border-2 border-red-600 shadow-lg shadow-red-600/30 -translate-y-0.5'
                          : 'bg-gray-50 text-gray-600 border-2 border-gray-200 hover:border-red-600 hover:-translate-y-0.5 hover:shadow-lg'
                        }
                      `}
                    >
                      {isSelectAll && allSearchesSelected ? 'DESELECT ALL' : search}
                  </button>
                  );
                })}
                  </div>
                  </div>
                  )}
              
            {/* Select ASIC Type Card - Only show when ORGANISATION + ASIC selected */}
            {selectedCategory === 'ORGANISATION' && selectedSearches.has('ASIC') && (
            <div className="bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
              <h2 className="text-[32px] font-bold text-center mb-10 text-gray-900 tracking-tight">
                Select <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20">ASIC Type</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {asicTypes.map((asicType) => {
                  const isSelected = selectedAsicTypes.has(asicType);
                  const isSelectAll = asicType === 'SELECT ALL';
                  
                  return (
                  <button 
                      key={asicType}
                      onClick={() => handleAsicTypeToggle(asicType)}
                      className={`
                        px-6 py-5 rounded-xl font-semibold text-[13px] uppercase tracking-wide
                        transition-all duration-300 shadow-md min-h-[70px] flex items-center justify-center
                        ${isSelected
                          ? isSelectAll
                            ? 'bg-white text-red-600 border-2 border-red-600 hover:bg-red-50 shadow-lg shadow-red-600/20'
                            : 'bg-red-600 text-white border-2 border-red-600 shadow-lg shadow-red-600/30 -translate-y-0.5'
                          : 'bg-gray-50 text-gray-600 border-2 border-gray-200 hover:border-red-600 hover:-translate-y-0.5 hover:shadow-lg'
                        }
                      `}
                    >
                      {isSelectAll && allAsicTypesSelected ? 'DESELECT ALL' : asicType}
                  </button>
                  );
                })}
                </div>
              </div>
            )}

            {/* Enter Search Details Card - Show when ORGANISATION selected and searches/ASIC types chosen */}
            {showEnterSearchDetails && (
            <div ref={detailsCardRef} className="bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
              <h2 className="text-[32px] font-bold text-center mb-10 text-gray-900 tracking-tight">
                Enter <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20">Search Details</span>
              </h2>

              <div className="max-w-2xl mx-auto">
                <div>
                  <label htmlFor="organisation-search" className="block text-lg font-semibold text-gray-700 mb-3">
                    Search for Organisation (ABN/ACN)
                  </label>
                  <div className="relative">
                  <input
                    type="text"
                      id="organisation-search"
                      name="organisation-search"
                      className="block w-full px-4 py-3 border-2 border-gray-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 text-base transition-all duration-200"
                      placeholder="Type to search..."
                      value={organisationSearchTerm}
                      onChange={(e) => setOrganisationSearchTerm(e.target.value)}
                    onFocus={() => {
                        hasSelectedRef.current = false; // Reset flag when field is focused
                        if (organisationSearchTerm.trim().length >= 2 && suggestions.length > 0) {
                          setShowSuggestions(true);
                        }
                      }}
                    />
                    {organisationSearchTerm && (
                  <button
                        type="button"
                    onClick={() => {
                          setOrganisationSearchTerm('');
                          setShowSuggestions(false);
                          setSuggestions([]);
                          hasSelectedRef.current = false;
                          setHasSelectedCompany(false);
                          setSelectedAdditionalSearches(new Set());
                          setDataAvailable(null);
                          setCheckingData(false);
                          setCompanyDetails({ directors: 0, pastDirectors: 0, shareholders: 0 });
                        }}
                        className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-red-600 focus:outline-none transition-colors duration-200"
                        aria-label="Clear search"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                  </button>
                )}

                    {/* Suggestions Dropdown */}
                    {showSuggestions && suggestions.length > 0 && (
                      <div 
                        ref={dropdownRef}
                        className="absolute z-50 w-full mt-2 bg-white border-2 border-gray-200 rounded-xl shadow-2xl max-h-80 overflow-y-auto"
                      >
                        {isLoadingSuggestions ? (
                          <div className="px-4 py-3 text-center text-gray-500">
                            <svg className="animate-spin h-5 w-5 mx-auto text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                    </div>
                        ) : (
                          suggestions.map((suggestion, index) => (
                      <button 
                          key={index}
                              onClick={() => handleSuggestionSelect(suggestion)}
                              className="w-full px-4 py-3 text-left hover:bg-red-50 transition-colors duration-150 border-b border-gray-100 last:border-b-0 focus:outline-none focus:bg-red-50"
                            >
                              <div className="flex flex-col">
                                {suggestion.Name && (
                                  <span className="font-semibold text-gray-900 text-sm">
                                    {suggestion.Name}
                                  </span>
                                )}
                                <span className={`text-gray-600 text-sm ${suggestion.Name ? 'mt-1' : ''}`}>
                                  ABN: {suggestion.Abn}
                                </span>
                        </div>
                            </button>
                          ))
                )}
                    </div>
                  )}
                </div>
                
                {/* Data Availability Status */}
                {hasSelectedCompany && (
                  <div className="mt-6">
                    {checkingData ? (
                      <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
                        <p className="text-sm font-semibold text-blue-800">
                          Checking data availability...
                        </p>
              </div>
                    ) : dataAvailable !== null && (
                      <div className={`border-l-4 p-4 rounded ${
                        dataAvailable 
                          ? 'bg-green-50 border-green-500' 
                          : 'bg-yellow-50 border-yellow-500'
                      }`}>
                        <p className={`text-sm font-semibold ${
                          dataAvailable 
                            ? 'text-green-800' 
                            : 'text-yellow-800'
                        }`}>
                          {dataAvailable 
                            ? '✅ ASIC Current data is AVAILABLE' 
                            : '⚠️ ASIC Current data is NOT AVAILABLE'}
                        </p>
            </div>
                    )}
                </div>
              )}
                </div>
                </div>
                </div>
              )}
              
            {/* Enter Person Details Card - Show when INDIVIDUAL selected and searches are chosen */}
            {selectedCategory === 'INDIVIDUAL' && selectedSearches.size > 0 && Array.from(selectedSearches).some(s => s !== 'SELECT ALL') && (
            <div ref={detailsCardRef} className="bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
              <h2 className="text-[32px] font-bold text-center mb-10 text-gray-900 tracking-tight">
                Enter <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20">Person Details</span>
              </h2>

              <div className="max-w-2xl mx-auto space-y-6">
                {/* First Name */}
                <div>
                  <label htmlFor="first-name" className="block text-sm font-semibold text-[#2c3e50] mb-2.5 uppercase tracking-[0.5px]">
                    First Name
                  </label>
                  <input
                    type="text"
                    id="first-name"
                    name="first-name"
                    className="block w-full px-[22px] py-[18px] border-2 border-[#e8ecef] rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] bg-[#fafbfc] focus:outline-none focus:border-red-600 focus:bg-white focus:shadow-[0_4px_12px_rgba(229,57,53,0.15)] text-[15px] transition-all duration-300"
                    placeholder="Enter first name"
                    value={individualFirstName}
                    onChange={(e) => setIndividualFirstName(e.target.value)}
                  />
                </div>

                {/* Last Name */}
                <div>
                  <label htmlFor="last-name" className="block text-sm font-semibold text-[#2c3e50] mb-2.5 uppercase tracking-[0.5px]">
                    Last Name
                  </label>
                  <input
                    type="text"
                    id="last-name"
                    name="last-name"
                    className="block w-full px-[22px] py-[18px] border-2 border-[#e8ecef] rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] bg-[#fafbfc] focus:outline-none focus:border-red-600 focus:bg-white focus:shadow-[0_4px_12px_rgba(229,57,53,0.15)] text-[15px] transition-all duration-300"
                    placeholder="Enter last name"
                    value={individualLastName}
                    onChange={(e) => setIndividualLastName(e.target.value)}
                  />
                </div>

                {/* Date of Birth */}
                <div>
                  <label htmlFor="date-of-birth" className="block text-sm font-semibold text-[#2c3e50] mb-2.5 uppercase tracking-[0.5px]">
                    Date of Birth
                  </label>
                  <input
                    type="text"
                    id="date-of-birth"
                    name="date-of-birth"
                    className="block w-full px-[22px] py-[18px] border-2 border-[#e8ecef] rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] bg-[#fafbfc] focus:outline-none focus:border-red-600 focus:bg-white focus:shadow-[0_4px_12px_rgba(229,57,53,0.15)] text-[15px] transition-all duration-300"
                    placeholder="DD/MM/YYYY"
                    value={individualDateOfBirth}
                    onChange={(e) => setIndividualDateOfBirth(e.target.value)}
                  />
                </div>
              </div>
                </div>
            )}
            
            {/* Select Additional Searches - Show when ORGANISATION category is selected */}
            {selectedCategory === 'ORGANISATION' && (
            <div ref={additionalCardRef} className="bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
              <h2 className="text-[32px] font-bold text-center mb-10 text-gray-900 tracking-tight">
                Select <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20">Additional Searches</span>
              </h2>

              {/* Company Details Banner - Only show when company is selected */}
              {hasSelectedCompany && (
              <div className="mb-8 bg-green-50 border-l-4 border-green-500 p-4 rounded">
                <p className="text-sm font-semibold text-green-800">
                  Credion has detected Directors: {companyDetails.directors} | Past directors: {companyDetails.pastDirectors} | Shareholders: {companyDetails.shareholders}
                </p>
                </div>
              )}
                
              {/* Additional Search Options Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {additionalSearchOptions.map((option) => {
                  const isSelected = selectedAdditionalSearches.has(option.name);
                  const isSelectAll = option.name === 'SELECT ALL';
                  
                  return (
                      <button 
                      key={option.name}
                      onClick={() => handleAdditionalSearchToggle(option.name)}
                      className={`
                        px-4 py-4 rounded-xl font-semibold text-xs uppercase tracking-wide
                        transition-all duration-300 shadow-md min-h-[90px] flex flex-col items-center justify-center
                        ${isSelected
                          ? isSelectAll
                            ? 'bg-white text-red-600 border-2 border-red-600 hover:bg-red-50 shadow-lg shadow-red-600/20'
                            : 'bg-red-600 text-white border-2 border-red-600 shadow-lg shadow-red-600/30'
                          : 'bg-white text-gray-700 border-2 border-gray-300 hover:border-red-600 hover:bg-red-50'
                        }
                      `}
                    >
                      <span className="text-center">
                        {isSelectAll && allAdditionalSearchesSelected ? 'DESELECT ALL' : option.name}
                      </span>
                      {option.available && (
                        <span className="text-xs mt-2 opacity-75">
                          ({option.available} available)
                        </span>
                      )}
                      </button>
                  );
                })}
                    </div>
                          </div>
                        )}

            {/* Selected Searches Summary Section - Show when ORGANISATION category is selected */}
            {selectedCategory === 'ORGANISATION' && (
            <div className="bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100">
              <h2 className="text-base font-bold text-[#2c3e50] mb-[18px] uppercase tracking-wide">
                Selected Searches:
              </h2>

              {/* Display all selected searches as pills */}
              <div className="flex flex-wrap gap-4 mb-8">
                {/* Main searches */}
                {Array.from(selectedSearches)
                  .filter(search => search !== 'SELECT ALL')
                  .map((search) => (
                    <div
                      key={search}
                      className="px-6 py-3 rounded-xl font-semibold text-sm uppercase tracking-wide bg-red-600 text-white shadow-md"
                    >
                      {search}
                      </div>
                  ))}
                
                {/* ASIC types - Show as separate pills if selected */}
                {selectedCategory === 'ORGANISATION' && selectedSearches.has('ASIC') && 
                  Array.from(selectedAsicTypes)
                    .filter(type => type !== 'SELECT ALL')
                    .map((type) => (
                      <div
                        key={`asic-${type}`}
                        className="px-6 py-3 rounded-xl font-semibold text-sm uppercase tracking-wide bg-blue-600 text-white shadow-md border-2 border-blue-700"
                      >
                        ASIC: {type}
                    </div>
                    ))
                }
                
                {/* Additional searches */}
                {Array.from(selectedAdditionalSearches)
                  .filter(search => search !== 'SELECT ALL')
                  .map((search) => {
                    const option = additionalSearchOptions.find(o => o.name === search);
                    return (
                      <div
                        key={search}
                        className="px-6 py-3 rounded-xl font-semibold text-sm uppercase tracking-wide bg-red-600 text-white shadow-md"
                      >
                        {search}
                        {option?.available && ` (${option.available} available)`}
                  </div>
                    );
                  })}
              </div>

              {/* Process Reports Button */}
                      <button 
                className="w-full py-4 rounded-xl font-bold text-lg uppercase tracking-wide bg-red-600 text-white shadow-lg hover:bg-red-700 transition-all duration-300 hover:shadow-xl"
                      onClick={handleProcessReports}
                    disabled={isProcessingReports}
                    >
                {isProcessingReports ? 'Processing Reports...' : 'Process Reports'}
                  </button>
                </div>
                )}
            {
              proccessReportStatus ? <div className="selected-section">
                <div className="selected-label">Selected Searches:</div>
                <div className="selected-tags" id="selectedTagsOrg"><span className="tag">ASIC</span><span className="tag">ASIC - CURRENT</span></div>

                {/* <button className="pay-button-card" id="payButtonOrg" style="display: none;">
                    Process Reports
                </button> */}
                {/* <span id="totalPriceOrg" style="display: none;">70</span> */}

                <div className="payment-actions" id="paymentActionsOrg">
                  <div className="action-box">
                    <h3>Send Reports via Email</h3>
                    <input type="email" className="email-input" id="emailInputOrg" placeholder="Enter your email address" />
                    <button className="action-button send-button" id="sendButtonOrg">Send</button>
                  </div>
                  <div className="action-box">
                    <h3>Download Report</h3>
                    <div className="reports-available">
                      Reports available: <span id="reportsCountOrg">{totalDownloadReport}</span>
                    </div>
                    <button className="action-button send-button" id="downloadButtonOrg" onClick={handleReportsDownload}>Download</button>
                  </div>
                </div>
              </div>
                : <></>
            }
                </div>
                </div>
                </div>

      {/* Right Sidebar - Receipt */}
      <div className="fixed right-8 top-32 w-80 max-h-[calc(100vh-160px)] bg-white rounded-[20px] shadow-xl overflow-hidden flex flex-col z-50 hidden lg:flex">
        {/* Header */}
        <div className="bg-white px-6 py-6 border-b border-gray-100">
          <h3 className="text-xl font-bold text-gray-800 tracking-tight">Your Selection</h3>
              </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-6 py-5 bg-white custom-scrollbar">
          {(selectedSearches.size === 0 || (selectedSearches.size === 1 && selectedSearches.has('SELECT ALL'))) && 
           (selectedAdditionalSearches.size === 0 || (selectedAdditionalSearches.size === 1 && selectedAdditionalSearches.has('SELECT ALL'))) ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3 opacity-40">📋</div>
              <div className="text-[15px] font-semibold text-gray-700 mb-1.5">No reports selected</div>
              <div className="text-[13px] text-gray-400">Select reports to see them here</div>
                </div>
          ) : (
            <div className="space-y-0">
              {Array.from(selectedSearches)
                .filter(search => search !== 'SELECT ALL')
                .map((search, index) => (
                  <div 
                    key={search} 
                    className="flex justify-between items-start py-3 border-b border-gray-100 last:border-b-0 animate-fadeIn"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="flex-1 text-[13px] font-medium text-gray-600 pr-4 leading-relaxed">
                      {search}
              </div>
                    <div className="text-sm font-semibold text-gray-800 whitespace-nowrap">
                      ${searchPrices[search as keyof SearchPrices].toFixed(2)}
            </div>
              </div>
                ))}
              
              {/* Show selected ASIC types if any */}
              {selectedCategory === 'ORGANISATION' && Array.from(selectedAsicTypes).filter(t => t !== 'SELECT ALL').length > 0 && (
                <div className="mt-2">
                  {Array.from(selectedAsicTypes)
                    .filter(type => type !== 'SELECT ALL')
                    .map((type, index) => (
                      <div 
                        key={type}
                        className="flex justify-between items-start py-3 border-b border-gray-100 last:border-b-0 animate-fadeIn"
                        style={{ animationDelay: `${(selectedSearches.size + index) * 50}ms` }}
                      >
                        <div className="flex-1 text-[13px] font-medium text-gray-600 pr-4 leading-relaxed">
                          ASIC: {type}
                </div>
                        <div className="text-sm font-semibold text-gray-800 whitespace-nowrap">
                          ${asicTypePrices[type]?.toFixed(2) || '0.00'}
                </div>
                </div>
                    ))}
              </div>
              )}
              
              {/* Show selected additional searches if any */}
              {Array.from(selectedAdditionalSearches).filter(s => s !== 'SELECT ALL').length > 0 && (
                <div className="mt-2">
                  {Array.from(selectedAdditionalSearches)
                    .filter(search => search !== 'SELECT ALL')
                    .map((search, index) => {
                      const option = additionalSearchOptions.find(o => o.name === search);
                      return (
                        <div 
                          key={search}
                          className="flex justify-between items-start py-3 border-b border-gray-100 last:border-b-0 animate-fadeIn"
                          style={{ animationDelay: `${(selectedSearches.size + selectedAsicTypes.size + index) * 50}ms` }}
                        >
                          <div className="flex-1 text-[13px] font-medium text-gray-600 pr-4 leading-relaxed">
                            {search}
                            {option?.available && ` (${option.available})`}
                  </div>
                          <div className="text-sm font-semibold text-gray-800 whitespace-nowrap">
                            ${option?.price.toFixed(2)}
                        </div>
                    </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-5 border-t border-gray-100">
          <div className="flex justify-between items-center">
            <span className="text-lg font-bold text-gray-800">Total</span>
            <span className="text-[22px] font-bold text-red-600">
              ${calculateTotal().toFixed(2)}
            </span>
        </div>
        </div>
      </div>

    </div>
  );
};

export default Search;
