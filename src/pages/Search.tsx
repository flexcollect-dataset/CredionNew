import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { apiService } from '../services/api';

type CategoryType = 'ORGANISATION' | 'INDIVIDUAL' | 'LAND TITLE';
type SearchType =
  | 'SELECT ALL'
  | 'ASIC'
  | 'COURT'
  | 'ATO'
  | 'ABN/ACN PPSR'
  | 'ADD DOCUMENT SEARCH'
  | 'INDIVIDUAL RELATED ENTITIES'
  | 'INDIVIDUAL BANKRUPTCY'
  | 'INDIVIDUAL COURT'
  | 'INDIVIDUAL LAND TITLE'
  | 'INDIVIDUAL PPSR'
  | 'REGO PPSR'
  | 'SOLE TRADER CHECK'
  | 'UNCLAIMED MONEY'
  | 'LAND_TITLE_TITLE_REFERENCE'
  | 'LAND_TITLE_ORGANISATION'
  | 'LAND_TITLE_INDIVIDUAL'
  | 'LAND_TITLE_ADDRESS'
  | 'LAND_TITLE_ADD_ON';
type AsicType = 'SELECT ALL' | 'CURRENT' | 'CURRENT/HISTORICAL' | 'COMPANY';
type CourtTypeOption = 'ALL' | 'CIVIL COURT' | 'CRIMINAL COURT';
type AdditionalSearchType =
  | 'SELECT ALL'
  | 'ABN/ACN PPSR'
  | 'ASIC - CURRENT'
  | 'ABN/ACN LAND TITLE'
  | 'DIRECTOR RELATED ENTITIES'
  | 'DIRECTOR LAND TITLE'
  | 'DIRECTOR PPSR'
  | 'DIRECTOR BANKRUPTCY'
  | 'ABN/ACN COURT FILES'
  | 'ATO';

type LandTitleOption = 'ABN/ACN LAND TITLE' | 'DIRECTOR LAND TITLE';
type LandTitleDetailSelection = 'SUMMARY' | 'CURRENT' | 'PAST' | 'ALL';

interface LandTitleSelection {
  summary: boolean;
  detail: LandTitleDetailSelection;
  addOn: boolean;
}

const initialLandTitleSelection: LandTitleSelection = {
  summary: true,
  detail: 'SUMMARY',
  addOn: false
};

type TitleReferenceAvailability = Record<LandTitleDetailSelection, number | null>;

const INITIAL_TITLE_REFERENCE_AVAILABILITY: TitleReferenceAvailability = {
  SUMMARY: null,
  CURRENT: null,
  PAST: null,
  ALL: null
};

// TODO: Replace demo values with real availability data once backend endpoint is available
const DEMO_TITLE_REFERENCE_AVAILABILITY: TitleReferenceAvailability = {
  SUMMARY: null,
  CURRENT: 1,
  PAST: 11,
  ALL: 12
};

type LandTitleCategoryOption = 'TITLE_REFERENCE' | 'LAND_ORGANISATION' | 'LAND_INDIVIDUAL' | 'ADDRESS';

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

interface DirectorInfo {
  firstName: string;
  lastName: string;
  dob: string;
  fullName?: string;
}

const Search: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<CategoryType>('ORGANISATION');
  const [selectedSearches, setSelectedSearches] = useState<Set<SearchType>>(new Set());
  const [selectedAsicTypes, setSelectedAsicTypes] = useState<Set<AsicType>>(new Set());
  const [selectedCourtType, setSelectedCourtType] = useState<CourtTypeOption>('ALL');
  const [isAsicModalOpen, setIsAsicModalOpen] = useState(false);
  const [isCourtModalOpen, setIsCourtModalOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [organisationSearchTerm, setOrganisationSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState<ABNSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimeoutRef = useRef<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const landTitleOrganisationDropdownRef = useRef<HTMLDivElement>(null);
  const hasSelectedRef = useRef(false); // Track if user selected from dropdown
  const [hasSelectedCompany, setHasSelectedCompany] = useState(false);
  const [selectedAdditionalSearches, setSelectedAdditionalSearches] = useState<Set<AdditionalSearchType>>(new Set());
  const [selectedIndividualAdditionalSearches, setSelectedIndividualAdditionalSearches] = useState<Set<SearchType>>(new Set());
  const [companyDetails, setCompanyDetails] = useState({ directors: 0, pastDirectors: 0, shareholders: 0 });
  const [directorsList, setDirectorsList] = useState<DirectorInfo[]>([]);
  const [isProcessingReports, setIsProcessingReports] = useState(false);
  // Company confirmation state
  const [pendingCompany, setPendingCompany] = useState<{ name: string; abn: string } | null>(null);
  const [isCompanyConfirmed, setIsCompanyConfirmed] = useState(false);
  const [isConfirmingCompany, setIsConfirmingCompany] = useState(false);
  // Individual search details
  const [individualFirstName, setIndividualFirstName] = useState('');
  const [individualLastName, setIndividualLastName] = useState('');
  const [individualDateOfBirth, setIndividualDateOfBirth] = useState('');

  // Data availability
  const [, setDataAvailable] = useState<boolean | null>(null);
  const [, setCheckingData] = useState(false);

  // Stepper state and refs
  const [activeStep, setActiveStep] = useState(0);
  const categoryCardRef = useRef<HTMLDivElement>(null);
  const searchesCardRef = useRef<HTMLDivElement>(null);
  const detailsCardRef = useRef<HTMLDivElement>(null);
  const additionalCardRef = useRef<HTMLDivElement>(null);

  // download report
  const [proccessReportStatus, setProccessReportStatus] = useState(false);
  const [totalDownloadReport, setTotalDownloadReports] = useState(0);
  const [pdfFilenames, setPdfFilenames] = useState<string[]>([]);

  // email sending state
  const [emailAddress, setEmailAddress] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [documentIdInput, setDocumentIdInput] = useState('');
  const [documentSearchId, setDocumentSearchId] = useState('');
  const [selectedLandTitleOption, setSelectedLandTitleOption] = useState<LandTitleCategoryOption | null>(null);
  const [isLandTitleAddOnSelected, setIsLandTitleAddOnSelected] = useState(false);
  const [landTitleReferenceId, setLandTitleReferenceId] = useState('');
  const [landTitleOrganisationStates, setLandTitleOrganisationStates] = useState<Set<string>>(new Set());
  const [landTitleOrganisationSearchTerm, setLandTitleOrganisationSearchTerm] = useState('');
  const [landTitleOrganisationSuggestions, setLandTitleOrganisationSuggestions] = useState<ABNSuggestion[]>([]);
  const [landTitleOrganisationSelected, setLandTitleOrganisationSelected] = useState<ABNSuggestion | null>(null);
  const [isLoadingLandTitleOrganisationSuggestions, setIsLoadingLandTitleOrganisationSuggestions] = useState(false);
  const landTitleOrganisationSearchTimeoutRef = useRef<number | null>(null);
  const [landTitleOrganisationShowSuggestions, setLandTitleOrganisationShowSuggestions] = useState(false);
  const [isLandTitleOrganisationConfirmed, setIsLandTitleOrganisationConfirmed] = useState(false);
  const [isConfirmingLandTitleOrganisation, setIsConfirmingLandTitleOrganisation] = useState(false);

  const resetLandTitleOrganisationSearch = useCallback(() => {
    setLandTitleOrganisationSearchTerm('');
    setLandTitleOrganisationSuggestions([]);
    setLandTitleOrganisationSelected(null);
    setLandTitleOrganisationShowSuggestions(false);
    setIsLandTitleOrganisationConfirmed(false);
    setIsLoadingLandTitleOrganisationSuggestions(false);
  }, []);

  const [landTitleIndividualFirstName, setLandTitleIndividualFirstName] = useState('');
  const [landTitleIndividualLastName, setLandTitleIndividualLastName] = useState('');
  const [landTitleIndividualDobMode, setLandTitleIndividualDobMode] = useState<'EXACT' | 'RANGE'>('EXACT');
  const [landTitleIndividualDob, setLandTitleIndividualDob] = useState('');
  const [landTitleIndividualStartYear, setLandTitleIndividualStartYear] = useState('');
  const [landTitleIndividualEndYear, setLandTitleIndividualEndYear] = useState('');
  const [landTitleIndividualStates, setLandTitleIndividualStates] = useState<Set<string>>(new Set());
  const [isIndividualNameConfirmed, setIsIndividualNameConfirmed] = useState(false);
  const [landTitleAddress, setLandTitleAddress] = useState('');
  const [titleReferenceSelection, setTitleReferenceSelection] = useState<LandTitleSelection>({ ...initialLandTitleSelection });
  const [pendingTitleReferenceSelection, setPendingTitleReferenceSelection] = useState<LandTitleSelection>({ ...initialLandTitleSelection });
  const [isTitleReferenceModalOpen, setIsTitleReferenceModalOpen] = useState(false);
  const [titleReferenceModalStep, setTitleReferenceModalStep] = useState<'SUMMARY_PROMPT' | 'DETAIL' | 'ADD_ON'>('SUMMARY_PROMPT');
  const [titleReferenceAvailability, setTitleReferenceAvailability] = useState<TitleReferenceAvailability>({
    ...INITIAL_TITLE_REFERENCE_AVAILABILITY
  });
  const [confirmedTitleReferenceAvailability, setConfirmedTitleReferenceAvailability] = useState<TitleReferenceAvailability>({
    ...INITIAL_TITLE_REFERENCE_AVAILABILITY
  });
  const [isTitleReferenceSelectionConfirmed, setIsTitleReferenceSelectionConfirmed] = useState(false);
  const [isLandTitleIndividualSearchPerformed, setIsLandTitleIndividualSearchPerformed] = useState(false);
  const [selectedLandTitleIndividualMatch, setSelectedLandTitleIndividualMatch] = useState<string | null>(null);
  const [isLandTitleIndividualSummaryModalOpen, setIsLandTitleIndividualSummaryModalOpen] = useState(false);
  const [isLandTitleIndividualDetailModalOpen, setIsLandTitleIndividualDetailModalOpen] = useState(false);
  const [isLandTitleIndividualAddOnModalOpen, setIsLandTitleIndividualAddOnModalOpen] = useState(false);
  const categories: CategoryType[] = ['ORGANISATION', 'INDIVIDUAL', 'LAND TITLE'];
  const asicTypes: AsicType[] = ['SELECT ALL', 'CURRENT', 'CURRENT/HISTORICAL', 'COMPANY'];
  const courtTypes: CourtTypeOption[] = ['ALL', 'CIVIL COURT', 'CRIMINAL COURT'];

  const asicTypePrices: Record<string, number> = {
    'CURRENT': 25.00,
    'CURRENT/HISTORICAL': 40.00,
    'COMPANY': 30.00
  };

  // Base prices for additional searches (per director for director-related searches)
  const additionalSearchBasePrices: Record<string, number> = {
    'ABN/ACN PPSR': 50,
    'ASIC - CURRENT': 25,
    'ABN/ACN LAND TITLE': 100,
    'DIRECTOR RELATED ENTITIES': 75,
    'DIRECTOR LAND TITLE': 80,
    'DIRECTOR PPSR': 50,
    'DIRECTOR BANKRUPTCY': 90,
    'ABN/ACN COURT FILES': 60,
    'ATO': 55
  };

  const landTitlePricingConfig = {
    base: {
      'ABN/ACN LAND TITLE': 100,
      'DIRECTOR LAND TITLE': 80
    } as Record<LandTitleOption, number>,
    addOn: 40
  } as const;

  const mockLandTitleIndividualMatches: string[] = [
    'William P.J. Pike (16/10/1960)',
    'William Peter J Pike (16/10/1960)',
    'William P James Pike (16/10/1960)',
    'W.P.J. Pike (16/10/1960)',
    'William Peter James Pike (16/10/1960)'
  ];

  const landTitleIndividualDetailPricing: Record<LandTitleDetailSelection, number> = {
    SUMMARY: 20,
    CURRENT: 10,
    PAST: 110,
    ALL: 120
  };

  const landTitleIndividualDetailCounts: Record<Exclude<LandTitleDetailSelection, 'SUMMARY'>, number> = {
    CURRENT: 1,
    PAST: 11,
    ALL: 12
  };

  const isLandTitleOption = (option: string): option is LandTitleOption =>
    option === 'ABN/ACN LAND TITLE' || option === 'DIRECTOR LAND TITLE';

  const landTitleModalCopy: Record<
    LandTitleOption,
    {
      summaryTitle: string;
      summaryDescription: string;
      detailTitle: string;
      detailDescription: string;
      addOnTitle: string;
      addOnDescription: string;
    }
  > = {
    'ABN/ACN LAND TITLE': {
      summaryTitle: 'Land Title Summary Report',
      summaryDescription:
        'A summary report will outline land title references located for the organisation search. Select continue to choose detailed options.',
      detailTitle: 'Land Title Report Options',
      detailDescription: 'Select the detailed land title reports you require before processing.',
      addOnTitle: 'Additional Selections',
      addOnDescription:
        'Property Value + Sales History + More provides property value, sales history report, and extended property detail.'
    },
    'DIRECTOR LAND TITLE': {
      summaryTitle: 'Director Property Title - Summary Report',
      summaryDescription:
        'A summary report will display any recorded title references from your search. For full details on current or past titles, select after processing or continue with the summary only.',
      detailTitle: 'Director Property Title',
      detailDescription: 'Select detailed property reports for the director search.',
      addOnTitle: 'Additional Selections',
      addOnDescription:
        'Property Value + Sales History + More includes property value, sales history report, and property detail.'
    }
  };

  const landTitleCategoryOptionConfig: Record<
    LandTitleCategoryOption,
    {
      label: string;
      description: string;
      price: number;
    }
  > = {
    TITLE_REFERENCE: {
      label: 'Title Reference',
      description: 'Search by land title reference to retrieve detailed property information.',
      price: 120
    },
    LAND_ORGANISATION: {
      label: 'Organisation',
      description: 'Search land title information associated with an organisation.',
      price: 140
    },
    LAND_INDIVIDUAL: {
      label: 'Individual',
      description: 'Search land title information associated with an individual.',
      price: 130
    },
    ADDRESS: {
      label: 'Address',
      description: 'Search land title information using a full property address.',
      price: 125
    }
  };

  const titleReferenceDetailPricing: Record<LandTitleDetailSelection, number> = {
    SUMMARY: landTitleCategoryOptionConfig.TITLE_REFERENCE.price,
    CURRENT: landTitleCategoryOptionConfig.TITLE_REFERENCE.price,
    PAST: landTitleCategoryOptionConfig.TITLE_REFERENCE.price,
    ALL: landTitleCategoryOptionConfig.TITLE_REFERENCE.price
  };

  const titleReferenceDetailOptions: Array<{
    key: Exclude<LandTitleDetailSelection, 'SUMMARY'>;
  }> = [
      { key: 'CURRENT' },
      { key: 'PAST' },
      { key: 'ALL' }
    ];

  const LAND_TITLE_ADD_ON_LABEL = 'Property Value + Sales History + More';
  const LAND_TITLE_ADD_ON_PRICE = 40;

  const landTitleCategoryOptions: LandTitleCategoryOption[] = [
    'TITLE_REFERENCE',
    'LAND_ORGANISATION',
    'LAND_INDIVIDUAL',
    'ADDRESS'
  ];

  const landTitleSearchTypeMap: Record<LandTitleCategoryOption, SearchType> = {
    TITLE_REFERENCE: 'LAND_TITLE_TITLE_REFERENCE',
    LAND_ORGANISATION: 'LAND_TITLE_ORGANISATION',
    LAND_INDIVIDUAL: 'LAND_TITLE_INDIVIDUAL',
    ADDRESS: 'LAND_TITLE_ADDRESS'
  };

  const landTitleSearchTypeLabelMap: Partial<Record<SearchType, string>> = {
    LAND_TITLE_TITLE_REFERENCE: landTitleCategoryOptionConfig.TITLE_REFERENCE.label,
    LAND_TITLE_ORGANISATION: landTitleCategoryOptionConfig.LAND_ORGANISATION.label,
    LAND_TITLE_INDIVIDUAL: landTitleCategoryOptionConfig.LAND_INDIVIDUAL.label,
    LAND_TITLE_ADDRESS: landTitleCategoryOptionConfig.ADDRESS.label,
    LAND_TITLE_ADD_ON: LAND_TITLE_ADD_ON_LABEL
  };

  const landTitleCategoryReportTypeMap: Record<LandTitleCategoryOption, string> = {
    TITLE_REFERENCE: 'land-title-reference',
    LAND_ORGANISATION: 'land-title-organisation',
    LAND_INDIVIDUAL: 'land-title-individual',
    ADDRESS: 'land-title-address'
  };

  const landTitleStateOptions = ['NSW', 'VIC', 'SA', 'WA', 'NT', 'QLD'] as const;

  const landTitleDetailHeadingMap: Record<LandTitleCategoryOption, string> = {
    TITLE_REFERENCE: 'Title Reference',
    LAND_ORGANISATION: 'Organisation Details',
    LAND_INDIVIDUAL: 'Person Details',
    ADDRESS: 'Address Details'
  };

  const formatOrganisationDisplay = (suggestion: ABNSuggestion) =>
    suggestion.Name ? `${suggestion.Name} ABN: ${suggestion.Abn}` : `ABN: ${suggestion.Abn}`;

  const [landTitleModalOpen, setLandTitleModalOpen] = useState<LandTitleOption | null>(null);
  const [pendingLandTitleSelection, setPendingLandTitleSelection] = useState<LandTitleSelection>(initialLandTitleSelection);
  const [landTitleSelections, setLandTitleSelections] = useState<Record<LandTitleOption, LandTitleSelection>>({
    'ABN/ACN LAND TITLE': { ...initialLandTitleSelection },
    'DIRECTOR LAND TITLE': { ...initialLandTitleSelection }
  });
  const [landTitlePrices, setLandTitlePrices] = useState<Record<LandTitleOption, number>>({
    'ABN/ACN LAND TITLE': landTitlePricingConfig.base['ABN/ACN LAND TITLE'],
    'DIRECTOR LAND TITLE': landTitlePricingConfig.base['DIRECTOR LAND TITLE']
  });
  const [landTitleModalStep, setLandTitleModalStep] = useState<'SUMMARY_PROMPT' | 'DETAIL' | 'ADD_ON'>('SUMMARY_PROMPT');
  useEffect(() => {
    if (selectedLandTitleOption === 'TITLE_REFERENCE') {
      setTitleReferenceSelection(prev =>
        prev.addOn === isLandTitleAddOnSelected ? prev : { ...prev, addOn: isLandTitleAddOnSelected }
      );
    }
  }, [isLandTitleAddOnSelected, selectedLandTitleOption]);

  // Dynamic additional search options based on number of directors and selected main searches
  const additionalSearchOptions: AdditionalSearchOption[] = useMemo(() => {
    if (selectedSearches.has('ADD DOCUMENT SEARCH')) {
      return [];
    }

    const directorCount = companyDetails.directors || 0;

    const isAbnPpsrSelected = selectedSearches.has('ABN/ACN PPSR');
    const isAsicSelected = selectedSearches.has('ASIC');
    const isCourtSelected = selectedSearches.has('COURT');
    const isAtoSelected = selectedSearches.has('ATO');

    const allOptions: AdditionalSearchOption[] = [
      { name: 'SELECT ALL', price: 0 },
      { name: 'ABN/ACN PPSR', price: additionalSearchBasePrices['ABN/ACN PPSR'] },
      { name: 'ASIC - CURRENT', price: additionalSearchBasePrices['ASIC - CURRENT'] },
      { name: 'ABN/ACN LAND TITLE', price: landTitlePrices['ABN/ACN LAND TITLE'] },
      {
        name: 'DIRECTOR RELATED ENTITIES',
        available: directorCount,
        price: additionalSearchBasePrices['DIRECTOR RELATED ENTITIES'] * directorCount
      },
      {
        name: 'DIRECTOR LAND TITLE',
        available: directorCount + (companyDetails.pastDirectors || 0),
        price: landTitlePrices['DIRECTOR LAND TITLE']
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
      { name: 'ATO', price: additionalSearchBasePrices['ATO'] }
    ];

    return allOptions.filter(option => {
      if (option.name === 'SELECT ALL') return true;
      if (isAbnPpsrSelected && option.name === 'ABN/ACN PPSR') return false;
      if (isAsicSelected && option.name === 'ASIC - CURRENT') return false;
      if (isCourtSelected && option.name === 'ABN/ACN COURT FILES') return false;
      if (isAtoSelected && option.name === 'ATO') return false;
      return true;
    });
  }, [companyDetails.directors, companyDetails.pastDirectors, landTitlePrices, selectedSearches]);

  // Dynamic searches based on category - CHANGES PER CATEGORY!
  const categorySearches: Record<CategoryType, SearchType[]> = {
    'ORGANISATION': ['SELECT ALL', 'ASIC', 'COURT', 'ATO', 'ABN/ACN PPSR', 'ADD DOCUMENT SEARCH'],
    'INDIVIDUAL': ['SELECT ALL', 'INDIVIDUAL RELATED ENTITIES', 'INDIVIDUAL BANKRUPTCY', 'INDIVIDUAL COURT', 'INDIVIDUAL LAND TITLE', 'INDIVIDUAL PPSR', 'REGO PPSR', 'SOLE TRADER CHECK', 'UNCLAIMED MONEY'],
    'LAND TITLE': [] // No options for Land Title as of now
  };

  // Display names for searches (with INDIVIDUAL prefix for individual tab)
  const getSearchDisplayName = (search: SearchType): string => {
    if (search === 'LAND_TITLE_TITLE_REFERENCE') {
      switch (titleReferenceSelection.detail) {
        case 'CURRENT':
          return 'Current';
        case 'PAST':
          return 'Past';
        case 'ALL':
          return 'All';
        case 'SUMMARY':
        default:
          return 'Summary Report Only';
      }
    }
    if (landTitleSearchTypeLabelMap[search]) {
      return landTitleSearchTypeLabelMap[search] as string;
    }
    if (selectedCategory === 'INDIVIDUAL') {
      if (search === 'SELECT ALL') {
        return search;
      }
      if (search === 'COURT') {
        if (selectedCourtType === 'CIVIL COURT') {
          return 'INDIVIDUAL COURT (CIVIL)';
        }
        if (selectedCourtType === 'CRIMINAL COURT') {
          return 'INDIVIDUAL COURT (CRIMINAL)';
        }
      }
      return `${search}`;
    }
    return search;
  };

  const searches = useMemo(() => categorySearches[selectedCategory], [selectedCategory]);

  const selectedAsicTypeList = useMemo(
    () => Array.from(selectedAsicTypes).filter(type => type !== 'SELECT ALL'),
    [selectedAsicTypes]
  );
  const isOrganisationCategory = selectedCategory === 'ORGANISATION';
  const selectedMainSearchCount = useMemo(
    () => Array.from(selectedSearches).filter(s => s !== 'SELECT ALL').length,
    [selectedSearches]
  );
  const isAdditionalSearchesDisabled = isOrganisationCategory && !isCompanyConfirmed;
  const organisationSearchDisabled = isOrganisationCategory
    ? selectedMainSearchCount === 0 || isCompanyConfirmed || selectedSearches.has('ADD DOCUMENT SEARCH')
    : true;

  const landTitleOrganisationSearchDisabled = landTitleOrganisationStates.size === 0;
  const isIndividualSearchLocked = selectedCategory === 'INDIVIDUAL' && isIndividualNameConfirmed;

  const updateLandTitleSearchSelection = useCallback(
    (option: LandTitleCategoryOption | null, addOn: boolean) => {
      setSelectedSearches(prev => {
        const next = new Set<SearchType>();
        if (option) {
          next.add(landTitleSearchTypeMap[option]);
          if (addOn) {
            next.add('LAND_TITLE_ADD_ON');
          }
        }

        let changed = next.size !== prev.size;
        if (!changed) {
          for (const value of next) {
            if (!prev.has(value)) {
              changed = true;
              break;
            }
          }
        }
        if (!changed) {
          for (const value of prev) {
            if (!next.has(value)) {
              changed = true;
              break;
            }
          }
        }

        return changed ? next : prev;
      });
    },
    []
  );

  const closeTitleReferenceModal = useCallback(() => {
    setIsTitleReferenceModalOpen(false);
    setTitleReferenceModalStep('SUMMARY_PROMPT');
    setTitleReferenceAvailability({ ...INITIAL_TITLE_REFERENCE_AVAILABILITY });
  }, []);

  const resetLandTitleSelections = useCallback(() => {
    setLandTitleSelections({
      'ABN/ACN LAND TITLE': { ...initialLandTitleSelection },
      'DIRECTOR LAND TITLE': { ...initialLandTitleSelection }
    });
    setLandTitlePrices({
      'ABN/ACN LAND TITLE': landTitlePricingConfig.base['ABN/ACN LAND TITLE'],
      'DIRECTOR LAND TITLE': landTitlePricingConfig.base['DIRECTOR LAND TITLE']
    });
    setSelectedLandTitleOption(null);
    setIsLandTitleAddOnSelected(false);
    updateLandTitleSearchSelection(null, false);
    setLandTitleReferenceId('');
    setLandTitleOrganisationStates(new Set());
    setLandTitleIndividualFirstName('');
    setLandTitleIndividualLastName('');
    setLandTitleIndividualDobMode('EXACT');
    setLandTitleIndividualDob('');
    setLandTitleIndividualStartYear('');
    setLandTitleIndividualEndYear('');
    setLandTitleIndividualStates(new Set());
    setLandTitleAddress('');
    resetLandTitleOrganisationSearch();
    setTitleReferenceSelection({ ...initialLandTitleSelection });
    setPendingTitleReferenceSelection({ ...initialLandTitleSelection });
    setConfirmedTitleReferenceAvailability({ ...INITIAL_TITLE_REFERENCE_AVAILABILITY });
    setIsTitleReferenceSelectionConfirmed(false);
    closeTitleReferenceModal();
  }, [
    closeTitleReferenceModal,
    resetLandTitleOrganisationSearch,
    updateLandTitleSearchSelection
  ]);

  const handleLandTitleOptionSelect = useCallback(
    (option: LandTitleCategoryOption) => {
      if (selectedLandTitleOption === option) {
        setSelectedLandTitleOption(null);
        setIsLandTitleAddOnSelected(false);
        updateLandTitleSearchSelection(null, false);
        setLandTitleReferenceId('');
        setLandTitleOrganisationStates(new Set());
        setLandTitleIndividualFirstName('');
        setLandTitleIndividualLastName('');
        setLandTitleIndividualDobMode('EXACT');
        setLandTitleIndividualDob('');
        setLandTitleIndividualStartYear('');
        setLandTitleIndividualEndYear('');
        setLandTitleIndividualStates(new Set());
        setLandTitleAddress('');
        resetLandTitleOrganisationSearch();
        setTitleReferenceSelection({ ...initialLandTitleSelection });
        setPendingTitleReferenceSelection({ ...initialLandTitleSelection });
        setConfirmedTitleReferenceAvailability({ ...INITIAL_TITLE_REFERENCE_AVAILABILITY });
        setIsTitleReferenceSelectionConfirmed(false);
        closeTitleReferenceModal();
      } else {
        setSelectedLandTitleOption(option);
        updateLandTitleSearchSelection(option, isLandTitleAddOnSelected);
        setLandTitleReferenceId('');
        setLandTitleOrganisationStates(new Set());
        setLandTitleIndividualFirstName('');
        setLandTitleIndividualLastName('');
        setLandTitleIndividualDobMode('EXACT');
        setLandTitleIndividualDob('');
        setLandTitleIndividualStartYear('');
        setLandTitleIndividualEndYear('');
        setLandTitleIndividualStates(new Set());
        setLandTitleAddress('');
        resetLandTitleOrganisationSearch();
        setTitleReferenceSelection({ ...initialLandTitleSelection });
        setPendingTitleReferenceSelection({ ...initialLandTitleSelection });
        setConfirmedTitleReferenceAvailability({ ...INITIAL_TITLE_REFERENCE_AVAILABILITY });
        setIsTitleReferenceSelectionConfirmed(false);
        closeTitleReferenceModal();
      }
    },
    [
      closeTitleReferenceModal,
      isLandTitleAddOnSelected,
      resetLandTitleOrganisationSearch,
      selectedLandTitleOption,
      updateLandTitleSearchSelection
    ]
  );

  const handleLandTitleAddOnToggle = useCallback(() => {
    const next = !isLandTitleAddOnSelected;
    setIsLandTitleAddOnSelected(next);

    if (selectedLandTitleOption) {
      updateLandTitleSearchSelection(selectedLandTitleOption, next);
    }
  }, [isLandTitleAddOnSelected, selectedLandTitleOption, updateLandTitleSearchSelection]);

  const handleTitleReferenceSearchClick = useCallback(() => {
    if (selectedLandTitleOption !== 'TITLE_REFERENCE') {
      return;
    }

    if (!landTitleReferenceId.trim()) {
      alert('Please enter a reference ID');
      return;
    }

    setPendingTitleReferenceSelection({
      ...titleReferenceSelection,
      addOn: isLandTitleAddOnSelected
    });
    setTitleReferenceAvailability({ ...DEMO_TITLE_REFERENCE_AVAILABILITY });
    setTitleReferenceModalStep('SUMMARY_PROMPT');
    setIsTitleReferenceModalOpen(true);
  }, [isLandTitleAddOnSelected, landTitleReferenceId, selectedLandTitleOption, titleReferenceSelection]);

  // handleLandTitleAddressSearchClick
  const handleLandTitleAddressSearchClick = useCallback(() => {
    if (selectedLandTitleOption !== 'ADDRESS') {
      return;
    }

    if (!landTitleAddress.trim()) {
      alert('Please enter a address');
      return;
    }

    setPendingTitleReferenceSelection({
      ...titleReferenceSelection,
      addOn: isLandTitleAddOnSelected
    });
    setTitleReferenceAvailability({ ...DEMO_TITLE_REFERENCE_AVAILABILITY });
    setTitleReferenceModalStep('SUMMARY_PROMPT');
    setIsTitleReferenceModalOpen(true);
  }, [isLandTitleAddOnSelected, landTitleReferenceId, selectedLandTitleOption, titleReferenceSelection]);




  const handleTitleReferenceSummaryContinue = useCallback(() => {
    setTitleReferenceModalStep('DETAIL');
  }, []);

  const handleTitleReferenceDetailSelect = useCallback((detail: LandTitleDetailSelection) => {
    setPendingTitleReferenceSelection(prev => ({
      ...prev,
      detail,
      summary: detail === 'SUMMARY'
    }));
  }, []);

  const handleTitleReferenceModalConfirm = useCallback(() => {
    setTitleReferenceSelection(pendingTitleReferenceSelection);
    setConfirmedTitleReferenceAvailability(titleReferenceAvailability);
    setIsTitleReferenceSelectionConfirmed(true);
    if (pendingTitleReferenceSelection.addOn !== isLandTitleAddOnSelected) {
      setIsLandTitleAddOnSelected(pendingTitleReferenceSelection.addOn);
    }
    if (selectedLandTitleOption) {
      updateLandTitleSearchSelection(selectedLandTitleOption, pendingTitleReferenceSelection.addOn);
    }
    closeTitleReferenceModal();
  }, [
    closeTitleReferenceModal,
    isLandTitleAddOnSelected,
    pendingTitleReferenceSelection,
    selectedLandTitleOption,
    titleReferenceAvailability,
    updateLandTitleSearchSelection
  ]);

  const handleTitleReferenceDetailBack = useCallback(() => {
    setTitleReferenceModalStep('SUMMARY_PROMPT');
  }, []);

  const handleTitleReferenceDetailContinue = useCallback(() => {
    if (isLandTitleAddOnSelected) {
      handleTitleReferenceModalConfirm();
      return;
    }
    setTitleReferenceModalStep('ADD_ON');
  }, [handleTitleReferenceModalConfirm, isLandTitleAddOnSelected]);

  const handleTitleReferenceAddOnSelect = useCallback((addOn: boolean) => {
    setPendingTitleReferenceSelection(prev => ({ ...prev, addOn }));
  }, []);

  const handleTitleReferenceAddOnBack = useCallback(() => {
    setTitleReferenceModalStep('DETAIL');
  }, []);

  const handleLandTitleIndividualSearchClick = useCallback(() => {
    setIsLandTitleIndividualSearchPerformed(true);
    setSelectedLandTitleIndividualMatch(null);
    setIsIndividualNameConfirmed(false);
  }, []);

  const closeLandTitleIndividualModals = useCallback(() => {
    setIsLandTitleIndividualSummaryModalOpen(false);
    setIsLandTitleIndividualDetailModalOpen(false);
    setIsLandTitleIndividualAddOnModalOpen(false);
  }, []);

  const finalizeLandTitleIndividualSelection = useCallback(() => {
    if (selectedLandTitleOption !== 'LAND_INDIVIDUAL') {
      closeLandTitleIndividualModals();
      return;
    }
    setIsLandTitleAddOnSelected(pendingLandTitleSelection.addOn);
    updateLandTitleSearchSelection('LAND_INDIVIDUAL', pendingLandTitleSelection.addOn);
    setIsLandTitleIndividualSearchPerformed(false);
    setSelectedLandTitleIndividualMatch(null);
    closeLandTitleIndividualModals();
  }, [closeLandTitleIndividualModals, pendingLandTitleSelection.addOn, selectedLandTitleOption, updateLandTitleSearchSelection]);

  const handleLandTitleIndividualSummaryContinue = useCallback(() => {
    setIsLandTitleIndividualSummaryModalOpen(false);
    setIsLandTitleIndividualDetailModalOpen(true);
  }, []);

  const handleLandTitleIndividualDetailBack = useCallback(() => {
    setIsLandTitleIndividualDetailModalOpen(false);
    setIsLandTitleIndividualSummaryModalOpen(true);
  }, []);

  const handleLandTitleIndividualDetailContinue = useCallback(() => {
    if (pendingLandTitleSelection.addOn || isLandTitleAddOnSelected) {
      finalizeLandTitleIndividualSelection();
      return;
    }
    setIsLandTitleIndividualDetailModalOpen(false);
    setIsLandTitleIndividualAddOnModalOpen(true);
  }, [finalizeLandTitleIndividualSelection, isLandTitleAddOnSelected, pendingLandTitleSelection.addOn]);

  const handleLandTitleIndividualAddOnBack = useCallback(() => {
    setIsLandTitleIndividualAddOnModalOpen(false);
    setIsLandTitleIndividualDetailModalOpen(true);
  }, []);

  const handleLandTitleIndividualDetailSelect = useCallback((detail: LandTitleDetailSelection) => {
    setPendingLandTitleSelection(prev => ({
      ...prev,
      detail,
      summary: detail === 'SUMMARY'
    }));
  }, []);

  const handleLandTitleOrganisationStateToggle = useCallback((state: string) => {
    setLandTitleOrganisationStates(prev => {
      const next = new Set(prev);
      if (next.has(state)) {
        next.delete(state);
      } else {
        next.add(state);
      }
      return next;
    });
    setIsLandTitleOrganisationConfirmed(false);
  }, []);

  const handleLandTitleOrganisationStateSelectAll = useCallback(() => {
    setLandTitleOrganisationStates(prev => {
      if (prev.size === landTitleStateOptions.length) {
        return new Set();
      }
      return new Set(landTitleStateOptions);
    });
    setIsLandTitleOrganisationConfirmed(false);
  }, []);

  const handleLandTitleIndividualStateToggle = useCallback((state: string) => {
    setLandTitleIndividualStates(prev => {
      const next = new Set(prev);
      if (next.has(state)) {
        next.delete(state);
      } else {
        next.add(state);
      }
      return next;
    });
    setIsIndividualNameConfirmed(false);
  }, []);

  const handleLandTitleIndividualStateSelectAll = useCallback(() => {
    setLandTitleIndividualStates(prev => {
      if (prev.size === landTitleStateOptions.length) {
        return new Set();
      }
      return new Set(landTitleStateOptions);
    });
    setIsIndividualNameConfirmed(false);
  }, []);




  const calculateLandTitlePrice = useCallback((option: LandTitleOption, selection: LandTitleSelection) => {
    let price = landTitlePricingConfig.base[option];
    if (selection.addOn) {
      price += landTitlePricingConfig.addOn;
    }

    if (option === 'DIRECTOR LAND TITLE') {
      const directorCount = companyDetails.directors || 0;
      const pastDirectorCount = companyDetails.pastDirectors || 0;
      const totalCount =
        selection.detail === 'CURRENT'
          ? directorCount
          : selection.detail === 'PAST'
            ? pastDirectorCount
            : selection.detail === 'ALL'
              ? directorCount + pastDirectorCount
              : directorCount;
      if (totalCount > 0) {
        const perUnit = landTitlePricingConfig.base[option] / Math.max(directorCount || 1, 1);
        price = perUnit * totalCount;
      } else {
        price = landTitlePricingConfig.base[option];
      }
    }

    return price;
  }, [companyDetails.directors, companyDetails.pastDirectors]);

  const ensureAdditionalSelectAllState = useCallback(
    (setToNormalize: Set<AdditionalSearchType>) => {
      const availableOptions = additionalSearchOptions
        .filter(option => option.name !== 'SELECT ALL')
        .map(option => option.name as AdditionalSearchType);
      if (
        availableOptions.length > 0 &&
        availableOptions.every(name => setToNormalize.has(name))
      ) {
        setToNormalize.add('SELECT ALL');
      } else {
        setToNormalize.delete('SELECT ALL');
      }
    },
    [additionalSearchOptions]
  );

  const openLandTitleModal = useCallback(
    (option: LandTitleOption) => {
      const existing = landTitleSelections[option] || { ...initialLandTitleSelection };
      setPendingLandTitleSelection({ ...existing });
      setLandTitleModalStep('SUMMARY_PROMPT');
      setLandTitleModalOpen(option);
    },
    [landTitleSelections]
  );

  const closeLandTitleModal = useCallback(() => {
    setLandTitleModalOpen(null);
    setLandTitleModalStep('SUMMARY_PROMPT');
  }, []);

  const removeAsicSelection = useCallback(() => {
    setSelectedAsicTypes(new Set());
    setSelectedSearches(prev => {
      const updated = new Set(prev);
      const hadAsic = updated.delete('ASIC');
      if (hadAsic) {
        updated.delete('SELECT ALL');
      }
      return updated;
    });
  }, []);

  const removeCourtSelection = useCallback(() => {
    setSelectedCourtType('ALL');
    setSelectedSearches(prev => {
      const updated = new Set(prev);
      const hadCourt = updated.delete('COURT');
      if (hadCourt) {
        updated.delete('SELECT ALL');
      }
      return updated;
    });
  }, []);

  const closeAsicModal = useCallback(
    (options?: { removeIfEmpty?: boolean }) => {
      setIsAsicModalOpen(false);
      const shouldRemove = options?.removeIfEmpty ?? true;
      if (shouldRemove && selectedAsicTypeList.length === 0) {
        removeAsicSelection();
      }
    },
    [removeAsicSelection, selectedAsicTypeList]
  );

  const closeCourtModal = useCallback(
    (options?: { removeSelection?: boolean }) => {
      setIsCourtModalOpen(false);
      if (options?.removeSelection) {
        removeCourtSelection();
      }
    },
    [removeCourtSelection]
  );

  const handleCourtSelectionConfirm = () => {
    setIsCourtModalOpen(false);
  };

  const handleDocumentModalCancel = useCallback(() => {
    setDocumentIdInput(documentSearchId);
    setIsDocumentModalOpen(false);
  }, [documentSearchId]);

  const handleDocumentModalConfirm = useCallback(() => {
    const trimmed = documentIdInput.trim();
    if (!trimmed) {
      alert('Please enter a document ID');
      return;
    }
    setDocumentSearchId(trimmed);
    setDocumentIdInput(trimmed);
    setSelectedAdditionalSearches(new Set());
    resetLandTitleSelections();

    setSelectedSearches(prev => {
      const updated = new Set(prev);
      updated.add('ADD DOCUMENT SEARCH');
      const allNonDocumentSelected = searches
        .filter(s => s !== 'SELECT ALL' && s !== 'ADD DOCUMENT SEARCH')
        .every(s => updated.has(s));
      if (allNonDocumentSelected) {
        updated.add('SELECT ALL');
      }
      return updated;
    });
    setIsDocumentModalOpen(false);
  }, [documentIdInput, searches]);

  // Check if all searches are selected (excluding SELECT ALL)
  const allSearchesSelected = useMemo(() => {
    const individualSearches = searches.filter(s => s !== 'SELECT ALL' && s !== 'ADD DOCUMENT SEARCH');
    return individualSearches.length > 0 && individualSearches.every(s => selectedSearches.has(s));
  }, [searches, selectedSearches]);

  // Check if all ASIC types are selected (excluding SELECT ALL)
  const allAsicTypesSelected = useMemo(() => {
    return selectedAsicTypes.has('CURRENT/HISTORICAL') && selectedAsicTypes.has('COMPANY');
  }, [selectedAsicTypes]);

  // Check if all additional searches are selected (excluding SELECT ALL)
  const allAdditionalSearchesSelected = useMemo(() => {
    const individualSearches = additionalSearchOptions.filter(o => o.name !== 'SELECT ALL');
    return individualSearches.length > 0 && individualSearches.every(o => selectedAdditionalSearches.has(o.name));
  }, [selectedAdditionalSearches]);

  // Show "Enter Search Details" when ORGANISATION is selected (show by default)
  const showEnterSearchDetails = useMemo(() => {
    return selectedCategory === 'ORGANISATION' && !selectedSearches.has('ADD DOCUMENT SEARCH');
  }, [selectedCategory, selectedSearches]);

  const searchPrices: SearchPrices = {
    'ASIC': 50.00,
    'COURT': 60.00,
    'ATO': 55.00,
    'ABN/ACN PPSR': 50.00,
    'PPSR': 50.00,
    'ADD DOCUMENT SEARCH': 35.00,
    'BANKRUPTCY': 90.00,
    'LAND TITLE': 80.00,
    'INDIVIDUAL RELATED ENTITIES': 50.00,
    'INDIVIDUAL BANKRUPTCY': 90.00,
    'INDIVIDUAL COURT': 60.00,
    'INDIVIDUAL LAND TITLE': 80.00,
    'INDIVIDUAL PPSR': 50.00,
    'REGO PPSR': 50.00,
    'SOLE TRADER CHECK': 50.00,
    'UNCLAIMED MONEY': 50.00,
    'LAND_TITLE_TITLE_REFERENCE': titleReferenceDetailPricing[titleReferenceSelection.detail],
    'LAND_TITLE_ORGANISATION': landTitleCategoryOptionConfig.LAND_ORGANISATION.price,
    'LAND_TITLE_INDIVIDUAL': landTitleCategoryOptionConfig.LAND_INDIVIDUAL.price,
    'LAND_TITLE_ADDRESS': landTitleCategoryOptionConfig.ADDRESS.price,
    'LAND_TITLE_ADD_ON': LAND_TITLE_ADD_ON_PRICE
  };

  const formatCurrency = (value: number) => `$${value.toFixed(2)}`;

  const handleSearchToggle = (search: SearchType) => {
    if (selectedCategory === 'INDIVIDUAL' && isIndividualNameConfirmed) {
      return;
    }

    const newSelected = new Set(selectedSearches);

    if (search === 'SELECT ALL') {
      if (selectedSearches.has('SELECT ALL')) {
        const hadAsicSelected = newSelected.has('ASIC');
        const hadCourtSelected = newSelected.has('COURT');
        newSelected.clear();
        if (hadAsicSelected) {
          setSelectedAsicTypes(new Set());
          setIsAsicModalOpen(false);
        }
        if (hadCourtSelected) {
          setSelectedCourtType('ALL');
          setIsCourtModalOpen(false);
        }
        setDocumentSearchId('');
        setDocumentIdInput('');
        setSelectedAdditionalSearches(new Set());
        resetLandTitleSelections();
      } else {
        searches.forEach(s => {
          if (s !== 'ADD DOCUMENT SEARCH') {
            newSelected.add(s);
          }
        });
        if (selectedCategory === 'ORGANISATION' && searches.includes('ASIC')) {
          setIsAsicModalOpen(true);
        }
        if (selectedCategory === 'INDIVIDUAL' && searches.includes('COURT')) {
          setIsCourtModalOpen(true);
        }
      }
    } else {
      if (search === 'ADD DOCUMENT SEARCH') {
        if (newSelected.has(search)) {
          newSelected.delete(search);
          newSelected.delete('SELECT ALL');
          setDocumentSearchId('');
          setDocumentIdInput('');
          setSelectedAdditionalSearches(new Set());
          resetLandTitleSelections();
          setSelectedSearches(newSelected);
        } else {
          setDocumentIdInput(documentSearchId);
          setIsDocumentModalOpen(true);
        }
        return;
      }

      if (newSelected.has(search)) {
        newSelected.delete(search);
        newSelected.delete('SELECT ALL');

        // If ASIC is being deselected, clear all ASIC types
        if (search === 'ASIC') {
          setSelectedAsicTypes(new Set());
          setIsAsicModalOpen(false);
        }
        if (search === 'COURT' && selectedCategory === 'INDIVIDUAL') {
          setSelectedCourtType('ALL');
          setIsCourtModalOpen(false);
        }
      } else {
        newSelected.add(search);
        const allSelected = searches
          .filter(s => s !== 'SELECT ALL' && s !== 'ADD DOCUMENT SEARCH')
          .every(s => newSelected.has(s));
        if (allSelected) {
          newSelected.add('SELECT ALL');
        }
        if (search === 'ASIC' && selectedCategory === 'ORGANISATION') {
          setIsAsicModalOpen(true);
        }
        if (search === 'COURT' && selectedCategory === 'INDIVIDUAL') {
          setIsCourtModalOpen(true);
        }
      }
    }

    setSelectedSearches(newSelected);
  };

  const calculateTotal = (): number => {
    let total = 0;

    // Add main searches
    selectedSearches.forEach(search => {
      if (search !== 'SELECT ALL') {
        const priceKey = search === 'INDIVIDUAL PPSR' ? 'ABN/ACN PPSR' : search;
        if (priceKey in searchPrices) {
          total += searchPrices[priceKey as keyof SearchPrices];
        }
      }
    });

    // Add ASIC type prices
    selectedAsicTypes.forEach(type => {
      if (type !== 'SELECT ALL' && type in asicTypePrices) {
        total += asicTypePrices[type];
      }
    });

    // Add additional searches for ORGANISATION
    if (selectedCategory === 'ORGANISATION') {
      selectedAdditionalSearches.forEach(search => {
        if (search !== 'SELECT ALL') {
          const option = additionalSearchOptions.find(o => o.name === search);
          if (option && option.price) {
            total += option.price;
          }
        }
      });
    }

    // Add additional searches for INDIVIDUAL
    if (selectedCategory === 'INDIVIDUAL') {
      selectedIndividualAdditionalSearches.forEach(search => {
        if (search !== 'SELECT ALL') {
          const priceKey = search === 'INDIVIDUAL PPSR' ? 'ABN/ACN PPSR' : search;
          if (priceKey in searchPrices) {
            total += searchPrices[priceKey as keyof SearchPrices];
          }
        }
      });
    }

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
    } else     if (landTitleOrganisationSearchTerm.trim().length >= 2) {
      setIsLoadingLandTitleOrganisationSuggestions(true);
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const response = await apiService.searchABNByName(landTitleOrganisationSearchTerm);
          if (response.success && response.results) {
            setLandTitleOrganisationSuggestions(response.results);
            setLandTitleOrganisationShowSuggestions(true);
          }
        } catch (error) {
          console.error('Error fetching ABN suggestions:', error);
          setLandTitleOrganisationSuggestions([]);
        } finally {
          setIsLoadingLandTitleOrganisationSuggestions(false);
        }
      }, 500);
    }else {
      setSuggestions([]);
      setLandTitleOrganisationSuggestions([]);
      setShowSuggestions(false);
      setLandTitleOrganisationShowSuggestions(false);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [organisationSearchTerm, landTitleOrganisationSearchTerm]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
              setLandTitleOrganisationShowSuggestions(false);
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

  useEffect(() => {
    if (!isAsicModalOpen) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAsicModal();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [closeAsicModal, isAsicModalOpen]);

  useEffect(() => {
    if (!isCourtModalOpen) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeCourtModal();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [closeCourtModal, isCourtModalOpen]);

  useEffect(() => {
    if (!isDocumentModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleDocumentModalCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleDocumentModalCancel, isDocumentModalOpen]);

  useEffect(() => {
    if (organisationSearchDisabled) {
      setShowSuggestions(false);
    }
    if (landTitleOrganisationSearchDisabled) {
      setLandTitleOrganisationShowSuggestions(false);
    }
  }, [organisationSearchDisabled, landTitleOrganisationSearchDisabled]);



  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        landTitleOrganisationDropdownRef.current &&
        !landTitleOrganisationDropdownRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
        setLandTitleOrganisationShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!landTitleModalOpen) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeLandTitleModal();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [closeLandTitleModal, landTitleModalOpen]);

  useEffect(() => {
    setLandTitlePrices(prev => {
      let changed = false;
      const updated: Record<LandTitleOption, number> = { ...prev };
      (['ABN/ACN LAND TITLE', 'DIRECTOR LAND TITLE'] as LandTitleOption[]).forEach(option => {
        const selection = landTitleSelections[option];
        if (!selection) return;
        const recalculated = calculateLandTitlePrice(option, selection);
        if (prev[option] !== recalculated) {
          updated[option] = recalculated;
          changed = true;
        }
      });
      return changed ? updated : prev;
    });
  }, [calculateLandTitlePrice, landTitleSelections]);


  // Clean up selectedAdditionalSearches when options are filtered out
  useEffect(() => {
    const isAbnPpsrSelected = selectedSearches.has('ABN/ACN PPSR');
    const isAsicSelected = selectedSearches.has('ASIC');
    const isCourtSelected = selectedSearches.has('COURT');
    const isAtoSelected = selectedSearches.has('ATO');

    const filteredOptions = new Set(additionalSearchOptions.map(opt => opt.name));
    const newSelected = new Set(selectedAdditionalSearches);
    let hasChanges = false;
    const landTitleOptionsToReset: LandTitleOption[] = [];

    // Remove selections that are no longer available
    selectedAdditionalSearches.forEach(selected => {
      if (!filteredOptions.has(selected)) {
        newSelected.delete(selected);
        hasChanges = true;
        if (isLandTitleOption(selected)) {
          landTitleOptionsToReset.push(selected as LandTitleOption);
        }
      }
    });

    // Also remove ABN/ACN PPSR if it's selected in main searches
    if (isAbnPpsrSelected && newSelected.has('ABN/ACN PPSR')) {
      newSelected.delete('ABN/ACN PPSR');
      newSelected.delete('SELECT ALL'); // Remove SELECT ALL if any item is removed
      hasChanges = true;
    }

    // Also remove ASIC-CURRENT if ASIC is selected in main searches
    if (isAsicSelected && newSelected.has('ASIC - CURRENT')) {
      newSelected.delete('ASIC - CURRENT');
      newSelected.delete('SELECT ALL'); // Remove SELECT ALL if any item is removed
      hasChanges = true;
    }

    // Also remove ABN/ACN COURT FILES if COURT is selected in main searches
    if (isCourtSelected && newSelected.has('ABN/ACN COURT FILES')) {
      newSelected.delete('ABN/ACN COURT FILES');
      newSelected.delete('SELECT ALL'); // Remove SELECT ALL if any item is removed
      hasChanges = true;
    }

    if (isAtoSelected && newSelected.has('ATO')) {
      newSelected.delete('ATO');
      newSelected.delete('SELECT ALL');
      hasChanges = true;
    }

    if (hasChanges) {
      setSelectedAdditionalSearches(newSelected);
    }

    if (landTitleOptionsToReset.length > 0) {
      setLandTitleSelections(prev => {
        const updated = { ...prev };
        landTitleOptionsToReset.forEach(option => {
          updated[option] = { ...initialLandTitleSelection };
        });
        return updated;
      });
      setLandTitlePrices(prev => {
        const updated = { ...prev };
        landTitleOptionsToReset.forEach(option => {
          updated[option] = landTitlePricingConfig.base[option];
        });
        return updated;
      });
    }
  }, [selectedSearches, additionalSearchOptions]);

  // Clean up selectedIndividualAdditionalSearches when options are selected in main searches
  useEffect(() => {
    if (selectedCategory === 'INDIVIDUAL') {
      const newSelected = new Set(selectedIndividualAdditionalSearches);
      let hasChanges = false;

      // Remove any searches that are now selected in main searches
      selectedIndividualAdditionalSearches.forEach(selected => {
        if (selected !== 'SELECT ALL' && selectedSearches.has(selected)) {
          newSelected.delete(selected);
          hasChanges = true;
        }
      });

      // Remove SELECT ALL if any item was removed
      if (hasChanges && newSelected.size === 0) {
        newSelected.delete('SELECT ALL');
      } else if (hasChanges) {
        // Check if all remaining items are selected
        const availableSearches = searches.filter(s => s !== 'SELECT ALL' && !selectedSearches.has(s));
        const allSelected = availableSearches.length > 0 && availableSearches.every(s => newSelected.has(s));
        if (!allSelected) {
          newSelected.delete('SELECT ALL');
        }
      }

      if (hasChanges) {
        setSelectedIndividualAdditionalSearches(newSelected);
      }
    }
  }, [selectedSearches, selectedCategory, searches]);

  const handleSuggestionSelect = async (suggestion: ABNSuggestion) => {
    hasSelectedRef.current = true; // Mark as selected to prevent re-searching
    const displayText = suggestion.Name
      ? `${suggestion.Name} ABN: ${suggestion.Abn}`
      : `ABN: ${suggestion.Abn}`;
    setOrganisationSearchTerm(displayText);
setLandTitleOrganisationSearchTerm(displayText);
    setShowSuggestions(false);
          setLandTitleOrganisationShowSuggestions(false);
    setSuggestions([]);
    setLandTitleOrganisationSuggestions([]);

    // Store pending company for confirmation
    if (suggestion.Abn) {
      setPendingCompany({
        name: suggestion.Name || 'Unknown',
        abn: suggestion.Abn
      });
      setIsCompanyConfirmed(false);
    }
  };

  // Handle company confirmation - call createReport with type "asic-current"
  const handleConfirmCompany = async () => {
    if (!pendingCompany) return;

    setIsConfirmingCompany(true);
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (!user.userId) {
        alert('Please log in to continue');
        return;
      }

      const currentMatter = localStorage.getItem('currentMatter')
        ? JSON.parse(localStorage.getItem('currentMatter') || '{}')
        : null;

      const reportData: any = {
        business: {
          Abn: pendingCompany.abn,
          Name: pendingCompany.name,
          isCompany: 'ORGANISATION'
        },
        type: 'asic-current',
        userId: user.userId,
        matterId: currentMatter?.matterId,
        ispdfcreate: false
      };

      console.log('Creating report with data:', reportData);
      const reportResponse = await apiService.createReport(reportData);
      console.log('Report created:', reportResponse);

      // Mark as confirmed and show additional searches section
      setIsCompanyConfirmed(true);
      setHasSelectedCompany(true);

      // Check data availability and extract company details
      setCheckingData(true);
      setDataAvailable(null);
      try {
        const result = await apiService.checkDataAvailability(pendingCompany.abn, 'asic-current');
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

            // Extract director information (first name, last name, DOB) for current directors
            if (currentDirectors > 0 && asicExtract.directors) {
              const directorsInfo: DirectorInfo[] = asicExtract.directors
                .filter((d: any) => d.status === 'Current')
                .map((director: any) => {
                  // Parse full name into first and last name
                  const fullName = director.name || '';
                  const nameParts = fullName.trim().split(/\s+/);
                  const firstName = nameParts.length > 0 ? nameParts[0] : '';
                  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

                  // Format DOB - handle different formats
                  let dob = '';
                  if (director.dob) {
                    // If DOB is already in DD/MM/YYYY format, use it
                    if (typeof director.dob === 'string' && director.dob.includes('/')) {
                      dob = director.dob;
                    } else {
                      // If it's a date object or ISO string, format it
                      try {
                        const dateObj = new Date(director.dob);
                        if (!isNaN(dateObj.getTime())) {
                          const day = String(dateObj.getDate()).padStart(2, '0');
                          const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                          const year = dateObj.getFullYear();
                          dob = `${day}/${month}/${year}`;
                        }
                      } catch (e) {
                        dob = director.dob.toString();
                      }
                    }
                  }

                  return {
                    firstName,
                    lastName,
                    dob,
                    fullName
                  };
                });

              setDirectorsList(directorsInfo);
            } else {
              setDirectorsList([]);
            }

          }
        } else {
          // Reset to 0 if no data available
          setCompanyDetails({ directors: 0, pastDirectors: 0, shareholders: 0 });
          setDirectorsList([]);
        }
      } catch (error) {
        console.error('Error checking data:', error);
        setDataAvailable(null);
        setCompanyDetails({ directors: 0, pastDirectors: 0, shareholders: 0 });
      } finally {
        setCheckingData(false);
      }
    } catch (error) {
      console.error('Error creating report:', error);
      alert('Failed to create report. Please try again.');
    } finally {
      setIsConfirmingCompany(false);
    }
  };

  // Handle changing company selection
  const handleChangeCompany = () => {
    setPendingCompany(null);
    setIsCompanyConfirmed(false);
    setIsIndividualNameConfirmed(false);
    setHasSelectedCompany(false);
    setOrganisationSearchTerm('');
  setLandTitleOrganisationSearchTerm('');
    setShowSuggestions(false);
          setLandTitleOrganisationShowSuggestions(false);
    setSuggestions([]);
    setLandTitleOrganisationSuggestions([]);
    hasSelectedRef.current = false;
    setSelectedAdditionalSearches(new Set());
    resetLandTitleSelections();
    setDataAvailable(null);
    setCheckingData(false);
    setCompanyDetails({ directors: 0, pastDirectors: 0, shareholders: 0 });
    setIsAsicModalOpen(false);
  };

  // Clear selections when category changes
  const handleCategoryChange = (category: CategoryType) => {
    setSelectedCategory(category);
    setSelectedSearches(new Set());
    setSelectedAsicTypes(new Set());
    setIsAsicModalOpen(false);
    setIsCourtModalOpen(false);
    setSelectedCourtType('ALL');
    setIsDocumentModalOpen(false);
    setOrganisationSearchTerm('');
      setLandTitleOrganisationSearchTerm('');
    setSuggestions([]);
    setLandTitleOrganisationSuggestions([]);
    setShowSuggestions(false);
          setLandTitleOrganisationShowSuggestions(false);
    hasSelectedRef.current = false;
    setHasSelectedCompany(false);
    setSelectedAdditionalSearches(new Set());
    resetLandTitleSelections();
    setDataAvailable(null);
    setCheckingData(false);
    setCompanyDetails({ directors: 0, pastDirectors: 0, shareholders: 0 });
    setDirectorsList([]);
    setPendingCompany(null);
    setIsCompanyConfirmed(false);
    setIsIndividualNameConfirmed(false);
    setDocumentSearchId('');
    setDocumentIdInput('');

    // Clear individual details
    setIndividualFirstName('');
    setIndividualLastName('');
    setIndividualDateOfBirth('');
    setSelectedIndividualAdditionalSearches(new Set());
  };

  const handleAsicTypeToggle = (asicType: AsicType) => {
    const newSelected = new Set(selectedAsicTypes);
    const syncSelectAllState = () => {
      if (newSelected.has('CURRENT/HISTORICAL') && newSelected.has('COMPANY')) {
        newSelected.add('SELECT ALL');
      } else {
        newSelected.delete('SELECT ALL');
      }
    };

    if (asicType === 'SELECT ALL') {
      if (selectedAsicTypes.has('SELECT ALL')) {
        newSelected.clear();
      } else {
        newSelected.clear();
        newSelected.add('CURRENT/HISTORICAL');
        newSelected.add('COMPANY');
        newSelected.add('SELECT ALL');
      }
    } else {
      if (newSelected.has(asicType)) {
        newSelected.delete(asicType);
      } else {
        if (asicType === 'CURRENT/HISTORICAL') {
          newSelected.delete('CURRENT');
        }
        if (asicType === 'CURRENT') {
          newSelected.delete('CURRENT/HISTORICAL');
        }
        newSelected.add(asicType);
      }
    }

    syncSelectAllState();

    setSelectedAsicTypes(newSelected);
  };

  const handleAsicSelectionConfirm = () => {
    if (selectedAsicTypeList.length === 0) {
      alert('Please select at least one ASIC report type');
      return;
    }
    closeAsicModal({ removeIfEmpty: false });
  };

  const handleAdditionalSearchToggle = (searchName: AdditionalSearchType) => {
    if (isAdditionalSearchesDisabled) {
      return;
    }

    if (isLandTitleOption(searchName)) {
      const landOption = searchName as LandTitleOption;
      if (selectedAdditionalSearches.has(searchName)) {
        const updated = new Set(selectedAdditionalSearches);
        updated.delete(searchName);
        updated.delete('SELECT ALL');
        ensureAdditionalSelectAllState(updated);
        setSelectedAdditionalSearches(updated);
        setLandTitleSelections(prev => ({
          ...prev,
          [landOption]: { ...initialLandTitleSelection }
        }));
        setLandTitlePrices(prev => ({
          ...prev,
          [landOption]: landTitlePricingConfig.base[landOption]
        }));
        return;
      }

      openLandTitleModal(landOption);
      return;
    }

    const newSelected = new Set(selectedAdditionalSearches);

    if (searchName === 'SELECT ALL') {
      if (selectedAdditionalSearches.has('SELECT ALL')) {
        newSelected.clear();
      } else {
        additionalSearchOptions.forEach(option => {
          const optionName = option.name as AdditionalSearchType;
          if (isLandTitleOption(optionName)) {
            const landOption = optionName as LandTitleOption;
            const selection = landTitleSelections[landOption] || { ...initialLandTitleSelection };
            const price = calculateLandTitlePrice(landOption, selection);
            setLandTitlePrices(prev => ({ ...prev, [landOption]: price }));
            newSelected.add(landOption);
          } else {
            newSelected.add(optionName);
          }
        });
        ensureAdditionalSelectAllState(newSelected);
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
    ensureAdditionalSelectAllState(newSelected);
    setSelectedAdditionalSearches(newSelected);
  };

  const handleLandTitleModalConfirm = () => {
    if (!landTitleModalOpen) return;
    const selection = { ...pendingLandTitleSelection };
    const price = calculateLandTitlePrice(landTitleModalOpen, selection);
    setLandTitleSelections(prev => ({ ...prev, [landTitleModalOpen]: selection }));
    setLandTitlePrices(prev => ({ ...prev, [landTitleModalOpen]: price }));
    setSelectedAdditionalSearches(prev => {
      const updated = new Set(prev);
      updated.add(landTitleModalOpen);
      ensureAdditionalSelectAllState(updated);
      return updated;
    });
    closeLandTitleModal();
  };

  const handleLandTitleSummaryContinue = () => {
    setPendingLandTitleSelection(prev => ({ ...prev, summary: true }));
    setLandTitleModalStep('DETAIL');
  };

  const handleLandTitleDetailSelect = (detail: LandTitleDetailSelection) => {
    setPendingLandTitleSelection(prev => ({
      ...prev,
      detail,
      summary: detail === 'SUMMARY'
    }));
  };

  const handleLandTitleDetailContinue = () => {
    setLandTitleModalStep('ADD_ON');
  };

  const handleLandTitleDetailBack = () => {
    setLandTitleModalStep('SUMMARY_PROMPT');
  };

  const handleLandTitleAddOnSelect = (addOn: boolean) => {
    setPendingLandTitleSelection(prev => ({ ...prev, addOn }));
  };

  const handleLandTitleAddOnBack = () => {
    setLandTitleModalStep('DETAIL');
  };

  const getLandTitleLabel = useCallback(
    (option: LandTitleOption) => {
      const selection = landTitleSelections[option];
      if (!selection) return option;
      const parts: string[] = [];
      if (selection.detail === 'CURRENT') {
        const count = option === 'DIRECTOR LAND TITLE' ? companyDetails.directors || 0 : companyDetails.shareholders || 0;
        parts.push(`Current${count ? ` (${count} available)` : ''}`);
      } else if (selection.detail === 'PAST') {
        const count = option === 'DIRECTOR LAND TITLE' ? companyDetails.pastDirectors || 0 : companyDetails.shareholders || 0;
        parts.push(`Past${count ? ` (${count} available)` : ''}`);
      } else if (selection.detail === 'ALL') {
        const currentCount = option === 'DIRECTOR LAND TITLE' ? companyDetails.directors || 0 : companyDetails.shareholders || 0;
        const pastCount = option === 'DIRECTOR LAND TITLE' ? companyDetails.pastDirectors || 0 : 0;
        const total = currentCount + pastCount;
        parts.push(`All${total ? ` (${total} available)` : ''}`);
      } else {
        parts.push('Summary');
      }
      if (selection.addOn) {
        parts.push('Property Value + Sales History + More');
      }
      return `${option}${parts.length ? ` (${parts.join(', ')})` : ''}`;
    },
    [companyDetails.directors, companyDetails.pastDirectors, companyDetails.shareholders, landTitleSelections]
  );

  const getAdditionalSearchLabel = useCallback(
    (search: AdditionalSearchType) => {
      if (isLandTitleOption(search)) {
        return getLandTitleLabel(search);
      }
      return search;
    },
    [getLandTitleLabel]
  );

  const handleIndividualAdditionalSearchToggle = (searchName: SearchType) => {
    if (!isIndividualNameConfirmed) {
      return;
    }

    const newSelected = new Set(selectedIndividualAdditionalSearches);

    if (searchName === 'SELECT ALL') {
      if (selectedIndividualAdditionalSearches.has('SELECT ALL')) {
        newSelected.clear();
      } else {
        // Only add searches that are not selected in main searches
        searches.forEach(s => {
          if (s !== 'SELECT ALL' && !selectedSearches.has(s)) {
            newSelected.add(s);
          }
        });
        if (newSelected.size > 0) {
          newSelected.add('SELECT ALL');
        }
      }
    } else {
      if (newSelected.has(searchName)) {
        newSelected.delete(searchName);
        newSelected.delete('SELECT ALL');
      } else {
        newSelected.add(searchName);
        const availableSearches = searches.filter(s => s !== 'SELECT ALL' && !selectedSearches.has(s));
        const allIndividualSelected = availableSearches.every(s => newSelected.has(s) || s === searchName);
        if (allIndividualSelected && availableSearches.length > 0) {
          newSelected.add('SELECT ALL');
        }
      }
    }
    setSelectedIndividualAdditionalSearches(newSelected);
  };


  // Check if all individual additional searches are selected (excluding SELECT ALL)
  const allIndividualAdditionalSearchesSelected = useMemo(() => {
    const availableSearches = searches.filter(s => s !== 'SELECT ALL' && !selectedSearches.has(s));
    return availableSearches.length > 0 && availableSearches.every(s => selectedIndividualAdditionalSearches.has(s));
  }, [selectedIndividualAdditionalSearches, selectedSearches, searches]);

  const handleSendEmail = async () => {
    if (!emailAddress.trim()) {
      alert('Please enter an email address');
      return;
    }

    if (pdfFilenames.length === 0) {
      alert('No reports available to send');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailAddress.trim())) {
      alert('Please enter a valid email address');
      return;
    }

    setIsSendingEmail(true);
    setEmailSent(false);

    try {
      const currentMatter = localStorage.getItem('currentMatter')
        ? JSON.parse(localStorage.getItem('currentMatter') || '{}')
        : null;

      const response = await apiService.sendReports(
        emailAddress.trim(),
        pdfFilenames,
        currentMatter?.matterName || 'Matter'
      );

      if (response.success) {
        setEmailSent(true);
        alert(`Reports sent successfully to ${emailAddress.trim()}!`);
        setEmailAddress(''); // Clear email field
      } else {
        alert('Failed to send reports. Please try again.');
      }
    } catch (error: any) {
      console.error('Error sending email:', error);
      alert(error.message || 'Failed to send reports. Please try again.');
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleReportsDownload = async () => {
    if (pdfFilenames.length === 0) {
      alert('No reports available for download');
      return;
    }

    try {
      // Get S3 configuration from environment or use local media path
      const BUCKET_NAME = import.meta.env.VITE_AWS_BUCKET_NAME;
      const AWS_REGION = import.meta.env.VITE_AWS_REGION;

      console.log(BUCKET_NAME);
      console.log(AWS_REGION);
      // Download each PDF
      for (const filename of pdfFilenames) {
        let downloadUrl: string;
        console.log(filename);
        console.log(BUCKET_NAME);
        console.log(AWS_REGION);
        //if (BUCKET_NAME && AWS_REGION) {
        // Use S3 URL
        downloadUrl = `https://credion-reports.s3.ap-southeast-2.amazonaws.com/${filename}`;
        console.log(downloadUrl);
        //}

        // Create a temporary anchor element to trigger download
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Small delay between downloads to avoid browser blocking
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      alert(`Downloaded ${pdfFilenames.length} report(s) successfully!`);
    } catch (error: any) {
      console.error('Error downloading reports:', error);
      alert(`Error downloading reports: ${error?.message || 'Unknown error'}`);
    }
  }
  // Process reports handler
  const handleProcessReports = async () => {
    // Validation checks
    if (selectedCategory === 'ORGANISATION' && !isCompanyConfirmed) {
      alert('Please select and confirm a company first');
      return;
    }

    if (selectedCategory === 'INDIVIDUAL') {
      if (!individualFirstName || !individualLastName) {
        alert('Please enter first name and last name');
        return;
      }
    }

    // Check if at least one search is selected
    const hasMainSearches = Array.from(selectedSearches).some(s => s !== 'SELECT ALL');
    const hasAdditionalSearches = selectedCategory === 'ORGANISATION'
      ? Array.from(selectedAdditionalSearches).some(s => s !== 'SELECT ALL')
      : Array.from(selectedIndividualAdditionalSearches).some(s => s !== 'SELECT ALL');
    const hasAsicTypes = selectedAsicTypeList.length > 0;

    // Validation: If ASIC is selected, ASIC type must be selected
    if (selectedCategory === 'ORGANISATION' && selectedSearches.has('ASIC') && !hasAsicTypes) {
      alert('Please select an ASIC type (Current, Current/Historical, or Company) when ASIC is selected');
      return;
    }

    if (!hasMainSearches && !hasAdditionalSearches && !hasAsicTypes) {
      alert('Please select at least one search option');
      return;
    }

    if (selectedCategory === 'LAND TITLE' && !selectedLandTitleOption) {
      alert('Please select a land title report option');
      setIsProcessingReports(false);
      return;
    }

    if (
      selectedCategory === 'LAND TITLE' &&
      selectedLandTitleOption === 'TITLE_REFERENCE' &&
      !isTitleReferenceSelectionConfirmed
    ) {
      alert('Please confirm your Title Reference report selection before processing');
      return;
    }

    if (selectedSearches.has('ADD DOCUMENT SEARCH') && !documentSearchId) {
      alert('Please enter a document ID for the Add Document Search option');
      return;
    }

    console.log('Processing reports...');
    setIsProcessingReports(true);
    // Reset PDF filenames array for new batch
    setPdfFilenames([]);

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
      const reportsToCreate: Array<{ type: string; name: string; meta?: Record<string, unknown> }> = [];

      // Add main searches (handled separately for Land Title category)
      if (selectedCategory !== 'LAND TITLE') {
        Array.from(selectedSearches)
          .filter(search => search !== 'SELECT ALL')
          .forEach(search => {
            if (search === 'ASIC') {
              // Don't add generic ASIC if specific types are selected
              if (hasAsicTypes) {
                return;
              }
            }
            const meta = isLandTitleOption(search) ? { landTitleSelection: landTitleSelections[search as LandTitleOption] } : undefined;
            reportsToCreate.push({ type: search, name: search, meta });
          });
      }

      // Add ASIC types if selected
      if (selectedCategory === 'ORGANISATION' && selectedSearches.has('ASIC')) {
        selectedAsicTypeList.forEach(type => {
          reportsToCreate.push({ type: `ASIC: ${type}`, name: `ASIC ${type}` });
        });
      }

      // Add additional searches for ORGANISATION
      if (selectedCategory === 'ORGANISATION') {
        Array.from(selectedAdditionalSearches)
          .filter(search => search !== 'SELECT ALL')
          .forEach(search => {
            const additional = search as AdditionalSearchType;
            const meta = isLandTitleOption(additional)
              ? { landTitleSelection: landTitleSelections[additional as LandTitleOption] }
              : undefined;
            reportsToCreate.push({ type: search, name: search, meta });
          });
      }

      if (selectedCategory === 'LAND TITLE') {
        if (!selectedLandTitleOption) {
          alert('Please select a land title report option');
          setIsProcessingReports(false);
          return;
        }
        if (selectedLandTitleOption === 'LAND_ORGANISATION') {
          if (landTitleOrganisationStates.size === 0) {
            alert('Please select at least one state');
            setIsProcessingReports(false);
            return;
          }
          if (!landTitleOrganisationSelected || !isLandTitleOrganisationConfirmed) {
            alert('Please search and confirm a company');
            setIsProcessingReports(false);
            return;
          }
        }
        if (selectedLandTitleOption === 'TITLE_REFERENCE' && !landTitleReferenceId.trim()) {
          alert('Please enter a reference ID');
          setIsProcessingReports(false);
          return;
        }
        if (selectedLandTitleOption === 'LAND_INDIVIDUAL') {
          if (!landTitleIndividualFirstName.trim() || !landTitleIndividualLastName.trim()) {
            alert('Please enter first name and last name');
            setIsProcessingReports(false);
            return;
          }
          if (landTitleIndividualDobMode === 'EXACT' && !landTitleIndividualDob) {
            alert('Please enter a date of birth');
            setIsProcessingReports(false);
            return;
          }
          if (
            landTitleIndividualDobMode === 'RANGE' &&
            (!landTitleIndividualStartYear.trim() || !landTitleIndividualEndYear.trim())
          ) {
            alert('Please enter a start and end year');
            setIsProcessingReports(false);
            return;
          }
          if (landTitleIndividualStates.size === 0) {
            alert('Please select at least one state');
            setIsProcessingReports(false);
            return;
          }
        }
        if (selectedLandTitleOption === 'ADDRESS' && !landTitleAddress.trim()) {
          alert('Please enter an address');
          setIsProcessingReports(false);
          return;
        }

        const landTitleMeta: Record<string, unknown> = {
          option: selectedLandTitleOption,
          addOn: isLandTitleAddOnSelected
        };

        if (selectedLandTitleOption === 'TITLE_REFERENCE') {
          landTitleMeta.detail = titleReferenceSelection.detail;
          landTitleMeta.summary = titleReferenceSelection.summary;
        }

        switch (selectedLandTitleOption) {
          case 'TITLE_REFERENCE':
            landTitleMeta.referenceId = landTitleReferenceId.trim();
            break;
          case 'LAND_ORGANISATION':
            landTitleMeta.states = Array.from(landTitleOrganisationStates);
            landTitleMeta.organisation = {
              name: landTitleOrganisationSelected?.Name,
              abn: landTitleOrganisationSelected?.Abn,
              confirmed: isLandTitleOrganisationConfirmed
            };
            landTitleMeta.searchTerm = landTitleOrganisationSearchTerm;
            break;
          case 'LAND_INDIVIDUAL':
            landTitleMeta.person = {
              firstName: landTitleIndividualFirstName.trim(),
              lastName: landTitleIndividualLastName.trim(),
              dobMode: landTitleIndividualDobMode,
              dob: landTitleIndividualDob,
              startYear: landTitleIndividualStartYear.trim(),
              endYear: landTitleIndividualEndYear.trim(),
              states: Array.from(landTitleIndividualStates)
            };
            break;
          case 'ADDRESS':
            landTitleMeta.address = landTitleAddress.trim();
            break;
        }

        reportsToCreate.push({
          type: landTitleCategoryReportTypeMap[selectedLandTitleOption],
          name: landTitleCategoryOptionConfig[selectedLandTitleOption].label,
          meta: landTitleMeta
        });
      }

      // Add additional searches for INDIVIDUAL
      if (selectedCategory === 'INDIVIDUAL') {
        Array.from(selectedIndividualAdditionalSearches)
          .filter(search => search !== 'SELECT ALL')
          .forEach(search => {
            reportsToCreate.push({ type: search, name: search });
          });
      }

      console.log('Reports to create:', reportsToCreate);

      // Process each report
      const createdReports = [];
      //let company_type = 'N/A';
      for (const reportItem of reportsToCreate) {
        console.log('Processing report:', reportItem);
        //company_type = reportItem.type

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
          if (selectedCategory === 'INDIVIDUAL') {
            if (selectedCourtType === 'CIVIL COURT') {
              reportType = 'director-court-civil';
            } else if (selectedCourtType === 'CRIMINAL COURT') {
              reportType = 'director-court-criminal';
            } else {
              reportType = 'director-court';
            }
          } else {
            reportType = 'court';
          }
        } else if (reportItem.type === 'ATO') {
          reportType = 'ato';
        } else if (reportItem.type === 'BANKRUPTCY') {
          // For INDIVIDUAL category, use same type as directors (individual-bankruptcy)
          reportType = selectedCategory === 'INDIVIDUAL' ? 'director-bankruptcy' : 'bankruptcy';
        } else if (reportItem.type === 'LAND TITLE') {
          // For INDIVIDUAL category, use same type as directors (individual-property)
          reportType = selectedCategory === 'INDIVIDUAL' ? 'director-property' : 'land';
        } else if (reportItem.type === 'ABN/ACN PPSR' || reportItem.type === 'PPSR') {
          // For INDIVIDUAL category, use same type as directors (director-ppsr)
          reportType = selectedCategory === 'INDIVIDUAL' ? 'director-ppsr' : 'ppsr';
        } else if (reportItem.type === 'ASIC') {
          // For INDIVIDUAL category, use same type as directors (director-related)
          reportType = selectedCategory === 'INDIVIDUAL' ? 'director-related' : 'asic-current';
        } else if (reportItem.type === 'ABN/ACN LAND TITLE') {
          reportType = 'property';
        } else if (reportItem.type === 'ABN/ACN COURT FILES') {
          reportType = 'court';
        } else if (reportItem.type === 'ASIC - CURRENT') {
          reportType = 'asic-current';
        } else if (reportItem.type === 'ATO') {
          reportType = 'ato';
        } else if (reportItem.type.includes('DIRECTOR')) {
          if (reportItem.type.includes('PPSR')) {
            reportType = 'director-ppsr';
          } else if (reportItem.type.includes('BANKRUPTCY')) {
            reportType = 'director-bankruptcy';
          } else if (reportItem.type.includes('LAND TITLE')) {
            reportType = 'director-property';
          } else {
            reportType = 'director-related';
          }
        } else if (reportItem.type === 'ADD DOCUMENT SEARCH') {
          reportType = 'asic-document-search';
        } else if (reportItem.type === 'ASIC - CURRENT') {
          reportType = 'asic-current';
        } else {
          // Default fallback
          reportType = reportItem.type.toLowerCase().replace(/\s+/g, '-');
        }

        // Create report data
        const user = localStorage.getItem("user") ? JSON.parse(localStorage.getItem("user") || '{}') : null;
        const currentMatter = localStorage.getItem('currentMatter') ? JSON.parse(localStorage.getItem('currentMatter') || '{}') : null;

        const reportData: any = {
          type: reportType,
          userId: user?.userId || 0,
          matterId: currentMatter?.matterId,
          ispdfcreate: true as const
        };

        const isDirectorReport = reportType.startsWith('director-');
        const shouldLoopDirectors = isDirectorReport && selectedCategory === 'ORGANISATION' && directorsList.length > 0;
        if (shouldLoopDirectors) {
          // Loop through each director and create a report for each
          console.log(`Creating ${reportType} reports for ${directorsList.length} directors`);
          for (const director of directorsList) {
            const reportData: any = {
              type: reportType,
              userId: user?.userId || 0,
              matterId: currentMatter?.matterId,
              ispdfcreate: true as const,
              business: {
                Abn: abn,
                Name: companyName || 'Unknown',
                isCompany: 'ORGANISATION',
                fname: director.firstName,
                lname: director.lastName,
                dob: director.dob
              }
            };

            if (reportItem.meta?.landTitleSelection) {
              reportData.business = {
                ...reportData.business,
                landTitleSelection: reportItem.meta.landTitleSelection
              };
            }

            console.log(`Creating report for director: ${director.fullName || `${director.firstName} ${director.lastName}`}`, reportData);

            // Call backend to create report
            const reportResponse = await apiService.createReport(reportData);
            console.log('Report created:', reportResponse);

            // Extract PDF filename from response
            const pdfFilename = reportResponse?.report;

            if (pdfFilename && typeof pdfFilename === 'string') {
              // Add PDF filename to the array
              setPdfFilenames(prev => [...prev, pdfFilename]);
            }

            createdReports.push({
              reportResponse,
              pdfFilename: pdfFilename || undefined
            });
          }
        } else {
          let businessData = reportData.business ? { ...reportData.business } : undefined;

          if (selectedCategory === 'ORGANISATION') {
            businessData = {
              ...(businessData || {}),
              Abn: abn,
              Name: companyName || 'Unknown',
              isCompany: 'ORGANISATION'
            };
          } else if (selectedCategory === 'INDIVIDUAL') {
            businessData = {
              ...(businessData || {}),
              fname: individualFirstName,
              lname: individualLastName,
              dob: individualDateOfBirth,
              isCompany: 'INDIVIDUAL'
            };
          }

          if (reportItem.meta?.landTitleSelection) {
            businessData = {
              ...(businessData || {}),
              landTitleSelection: reportItem.meta.landTitleSelection
            };
          }

          if (businessData) {
            reportData.business = businessData;
          }

          if (reportItem.type === 'ADD DOCUMENT SEARCH' && documentSearchId) {
            reportData.business = {
              ...(reportData.business || {}),
              documentId: documentSearchId
            };
            reportData.documentId = documentSearchId;
          }

          console.log('Creating report with data:', reportData);

          // Call backend to create report
          const reportResponse = await apiService.createReport(reportData);
          console.log('Report created:', reportResponse);

          // Extract PDF filename from response
          // The response always has the filename in the 'report' property and always ends with .pdf
          const pdfFilename = reportResponse?.report;

          if (pdfFilename && typeof pdfFilename === 'string') {
            // Add PDF filename to the array
            setPdfFilenames(prev => [...prev, pdfFilename]);
          }

          createdReports.push({
            reportResponse,
            pdfFilename: pdfFilename || undefined
          });
        }
      }

      console.log('All reports created:', createdReports);
      setProccessReportStatus(true);
      setTotalDownloadReports(createdReports.length);

      // Ensure PDF filenames are set (they should already be set in the loop)
      const collectedFilenames = createdReports
        .map(r => r.pdfFilename)
        .filter(f => f); // Filter out undefined/null values

      if (collectedFilenames.length > 0) {
        setPdfFilenames(collectedFilenames);
      }


    } catch (error: any) {
      console.error('Error processing reports:', error);
      alert(`Error processing reports: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsProcessingReports(false);
    }
  };

  const directorCurrentCount = companyDetails.directors || 0;
  const directorPastCount = companyDetails.pastDirectors || 0;
  const shareholderCount = companyDetails.shareholders || 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="mx-auto py-16 px-8 pr-[370px]">
        <div className="flex gap-12">
          {/* Left Sidebar - Vertical Stepper */}
          <div className="w-[250px] flex-shrink-0 sticky top-32 self-start">
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
                <div className={`w-[34px] h-[34px] rounded-full border-2 flex items-center justify-center font-bold shadow-md z-10 ${activeStep === 0
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
                <div className={`w-[34px] h-[34px] rounded-full border-2 flex items-center justify-center font-bold shadow-md z-10 ${activeStep === 1
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
                <div className={`w-[34px] h-[34px] rounded-full border-2 flex items-center justify-center font-bold shadow-md z-10 ${activeStep === 2
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
                <div className={`w-[34px] h-[34px] rounded-full border-2 flex items-center justify-center font-bold shadow-md z-10 ${activeStep === 3
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
                      transition-all duration-300
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

            {/* Select Searches Card */}
            <div ref={searchesCardRef} className="bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
              <h2 className="text-[32px] font-bold text-center mb-10 text-gray-900 tracking-tight">
                Select <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20">Searches</span>
              </h2>

              {selectedCategory === 'LAND TITLE' ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    {landTitleCategoryOptions.map(option => {
                      const config = landTitleCategoryOptionConfig[option];
                      const isSelected = selectedLandTitleOption === option;
                      return (
                        <button
                          key={option}
                          onClick={() => handleLandTitleOptionSelect(option)}
                          className={`
                            px-6 py-5 rounded-xl font-semibold text-[13px] uppercase tracking-wide
                            transition-all duration-300 shadow-md min-h-[70px] flex items-center justify-center
                            ${isSelected
                              ? 'bg-red-600 text-white border-2 border-red-600 shadow-lg shadow-red-600/30 -translate-y-0.5'
                              : 'bg-gray-50 text-gray-600 border-2 border-gray-200 hover:border-red-600 hover:-translate-y-0.5 hover:shadow-lg'}
                          `}
                        >
                          {config.label}
                        </button>
                      );
                    })}
                  </div>

                  <p className="text-center text-s font-semibold uppercase tracking-wide text-gray-600">
                    Available as a single search or add it to your current search for more insight
                  </p>

                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={handleLandTitleAddOnToggle}
                      className={`
                        w-full sm:w-auto px-6 py-4 rounded-xl font-semibold text-[13px] uppercase tracking-wide transition-all duration-300 shadow-md border-2
                        ${isLandTitleAddOnSelected
                          ? 'border-red-600 bg-red-600 text-white shadow-lg shadow-red-600/30'
                          : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:-translate-y-0.5 hover:shadow-lg'
                        }
                        ${!selectedLandTitleOption ? 'focus-visible:outline-none' : ''}
                      `}
                    >
                      {LAND_TITLE_ADD_ON_LABEL}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 ${
                      isIndividualSearchLocked ? 'opacity-60' : ''
                    }`}
                  >
                  {searches.map((search) => {
                    const isSelected = selectedSearches.has(search);
                    const isSelectAll = search === 'SELECT ALL';

                    return (
                      <button
                        key={search}
                          disabled={isIndividualSearchLocked}
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
                        ${isIndividualSearchLocked ? 'cursor-not-allowed' : ''}
                      `}
                      >
                        {isSelectAll && allSearchesSelected ? 'DESELECT ALL' : getSearchDisplayName(search)}
                      </button>
                    );
                  })}
                  </div>
                  {isIndividualSearchLocked && (
                    <p className="mt-4 text-center text-sm font-medium text-gray-500">
                      Name confirmed. Update the person details above to modify selected searches.
                    </p>
                  )}
                </>
              )}
            </div>
            {selectedCategory === 'LAND TITLE' && (
              <div ref={detailsCardRef} className="bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
                <h2 className="text-[32px] font-bold text-center mb-10 text-gray-900 tracking-tight">
                  Enter <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20">{selectedLandTitleOption ? landTitleDetailHeadingMap[selectedLandTitleOption] : 'Details'}</span>
                </h2>

                {!selectedLandTitleOption ? (
                  <p className="text-center text-sm text-gray-500">
                    Select a search option above to continue.
                  </p>
                ) : (
                  (() => {
                    switch (selectedLandTitleOption) {
                      case 'TITLE_REFERENCE':
                        return (
                          <div className="max-w-2xl mx-auto space-y-6">
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-2">
                                Reference ID<span className="text-red-500">*</span>
                              </label>
                              <input
                                type="text"
                                value={landTitleReferenceId}
                                onChange={(event) => setLandTitleReferenceId(event.target.value)}
                                placeholder="Enter reference ID"
                                className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={handleTitleReferenceSearchClick}
                              className="w-full rounded-xl bg-red-600 py-4 font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
                            >
                              Search
                            </button>
                          </div>
                        );
                      case 'LAND_ORGANISATION':
                        return (
                          <div className="max-w-3xl mx-auto space-y-6">
                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                              * required fields
                            </div>

                            <div>
                              <span className="block text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
                                Select States<span className="text-red-500">*</span>
                              </span>
                              <div className="flex flex-wrap gap-3">
                                {landTitleStateOptions.map(state => {
                                  const isSelected = landTitleOrganisationStates.has(state);
                                  return (
<button
  key={state}
  type="button"
  onClick={() => handleLandTitleOrganisationStateToggle(state)}
  className={`
    px-6 py-4 rounded-2xl border-2 text-base font-semibold uppercase tracking-wide transition-all duration-200
    ${isSelected
      ? 'border-red-600 bg-red-600 text-white shadow-red-600/30'
      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'}
  `}
>
  {state}
</button>

                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={handleLandTitleOrganisationStateSelectAll}
                                  className={`
                                  px-5 py-3 rounded-xl border-2 text-sm font-semibold uppercase tracking-wide transition-all duration-200
                                  ${landTitleOrganisationStates.size === landTitleStateOptions.length
                                      ? 'border-red-600 bg-red-600 text-white shadow-red-600/30'
                                      : 'border-gray-200 bg-white text-red-600 hover:border-red-600'}
                                `}
                                >
                                  Select All
                                </button>
                              </div>
                            </div>

                            <div className="space-y-3">
                              <label className="block text-sm font-semibold text-gray-700">
                                Search Organisation<span className="text-red-500">*</span>
                              </label>

                    <div className="relative">
                      <input
                        type="text"
                        id="organisation-search"
                        name="organisation-search"
                        className={`block w-full px-4 py-3 border-2 rounded-xl shadow-sm text-base transition-all duration-200 ${landTitleOrganisationSearchDisabled
                          ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500'
                          }`}
                        placeholder="Type to search..."
                        value={landTitleOrganisationSearchTerm}
                        onChange={(e) => {
                          if (landTitleOrganisationSearchDisabled) return;
                            setLandTitleOrganisationSearchTerm(e.target.value);
                          // Clear pending company if user starts typing
                          if (pendingCompany && !isCompanyConfirmed) {
                            setPendingCompany(null);
                          }
                        }}
                        onFocus={() => {
                          if (landTitleOrganisationSearchDisabled) return;
                          hasSelectedRef.current = false; // Reset flag when field is focused
                          if (
                            landTitleOrganisationSearchTerm.trim().length >= 2 &&
                            landTitleOrganisationSuggestions.length > 0
                          ) {
                            setLandTitleOrganisationShowSuggestions(true);
                          }
                        }}
                        disabled={landTitleOrganisationSearchDisabled}
                      />
                      {landTitleOrganisationSearchTerm && (
                        <button
                          type="button"
                          onClick={() => {
                            handleChangeCompany();
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
                      {landTitleOrganisationShowSuggestions && (
                        <div
                          ref={landTitleOrganisationDropdownRef}
                          className="absolute z-50 w-full mt-2 bg-white border-2 border-gray-200 rounded-xl shadow-2xl max-h-80 overflow-y-auto"
                        >
                          {isLoadingLandTitleOrganisationSuggestions ? (
                            <div className="px-4 py-3 text-center text-gray-500">
                              <svg className="animate-spin h-5 w-5 mx-auto text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            </div>
                          ) : landTitleOrganisationSuggestions.length > 0 ? (
                            landTitleOrganisationSuggestions.map((suggestion, index) => (
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
                          ) : (
                            <div className="px-4 py-3 text-center text-gray-500">No results found</div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Company Confirmation Section */}
                    {pendingCompany && !isCompanyConfirmed && (
                      <div className="mt-6 bg-blue-50 border-2 border-blue-200 rounded-xl p-6 shadow-md">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">Selected Company</h3>
                            <div className="space-y-1">
                              <p className="text-base font-medium text-gray-800">
                                <span className="font-bold">Company:</span> {pendingCompany.name}
                              </p>
                              <p className="text-base font-medium text-gray-800">
                                <span className="font-bold">ABN:</span> {pendingCompany.abn}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-3 ml-4">
                            <button
                              type="button"
                              onClick={handleChangeCompany}
                              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border-2 border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors duration-200"
                            >
                              Change
                            </button>
                            <button
                              type="button"
                              onClick={handleConfirmCompany}
                              disabled={isConfirmingCompany}
                              className="px-6 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                            >
                              {isConfirmingCompany ? (
                                <span className="flex items-center">
                                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  Confirming...
                                </span>
                              ) : (
                                'Confirm'
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Confirmed Company Display */}
                    {isCompanyConfirmed && pendingCompany && (
                      <div className="mt-6 bg-green-50 border-2 border-green-200 rounded-xl p-6 shadow-md">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <h3 className="text-lg font-semibold text-gray-900">Company Confirmed</h3>
                            </div>
                            <div className="space-y-1">
                              <p className="text-base font-medium text-gray-800">
                                <span className="font-bold">Company:</span> {pendingCompany.name}
                              </p>
                              <p className="text-base font-medium text-gray-800">
                                <span className="font-bold">ABN:</span> {pendingCompany.abn}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleChangeCompany}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border-2 border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors duration-200"
                          >
                            Change Company
                          </button>
                        </div>
                      </div>
                    )}


                    
                                        


                            </div>
                          </div>
                        );
                      case 'LAND_INDIVIDUAL':
                        return (
                          <div className="max-w-3xl mx-auto space-y-6">
                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                              * required fields
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                  First Name<span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="text"
                                  value={landTitleIndividualFirstName}
                                  onChange={(event) => {
                                    setLandTitleIndividualFirstName(event.target.value);
                                    setIsIndividualNameConfirmed(false);
                                  }}
                                  placeholder="Enter first name"
                                  className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                  Last Name<span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="text"
                                  value={landTitleIndividualLastName}
                                  onChange={(event) => {
                                    setLandTitleIndividualLastName(event.target.value);
                                    setIsIndividualNameConfirmed(false);
                                  }}
                                  placeholder="Enter last name"
                                  className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                                />
                              </div>
                            </div>

                            <div className="space-y-4">
                              <span className="block text-sm font-semibold text-gray-700">
                                Date of Birth Options<span className="text-red-500">*</span>
                              </span>
                              <div className="flex flex-wrap gap-3">
                                {[
                                  { key: 'EXACT' as const, label: 'Exact Date of Birth' },
                                  { key: 'RANGE' as const, label: 'Birth Year Range' }
                                ].map(option => {
                                  const isSelected = landTitleIndividualDobMode === option.key;
                                  return (
                                    <button
                                      key={option.key}
                                      type="button"
                                      onClick={() => {
                                        setLandTitleIndividualDobMode(option.key);
                                        setIsIndividualNameConfirmed(false);
                                      }}
                                      className={`
                                      px-5 py-3 rounded-xl border-2 text-sm font-semibold uppercase tracking-wide transition-all duration-200
                                      ${isSelected
                                          ? 'border-red-600 bg-red-600 text-white shadow-red-600/30'
                                          : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'}
                                    `}
                                    >
                                      {option.label}
                                    </button>
                                  );
                                })}
                              </div>

                              {landTitleIndividualDobMode === 'EXACT' ? (
                                <input
                                  type="date"
                                  value={landTitleIndividualDob}
                                  onChange={(event) => {
                                    setLandTitleIndividualDob(event.target.value);
                                    setIsIndividualNameConfirmed(false);
                                  }}
                                  className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                                />
                              ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  <input
                                    type="number"
                                    value={landTitleIndividualStartYear}
                                    onChange={(event) => {
                                      setLandTitleIndividualStartYear(event.target.value);
                                      setIsIndividualNameConfirmed(false);
                                    }}
                                    placeholder="Start year"
                                    className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                                  />
                                  <input
                                    type="number"
                                    value={landTitleIndividualEndYear}
                                    onChange={(event) => {
                                      setLandTitleIndividualEndYear(event.target.value);
                                      setIsIndividualNameConfirmed(false);
                                    }}
                                    placeholder="End year"
                                    className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                                  />
                                </div>
                              )}
                            </div>

                            <div>
                              <span className="block text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
                                Select States<span className="text-red-500">*</span>
                              </span>
                              <div className="flex flex-wrap gap-3">
                                {landTitleStateOptions.map(state => {
                                  const isSelected = landTitleIndividualStates.has(state);
                                  return (
                                    <button
                                      key={state}
                                      type="button"
                                      onClick={() => handleLandTitleIndividualStateToggle(state)}
                                      className={`
                                      px-5 py-3 rounded-xl border-2 text-sm font-semibold uppercase tracking-wide transition-all duration-200
                                      ${isSelected
                                          ? 'border-red-600 bg-red-600 text-white shadow-red-600/30'
                                          : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'}
                                    `}
                                    >
                                      {state}
                                    </button>
                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={handleLandTitleIndividualStateSelectAll}
                                  className={`
                                  px-5 py-3 rounded-xl border-2 text-sm font-semibold uppercase tracking-wide transition-all duration-200
                                  ${landTitleIndividualStates.size === landTitleStateOptions.length
                                      ? 'border-red-600 bg-red-600 text-white shadow-red-600/30'
                                      : 'border-gray-200 bg-white text-red-600 hover:border-red-600'}
                                `}
                                >
                                  Select All
                                </button>
                              </div>
                            </div>

                            {isLandTitleIndividualSearchPerformed ? (
                              <div className="space-y-4">
                                <div>
                                  <div className="grid grid-cols-1 gap-3">
                                    {mockLandTitleIndividualMatches.map(match => {
                                      const isSelected = selectedLandTitleIndividualMatch === match;
                                      return (
                                        <button
                                          key={match}
                                          type="button"
                                          onClick={() => {
                                            setSelectedLandTitleIndividualMatch(match);
                                            setIsIndividualNameConfirmed(false);
                                          }}
                                          className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${isSelected
                                              ? 'border-green-500 bg-green-50 text-green-700'
                                              : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                                            }`}
                                        >
                                          {match}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                                {selectedLandTitleIndividualMatch && (
                                  <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                                    Selected Name: {selectedLandTitleIndividualMatch}
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!selectedLandTitleIndividualMatch) {
                                      alert('Please select a name to confirm');
                                      return;
                                    }
                                    setPendingLandTitleSelection({
                                      summary: true,
                                      detail: 'SUMMARY',
                                      addOn: isLandTitleAddOnSelected
                                    });
                                setIsLandTitleIndividualDetailModalOpen(false);
                                setIsLandTitleIndividualAddOnModalOpen(false);
                                setIsLandTitleIndividualSummaryModalOpen(true);
                                  }}
                                  disabled={!selectedLandTitleIndividualMatch}
                                  className="w-full rounded-xl bg-red-600 py-4 font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  Confirm Name Search
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={handleLandTitleIndividualSearchClick}
                                className="mt-6 w-full rounded-xl bg-red-600 py-4 font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
                              >
                                Search
                              </button>
                            )}
                          </div>
                        );
                      case 'ADDRESS':
                        return (
                          <div className="max-w-2xl mx-auto space-y-6">
                            <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-2">
                                Address<span className="text-red-500">*</span>
                              </label>
                              <input
                                type="text"
                                value={landTitleAddress}
                                onChange={(event) => setLandTitleAddress(event.target.value)}
                                placeholder="Enter address"
                                className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                              />

                              <button
                                type="button"
                                onClick={handleLandTitleAddressSearchClick}
                                className="mt-6 w-full rounded-xl bg-red-600 py-4 font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
                              >
                                Search
                              </button>

                            </div>
                          </div>
                        );
                      default:
                        return null;
                    }
                  })()
                )}
              </div>
            )}

            {/* Enter Search Details Card - Show when ORGANISATION selected */}
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
                        className={`block w-full px-4 py-3 border-2 rounded-xl shadow-sm text-base transition-all duration-200 ${organisationSearchDisabled
                          ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500'
                          }`}
                        placeholder="Type to search..."
                        value={organisationSearchTerm}
                        onChange={(e) => {
                          if (organisationSearchDisabled) return;
                          setOrganisationSearchTerm(e.target.value);
                          // Clear pending company if user starts typing
                          if (pendingCompany && !isCompanyConfirmed) {
                            setPendingCompany(null);
                          }
                        }}
                        onFocus={() => {
                          if (organisationSearchDisabled) return;
                          hasSelectedRef.current = false; // Reset flag when field is focused
                          if (organisationSearchTerm.trim().length >= 2 && suggestions.length > 0) {
                            setShowSuggestions(true);
                          }
                        }}
                        disabled={organisationSearchDisabled}
                      />
                      {organisationSearchTerm && (
                        <button
                          type="button"
                          onClick={() => {
                            handleChangeCompany();
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

                    {/* Company Confirmation Section */}
                    {pendingCompany && !isCompanyConfirmed && (
                      <div className="mt-6 bg-blue-50 border-2 border-blue-200 rounded-xl p-6 shadow-md">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">Selected Company</h3>
                            <div className="space-y-1">
                              <p className="text-base font-medium text-gray-800">
                                <span className="font-bold">Company:</span> {pendingCompany.name}
                              </p>
                              <p className="text-base font-medium text-gray-800">
                                <span className="font-bold">ABN:</span> {pendingCompany.abn}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-3 ml-4">
                            <button
                              type="button"
                              onClick={handleChangeCompany}
                              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border-2 border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors duration-200"
                            >
                              Change
                            </button>
                            <button
                              type="button"
                              onClick={handleConfirmCompany}
                              disabled={isConfirmingCompany}
                              className="px-6 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                            >
                              {isConfirmingCompany ? (
                                <span className="flex items-center">
                                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  Confirming...
                                </span>
                              ) : (
                                'Confirm'
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Confirmed Company Display */}
                    {isCompanyConfirmed && pendingCompany && (
                      <div className="mt-6 bg-green-50 border-2 border-green-200 rounded-xl p-6 shadow-md">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <h3 className="text-lg font-semibold text-gray-900">Company Confirmed</h3>
                            </div>
                            <div className="space-y-1">
                              <p className="text-base font-medium text-gray-800">
                                <span className="font-bold">Company:</span> {pendingCompany.name}
                              </p>
                              <p className="text-base font-medium text-gray-800">
                                <span className="font-bold">ABN:</span> {pendingCompany.abn}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleChangeCompany}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border-2 border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors duration-200"
                          >
                            Change Company
                          </button>
                        </div>
                      </div>
                    )}


                  </div>
                </div>
              </div>
            )}

            {/* Enter Person Details Card - Show when INDIVIDUAL selected */}
            {selectedCategory === 'INDIVIDUAL' && (

              <div ref={detailsCardRef} className="bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
                <h2 className="text-[32px] font-bold text-center mb-10 text-gray-900 tracking-tight">
                  Enter <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20"> Person Details</span>
                </h2>

                <div className="max-w-3xl mx-auto space-y-6">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    * required fields
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        First Name<span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={landTitleIndividualFirstName}
                        onChange={(event) => {
                          setLandTitleIndividualFirstName(event.target.value);
                          setIsIndividualNameConfirmed(false);
                        }}
                        placeholder="Enter first name"
                        className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Last Name<span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={landTitleIndividualLastName}
                        onChange={(event) => {
                          setLandTitleIndividualLastName(event.target.value);
                          setIsIndividualNameConfirmed(false);
                        }}
                        placeholder="Enter last name"
                        className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <span className="block text-sm font-semibold text-gray-700">
                      Date of Birth Options<span className="text-red-500">*</span>
                    </span>
                    <div className="flex flex-wrap gap-3">
                      {[
                        { key: 'EXACT' as const, label: 'Exact Date of Birth' },
                        { key: 'RANGE' as const, label: 'Birth Year Range' }
                      ].map(option => {
                        const isSelected = landTitleIndividualDobMode === option.key;
                        return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => {
                          setLandTitleIndividualDobMode(option.key);
                          setIsIndividualNameConfirmed(false);
                        }}
                            className={`
                      px-5 py-3 rounded-xl border-2 text-sm font-semibold uppercase tracking-wide transition-all duration-200
                      ${isSelected
                                ? 'border-red-600 bg-red-600 text-white shadow-red-600/30'
                                : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'}
                    `}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>

                    {landTitleIndividualDobMode === 'EXACT' ? (
                      <input
                        type="date"
                        value={landTitleIndividualDob}
                        onChange={(event) => {
                          setLandTitleIndividualDob(event.target.value);
                          setIsIndividualNameConfirmed(false);
                        }}
                        className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                      />
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <input
                          type="number"
                          value={landTitleIndividualStartYear}
                          onChange={(event) => {
                            setLandTitleIndividualStartYear(event.target.value);
                            setIsIndividualNameConfirmed(false);
                          }}
                          placeholder="Start year"
                          className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                        />
                        <input
                          type="number"
                          value={landTitleIndividualEndYear}
                          onChange={(event) => {
                            setLandTitleIndividualEndYear(event.target.value);
                            setIsIndividualNameConfirmed(false);
                          }}
                          placeholder="End year"
                          className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                        />
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleLandTitleIndividualSearchClick}
                    className="mt-6 w-full rounded-xl bg-red-600 py-4 font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
                  >
                    Search
                  </button>


                  <div className="space-y-4">
                    <div>
                      <div className="grid grid-cols-1 gap-3">
                                    {mockLandTitleIndividualMatches.map(match => {
                                      const isSelected = selectedLandTitleIndividualMatch === match;
                                      return (
                                        <button
                                          key={match}
                                          type="button"
                                          onClick={() => {
                                            setSelectedLandTitleIndividualMatch(match);
                                            setIsIndividualNameConfirmed(false);
                                          }}
                              className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${isSelected
                                  ? 'border-green-500 bg-green-50 text-green-700'
                                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                                }`}
                            >
                              {match}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {selectedLandTitleIndividualMatch && (
                      <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        Selected Name: {selectedLandTitleIndividualMatch}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedLandTitleIndividualMatch) {
                          alert('Please select a name to confirm');
                          return;
                        }
                        setPendingLandTitleSelection({
                          summary: true,
                          detail: 'SUMMARY',
                          addOn: isLandTitleAddOnSelected
                        });
                        setIsLandTitleIndividualDetailModalOpen(false);
                        setIsLandTitleIndividualAddOnModalOpen(false);
                        setIsLandTitleIndividualSummaryModalOpen(true);
                        setIsIndividualNameConfirmed(true);
                      }}
                      disabled={!selectedLandTitleIndividualMatch}
                      className="w-full rounded-xl bg-red-600 py-4 font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Confirm Name Search
                    </button>
                  </div>

                </div>
              </div>



            )}


            {selectedCategory === 'INDIVIDUAL' && isIndividualNameConfirmed && (
              <div ref={additionalCardRef} className="bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
                <h2 className="text-[32px] font-bold text-center mb-10 text-gray-900 tracking-tight">
                  Select <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20">Enrichment Options</span>
                </h2>

                {/* Additional Search Options Grid - Filter out options already selected in main searches */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {searches.filter(search => {
                    // Hide SELECT ALL if all searches are selected, or hide individual searches if they're selected in main
                    if (search === 'SELECT ALL') {
                      return true; // Always show SELECT ALL
                    }
                    return !selectedSearches.has(search); // Hide if already selected in main searches
                  }).map((search) => {
                    const isSelected = selectedIndividualAdditionalSearches.has(search);
                    const isSelectAll = search === 'SELECT ALL';

                    return (
                      <button
                        key={search}
                        onClick={() => handleIndividualAdditionalSearchToggle(search)}
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
                        {isSelectAll && allIndividualAdditionalSearchesSelected ? 'DESELECT ALL' : getSearchDisplayName(search)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Select Additional Searches - Show when ORGANISATION category is selected */}
            {selectedCategory === 'ORGANISATION' && !selectedSearches.has('ADD DOCUMENT SEARCH') && (
              <div
                ref={additionalCardRef}
                className={`bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100 transition-all duration-300 ${isAdditionalSearchesDisabled ? 'opacity-60' : 'hover:shadow-2xl hover:-translate-y-1'
                  }`}
              >
                <h2 className="text-[32px] font-bold text-center mb-4 text-gray-900 tracking-tight">
                  Report <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20">Enrichment Options</span>
                </h2>
                {isAdditionalSearchesDisabled && (
                  <p className="text-center text-sm text-gray-500 mb-8">
                    Additional searches unlock once an organisation is confirmed.
                  </p>
                )}

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
                        onClick={() => {
                          if (!isAdditionalSearchesDisabled) {
                            handleAdditionalSearchToggle(option.name);
                          }
                        }}
                        disabled={isAdditionalSearchesDisabled}
                        className={`
                        px-4 py-4 rounded-xl font-semibold text-xs uppercase tracking-wide
                        transition-all duration-300 shadow-md min-h-[90px] flex flex-col items-center justify-center
                        ${isAdditionalSearchesDisabled
                            ? 'bg-gray-100 text-gray-400 border-2 border-gray-200 cursor-not-allowed'
                            : isSelected
                              ? isSelectAll
                                ? 'bg-white text-red-600 border-2 border-red-600 hover:bg-red-50 shadow-lg shadow-red-600/20'
                                : 'bg-red-600 text-white border-2 border-red-600 shadow-lg shadow-red-600/30'
                              : 'bg-white text-gray-700 border-2 border-gray-300 hover:border-red-600 hover:bg-red-50'
                          }
                      `}
                      >
                        <span className="text-center">
                          {isSelectAll && allAdditionalSearchesSelected
                            ? 'DESELECT ALL'
                            : isLandTitleOption(option.name as AdditionalSearchType)
                              ? getAdditionalSearchLabel(option.name as AdditionalSearchType)
                              : option.name}
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

            {/* Selected Searches Summary Section - Show when ORGANISATION or INDIVIDUAL category is selected */}
            {(selectedCategory === 'ORGANISATION' || selectedCategory === 'INDIVIDUAL' || selectedCategory === 'LAND TITLE') && (
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
                        {search === 'LAND_TITLE_TITLE_REFERENCE' && isTitleReferenceSelectionConfirmed ? (
                          <span className="flex items-center gap-2">
                            <span>{getSearchDisplayName(search)}</span>
                            {(() => {
                              const detail = titleReferenceSelection.detail;
                              const count = confirmedTitleReferenceAvailability[detail];
                              return typeof count === 'number' ? (
                                <span className="inline-flex min-w-[20px] items-center justify-center rounded-xl bg-white/25 px-4 py-1 text-xs font-semibold leading-tight text-white">
                                  {count} Available
                                </span>
                              ) : null;
                            })()}
                          </span>
                        ) : (
                          getSearchDisplayName(search)
                        )}
                      </div>
                    ))}

                  {/* ASIC types - Show as separate pills if selected */}
                  {selectedCategory === 'ORGANISATION' && selectedSearches.has('ASIC') &&
                    selectedAsicTypeList.map((type) => (
                      <div
                        key={`asic-${type}`}
                        className="px-6 py-3 rounded-xl font-semibold text-sm uppercase tracking-wide bg-blue-600 text-white shadow-md border-2 border-blue-700"
                      >
                        ASIC: {type}
                      </div>
                    ))
                  }

                  {/* Additional searches for ORGANISATION */}
                  {selectedCategory === 'ORGANISATION' && Array.from(selectedAdditionalSearches)
                    .filter(search => search !== 'SELECT ALL')
                    .map((search) => {
                      const option = additionalSearchOptions.find(o => o.name === search);
                      return (
                        <div
                          key={search}
                          className="px-6 py-3 rounded-xl font-semibold text-sm uppercase tracking-wide bg-red-600 text-white shadow-md"
                        >
                          {getAdditionalSearchLabel(search)}
                          {option?.available && ` (${option.available} available)`}
                        </div>
                      );
                    })}

                  {/* Additional searches for INDIVIDUAL */}
                  {selectedCategory === 'INDIVIDUAL' && Array.from(selectedIndividualAdditionalSearches)
                    .filter(search => search !== 'SELECT ALL')
                    .map((search) => (
                      <div
                        key={search}
                        className="px-6 py-3 rounded-xl font-semibold text-sm uppercase tracking-wide bg-red-600 text-white shadow-md"
                      >
                        {getSearchDisplayName(search)}
                      </div>
                    ))}
                </div>

                {/* Process Reports Button */}
                <button
                  className="w-full py-4 rounded-xl font-bold text-lg uppercase tracking-wide bg-red-600 text-white shadow-lg hover:bg-red-700 transition-all duration-300 hover:shadow-xl"
                  onClick={handleProcessReports}
                  disabled={isProcessingReports}
                >
                  {isProcessingReports ? 'Processing Reports...' : 'Process Reports'}
                </button>


{proccessReportStatus ? (
  <div className="payment-actions" id="paymentActionsOrg">
    <div className="action-box">
      <h3>Send Reports via Email</h3>
      <input
        type="email"
        className="email-input"
        id="emailInputOrg"
        placeholder="Enter your email address"
        value={emailAddress}
        onChange={(e) => {
          setEmailAddress(e.target.value);
          setEmailSent(false);
        }}
        disabled={isSendingEmail}
      />
      {emailSent && (
        <div
          style={{
            color: '#10b981',
            fontSize: '12px',
            marginTop: '8px',
            fontWeight: 'bold',
          }}
        >
          ✓ Email sent successfully!
        </div>
      )}
      <button
        className="action-button send-button"
        id="sendButtonOrg"
        onClick={handleSendEmail}
        disabled={isSendingEmail || pdfFilenames.length === 0}
      >
        {isSendingEmail ? 'Sending...' : 'Send'}
      </button>
    </div>

    <div className="action-box">
      <h3>Download Report</h3>
      <div className="reports-available">
        Reports available: <span id="reportsCountOrg">{totalDownloadReport}</span>
      </div>
      <button
        className="action-button send-button"
        id="downloadButtonOrg"
        onClick={handleReportsDownload}
      >
        Download
      </button>
    </div>
  </div>
) : (
  <></>
)}


              </div>
            )}
        
          </div>
        </div>
      </div>

      {selectedCategory === 'ORGANISATION' && selectedSearches.has('ASIC') && isAsicModalOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-gray-900/60 px-4"
          onClick={() => closeAsicModal()}
        >
          <div
            className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => closeAsicModal()}
              className="absolute top-4 right-4 text-gray-400 transition-colors duration-200 hover:text-red-600"
              aria-label="Close modal"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="text-center">
              <h3 className="text-2xl font-bold text-gray-900">Select ASIC Report Type</h3>
              <p className="mt-2 text-sm text-gray-500">
                Pick one or more ASIC report types to include in your search.
              </p>
            </div>

            <div className="mt-8 space-y-3">
              {asicTypes.map((asicType) => {
                const isSelected = selectedAsicTypes.has(asicType);
                const isSelectAll = asicType === 'SELECT ALL';

                return (
                  <button
                    type="button"
                    key={asicType}
                    onClick={() => handleAsicTypeToggle(asicType)}
                    className={`w-full rounded-xl border-2 px-6 py-4 text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${isSelected
                      ? isSelectAll
                        ? 'border-red-600 bg-white text-red-600 shadow-lg shadow-red-600/15'
                        : 'border-red-600 bg-red-600 text-white shadow-lg shadow-red-600/25'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                      }`}
                  >
                    {isSelectAll && allAsicTypesSelected ? 'DESELECT ALL' : asicType}
                  </button>
                );
              })}
            </div>

            <div className="mt-8 grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => {
                  removeAsicSelection();
                  closeAsicModal({ removeIfEmpty: false });
                }}
                className="rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAsicSelectionConfirm}
                className="rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}


      {selectedCategory === 'INDIVIDUAL' && selectedSearches.has('COURT') && isCourtModalOpen && (
        <div
          className="fixed inset-0 z-[119] flex items-center justify-center bg-gray-900/60 px-4"
          onClick={() => closeCourtModal()}
        >
          <div
            className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => closeCourtModal()}
              className="absolute top-4 right-4 text-gray-400 transition-colors duration-200 hover:text-red-600"
              aria-label="Close modal"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="text-center">
              <h3 className="text-2xl font-bold text-gray-900">Select Court Report Type</h3>
              <p className="mt-2 text-sm text-gray-500">
                Choose the type of court search you need for this individual.
              </p>
            </div>

            <div className="mt-8 space-y-3">
              {courtTypes.map((courtType) => {
                const isSelected = selectedCourtType === courtType;
                return (
                  <button
                    type="button"
                    key={courtType}
                    onClick={() => setSelectedCourtType(courtType)}
                    className={`w-full rounded-xl border-2 px-6 py-4 text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${isSelected
                      ? 'border-red-600 bg-red-600 text-white shadow-lg shadow-red-600/25'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                      }`}
                  >
                    {courtType === 'ALL' ? 'ALL COURT SEARCHES' : courtType}
                  </button>
                );
              })}
            </div>

            <div className="mt-8 grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => closeCourtModal({ removeSelection: true })}
                className="rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCourtSelectionConfirm}
                className="rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {isTitleReferenceModalOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-gray-900/60 px-4"
          onClick={closeTitleReferenceModal}
        >
          <div
            className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeTitleReferenceModal}
              className="absolute top-4 right-4 text-gray-400 transition-colors duration-200 hover:text-red-600"
              aria-label="Close modal"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {titleReferenceModalStep === 'SUMMARY_PROMPT' && (
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">Land Title Search - Summary Report</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  A summary report will display any recorded title references from your search. For full details on current
                  or past titles, select after processing or continue with the summary only.
                </p>
                <div className="mt-8 space-y-3">
                  <button
                    type="button"
                    onClick={handleTitleReferenceSummaryContinue}
                    className="w-full rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
                  >
                    Process – {formatCurrency(titleReferenceDetailPricing.SUMMARY)}
                  </button>
                  <button
                    type="button"
                    onClick={closeTitleReferenceModal}
                    className="w-full rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {titleReferenceModalStep === 'DETAIL' && (
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Land Title Search</h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-4">
                  Select detailed property reports
                </p>
                <div className="space-y-4">
                  {titleReferenceDetailOptions.map(option => {
                    const detail = option.key;
                    const isSelected = pendingTitleReferenceSelection.detail === detail;
                    const availableCount = titleReferenceAvailability[detail];
                    return (
                      <button
                        key={detail}
                        type="button"
                        onClick={() => handleTitleReferenceDetailSelect(detail)}
                        className={`w-full rounded-xl border-2 px-4 py-5 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${isSelected
                          ? 'border-red-600 bg-red-50 text-red-600'
                          : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                          }`}
                      >
                        <div className="flex items-center justify-between">
                          <span>
                            {option.key}
                            {typeof availableCount === 'number' ? ` (${availableCount} available)` : ''}
                          </span>
                          <span className="text-xs font-bold">{formatCurrency(titleReferenceDetailPricing[detail])}</span>
                        </div>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => handleTitleReferenceDetailSelect('SUMMARY')}
                    className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${pendingTitleReferenceSelection.detail === 'SUMMARY'
                      ? 'border-red-600 bg-red-50 text-red-600'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>
                        Summary Report Only
                        {typeof titleReferenceAvailability.SUMMARY === 'number'
                          ? ` (${titleReferenceAvailability.SUMMARY} available)`
                          : ''}
                      </span>
                      <span className="text-xs font-bold">—</span>
                    </div>
                  </button>
                </div>
                <div className="mt-6 flex justify-between gap-3">
                  <button
                    type="button"
                    onClick={handleTitleReferenceDetailBack}
                    className="flex-1 rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleTitleReferenceDetailContinue}
                    className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {titleReferenceModalStep === 'ADD_ON' && (
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Additional Selections</h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-6">
                  {LAND_TITLE_ADD_ON_LABEL} provides property value, sales history report, and extended property detail.
                </p>
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => handleTitleReferenceAddOnSelect(true)}
                    className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${pendingTitleReferenceSelection.addOn
                      ? 'border-red-600 bg-red-50 text-red-600'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{LAND_TITLE_ADD_ON_LABEL}</span>
                      <span className="text-xs font-bold">{formatCurrency(LAND_TITLE_ADD_ON_PRICE)}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTitleReferenceAddOnSelect(false)}
                    className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${!pendingTitleReferenceSelection.addOn
                      ? 'border-red-600 bg-red-50 text-red-600'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                      }`}
                  >
                    No, continue with selected options
                  </button>
                </div>
                <div className="mt-6 flex justify-between gap-3">
                  <button
                    type="button"
                    onClick={handleTitleReferenceAddOnBack}
                    className="flex-1 rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleTitleReferenceModalConfirm}
                    className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedLandTitleOption === 'LAND_INDIVIDUAL' && (
        <>
          {isLandTitleIndividualSummaryModalOpen && (
            <div
              className="fixed inset-0 z-[118] flex items-center justify-center bg-gray-900/60 px-4"
              onClick={closeLandTitleIndividualModals}
            >
              <div
                className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={closeLandTitleIndividualModals}
                  className="absolute top-4 right-4 text-gray-400 transition-colors duration-200 hover:text-red-600"
                  aria-label="Close modal"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                <h3 className="text-2xl font-bold text-gray-900 mb-4">Land Title Search - Summary Report</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  A summary report will display any recorded title references from your search. For full details on current or past titles, select after processing or continue with the summary only.
                </p>

                <div className="mt-8 space-y-3">
                  <button
                    type="button"
                    onClick={handleLandTitleIndividualSummaryContinue}
                    className="w-full rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
                  >
                    Process – {formatCurrency(landTitleIndividualDetailPricing.SUMMARY)}
                  </button>
                  <button
                    type="button"
                    onClick={closeLandTitleIndividualModals}
                    className="w-full rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {isLandTitleIndividualDetailModalOpen && (
            <div
              className="fixed inset-0 z-[118] flex items-center justify-center bg-gray-900/60 px-4"
              onClick={closeLandTitleIndividualModals}
            >
              <div
                className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={closeLandTitleIndividualModals}
                  className="absolute top-4 right-4 text-gray-400 transition-colors duration-200 hover:text-red-600"
                  aria-label="Close modal"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                <h3 className="text-2xl font-bold text-gray-900 mb-2">Land Title Search</h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-6">
                  Select the detailed property reports you require before processing.
                </p>

                <div className="space-y-3">
                  {(Object.keys(landTitleIndividualDetailCounts) as Array<Exclude<LandTitleDetailSelection, 'SUMMARY'>>).map(detail => {
                    const isSelected = pendingLandTitleSelection.detail === detail;
                    return (
                      <button
                        key={detail}
                        type="button"
                        onClick={() => handleLandTitleIndividualDetailSelect(detail)}
                        className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${isSelected
                            ? 'border-red-600 bg-red-50 text-red-600'
                            : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                          }`}
                      >
                        <div className="flex items-center justify-between">
                          <span>
                            {detail === 'CURRENT' ? 'Current' : detail === 'PAST' ? 'Past' : 'All'} ({landTitleIndividualDetailCounts[detail]} available)
                          </span>
                          <span className="text-xs font-bold">{formatCurrency(landTitleIndividualDetailPricing[detail])}</span>
                        </div>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => handleLandTitleIndividualDetailSelect('SUMMARY')}
                    className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${pendingLandTitleSelection.detail === 'SUMMARY'
                        ? 'border-red-600 bg-red-50 text-red-600'
                        : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>Summary Report Only</span>
                      <span className="text-xs font-bold">—</span>
                    </div>
                  </button>
                </div>

                <div className="mt-6 flex justify-between gap-3">
                  <button
                    type="button"
                    onClick={handleLandTitleIndividualDetailBack}
                    className="flex-1 rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleLandTitleIndividualDetailContinue}
                    className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          )}

          {isLandTitleIndividualAddOnModalOpen && (
            <div
              className="fixed inset-0 z-[118] flex items-center justify-center bg-gray-900/60 px-4"
              onClick={closeLandTitleIndividualModals}
            >
              <div
                className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={closeLandTitleIndividualModals}
                  className="absolute top-4 right-4 text-gray-400 transition-colors duration-200 hover:text-red-600"
                  aria-label="Close modal"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                <h3 className="text-2xl font-bold text-gray-900 mb-2">Additional Selections</h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-6">
                  {LAND_TITLE_ADD_ON_LABEL} provides property value, sales history report, and extended property detail.
                </p>

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() =>
                      setPendingLandTitleSelection(prev => ({
                        ...prev,
                        addOn: true
                      }))
                    }
                    className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${pendingLandTitleSelection.addOn
                        ? 'border-red-600 bg-red-50 text-red-600'
                        : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{LAND_TITLE_ADD_ON_LABEL}</span>
                      <span className="text-xs font-bold">{formatCurrency(landTitlePricingConfig.addOn)}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingLandTitleSelection(prev => ({
                        ...prev,
                        addOn: false
                      }))
                    }
                    className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${!pendingLandTitleSelection.addOn
                        ? 'border-red-600 bg-red-50 text-red-600'
                        : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                      }`}
                  >
                    No, continue with selected options
                  </button>
                </div>

                <div className="mt-6 flex justify-between gap-3">
                  <button
                    type="button"
                    onClick={handleLandTitleIndividualAddOnBack}
                    className="flex-1 rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={finalizeLandTitleIndividualSelection}
                    className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {landTitleModalOpen && (
        <div
          className="fixed inset-0 z-[118] flex items-center justify-center bg-gray-900/60 px-4"
          onClick={closeLandTitleModal}
        >
          <div
            className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeLandTitleModal}
              className="absolute top-4 right-4 text-gray-400 transition-colors duration-200 hover:text-red-600"
              aria-label="Close modal"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {landTitleModalStep === 'SUMMARY_PROMPT' && (
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">
                  {landTitleModalCopy[landTitleModalOpen].summaryTitle}
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {landTitleModalCopy[landTitleModalOpen].summaryDescription}
                </p>
                <div className="mt-8 space-y-3">
                  <button
                    type="button"
                    onClick={handleLandTitleSummaryContinue}
                    className="w-full rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
                  >
                    Process – {formatCurrency(landTitlePricingConfig.base[landTitleModalOpen])}
                  </button>
                  <button
                    type="button"
                    onClick={closeLandTitleModal}
                    className="w-full rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {landTitleModalStep === 'DETAIL' && (
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  {landTitleModalCopy[landTitleModalOpen].detailTitle}
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-6">
                  {landTitleModalCopy[landTitleModalOpen].detailDescription}
                </p>
                <div className="space-y-3">
                  {(() => {
                    const options =
                      landTitleModalOpen === 'DIRECTOR LAND TITLE'
                        ? [
                          {
                            key: 'CURRENT',
                            label: `Current${directorCurrentCount ? ` (${directorCurrentCount} available)` : ''}`
                          },
                          {
                            key: 'PAST',
                            label: `Past${directorPastCount ? ` (${directorPastCount} available)` : ''}`
                          },
                          {
                            key: 'ALL',
                            label: `All${directorCurrentCount + directorPastCount ? ` (${directorCurrentCount + directorPastCount} available)` : ''}`
                          },
                          {
                            key: 'SUMMARY',
                            label: 'Summary Report Only'
                          }
                        ]
                        : [
                          {
                            key: 'CURRENT',
                            label: `Current${shareholderCount ? ` (${shareholderCount} available)` : ''}`
                          },
                          { key: 'PAST', label: 'Past Records' },
                          { key: 'ALL', label: 'All Available' },
                          { key: 'SUMMARY', label: 'Summary Report Only' }
                        ];
                    return options.map(option => {
                      const detail = option.key as LandTitleDetailSelection;
                      const selectionForPrice = { ...pendingLandTitleSelection, detail, addOn: false };
                      const pricePreview = calculateLandTitlePrice(landTitleModalOpen, selectionForPrice);
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => handleLandTitleDetailSelect(detail)}
                          className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${pendingLandTitleSelection.detail === detail
                            ? 'border-red-600 bg-red-50 text-red-600'
                            : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                            }`}
                        >
                          <div className="flex items-center justify-between">
                            <span>{option.label}</span>
                            <span className="text-xs font-bold">{formatCurrency(pricePreview)}</span>
                          </div>
                        </button>
                      );
                    });
                  })()}
                </div>
                <div className="mt-6 flex justify-between gap-3">
                  <button
                    type="button"
                    onClick={handleLandTitleDetailBack}
                    className="flex-1 rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleLandTitleDetailContinue}
                    className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {landTitleModalStep === 'ADD_ON' && (
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  {landTitleModalCopy[landTitleModalOpen].addOnTitle}
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-6">
                  {landTitleModalCopy[landTitleModalOpen].addOnDescription}
                </p>
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => handleLandTitleAddOnSelect(true)}
                    className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${pendingLandTitleSelection.addOn
                      ? 'border-red-600 bg-red-50 text-red-600'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>Property Value + Sales History + More</span>
                      <span className="text-xs font-bold">{formatCurrency(landTitlePricingConfig.addOn)}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLandTitleAddOnSelect(false)}
                    className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${!pendingLandTitleSelection.addOn
                      ? 'border-red-600 bg-red-50 text-red-600'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                      }`}
                  >
                    No, continue with selected options
                  </button>
                </div>
                <div className="mt-6 flex justify-between gap-3">
                  <button
                    type="button"
                    onClick={handleLandTitleAddOnBack}
                    className="flex-1 rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleLandTitleModalConfirm}
                    className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {isDocumentModalOpen && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-gray-900/60 px-4"
          onClick={handleDocumentModalCancel}
        >
          <div
            className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={handleDocumentModalCancel}
              className="absolute top-4 right-4 text-gray-400 transition-colors duration-200 hover:text-red-600"
              aria-label="Close modal"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="text-center">
              <h3 className="text-2xl font-bold text-gray-900">Add Document ID</h3>
              <p className="mt-2 text-sm text-gray-500">
                Enter the ASIC document number to continue with the search.
              </p>
            </div>

            <div className="mt-8">
              <label htmlFor="document-id-input" className="block text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                Document ID
              </label>
              <input
                id="document-id-input"
                type="text"
                value={documentIdInput}
                onChange={(event) => setDocumentIdInput(event.target.value)}
                className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-base shadow-sm focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-100 transition-all duration-200"
                placeholder="Enter document ID"
                autoFocus
              />
            </div>

            <div className="mt-8 grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={handleDocumentModalCancel}
                className="rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDocumentModalConfirm}
                className="rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right Sidebar - Receipt */}
      <div className="fixed right-8 top-32 w-80 max-h-[calc(100vh-160px)] bg-white rounded-[20px] shadow-xl overflow-hidden flex flex-col z-50 hidden lg:flex">
        {/* Header */}
        <div className="bg-white px-6 py-6 border-b border-gray-100">
          <h3 className="text-xl font-bold text-gray-800 tracking-tight">Your Selection</h3>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-6 py-5 bg-white custom-scrollbar">
          {(selectedSearches.size === 0 || (selectedSearches.size === 1 && selectedSearches.has('SELECT ALL'))) &&
            (selectedCategory === 'ORGANISATION'
              ? (selectedAdditionalSearches.size === 0 || (selectedAdditionalSearches.size === 1 && selectedAdditionalSearches.has('SELECT ALL')))
              : (selectedIndividualAdditionalSearches.size === 0 || (selectedIndividualAdditionalSearches.size === 1 && selectedIndividualAdditionalSearches.has('SELECT ALL')))) ? (
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
                      {search === 'LAND_TITLE_TITLE_REFERENCE' && isTitleReferenceSelectionConfirmed ? (
                        <span className="inline-flex items-center gap-2">
                          <span>{getSearchDisplayName(search)}</span>
                          {(() => {
                            const detail = titleReferenceSelection.detail;
                            const count = confirmedTitleReferenceAvailability[detail];
                            return typeof count === 'number' ? (
                              <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-100 px-2 text-[11px] font-semibold leading-tight text-red-600">
                                {count}
                              </span>
                            ) : null;
                          })()}
                        </span>
                      ) : (
                        getSearchDisplayName(search)
                      )}
                    </div>
                    <div className="text-sm font-semibold text-gray-800 whitespace-nowrap">
                      ${(searchPrices[search as keyof SearchPrices] || searchPrices[search === 'INDIVIDUAL PPSR' ? 'ABN/ACN PPSR' : search as keyof SearchPrices] || 0).toFixed(2)}
                    </div>
                  </div>
                ))}

              {/* Show selected ASIC types if any */}
              {selectedCategory === 'ORGANISATION' && selectedAsicTypeList.length > 0 && (
                <div className="mt-2">
                  {selectedAsicTypeList.map((type, index) => (
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

              {/* Show selected additional searches for ORGANISATION if any */}
              {selectedCategory === 'ORGANISATION' && Array.from(selectedAdditionalSearches).filter(s => s !== 'SELECT ALL').length > 0 && (
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
                            {getAdditionalSearchLabel(search)}
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

              {/* Show selected additional searches for INDIVIDUAL if any */}
              {selectedCategory === 'INDIVIDUAL' && Array.from(selectedIndividualAdditionalSearches).filter(s => s !== 'SELECT ALL').length > 0 && (
                <div className="mt-2">
                  {Array.from(selectedIndividualAdditionalSearches)
                    .filter(search => search !== 'SELECT ALL')
                    .map((search, index) => {
                      const priceKey = search === 'INDIVIDUAL PPSR' ? 'ABN/ACN PPSR' : search;
                      const price = searchPrices[priceKey as keyof SearchPrices] || 0;
                      return (
                        <div
                          key={search}
                          className="flex justify-between items-start py-3 border-b border-gray-100 last:border-b-0 animate-fadeIn"
                          style={{ animationDelay: `${(selectedSearches.size + index) * 50}ms` }}
                        >
                          <div className="flex-1 text-[13px] font-medium text-gray-600 pr-4 leading-relaxed">
                            {getSearchDisplayName(search)}
                          </div>
                          <div className="text-sm font-semibold text-gray-800 whitespace-nowrap">
                            ${price.toFixed(2)}
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
