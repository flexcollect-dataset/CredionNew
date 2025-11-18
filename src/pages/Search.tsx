import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { apiService, BankruptcyMatch, DirectorRelatedMatch } from '../services/api';

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
  titleReferences?: Array<{ titleReference: string; jurisdiction: string }>;
  currentCount?: number;
  historicalCount?: number;
}

const initialLandTitleSelection: LandTitleSelection = {
  summary: true,
  detail: 'SUMMARY',
  addOn: false,
  titleReferences: []
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

interface LandTitleAddressDetails {
  formattedAddress: string;
  streetNumber?: string;
  route?: string;
  locality?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  components?: Record<string, string>;
}

const GOOGLE_MAPS_API_KEY = 'AIzaSyCHqaxmQSIkMUVLJrV26iMzG_gUPupm3NE';
const GOOGLE_MAPS_SCRIPT_ID = 'google-maps-places-api';
const GOOGLE_MAPS_CALLBACK_NAME = 'credionInitLandTitleAutocomplete';

declare global {
  interface Window {
    google?: any;
    credionInitLandTitleAutocomplete?: () => void;
  }
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
  const landTitleAddressInputRef = useRef<HTMLInputElement | null>(null);
  const landTitleAddressAutocompleteRef = useRef<any>(null);
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
  const [landTitleOrganisationShowSuggestions, setLandTitleOrganisationShowSuggestions] = useState(false);
  const [isLandTitleOrganisationConfirmed, setIsLandTitleOrganisationConfirmed] = useState(false);

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
  const [landTitleAddressDetails, setLandTitleAddressDetails] = useState<LandTitleAddressDetails | null>(null);
  const [isAddressSearchDisabled, setIsAddressSearchDisabled] = useState(false);
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
  const [landTitleIndividualMatches, setLandTitleIndividualMatches] = useState<string[]>([]);
  const [isLoadingLandTitlePersonNames, setIsLoadingLandTitlePersonNames] = useState(false);
  const [landTitlePersonNamesError, setLandTitlePersonNamesError] = useState<string | null>(null);
  const [isConfirmPersonNameModalOpen, setIsConfirmPersonNameModalOpen] = useState(false);
  const [confirmedLandTitlePersonDetails, setConfirmedLandTitlePersonDetails] = useState<{
    fullName: string;
    firstName: string;
    lastName: string;
    state: string;
  } | null>(null);
  const [bankruptcyMatchOptions, setBankruptcyMatchOptions] = useState<
    Array<{ label: string; match: BankruptcyMatch | null }>
  >([]);
  const [isLoadingBankruptcyMatches, setIsLoadingBankruptcyMatches] = useState(false);
  const [bankruptcyMatchesError, setBankruptcyMatchesError] = useState<string | null>(null);
  const [selectedBankruptcyMatch, setSelectedBankruptcyMatch] = useState<BankruptcyMatch | null>(null);
  const isIndividualBankruptcySelected =
    selectedCategory === 'INDIVIDUAL' && selectedSearches.has('INDIVIDUAL BANKRUPTCY');
  const [relatedEntityMatchOptions, setRelatedEntityMatchOptions] = useState<
    Array<{ label: string; match: DirectorRelatedMatch | null }>
  >([]);
  const [isLoadingRelatedMatches, setIsLoadingRelatedMatches] = useState(false);
  const [relatedMatchesError, setRelatedMatchesError] = useState<string | null>(null);
  const [selectedRelatedMatch, setSelectedRelatedMatch] = useState<DirectorRelatedMatch | null>(null);
  // Court search state
  const [courtMatchOptions, setCourtMatchOptions] = useState<Array<{ label: string; match: any }>>([]);
  const [isLoadingCourtMatches, setIsLoadingCourtMatches] = useState(false);
  const [courtMatchesError, setCourtMatchesError] = useState<string | null>(null);
  const [selectedCourtMatch, setSelectedCourtMatch] = useState<any | null>(null);
  // Modal states for individual name search results
  const [isIndividualNameSearchModalOpen, setIsIndividualNameSearchModalOpen] = useState(false);
  const [individualNameSearchModalType, setIndividualNameSearchModalType] = useState<'bankruptcy' | 'related' | 'court' | null>(null);
  const [pendingIndividualNameSelection, setPendingIndividualNameSelection] = useState<{
    displayLabel: string;
    source: 'bankruptcy' | 'related' | 'court' | 'mock';
    bankruptcyMatch?: BankruptcyMatch | null;
    relatedMatch?: DirectorRelatedMatch | null;
    courtMatch?: any | null;
  } | null>(null);
  const isIndividualRelatedEntitiesSelected =
    selectedCategory === 'INDIVIDUAL' && selectedSearches.has('INDIVIDUAL RELATED ENTITIES');

  const formatDisplayDate = useCallback((value?: string | null) => {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}/${month}/${year}`;
  }, []);

  const formatDobForAlares = useCallback((value?: string | null) => {
    if (!value) {
      return undefined;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}-${month}-${year}`;
  }, []);

  const resetIndividualSearchState = useCallback(() => {
    setIsIndividualNameConfirmed(false);
    setIsLandTitleIndividualSearchPerformed(false);
    setSelectedLandTitleIndividualMatch(null);
    setLandTitleIndividualMatches([]);
    setIsLoadingLandTitlePersonNames(false);
    setLandTitlePersonNamesError(null);
    setIsConfirmPersonNameModalOpen(false);
    setConfirmedLandTitlePersonDetails(null);
    setSelectedBankruptcyMatch(null);
    setBankruptcyMatchOptions([]);
    setBankruptcyMatchesError(null);
    setIsLoadingBankruptcyMatches(false);
    setSelectedRelatedMatch(null);
    setRelatedEntityMatchOptions([]);
    setRelatedMatchesError(null);
    setIsLoadingRelatedMatches(false);
  }, []);
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

  const mockLandTitleIndividualMatches: string[] = [
    'William P.J. Pike (16/10/1960)',
    'William Peter J Pike (16/10/1960)',
    'William P James Pike (16/10/1960)',
    'W.P.J. Pike (16/10/1960)',
    'William Peter James Pike (16/10/1960)'
  ];

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

  const landTitleIndividualDetailPricing: Record<LandTitleDetailSelection, number> = {
    SUMMARY: 20,
    CURRENT: 10,
    PAST: 110,
    ALL: 120
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
      summaryTitle: 'Land Title - Locate Title Reference',
      summaryDescription:
        'A summary report will outline land title references located for the organisation search. Select continue to choose detailed options.',
      detailTitle: 'Land Title Report Options',
      detailDescription: 'Select the detailed land title reports you require before processing.',
      addOnTitle: 'Additional Selections',
      addOnDescription:
        'Property Value + Sales History + More provides property value, sales history report, and extended property detail.'
    },
    'DIRECTOR LAND TITLE': {
      summaryTitle: 'Director Property Title -  Locate Title Reference',
      summaryDescription:
        'A summary report will display any recorded title references from your search. For full details on current or past titles, select after processing or continue with the summary only.',
      detailTitle: 'Land Title Deed Search',
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

  const [landTitleModalOpen, setLandTitleModalOpen] = useState<LandTitleOption | null>(null);
  const [pendingLandTitleSelection, setPendingLandTitleSelection] = useState<LandTitleSelection>(initialLandTitleSelection);
  // State for SELECT ALL flow for land title options in ORGANISATION category
  const [tempSelectAllLandTitleSelections, setTempSelectAllLandTitleSelections] = useState<Set<LandTitleOption>>(new Set());
  const [isSelectAllLandTitleFlow, setIsSelectAllLandTitleFlow] = useState(false);
  const [shownLandTitleModals, setShownLandTitleModals] = useState<Set<LandTitleOption>>(new Set());
  const [lockedLandTitleOptions, setLockedLandTitleOptions] = useState<Set<LandTitleOption>>(new Set());
  const [showCrossIcons, setShowCrossIcons] = useState(true); // Control cross icon visibility
  const [isAlreadyOrderedModalOpen, setIsAlreadyOrderedModalOpen] = useState(false);
  const [alreadyOrderedLandTitleOption, setAlreadyOrderedLandTitleOption] = useState<LandTitleOption | null>(null);
  const [alreadyOrderedCategory, setAlreadyOrderedCategory] = useState<CategoryType | null>(null);
  const [landTitleSelections, setLandTitleSelections] = useState<Record<LandTitleOption, LandTitleSelection>>({
    'ABN/ACN LAND TITLE': { ...initialLandTitleSelection },
    'DIRECTOR LAND TITLE': { ...initialLandTitleSelection }
  });
  const [landTitleCategorySelections, setLandTitleCategorySelections] = useState<Record<LandTitleCategoryOption, LandTitleSelection>>({
    TITLE_REFERENCE: { ...initialLandTitleSelection },
    LAND_ORGANISATION: { ...initialLandTitleSelection },
    LAND_INDIVIDUAL: { ...initialLandTitleSelection },
    ADDRESS: { ...initialLandTitleSelection }
  });
  const [landTitlePrices, setLandTitlePrices] = useState<Record<LandTitleOption, number>>({
    'ABN/ACN LAND TITLE': landTitlePricingConfig.base['ABN/ACN LAND TITLE'],
    'DIRECTOR LAND TITLE': landTitlePricingConfig.base['DIRECTOR LAND TITLE']
  });
  const [landTitleModalStep, setLandTitleModalStep] = useState<'SUMMARY_PROMPT' | 'DETAIL' | 'ADD_ON'>('SUMMARY_PROMPT');
  const [landTitleCounts, setLandTitleCounts] = useState<{
    current: number | null;
    historical: number | null;
    titleReferences: Array<{ titleReference: string; jurisdiction: string }>;
  }>({ current: null, historical: null, titleReferences: [] });
  const [isLoadingLandTitleCounts, setIsLoadingLandTitleCounts] = useState(false);

  // Dynamic counts based on landTitleCounts state
  const landTitleIndividualDetailCounts: Record<Exclude<LandTitleDetailSelection, 'SUMMARY'>, number> = useMemo(() => ({
    CURRENT: landTitleCounts.current ?? 0,
    PAST: landTitleCounts.historical ?? 0,
    ALL: (landTitleCounts.current ?? 0) + (landTitleCounts.historical ?? 0)
  }), [landTitleCounts]);
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
    'INDIVIDUAL': ['SELECT ALL', 'INDIVIDUAL RELATED ENTITIES', 'INDIVIDUAL BANKRUPTCY', 'COURT', 'INDIVIDUAL LAND TITLE', 'INDIVIDUAL PPSR', 'REGO PPSR', 'SOLE TRADER CHECK', 'UNCLAIMED MONEY'],
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
          return 'Title References Only';
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

  // Generate year options for birth year range
  const currentYear = new Date().getFullYear();
  const startYearOptions = useMemo(() => {
    const years = [];
    for (let year = 1900; year <= currentYear; year += 10) {
      years.push(year);
    }
    return years;
  }, [currentYear]);

  const endYearOptions = useMemo(() => {
    const years = [];
    const maxYear = Math.max(currentYear, 2029);
    for (let year = 1909; year <= maxYear; year += 10) {
      years.push(year);
    }
    return years;
  }, [currentYear]);

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
    // Disable address search button if modal was opened from ADDRESS section
    if (selectedLandTitleOption === 'ADDRESS') {
      setIsAddressSearchDisabled(true);
    }
  }, [selectedLandTitleOption]);

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
    setLandTitleAddressDetails(null);
    setIsAddressSearchDisabled(false);
    resetLandTitleOrganisationSearch();
    setTitleReferenceSelection({ ...initialLandTitleSelection });
    setPendingTitleReferenceSelection({ ...initialLandTitleSelection });
    setLandTitleCategorySelections({
      TITLE_REFERENCE: { ...initialLandTitleSelection },
      LAND_ORGANISATION: { ...initialLandTitleSelection },
      LAND_INDIVIDUAL: { ...initialLandTitleSelection },
      ADDRESS: { ...initialLandTitleSelection }
    });
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
        setLandTitleCategorySelections(prev => ({
          ...prev,
          [option]: {
            ...(prev[option] || { ...initialLandTitleSelection }),
            addOn: isLandTitleAddOnSelected
          }
        }));
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
        setLandTitleAddressDetails(null);
        setIsAddressSearchDisabled(false);
        resetLandTitleOrganisationSearch();
        setTitleReferenceSelection({ ...initialLandTitleSelection });
        setPendingTitleReferenceSelection({ ...initialLandTitleSelection });
        setConfirmedTitleReferenceAvailability({ ...INITIAL_TITLE_REFERENCE_AVAILABILITY });
        setIsTitleReferenceSelectionConfirmed(false);
        closeTitleReferenceModal();
      } else {
        const storedSelection = landTitleCategorySelections[option];
        const effectiveSelection = storedSelection
          ? { ...storedSelection }
          : { ...initialLandTitleSelection, addOn: isLandTitleAddOnSelected };

        setSelectedLandTitleOption(option);

        setLandTitleCategorySelections(prev => ({
          ...prev,
          [option]: effectiveSelection
        }));

        setPendingLandTitleSelection(effectiveSelection);
        setIsLandTitleAddOnSelected(effectiveSelection.addOn);
        updateLandTitleSearchSelection(option, effectiveSelection.addOn);
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
        setLandTitleAddressDetails(null);
        resetLandTitleOrganisationSearch();
        if (option === 'TITLE_REFERENCE') {
          setTitleReferenceSelection(effectiveSelection);
          setPendingTitleReferenceSelection(effectiveSelection);
        } else {
          setTitleReferenceSelection({ ...initialLandTitleSelection });
          setPendingTitleReferenceSelection({ ...initialLandTitleSelection });
        }
        setConfirmedTitleReferenceAvailability({ ...INITIAL_TITLE_REFERENCE_AVAILABILITY });
        setIsTitleReferenceSelectionConfirmed(false);
        closeTitleReferenceModal();
      }
    },
    [
      closeTitleReferenceModal,
      isLandTitleAddOnSelected,
      landTitleCategorySelections,
      resetLandTitleOrganisationSearch,
      selectedLandTitleOption,
      updateLandTitleSearchSelection
    ]
  );

  const handleLandTitleAddOnToggle = useCallback(() => {
    const next = !isLandTitleAddOnSelected;

    if (!selectedLandTitleOption) {
      const defaultOption: LandTitleCategoryOption = 'ADDRESS';
      const storedSelection = landTitleCategorySelections[defaultOption];
      const effectiveSelection = storedSelection
        ? { ...storedSelection, addOn: next }
        : { ...initialLandTitleSelection, addOn: next };

      setSelectedLandTitleOption(defaultOption);
      setIsLandTitleAddOnSelected(next);
      setLandTitleCategorySelections(prev => ({
        ...prev,
        [defaultOption]: effectiveSelection
      }));
      setPendingLandTitleSelection(effectiveSelection);
      updateLandTitleSearchSelection(defaultOption, next);

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
      setLandTitleAddressDetails(null);
      resetLandTitleOrganisationSearch();
      setTitleReferenceSelection({ ...initialLandTitleSelection });
      setPendingTitleReferenceSelection({ ...initialLandTitleSelection });
      setConfirmedTitleReferenceAvailability({ ...INITIAL_TITLE_REFERENCE_AVAILABILITY });
      setIsTitleReferenceSelectionConfirmed(false);
      closeTitleReferenceModal();
      return;
    }

    setIsLandTitleAddOnSelected(next);
    setLandTitleCategorySelections(prev => ({
      ...prev,
      [selectedLandTitleOption]: {
        ...(prev[selectedLandTitleOption] || { ...initialLandTitleSelection }),
        addOn: next
      }
    }));
    updateLandTitleSearchSelection(selectedLandTitleOption, next);
  }, [
    closeTitleReferenceModal,
    isLandTitleAddOnSelected,
    landTitleCategorySelections,
    resetLandTitleOrganisationSearch,
    selectedLandTitleOption,
    updateLandTitleSearchSelection
  ]);
 

  const handleTitleReferenceSearchClick = useCallback(() => {
    if (selectedLandTitleOption !== 'TITLE_REFERENCE') {
      return;
    }

    if (!landTitleReferenceId.trim()) {
      alert('Please enter a reference ID');
      return;
    }

    setPendingTitleReferenceSelection({
      summary: true,
      detail: 'SUMMARY',
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
      alert('Please enter an address');
      return;
    }

    if (!landTitleAddressDetails) {
      alert('Please select an address from the suggestions');
      return;
    }

    setPendingTitleReferenceSelection({
      summary: true,
      detail: 'SUMMARY',
      addOn: isLandTitleAddOnSelected
    });
    setTitleReferenceAvailability({ ...DEMO_TITLE_REFERENCE_AVAILABILITY });
    setTitleReferenceModalStep('SUMMARY_PROMPT');
    setIsTitleReferenceModalOpen(true);
  }, [isLandTitleAddOnSelected, landTitleAddress, landTitleAddressDetails, selectedLandTitleOption, titleReferenceSelection]);

  const initializeLandTitleAddressAutocomplete = useCallback(() => {
    if (typeof window === 'undefined' || !landTitleAddressInputRef.current) {
      return;
    }

    const googleMaps = window.google;
    if (!googleMaps?.maps?.places) {
      return;
    }

    if (landTitleAddressAutocompleteRef.current && googleMaps?.maps?.event?.clearInstanceListeners) {
      googleMaps.maps.event.clearInstanceListeners(landTitleAddressAutocompleteRef.current);
    }

    const autocomplete = new googleMaps.maps.places.Autocomplete(landTitleAddressInputRef.current, {
      componentRestrictions: { country: 'au' },
      fields: ['address_components', 'formatted_address', 'geometry', 'place_id']
    });

    landTitleAddressAutocompleteRef.current = autocomplete;

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place) {
        return;
      }

      const formattedAddress =
        place.formatted_address || landTitleAddressInputRef.current?.value || '';

      const componentsMap: Record<string, string> = {};
      const details: LandTitleAddressDetails = {
        formattedAddress,
        placeId: place.place_id || undefined,
        latitude: place.geometry?.location?.lat ? place.geometry.location.lat() : undefined,
        longitude: place.geometry?.location?.lng ? place.geometry.location.lng() : undefined,
        components: componentsMap
      };

      (place.address_components || []).forEach((component: any) => {
        const componentType = component.types?.[0];
        if (!componentType) {
          return;
        }

        componentsMap[componentType] = component.long_name;

        switch (componentType) {
          case 'street_number':
            details.streetNumber = component.long_name;
            break;
          case 'route':
            details.route = component.long_name;
            break;
          case 'locality':
          case 'sublocality_level_1':
            details.locality = component.long_name;
            break;
          case 'administrative_area_level_1':
            details.state = component.short_name || component.long_name;
            break;
          case 'postal_code':
            details.postalCode = component.long_name;
            break;
          case 'country':
            details.country = component.short_name || component.long_name;
            break;
          default:
            break;
        }
      });

      setLandTitleAddress(formattedAddress);
      setLandTitleAddressDetails(details);
    });
  }, [setLandTitleAddress, setLandTitleAddressDetails]);

  useEffect(() => {
    if (selectedCategory !== 'LAND TITLE' || selectedLandTitleOption !== 'ADDRESS') {
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    const googleMaps = window.google;

    if (googleMaps?.maps?.places) {
      initializeLandTitleAddressAutocomplete();
      return;
    }

    const callbackName = GOOGLE_MAPS_CALLBACK_NAME;

    (window as any)[callbackName] = () => {
      initializeLandTitleAddressAutocomplete();
    };

    if (!document.getElementById(GOOGLE_MAPS_SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = GOOGLE_MAPS_SCRIPT_ID;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places&callback=${callbackName}`;
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        console.error('Failed to load Google Maps Places API script');
      };
      document.head.appendChild(script);
    }

    return () => {
      const googleMapsInstance = window.google;
      if (landTitleAddressAutocompleteRef.current && googleMapsInstance?.maps?.event?.clearInstanceListeners) {
        googleMapsInstance.maps.event.clearInstanceListeners(landTitleAddressAutocompleteRef.current);
      }
      landTitleAddressAutocompleteRef.current = null;
    };
  }, [initializeLandTitleAddressAutocomplete, selectedCategory, selectedLandTitleOption]);




  const handleTitleReferenceSummaryContinue = useCallback(() => {
    setPendingTitleReferenceSelection(prev => ({
      ...prev,
      summary: true,
      detail: 'SUMMARY'
    }));
    setTitleReferenceModalStep('DETAIL');
  }, []);

  const handleTitleReferenceDetailSelect = useCallback((detail: LandTitleDetailSelection) => {
    setPendingTitleReferenceSelection(prev => ({ ...prev, detail }));
  }, []);

  const handleTitleReferenceDetailBack = useCallback(() => {
    setTitleReferenceModalStep('SUMMARY_PROMPT');
  }, []);

  const handleTitleReferenceDetailContinue = useCallback(() => {
    setTitleReferenceModalStep('ADD_ON');
  }, []);

  const handleTitleReferenceModalConfirm = useCallback(() => {
    setTitleReferenceSelection(pendingTitleReferenceSelection);
    // Handle both TITLE_REFERENCE and ADDRESS options
    if (selectedLandTitleOption === 'TITLE_REFERENCE' || selectedLandTitleOption === 'ADDRESS') {
      setLandTitleCategorySelections(prev => ({
        ...prev,
        [selectedLandTitleOption]: pendingTitleReferenceSelection
      }));
    }
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

  const handleTitleReferenceAddOnSelect = useCallback((addOn: boolean) => {
    setPendingTitleReferenceSelection(prev => ({ ...prev, addOn }));
  }, []);

  const handleTitleReferenceAddOnBack = useCallback(() => {
    setTitleReferenceModalStep('DETAIL');
  }, []);

  const handleLandTitleIndividualSearchClick = useCallback(async () => {
    const isBankruptcySearch = isIndividualBankruptcySelected;
    const isRelatedEntitiesSearch = isIndividualRelatedEntitiesSelected;
    const isIndividualCourtSearch = selectedCategory === 'INDIVIDUAL' && selectedSearches.has('COURT');
    const isIndividualLandTitleSearch = selectedCategory === 'INDIVIDUAL' && selectedSearches.has('INDIVIDUAL LAND TITLE');
    const isLandTitleSearch = selectedCategory === 'LAND TITLE';

    if ((isBankruptcySearch || isRelatedEntitiesSearch) && !landTitleIndividualLastName.trim()) {
      alert('Please enter a last name to search records');
      return;
    }

    // For land title search, validate required fields
    if (isLandTitleSearch && !isBankruptcySearch && !isRelatedEntitiesSearch) {
      if (!landTitleIndividualLastName.trim()) {
        alert('Please enter a last name to search records');
        return;
      }
      if (landTitleIndividualStates.size === 0) {
        alert('Please select at least one state');
        return;
      }
    }

    setIsLandTitleIndividualSearchPerformed(true);
    setIsIndividualNameConfirmed(false);
    setSelectedLandTitleIndividualMatch(null);
    setLandTitleIndividualMatches([]);
    setLandTitlePersonNamesError(null);

    const fetchTasks: Promise<void>[] = [];

    if (isBankruptcySearch) {
      setSelectedBankruptcyMatch(null);
      setBankruptcyMatchOptions([]);
      setBankruptcyMatchesError(null);
      setIsLoadingBankruptcyMatches(true);

      fetchTasks.push(
        (async () => {
          try {
            const response = await apiService.searchIndividualBankruptcyMatches({
              firstName: landTitleIndividualFirstName.trim() || undefined,
              lastName: landTitleIndividualLastName.trim(),
              dateOfBirth:
                landTitleIndividualDobMode === 'EXACT' && landTitleIndividualDob
                  ? landTitleIndividualDob
                  : undefined
            });

            const matches = response?.matches || [];
            const labelCounts = new Map<string, number>();
            const formattedOptions = matches.map((match) => {
              const name = [match.debtor?.givenNames, match.debtor?.surname].filter(Boolean).join(' ').trim();
              const dob = formatDisplayDate(match.debtor?.dateOfBirth);
              const startDate = formatDisplayDate(match.startDate);

              const parts: string[] = [];
              parts.push(name || 'Unknown');
              if (dob) {
                parts.push(`DOB: ${dob}`);
              }
              if (startDate) {
                parts.push(`Start: ${startDate}`);
              }

              const baseLabel = parts.join(' • ');
              const currentCount = labelCounts.get(baseLabel) ?? 0;
              labelCounts.set(baseLabel, currentCount + 1);

              const label = currentCount > 0 ? `${baseLabel} (${currentCount + 1})` : baseLabel;

              return { label, match };
            });

            if (formattedOptions.length === 0) {
              setBankruptcyMatchesError('No bankruptcy records found for the provided details.');
            }

            setBankruptcyMatchOptions(formattedOptions);
          } catch (error: any) {
            console.error('Error fetching bankruptcy matches:', error);
            setBankruptcyMatchesError(
              error?.message || 'Failed to fetch bankruptcy records. Please try again.'
            );
          } finally {
            setIsLoadingBankruptcyMatches(false);
          }
        })()
      );
    } else {
      setSelectedBankruptcyMatch(null);
      setBankruptcyMatchOptions([]);
      setBankruptcyMatchesError(null);
      setIsLoadingBankruptcyMatches(false);
    }

    if (isRelatedEntitiesSearch) {
      setSelectedRelatedMatch(null);
      setRelatedEntityMatchOptions([]);
      setRelatedMatchesError(null);
      setIsLoadingRelatedMatches(true);

      const dobFromParam =
        landTitleIndividualDobMode === 'EXACT'
          ? formatDobForAlares(landTitleIndividualDob)
          : landTitleIndividualDobMode === 'RANGE' && landTitleIndividualStartYear.trim()
            ? `01-01-${landTitleIndividualStartYear.trim()}`
            : undefined;
      const dobToParam =
        landTitleIndividualDobMode === 'EXACT'
          ? formatDobForAlares(landTitleIndividualDob)
          : landTitleIndividualDobMode === 'RANGE' && landTitleIndividualEndYear.trim()
            ? `31-12-${landTitleIndividualEndYear.trim()}`
            : undefined;

      fetchTasks.push(
        (async () => {
          try {
            const response = await apiService.searchIndividualRelatedEntityMatches({
              firstName: landTitleIndividualFirstName.trim() || undefined,
              lastName: landTitleIndividualLastName.trim(),
              dobFrom: dobFromParam,
              dobTo: dobToParam
            });

            const matches = response?.matches || [];
            const labelCounts = new Map<string, number>();
            const formattedOptions = matches.map((match) => {
              const parts: string[] = [];
              parts.push(match.name || 'Unknown');
              if (match.dob) {
                parts.push(`DOB: ${match.dob}`);
              }
              if (match.state) {
                parts.push(match.state);
              }
              if (match.suburb) {
                parts.push(match.suburb);
              }

              const baseLabel = parts.join(' • ');
              const currentCount = labelCounts.get(baseLabel) ?? 0;
              labelCounts.set(baseLabel, currentCount + 1);

              const label = currentCount > 0 ? `${baseLabel} (${currentCount + 1})` : baseLabel;

              return { label, match };
            });

            if (formattedOptions.length === 0) {
              setRelatedMatchesError('No related entities found for the provided details.');
            }

            setRelatedEntityMatchOptions(formattedOptions);
          } catch (error: any) {
            console.error('Error fetching related entity matches:', error);
            setRelatedMatchesError(
              error?.message || 'Failed to fetch related entity records. Please try again.'
            );
          } finally {
            setIsLoadingRelatedMatches(false);
          }
        })()
      );
    } else {
      setSelectedRelatedMatch(null);
      setRelatedEntityMatchOptions([]);
      setRelatedMatchesError(null);
      setIsLoadingRelatedMatches(false);
    }

    if (isIndividualCourtSearch) {
      if (!landTitleIndividualLastName.trim()) {
        alert('Please enter a last name to search records');
        return;
      }

      setSelectedCourtMatch(null);
      setCourtMatchOptions([]);
      setCourtMatchesError(null);
      setIsLoadingCourtMatches(true);

      fetchTasks.push(
        (async () => {
          try {
            // Get court type from selectedCourtType state (ALL, CIVIL, CRIMINAL)
            const courtTypeParam = selectedCourtType === 'ALL' ? 'ALL' : selectedCourtType === 'CIVIL COURT' ? 'CIVIL' : selectedCourtType === 'CRIMINAL COURT' ? 'CRIMINAL' : 'ALL';
            
            const response = await apiService.searchIndividualCourtMatches({
              firstName: landTitleIndividualFirstName.trim() || undefined,
              lastName: landTitleIndividualLastName.trim(),
              courtType: courtTypeParam as 'ALL' | 'CRIMINAL' | 'CIVIL'
            });

            const matches = response?.matches || [];
            const labelCounts = new Map<string, number>();
            const formattedOptions = matches.map((match) => {
              const parts: string[] = [];
              
              // Use fullname if available, otherwise construct from given_name and surname
              const fullName = match.fullname || 
                [match.given_name, match.surname].filter(Boolean).join(' ').trim() || 
                'Unknown';
              parts.push(fullName);
              
              if (match.courtType) {
                parts.push(match.courtType);
              }
              if (match.state) {
                parts.push(match.state);
              }

              const baseLabel = parts.join(' • ');
              const currentCount = labelCounts.get(baseLabel) ?? 0;
              labelCounts.set(baseLabel, currentCount + 1);

              const label = currentCount > 0 ? `${baseLabel} (${currentCount + 1})` : baseLabel;

              return { label, match };
            });

            if (formattedOptions.length === 0) {
              setCourtMatchesError('No court records found for the provided details.');
            }

            setCourtMatchOptions(formattedOptions);
          } catch (error: any) {
            console.error('Error fetching court matches:', error);
            setCourtMatchesError(
              error?.message || 'Failed to fetch court records. Please try again.'
            );
          } finally {
            setIsLoadingCourtMatches(false);
          }
        })()
      );
    }

    if (isLandTitleSearch && !isBankruptcySearch && !isRelatedEntitiesSearch) {
      setIsLoadingLandTitlePersonNames(true);
      
      // Search for each selected state and aggregate results
      const allPersonNamesSet = new Set<string>();
      const statesArray = Array.from(landTitleIndividualStates);
      
      fetchTasks.push(
        (async () => {
          try {
            // Search all states in parallel
            const searchPromises = statesArray.map(state => 
              apiService.searchLandTitlePersonNames({
                firstName: landTitleIndividualFirstName.trim() || undefined,
                lastName: landTitleIndividualLastName.trim(),
                state: state
              }).catch(error => {
                console.error(`Error searching state ${state}:`, error);
                return { success: false, personNames: [], error: error.message };
              })
            );
            
            const results = await Promise.all(searchPromises);
            
            // Aggregate unique person names from all states
            results.forEach(result => {
              if (result.success && result.personNames) {
                result.personNames.forEach(name => {
                  if (name && name.trim()) {
                    allPersonNamesSet.add(name.trim());
                  }
                });
              }
            });
            
            const allPersonNames = Array.from(allPersonNamesSet).sort();
            
            if (allPersonNames.length === 0) {
              setLandTitlePersonNamesError('No person names found for the provided details.');
            } else {
              setLandTitleIndividualMatches(allPersonNames);
              // Automatically open the popup when search results are available
              setIsConfirmPersonNameModalOpen(true);
              // Select first name by default
              if (allPersonNames.length > 0) {
                setSelectedLandTitleIndividualMatch(allPersonNames[0]);
              }
            }
          } catch (error: any) {
            console.error('Error fetching land title person names:', error);
            setLandTitlePersonNamesError(
              error?.message || 'Failed to fetch person names. Please try again.'
            );
          } finally {
            setIsLoadingLandTitlePersonNames(false);
          }
        })()
      );
    } else {
      setIsLoadingLandTitlePersonNames(false);
    }

    // If there are API tasks, wait for them to complete
    if (fetchTasks.length > 0) {
      await Promise.all(fetchTasks);
    }
    
    // After search completes (or if no API calls needed), open modal(s) based on what was selected
    // Priority: bankruptcy -> related entities -> court -> land title (mock)
    if (isBankruptcySearch) {
      // Bankruptcy selected - show bankruptcy modal first
      setIndividualNameSearchModalType('bankruptcy');
      setIsIndividualNameSearchModalOpen(true);
    } else if (isRelatedEntitiesSearch) {
      // Only related entities (no bankruptcy)
      setIndividualNameSearchModalType('related');
      setIsIndividualNameSearchModalOpen(true);
    } else if (isIndividualCourtSearch) {
      // Only COURT - show mock results in modal
      setIndividualNameSearchModalType('court');
      setIsIndividualNameSearchModalOpen(true);
    } else if (isIndividualLandTitleSearch) {
      // Only INDIVIDUAL LAND TITLE - show mock results in modal
      setIndividualNameSearchModalType(null);
      setIsIndividualNameSearchModalOpen(true);
    }
  }, [
    formatDisplayDate,
    formatDobForAlares,
    isIndividualBankruptcySelected,
    isIndividualRelatedEntitiesSelected,
    landTitleIndividualDob,
    landTitleIndividualDobMode,
    landTitleIndividualEndYear,
    landTitleIndividualFirstName,
    landTitleIndividualLastName,
    landTitleIndividualStartYear
  ]);

  const handleConfirmIndividualName = useCallback(() => {
    if (!selectedLandTitleIndividualMatch) {
      alert('Please select a name to confirm');
      return;
    }

    if (isIndividualBankruptcySelected && !selectedBankruptcyMatch) {
      alert('Please select a bankruptcy record to confirm');
      return;
    }

    if (isIndividualRelatedEntitiesSelected && !selectedRelatedMatch) {
      alert('Please select a related entity record to confirm');
      return;
    }

    // If INDIVIDUAL LAND TITLE is selected, open the summary modal instead
    const isIndividualLandTitleSelected = selectedCategory === 'INDIVIDUAL' && selectedSearches.has('INDIVIDUAL LAND TITLE');
    if (isIndividualLandTitleSelected) {
      setPendingLandTitleSelection({
        summary: true,
        detail: 'SUMMARY',
        addOn: false
      });
      setIsLandTitleIndividualSummaryModalOpen(true);
      return;
    }

    setIsIndividualNameConfirmed(true);
  }, [
    isIndividualBankruptcySelected,
    isIndividualRelatedEntitiesSelected,
    selectedBankruptcyMatch,
    selectedRelatedMatch,
    selectedLandTitleIndividualMatch,
    selectedCategory,
    selectedSearches
  ]);

  const closeLandTitleIndividualModals = useCallback((options?: { removeSelection?: boolean }) => {
    setIsLandTitleIndividualSummaryModalOpen(false);
    setIsLandTitleIndividualDetailModalOpen(false);
    setIsLandTitleIndividualAddOnModalOpen(false);
    
    // Only remove INDIVIDUAL LAND TITLE from selection if explicitly requested (e.g., when cancelled)
    // Don't remove it when modals are closed after confirmation (finalizeLandTitleIndividualSelection handles that)
    if (options?.removeSelection) {
      const isIndividualLandTitleInAdditional = selectedCategory === 'INDIVIDUAL' && !selectedSearches.has('INDIVIDUAL LAND TITLE');
      if (isIndividualLandTitleInAdditional) {
        setSelectedIndividualAdditionalSearches(prev => {
          const updated = new Set(prev);
          if (updated.has('INDIVIDUAL LAND TITLE')) {
            updated.delete('INDIVIDUAL LAND TITLE');
            updated.delete('SELECT ALL');
          }
          return updated;
        });
      }
    }
  }, [selectedCategory, selectedSearches]);

  // Handler for individual name search modal selection
  const handleIndividualNameSearchSelect = useCallback((option: {
    displayLabel: string;
    source: 'bankruptcy' | 'related' | 'court' | 'mock';
    bankruptcyMatch?: BankruptcyMatch | null;
    relatedMatch?: DirectorRelatedMatch | null;
    courtMatch?: any | null;
  }) => {
    setPendingIndividualNameSelection(option);
  }, []);

  // Handler for confirming selection in individual name search modal
  const handleIndividualNameSearchConfirm = useCallback(() => {
    if (!pendingIndividualNameSelection) return;

    const { displayLabel, source, bankruptcyMatch, relatedMatch, courtMatch } = pendingIndividualNameSelection;
    
    setSelectedLandTitleIndividualMatch(displayLabel);
    
    if (source === 'bankruptcy') {
      setSelectedBankruptcyMatch(bankruptcyMatch || null);
      setSelectedRelatedMatch(null);
      setSelectedCourtMatch(null);
    } else if (source === 'related') {
      setSelectedRelatedMatch(relatedMatch || null);
      setSelectedBankruptcyMatch(null);
      setSelectedCourtMatch(null);
    } else if (source === 'court') {
      setSelectedCourtMatch(courtMatch || null);
      setSelectedBankruptcyMatch(null);
      setSelectedRelatedMatch(null);
    } else {
      setSelectedBankruptcyMatch(null);
      setSelectedRelatedMatch(null);
      setSelectedCourtMatch(null);
    }

    // Close current modal
    setIsIndividualNameSearchModalOpen(false);
    setPendingIndividualNameSelection(null);

    const isIndividualCourtSearch = selectedCategory === 'INDIVIDUAL' && selectedSearches.has('COURT');
    const isIndividualLandTitleSearch = selectedCategory === 'INDIVIDUAL' && selectedSearches.has('INDIVIDUAL LAND TITLE');

    // Determine next modal to show based on sequence: bankruptcy -> related -> court -> land title
    if (individualNameSearchModalType === 'bankruptcy') {
      // Just confirmed bankruptcy - check what's next
      if (isIndividualRelatedEntitiesSelected && !isLoadingRelatedMatches) {
        // Show related entities modal next (even if no results)
        setIndividualNameSearchModalType('related');
        setIsIndividualNameSearchModalOpen(true);
      } else if (isIndividualCourtSearch) {
        // Show court modal next
        setIndividualNameSearchModalType('court');
        setIsIndividualNameSearchModalOpen(true);
      } else if (isIndividualLandTitleSearch) {
        // Show name selection modal for land title first (with mock results)
        setIndividualNameSearchModalType(null);
        setIsIndividualNameSearchModalOpen(true);
      } else {
        // No more modals - all name search popups are done, confirm the name
        setIsIndividualNameConfirmed(true);
        setIndividualNameSearchModalType(null);
      }
    } else if (individualNameSearchModalType === 'related') {
      // Just confirmed related entities - check what's next
      if (isIndividualCourtSearch) {
        // Show court modal next
        setIndividualNameSearchModalType('court');
        setIsIndividualNameSearchModalOpen(true);
      } else if (isIndividualLandTitleSearch) {
        // Show name selection modal for land title first (with mock results)
        setIndividualNameSearchModalType(null);
        setIsIndividualNameSearchModalOpen(true);
      } else {
        // No more modals - all name search popups are done, confirm the name
        setIsIndividualNameConfirmed(true);
        setIndividualNameSearchModalType(null);
      }
    } else if (individualNameSearchModalType === 'court') {
      // Just confirmed court - check if land title is next
      if (isIndividualLandTitleSearch) {
        // Show name selection modal for land title first (with mock results)
        setIndividualNameSearchModalType(null);
        setIsIndividualNameSearchModalOpen(true);
      } else {
        // No more modals - all name search popups are done, confirm the name
        setIsIndividualNameConfirmed(true);
        setIndividualNameSearchModalType(null);
      }
    } else {
      // Land title name selection modal (mock) - after confirming, open land title summary modal
      if (isIndividualLandTitleSearch) {
        // Set confirmed person details for land title flow
        // Extract name parts from displayLabel (format: "FirstName LastName • DOB: ... • State • Suburb")
        const nameParts = displayLabel.split(' • ');
        const fullName = nameParts[0] || displayLabel;
        const nameComponents = fullName.trim().split(/\s+/);
        const firstName = nameComponents.length > 1 ? nameComponents.slice(0, -1).join(' ') : '';
        const lastName = nameComponents.length > 0 ? nameComponents[nameComponents.length - 1] : fullName;
        
        // Extract state from displayLabel if available
        const statePart = nameParts.find(part => part.trim().length === 2 || ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'].includes(part.trim().toUpperCase()));
        const state = statePart ? statePart.trim() : '';
        
        setConfirmedLandTitlePersonDetails({
          firstName: firstName || landTitleIndividualFirstName.trim() || '',
          lastName: lastName || landTitleIndividualLastName.trim(),
          fullName: displayLabel,
          state: state
        });
        
        // Open land title summary modal after confirming name selection
        setPendingLandTitleSelection({
          summary: true,
          detail: 'SUMMARY',
          addOn: false
        });
        setIsLandTitleIndividualSummaryModalOpen(true);
        setIndividualNameSearchModalType(null);
      } else {
        // No more modals - all name search popups are done, confirm the name
        setIsIndividualNameConfirmed(true);
        setIndividualNameSearchModalType(null);
      }
    }
  }, [pendingIndividualNameSelection, individualNameSearchModalType, isIndividualBankruptcySelected, isIndividualRelatedEntitiesSelected, isLoadingRelatedMatches, relatedEntityMatchOptions, selectedCategory, selectedSearches]);

  // Handler for closing individual name search modal (called when user clicks Cancel or X)
  // Note: This is NOT called when user confirms - handleIndividualNameSearchConfirm handles that
  const handleIndividualNameSearchModalClose = useCallback(() => {
    // User cancelled - remove the search option but continue to next popup
    if (individualNameSearchModalType === 'bankruptcy') {
      // Remove INDIVIDUAL BANKRUPTCY from selected searches
      setSelectedSearches(prev => {
        const updated = new Set(prev);
        updated.delete('INDIVIDUAL BANKRUPTCY');
        return updated;
      });
      // Also clear any previous bankruptcy match
      setSelectedBankruptcyMatch(null);
      setBankruptcyMatchOptions([]);
    } else if (individualNameSearchModalType === 'related') {
      // Remove INDIVIDUAL RELATED ENTITIES from selected searches
      setSelectedSearches(prev => {
        const updated = new Set(prev);
        updated.delete('INDIVIDUAL RELATED ENTITIES');
        return updated;
      });
      // Also clear any previous related match
      setSelectedRelatedMatch(null);
      setRelatedEntityMatchOptions([]);
    } else if (individualNameSearchModalType === 'court') {
      // Remove COURT from selected searches
      setSelectedSearches(prev => {
        const updated = new Set(prev);
        updated.delete('COURT');
        return updated;
      });
    } else if (!individualNameSearchModalType) {
      // Land title mock modal - remove INDIVIDUAL LAND TITLE
      setSelectedSearches(prev => {
        const updated = new Set(prev);
        updated.delete('INDIVIDUAL LAND TITLE');
        return updated;
      });
      setSelectedLandTitleIndividualMatch(null);
    }
    
    // Close current modal
    setIsIndividualNameSearchModalOpen(false);
    setPendingIndividualNameSelection(null);
    
    // Check what's next and show the next popup
    const isIndividualCourtSearch = selectedCategory === 'INDIVIDUAL' && selectedSearches.has('COURT');
    const isIndividualLandTitleSearch = selectedCategory === 'INDIVIDUAL' && selectedSearches.has('INDIVIDUAL LAND TITLE');
    const isIndividualRelatedEntitiesSelected = selectedCategory === 'INDIVIDUAL' && selectedSearches.has('INDIVIDUAL RELATED ENTITIES');
    
    // Determine next modal to show based on sequence: bankruptcy -> related -> court -> land title
    if (individualNameSearchModalType === 'bankruptcy') {
      // Just cancelled bankruptcy - check what's next
      if (isIndividualRelatedEntitiesSelected && !isLoadingRelatedMatches) {
        // Show related entities modal next (even if no results)
        setIndividualNameSearchModalType('related');
        setIsIndividualNameSearchModalOpen(true);
      } else if (isIndividualCourtSearch) {
        // Show court modal next
        setIndividualNameSearchModalType('court');
        setIsIndividualNameSearchModalOpen(true);
      } else if (isIndividualLandTitleSearch) {
        // Show name selection modal for land title first (with mock results)
        setIndividualNameSearchModalType(null);
        setIsIndividualNameSearchModalOpen(true);
      } else {
        setIndividualNameSearchModalType(null);
      }
    } else if (individualNameSearchModalType === 'related') {
      // Just cancelled related entities - check what's next
      if (isIndividualCourtSearch) {
        // Show court modal next
        setIndividualNameSearchModalType('court');
        setIsIndividualNameSearchModalOpen(true);
      } else if (isIndividualLandTitleSearch) {
        // Show name selection modal for land title first (with mock results)
        setIndividualNameSearchModalType(null);
        setIsIndividualNameSearchModalOpen(true);
      } else {
        setIndividualNameSearchModalType(null);
      }
    } else if (individualNameSearchModalType === 'court') {
      // Just cancelled court - check if land title is next
      if (isIndividualLandTitleSearch) {
        // Show name selection modal for land title first (with mock results)
        setIndividualNameSearchModalType(null);
        setIsIndividualNameSearchModalOpen(true);
      } else {
        setIndividualNameSearchModalType(null);
      }
    } else {
      // Cancelled land title or mock modal - no more modals
      setIndividualNameSearchModalType(null);
    }
  }, [individualNameSearchModalType, selectedCategory, selectedSearches, isLoadingRelatedMatches]);

  const finalizeLandTitleIndividualSelection = useCallback(() => {
    const isIndividualLandTitleSelected = selectedCategory === 'INDIVIDUAL' && selectedSearches.has('INDIVIDUAL LAND TITLE');
    const isIndividualLandTitleInAdditional = selectedCategory === 'INDIVIDUAL' && !selectedSearches.has('INDIVIDUAL LAND TITLE');
    
    // For INDIVIDUAL category with INDIVIDUAL LAND TITLE in main searches, just confirm the name and close modals
    if (isIndividualLandTitleSelected) {
      setIsIndividualNameConfirmed(true);
      closeLandTitleIndividualModals({ removeSelection: false });
      return;
    }
    
    // For INDIVIDUAL category with INDIVIDUAL LAND TITLE in enrichment options
    if (isIndividualLandTitleInAdditional) {
      // Ensure INDIVIDUAL LAND TITLE is added to the selection (it might have been removed if user cancelled)
      // IMPORTANT: Use functional update to ensure we have the latest state
      setSelectedIndividualAdditionalSearches(prev => {
        const updated = new Set(prev);
        // Add INDIVIDUAL LAND TITLE if not already there
        updated.add('INDIVIDUAL LAND TITLE');
        
        // Check if all available searches are now selected and add SELECT ALL if needed
        const availableSearches = searches.filter(s => s !== 'SELECT ALL' && !selectedSearches.has(s));
        const allSelected = availableSearches.every(s => updated.has(s));
        if (allSelected && availableSearches.length > 0) {
          updated.add('SELECT ALL');
        }
        
        return updated;
      });
      // Then close modals (don't remove selection since we just confirmed it)
      closeLandTitleIndividualModals({ removeSelection: false });
      return;
    }
    
    // For LAND TITLE category, check if LAND_INDIVIDUAL is selected
    if (selectedLandTitleOption !== 'LAND_INDIVIDUAL') {
      closeLandTitleIndividualModals();
      return;
    }
    
    // Ensure titleReferences are set if they're missing for CURRENT/PAST/ALL selections
    let finalSelection = { ...pendingLandTitleSelection };
    if (finalSelection.detail !== 'SUMMARY' && (!finalSelection.titleReferences || finalSelection.titleReferences.length === 0)) {
      const titleReferencesToInclude = (finalSelection.detail === 'CURRENT' || finalSelection.detail === 'ALL')
        ? (landTitleCounts.titleReferences || [])
        : [];
      
      finalSelection = {
        ...finalSelection,
        titleReferences: titleReferencesToInclude,
        currentCount: landTitleCounts.current || 0,
        historicalCount: landTitleCounts.historical || 0
      };
    }
    
    setLandTitleCategorySelections(prev => ({
      ...prev,
      LAND_INDIVIDUAL: finalSelection
    }));
    setIsLandTitleAddOnSelected(finalSelection.addOn);
    updateLandTitleSearchSelection('LAND_INDIVIDUAL', finalSelection.addOn);
    setIsLandTitleIndividualSearchPerformed(false);
    setSelectedLandTitleIndividualMatch(null);
    closeLandTitleIndividualModals();
  }, [closeLandTitleIndividualModals, pendingLandTitleSelection, selectedLandTitleOption, updateLandTitleSearchSelection, landTitleCounts, selectedCategory, selectedSearches, searches]);

  const handleLandTitleIndividualSummaryContinue = useCallback(async () => {
    const isIndividualLandTitleSelected = selectedCategory === 'INDIVIDUAL' && selectedSearches.has('INDIVIDUAL LAND TITLE');
    const isIndividualLandTitleInAdditional = selectedCategory === 'INDIVIDUAL' && selectedIndividualAdditionalSearches.has('INDIVIDUAL LAND TITLE');
    
    // For INDIVIDUAL category with INDIVIDUAL LAND TITLE in main searches, check if we have selectedLandTitleIndividualMatch or confirmedLandTitlePersonDetails
    if (isIndividualLandTitleSelected) {
      if (!selectedLandTitleIndividualMatch && !confirmedLandTitlePersonDetails) {
        alert('Please confirm a person name first');
        return;
      }
      
      // For INDIVIDUAL category with INDIVIDUAL LAND TITLE, skip counts API call and proceed directly
      // The actual counts will be determined when processing reports with the confirmed name
      setPendingLandTitleSelection(prev => ({ ...prev, summary: true }));
      setLandTitleModalStep('DETAIL');
      // Set default counts (will be determined when processing reports)
      setLandTitleCounts({
        current: 0,
        historical: 0,
        titleReferences: []
      });
    setIsLandTitleIndividualSummaryModalOpen(false);
    setIsLandTitleIndividualDetailModalOpen(true);
      return;
    }
    
    // For INDIVIDUAL category with INDIVIDUAL LAND TITLE in enrichment options, no name validation needed
    if (isIndividualLandTitleInAdditional) {
      // Skip counts API call and proceed directly - no name validation needed for enrichment options
      setPendingLandTitleSelection(prev => ({ ...prev, summary: true }));
      setLandTitleModalStep('DETAIL');
      // Set default counts (will be determined when processing reports)
      setLandTitleCounts({
        current: 0,
        historical: 0,
        titleReferences: []
      });
      setIsLandTitleIndividualSummaryModalOpen(false);
      setIsLandTitleIndividualDetailModalOpen(true);
      return;
    }
    
    // For LAND TITLE category, require confirmedLandTitlePersonDetails
    if (!confirmedLandTitlePersonDetails) {
      alert('Please confirm a person name first');
      return;
    }

    setIsLoadingLandTitleCounts(true);
    setLandTitleCounts({ current: null, historical: null, titleReferences: [] });

    try {
      const states = Array.from(landTitleIndividualStates);
      if (states.length === 0) {
        alert('Please select at least one state');
        setIsLoadingLandTitleCounts(false);
        return;
      }

      // Handle DOB - only include if it's set and valid
      let dobParam: string | undefined = undefined;
      if (landTitleIndividualDobMode === 'EXACT' && landTitleIndividualDob) {
        dobParam = landTitleIndividualDob;
      }

      // Use confirmed person details (firstName, lastName) from the selected name
      // For INDIVIDUAL category, extract from selectedLandTitleIndividualMatch if confirmedLandTitlePersonDetails is not set
      let firstName: string | undefined = undefined;
      let lastName: string = '';
      
      if (isIndividualLandTitleSelected && !confirmedLandTitlePersonDetails && selectedLandTitleIndividualMatch) {
        // Extract from selectedLandTitleIndividualMatch (format: "FirstName LastName • DOB: ... • State • Suburb")
        const nameParts = selectedLandTitleIndividualMatch.split(' • ');
        const fullName = nameParts[0] || selectedLandTitleIndividualMatch;
        const nameComponents = fullName.trim().split(/\s+/);
        firstName = nameComponents.length > 1 ? nameComponents.slice(0, -1).join(' ') : undefined;
        lastName = nameComponents.length > 0 ? nameComponents[nameComponents.length - 1] : fullName;
      } else if (confirmedLandTitlePersonDetails) {
        firstName = confirmedLandTitlePersonDetails.firstName || landTitleIndividualFirstName.trim() || undefined;
        lastName = confirmedLandTitlePersonDetails.lastName || landTitleIndividualLastName.trim();
      } else {
        firstName = landTitleIndividualFirstName.trim() || undefined;
        lastName = landTitleIndividualLastName.trim();
      }
      
      const params: {
        type: 'individual';
        firstName?: string;
        lastName: string;
        dob?: string;
        startYear?: string;
        endYear?: string;
        states: string[];
      } = {
        type: 'individual',
        firstName,
        lastName,
        states
      };

      // Only add dob if it exists
      if (dobParam) {
        params.dob = dobParam;
      }

      // Only add startYear and endYear if in RANGE mode
      if (landTitleIndividualDobMode === 'RANGE') {
        if (landTitleIndividualStartYear) {
          params.startYear = landTitleIndividualStartYear;
        }
        if (landTitleIndividualEndYear) {
          params.endYear = landTitleIndividualEndYear;
        }
      }

      const response = await apiService.getLandTitleCounts(params);
      if (response.success) {
        const fetchedCounts = {
          current: response.current,
          historical: response.historical || 0, // Historical is always 0 for individual searches
          titleReferences: response.titleReferences || []
        };
        
        setLandTitleCounts(fetchedCounts);
        
        // Ensure titleReferences are set in pendingLandTitleSelection based on fetched data
        // Use the response data directly since setLandTitleCounts is async
        setPendingLandTitleSelection(prev => {
          // Only update if we have titleReferences and the current selection would need them
          if (fetchedCounts.titleReferences && fetchedCounts.titleReferences.length > 0) {
            if (prev.detail === 'CURRENT' || prev.detail === 'ALL') {
              return {
                ...prev,
                titleReferences: fetchedCounts.titleReferences,
                currentCount: fetchedCounts.current || 0,
                historicalCount: fetchedCounts.historical || 0
              };
            } else if (prev.detail === 'PAST') {
              return {
                ...prev,
                titleReferences: [], // PAST has no titleReferences for individual
                currentCount: fetchedCounts.current || 0,
                historicalCount: fetchedCounts.historical || 0
              };
            }
          }
          return prev;
        });
      } else {
        throw new Error('Failed to fetch land title counts');
      }
    } catch (error: any) {
      console.error('Error fetching land title counts:', error);
      alert(error?.message || 'Failed to fetch land title counts. Please try again.');
      setIsLoadingLandTitleCounts(false);
      return;
    } finally {
      setIsLoadingLandTitleCounts(false);
    }

    setIsLandTitleIndividualSummaryModalOpen(false);
    setIsLandTitleIndividualDetailModalOpen(true);
  }, [
    selectedCategory,
    selectedSearches,
    selectedIndividualAdditionalSearches,
    selectedLandTitleIndividualMatch,
    confirmedLandTitlePersonDetails,
    landTitleIndividualStates,
    landTitleIndividualDobMode,
    landTitleIndividualDob,
    landTitleIndividualStartYear,
    landTitleIndividualEndYear,
    landTitleIndividualFirstName,
    landTitleIndividualLastName,
    landTitleCounts
  ]);

  const handleLandTitleIndividualDetailBack = useCallback(() => {
    setIsLandTitleIndividualDetailModalOpen(false);
    setIsLandTitleIndividualSummaryModalOpen(true);
  }, []);

  const handleLandTitleIndividualDetailContinue = useCallback(() => {
    // Ensure titleReferences are set if user selected CURRENT/PAST/ALL but they're missing
    if (pendingLandTitleSelection.detail !== 'SUMMARY' && (!pendingLandTitleSelection.titleReferences || pendingLandTitleSelection.titleReferences.length === 0)) {
      const titleReferencesToInclude = (pendingLandTitleSelection.detail === 'CURRENT' || pendingLandTitleSelection.detail === 'ALL')
        ? (landTitleCounts.titleReferences || [])
        : [];
      
      setPendingLandTitleSelection(prev => ({
        ...prev,
        titleReferences: titleReferencesToInclude,
        currentCount: landTitleCounts.current || 0,
        historicalCount: landTitleCounts.historical || 0
      }));
    }
    
    if (pendingLandTitleSelection.addOn || isLandTitleAddOnSelected) {
      finalizeLandTitleIndividualSelection();
      return;
    }
    setIsLandTitleIndividualDetailModalOpen(false);
    setIsLandTitleIndividualAddOnModalOpen(true);
  }, [finalizeLandTitleIndividualSelection, isLandTitleAddOnSelected, pendingLandTitleSelection.addOn, pendingLandTitleSelection.detail, pendingLandTitleSelection.titleReferences, landTitleCounts]);

  const handleLandTitleIndividualAddOnBack = useCallback(() => {
    setIsLandTitleIndividualAddOnModalOpen(false);
    setIsLandTitleIndividualDetailModalOpen(true);
  }, []);

  const handleLandTitleIndividualDetailSelect = useCallback((detail: LandTitleDetailSelection) => {
    // Determine which titleReferences to include based on selection
    let titleReferencesToInclude: Array<{ titleReference: string; jurisdiction: string }> = [];
    
    if (detail === 'ALL') {
      // For "ALL", include all titleReferences (current + historical)
      // Since historical is always 0, all titleReferences are from current
      titleReferencesToInclude = landTitleCounts.titleReferences || [];
    } else if (detail === 'CURRENT') {
      // For "CURRENT", include all current titleReferences
      // Since historical is always 0, all titleReferences are from current
      titleReferencesToInclude = landTitleCounts.titleReferences || [];
    } else if (detail === 'PAST') {
      // For "PAST", include historical titleReferences (which will be empty since historical is always 0)
      titleReferencesToInclude = []; // Historical is always 0, so no titleReferences
    } else {
      // For "SUMMARY", no titleReferences needed
      titleReferencesToInclude = [];
    }
    
    setPendingLandTitleSelection(prev => ({
      ...prev,
      detail,
      summary: detail === 'SUMMARY',
      titleReferences: titleReferencesToInclude,
      currentCount: landTitleCounts.current || 0,
      historicalCount: landTitleCounts.historical || 0
    }));
  }, [landTitleCounts]);


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
    resetIndividualSearchState();
  }, [resetIndividualSearchState]);

  const handleLandTitleIndividualStateSelectAll = useCallback(() => {
    setLandTitleIndividualStates(prev => {
      if (prev.size === landTitleStateOptions.length) {
        return new Set();
      }
      return new Set(landTitleStateOptions);
    });
    resetIndividualSearchState();
  }, [resetIndividualSearchState]);




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
    const currentModal = landTitleModalOpen;
    setLandTitleModalOpen(null);
    setLandTitleModalStep('SUMMARY_PROMPT');
    
    // If we're in SELECT ALL flow and modal is closed (cancelled), check for remaining options
    if (isSelectAllLandTitleFlow && currentModal) {
      // Find remaining options that haven't been shown yet
      const remainingOptions = Array.from(tempSelectAllLandTitleSelections).filter(
        landOption => !shownLandTitleModals.has(landOption)
      );

      if (remainingOptions.length > 0) {
        // Open modal for next option that hasn't been shown
        const nextOption = remainingOptions[0];
        setTimeout(() => {
          openLandTitleModal(nextOption);
          setShownLandTitleModals(prev => new Set(prev).add(nextOption));
        }, 0);
      } else {
        // No more options, finalize SELECT ALL (even if some were cancelled)
        const newSelected = new Set(selectedAdditionalSearches);
        
        // Add all non-land-title options (already added)
        // Add only the land title options that were successfully configured
        tempSelectAllLandTitleSelections.forEach(landOption => {
          if (selectedAdditionalSearches.has(landOption)) {
            // Already configured and added
            newSelected.add(landOption);
          }
        });

        // Lock all land title options that went through the SELECT ALL flow (even if cancelled)
        // This prevents deselection since they went through the popup flow
        setLockedLandTitleOptions(prev => {
          const newLocked = new Set(prev);
          tempSelectAllLandTitleSelections.forEach(landOption => {
            newLocked.add(landOption);
          });
          return newLocked;
        });

        // If both land title options were configured, ensure SELECT ALL is added
        const configuredCount = Array.from(tempSelectAllLandTitleSelections).filter(
          opt => selectedAdditionalSearches.has(opt)
        ).length;
        
        if (configuredCount === tempSelectAllLandTitleSelections.size && tempSelectAllLandTitleSelections.size === 2) {
          ensureAdditionalSelectAllState(newSelected);
        } else {
          newSelected.delete('SELECT ALL');
        }

        setSelectedAdditionalSearches(newSelected);
        setIsSelectAllLandTitleFlow(false);
        setTempSelectAllLandTitleSelections(new Set());
        setShownLandTitleModals(new Set()); // Reset shown modals
      }
    }
  }, [isSelectAllLandTitleFlow, landTitleModalOpen, tempSelectAllLandTitleSelections, selectedAdditionalSearches, openLandTitleModal, ensureAdditionalSelectAllState]);

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
  setLandTitleOrganisationSelected({
    Abn: suggestion.Abn,
    Name: suggestion.Name,
    AbnStatus: suggestion.AbnStatus,
    Score: suggestion.Score
  });
  };

  // Handle company confirmation - call createReport with type "asic-current"
  const handleConfirmCompany = async () => {
    if (!pendingCompany) return;

    const shouldOpenLandTitleModal =
      selectedCategory === 'LAND TITLE' && selectedLandTitleOption === 'LAND_ORGANISATION';

    setIsConfirmingCompany(true);
    setIsLandTitleOrganisationConfirmed(true);
  setLandTitleOrganisationSelected({
    Abn: pendingCompany.abn,
    Name: pendingCompany.name
  });
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

      await apiService.createReport(reportData);

      // Mark as confirmed and show additional searches section
      setIsCompanyConfirmed(true);
      // Hide cross icons for "Choose Report Type" searches after company confirmation
      // Note: showCrossIcons still controls additional searches
      setHasSelectedCompany(true);
      

      if (shouldOpenLandTitleModal) {
        openLandTitleModal('ABN/ACN LAND TITLE');
        setPendingLandTitleSelection(prev => ({
          ...prev,
          addOn: isLandTitleAddOnSelected
        }));
      }

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
    resetIndividualSearchState();
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
    setDocumentSearchId('');
    setDocumentIdInput('');

    // Clear individual details
    setIndividualFirstName('');
    setIndividualLastName('');
    setIndividualDateOfBirth('');
    setSelectedIndividualAdditionalSearches(new Set());
    resetIndividualSearchState();
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
        // For ORGANISATION category, show "Already Ordered" modal instead of deselecting
        if (selectedCategory === 'ORGANISATION') {
          setAlreadyOrderedLandTitleOption(landOption);
          setAlreadyOrderedCategory('ORGANISATION');
          setIsAlreadyOrderedModalOpen(true);
          return;
        }
        // Check if this option is locked (configured through SELECT ALL)
        if (lockedLandTitleOptions.has(landOption)) {
          // Option is locked, prevent deselection
          return;
        }
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
        // For ORGANISATION category, directly open land title modals
        if (selectedCategory === 'ORGANISATION') {
          // Add all non-land-title options first
          additionalSearchOptions.forEach(option => {
            const optionName = option.name as AdditionalSearchType;
            if (!isLandTitleOption(optionName)) {
              newSelected.add(optionName);
            }
          });
          
          // Track which land title options need configuration
          const landTitleOptionsToConfigure: LandTitleOption[] = [];
          if (!selectedAdditionalSearches.has('ABN/ACN LAND TITLE')) {
            landTitleOptionsToConfigure.push('ABN/ACN LAND TITLE');
          }
          if (!selectedAdditionalSearches.has('DIRECTOR LAND TITLE')) {
            landTitleOptionsToConfigure.push('DIRECTOR LAND TITLE');
          }
          
          // If there are land title options to configure, open them in sequence
          if (landTitleOptionsToConfigure.length > 0) {
            setTempSelectAllLandTitleSelections(new Set(landTitleOptionsToConfigure));
            setIsSelectAllLandTitleFlow(true);
            setShownLandTitleModals(new Set()); // Reset shown modals
            // Open first land title modal
            openLandTitleModal(landTitleOptionsToConfigure[0]);
            setShownLandTitleModals(new Set([landTitleOptionsToConfigure[0]])); // Mark first as shown
            // Store the selections so far
            setSelectedAdditionalSearches(newSelected);
            return;
          } else {
            // Both land title options already configured, add them
            newSelected.add('ABN/ACN LAND TITLE');
            newSelected.add('DIRECTOR LAND TITLE');
            ensureAdditionalSelectAllState(newSelected);
          }
        } else {
          // For other categories, select all directly
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
    if (selectedCategory === 'LAND TITLE') {
      if (landTitleModalOpen === 'ABN/ACN LAND TITLE') {
        setLandTitleCategorySelections(prev => ({
          ...prev,
          LAND_ORGANISATION: selection
        }));
        if (selectedLandTitleOption === 'LAND_ORGANISATION') {
          setIsLandTitleAddOnSelected(selection.addOn);
        }
      } else if (landTitleModalOpen === 'DIRECTOR LAND TITLE') {
        setLandTitleCategorySelections(prev => ({
          ...prev,
          LAND_INDIVIDUAL: selection
        }));
        if (selectedLandTitleOption === 'LAND_INDIVIDUAL') {
          setIsLandTitleAddOnSelected(selection.addOn);
        }
      }
    }
    setLandTitlePrices(prev => ({ ...prev, [landTitleModalOpen]: price }));
    
    // If we're in SELECT ALL flow, handle it specially
    if (isSelectAllLandTitleFlow) {
      closeLandTitleModal();
      
      // Check if there are more land title options that need configuration
      // Find the next option in tempSelectAllLandTitleSelections that hasn't been shown yet
      const remainingOptions = Array.from(tempSelectAllLandTitleSelections).filter(
        landOption => !shownLandTitleModals.has(landOption)
      );

      if (remainingOptions.length > 0) {
        // Open modal for next option that hasn't been shown
        const nextOption = remainingOptions[0];
        openLandTitleModal(nextOption);
        setShownLandTitleModals(prev => new Set(prev).add(nextOption));
      } else {
        // All selected options are now configured, finalize SELECT ALL
        const newSelected = new Set(selectedAdditionalSearches);
        
        // Add all non-land-title options
        additionalSearchOptions.forEach(option => {
          const optionName = option.name as AdditionalSearchType;
          if (!isLandTitleOption(optionName)) {
            newSelected.add(optionName);
          }
        });

        // Add all selected land title options and lock them
        const updatedSelections = { ...landTitleSelections, [landTitleModalOpen]: selection };
        tempSelectAllLandTitleSelections.forEach(landOption => {
          const finalSelection = updatedSelections[landOption];
          const finalPrice = calculateLandTitlePrice(landOption, finalSelection);
          setLandTitlePrices(prev => ({ ...prev, [landOption]: finalPrice }));
          newSelected.add(landOption);
        });

        // Lock all land title options that went through the SELECT ALL flow
        setLockedLandTitleOptions(prev => {
          const newLocked = new Set(prev);
          tempSelectAllLandTitleSelections.forEach(landOption => {
            newLocked.add(landOption);
          });
          return newLocked;
        });

        // If both land title options are selected, ensure SELECT ALL is added
        if (tempSelectAllLandTitleSelections.size === 2) {
          ensureAdditionalSelectAllState(newSelected);
        } else {
          newSelected.delete('SELECT ALL');
        }

        setSelectedAdditionalSearches(newSelected);
        setIsSelectAllLandTitleFlow(false);
        setTempSelectAllLandTitleSelections(new Set());
        setShownLandTitleModals(new Set()); // Reset shown modals
      }
    } else {
      // Normal flow - just add this option
    setSelectedAdditionalSearches(prev => {
      const updated = new Set(prev);
      updated.add(landTitleModalOpen);
      ensureAdditionalSelectAllState(updated);
      return updated;
    });
    closeLandTitleModal();
    }
  };

  const handleLandTitleSummaryContinue = async () => {
    if (!landTitleModalOpen) return;

    // For ORGANISATION category with DIRECTOR LAND TITLE, skip counts API call and proceed directly
    if (landTitleModalOpen === 'DIRECTOR LAND TITLE' && selectedCategory === 'ORGANISATION') {
      setPendingLandTitleSelection(prev => ({ ...prev, summary: true }));
      setLandTitleModalStep('DETAIL');
      // Set default counts (will be determined when processing reports with actual directors)
      setLandTitleCounts({
        current: 0,
        historical: 0,
        titleReferences: []
      });
      return;
    }

    setIsLoadingLandTitleCounts(true);
    setLandTitleCounts({ current: null, historical: null, titleReferences: [] });

    try {
      let params: {
        type: 'organization' | 'individual';
        abn?: string;
        companyName?: string;
        firstName?: string;
        lastName?: string;
        dob?: string;
        startYear?: string;
        endYear?: string;
        states: string[];
      };

      if (landTitleModalOpen === 'ABN/ACN LAND TITLE') {
        // Organization search
        // For ORGANISATION category, use all states by default (no user selection required)
        // For LAND TITLE category, use selected states
        const states = selectedCategory === 'ORGANISATION' 
          ? Array.from(landTitleStateOptions)
          : Array.from(landTitleOrganisationStates);
        
        if (selectedCategory !== 'ORGANISATION' && states.length === 0) {
          alert('Please select at least one state');
          setIsLoadingLandTitleCounts(false);
          return;
        }

        // Use confirmed company data when in ORGANISATION category, otherwise use land title organisation data
        let abn = '';
        
        if (selectedCategory === 'ORGANISATION' && isCompanyConfirmed && pendingCompany) {
          // Use confirmed company from ORGANISATION category
          abn = pendingCompany.abn;
        } else {
          // Use land title organisation selection
          abn = landTitleOrganisationSelected?.Abn || landTitleOrganisationSearchTerm;
          
          // If abn is from search term, try to extract it
          if (!abn && organisationSearchTerm) {
            const abnMatch = organisationSearchTerm.match(/ABN:\s*(\d+)/i);
            if (abnMatch) {
              abn = abnMatch[1];
            }
          }
        }

        params = {
          type: 'organization',
          abn: landTitleOrganisationSelected?.Abn || landTitleOrganisationSearchTerm,
          companyName: landTitleOrganisationSelected?.Name || undefined,
          states
        };
      } else {
        // Individual search (DIRECTOR LAND TITLE)
        // For LAND TITLE category, use selected states or all states by default
        // For ORGANISATION category, states are not required (handled above)
        const states = selectedCategory === 'LAND TITLE'
          ? (landTitleIndividualStates.size > 0 
              ? Array.from(landTitleIndividualStates)
              : Array.from(landTitleStateOptions))
          : Array.from(landTitleIndividualStates);
        
        if (selectedCategory !== 'LAND TITLE' && states.length === 0) {
          alert('Please select at least one state');
          setIsLoadingLandTitleCounts(false);
          return;
        }

        if (!landTitleIndividualLastName.trim()) {
          alert('Please enter last name');
          setIsLoadingLandTitleCounts(false);
          return;
        }

        // Handle DOB - only include if it's set and valid (optional for land title individual)
        let dobParam: string | undefined = undefined;
        if (landTitleIndividualDobMode === 'EXACT' && landTitleIndividualDob) {
          dobParam = landTitleIndividualDob;
        }

        params = {
          type: 'individual',
          firstName: landTitleIndividualFirstName.trim() || undefined,
          lastName: landTitleIndividualLastName.trim(),
          states
        };

        // Only add dob if it exists
        if (dobParam) {
          params.dob = dobParam;
        }

        // Only add startYear and endYear if in RANGE mode and they exist
        if (landTitleIndividualDobMode === 'RANGE') {
          if (landTitleIndividualStartYear) {
            params.startYear = landTitleIndividualStartYear;
          }
          if (landTitleIndividualEndYear) {
            params.endYear = landTitleIndividualEndYear;
          }
        }
      }

      const response = await apiService.getLandTitleCounts(params);
      if (response.success) {
        setLandTitleCounts({
          current: response.current,
          historical: response.historical,
          titleReferences: response.titleReferences || []
        });
      } else {
        throw new Error('Failed to fetch land title counts');
      }
    } catch (error: any) {
      console.error('Error fetching land title counts:', error);
      alert(error?.message || 'Failed to fetch land title counts. Please try again.');
      setIsLoadingLandTitleCounts(false);
      return;
    } finally {
      setIsLoadingLandTitleCounts(false);
    }

    setPendingLandTitleSelection(prev => ({ ...prev, summary: true }));
    setLandTitleModalStep('DETAIL');
  };

  const handleLandTitleDetailSelect = (detail: LandTitleDetailSelection) => {
    // Determine which titleReferences to include based on selection
    let titleReferencesToInclude: Array<{ titleReference: string; jurisdiction: string }> = [];
    
    if (detail === 'ALL') {
      // For "ALL", include all titleReferences (current + historical)
      // Since historical is always 0, all titleReferences are from current
      titleReferencesToInclude = landTitleCounts.titleReferences || [];
    } else if (detail === 'CURRENT') {
      // For "CURRENT", include all current titleReferences
      // Since historical is always 0, all titleReferences are from current
      titleReferencesToInclude = landTitleCounts.titleReferences || [];
    } else if (detail === 'PAST') {
      // For "PAST", include historical titleReferences (which will be empty since historical is always 0)
      titleReferencesToInclude = []; // Historical is always 0, so no titleReferences
    } else {
      // For "SUMMARY", no titleReferences needed
      titleReferencesToInclude = [];
    }
    
    setPendingLandTitleSelection(prev => ({
      ...prev,
      detail,
      summary: detail === 'SUMMARY',
      titleReferences: titleReferencesToInclude,
      currentCount: landTitleCounts.current || 0,
      historicalCount: landTitleCounts.historical || 0
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
        // Get available searches (excluding SELECT ALL and those already in main searches)
        const availableSearches = searches.filter(s => s !== 'SELECT ALL' && !selectedSearches.has(s));
        const hasIndividualLandTitle = availableSearches.includes('INDIVIDUAL LAND TITLE');
        
        // Add ALL options first (including INDIVIDUAL LAND TITLE) - similar to how ORGANISATION adds ASIC
        availableSearches.forEach(s => {
            newSelected.add(s);
        });
        
        // If INDIVIDUAL LAND TITLE is available and not already configured, open the land title modals
        if (hasIndividualLandTitle && !selectedIndividualAdditionalSearches.has('INDIVIDUAL LAND TITLE')) {
          // Store the selections first (with INDIVIDUAL LAND TITLE included)
          setSelectedIndividualAdditionalSearches(newSelected);
          // Then open the land title summary modal for INDIVIDUAL LAND TITLE
          setPendingLandTitleSelection({
            summary: true,
            detail: 'SUMMARY',
            addOn: false
          });
          setIsLandTitleIndividualSummaryModalOpen(true);
          return;
        }
        
        // Add SELECT ALL if all options are selected
        if (newSelected.size > 0) {
          const allSelected = availableSearches.every(s => newSelected.has(s));
          if (allSelected) {
          newSelected.add('SELECT ALL');
          }
        }
      }
    } else {
      if (newSelected.has(searchName)) {
        // For INDIVIDUAL LAND TITLE, show "Already Ordered" modal instead of deselecting
        if (searchName === 'INDIVIDUAL LAND TITLE') {
          setAlreadyOrderedLandTitleOption('DIRECTOR LAND TITLE'); // Use DIRECTOR LAND TITLE as the key for individual
          setAlreadyOrderedCategory('INDIVIDUAL');
          setIsAlreadyOrderedModalOpen(true);
          return;
        }
        newSelected.delete(searchName);
        newSelected.delete('SELECT ALL');
      } else {
        // If it's INDIVIDUAL LAND TITLE, add it first then open the land title modals
        // Similar to how ASIC works - add to selection first, then open modal
        if (searchName === 'INDIVIDUAL LAND TITLE') {
          newSelected.add(searchName);
          setSelectedIndividualAdditionalSearches(newSelected);
          // Then open the land title summary modal
          setPendingLandTitleSelection({
            summary: true,
            detail: 'SUMMARY',
            addOn: false
          });
          setIsLandTitleIndividualSummaryModalOpen(true);
          return;
        }
        
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
    
    // Hide cross icons for all additional searches when processing reports
    setShowCrossIcons(false);

    if (selectedCategory === 'INDIVIDUAL') {
      // Check if name has been confirmed (from search results)
      if (!isIndividualNameConfirmed) {
        // If not confirmed, check if we have name fields filled
        const hasFirstName = individualFirstName.trim() || landTitleIndividualFirstName.trim();
        const hasLastName = individualLastName.trim() || landTitleIndividualLastName.trim();
        
        if (!hasFirstName || !hasLastName) {
          alert('Please enter first name and last name');
          return;
        }
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
          if (!landTitleOrganisationSearchTerm || !isLandTitleOrganisationConfirmed) {
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
          // Check if person name is confirmed from search, otherwise validate form inputs
          if (!confirmedLandTitlePersonDetails) {
          if (!landTitleIndividualFirstName.trim() || !landTitleIndividualLastName.trim()) {
              alert('Please enter first name and last name, or search and confirm a person name');
            setIsProcessingReports(false);
            return;
          }
          }
       
          // Validate that a person name is confirmed if search was performed
          if (isLandTitleIndividualSearchPerformed && !confirmedLandTitlePersonDetails) {
            alert('Please confirm a person name from the search results');
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

        let selectionForMeta: LandTitleSelection | undefined;

        if (selectedLandTitleOption === 'TITLE_REFERENCE') {
          selectionForMeta = landTitleCategorySelections.TITLE_REFERENCE || titleReferenceSelection;
        } else if (selectedLandTitleOption === 'LAND_ORGANISATION') {
          selectionForMeta =
            landTitleSelections['ABN/ACN LAND TITLE'] ||
            landTitleCategorySelections.LAND_ORGANISATION;
        } else if (selectedLandTitleOption === 'LAND_INDIVIDUAL') {
          selectionForMeta = landTitleCategorySelections.LAND_INDIVIDUAL;
        } else if (selectedLandTitleOption === 'ADDRESS') {
          selectionForMeta = landTitleCategorySelections.ADDRESS;
        }

        const effectiveDetail = selectionForMeta?.detail ?? 'SUMMARY';
        const effectiveSummary = selectionForMeta?.summary ?? effectiveDetail === 'SUMMARY';
        const effectiveAddOn = isLandTitleAddOnSelected;

        landTitleMeta.addOn = effectiveAddOn;
        landTitleMeta.detail = effectiveDetail;
        landTitleMeta.summary = effectiveSummary;

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
            // Include landTitleSelection with titleReferences for looping
            if (selectionForMeta) {
              landTitleMeta.landTitleSelection = selectionForMeta;
            }
            break;
          case 'LAND_INDIVIDUAL':
            // Use confirmed person details if available, otherwise use form input values
            const personFirstName = confirmedLandTitlePersonDetails?.firstName || landTitleIndividualFirstName.trim();
            const personLastName = confirmedLandTitlePersonDetails?.lastName || landTitleIndividualLastName.trim();
            const personFullName = confirmedLandTitlePersonDetails?.fullName || null;
            
            landTitleMeta.person = {
              firstName: personFirstName,
              lastName: personLastName,
              fullName: personFullName, 
              states: Array.from(landTitleIndividualStates),
              confirmed: !!confirmedLandTitlePersonDetails // Flag to indicate person was confirmed from search
            };
            // Include landTitleSelection with titleReferences for looping
            if (selectionForMeta) {
              landTitleMeta.landTitleSelection = selectionForMeta;
            }
            break;
          case 'ADDRESS':
            landTitleMeta.address = landTitleAddress.trim();
            if (landTitleAddressDetails) {
              landTitleMeta.addressDetails = landTitleAddressDetails;
            }
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

      // Process each report
      const createdReports = [];
      //let company_type = 'N/A';
      for (const reportItem of reportsToCreate) {
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
          // Map to land-title-organisation for new flow
          reportType = 'land-title-organisation';
        } else if (reportItem.type === 'ABN/ACN COURT FILES') {
          reportType = 'court';
        } else if (reportItem.type === 'ASIC - CURRENT') {
          reportType = 'asic-current';
        } else if (reportItem.type === 'ATO') {
          reportType = 'ato';
        } else if (reportItem.type.includes('DIRECTOR') || reportItem.type.includes('INDIVIDUAL') ) {
          if (reportItem.type.includes('PPSR')) {
            reportType = 'director-ppsr';
          } else if (reportItem.type.includes('BANKRUPTCY')) {
            reportType = 'director-bankruptcy';
          } else if (reportItem.type.includes('LAND TITLE')) {
            // Map to land-title-individual for new flow
            reportType = 'land-title-individual';
          } else {
            reportType = 'director-related';
          }
        } else if (reportItem.type === 'ADD DOCUMENT SEARCH') {
          reportType = 'asic-document-search';
        } else if (reportItem.type === 'ASIC - CURRENT') {
          reportType = 'asic-current';
        } else {
          // Default fallback
          console.log(reportItem.type);
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
            // Call backend to create report
            const reportResponse = await apiService.createReport(reportData);

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
            const effectiveFirstName =
              landTitleIndividualFirstName.trim() || individualFirstName;
            const effectiveLastName =
              landTitleIndividualLastName.trim() || individualLastName;
            const effectiveDob =
              landTitleIndividualDobMode === 'EXACT' && landTitleIndividualDob
                ? landTitleIndividualDob
                : individualDateOfBirth;

            businessData = {
              ...(businessData || {}),
              fname: effectiveFirstName,
              lname: effectiveLastName,
              dob: effectiveDob,
              isCompany: 'INDIVIDUAL'
            };

            if (reportType === 'director-bankruptcy' && selectedBankruptcyMatch) {
              (businessData as any).bankruptcySelection = selectedBankruptcyMatch;
            }
            if (reportType === 'director-related' && selectedRelatedMatch) {
              (businessData as any).directorRelatedSelection = selectedRelatedMatch;
            }
          }

          if (reportItem.meta) {
            const meta = reportItem.meta as Record<string, unknown> & {
              address?: string;
              addressDetails?: LandTitleAddressDetails;
              landTitleSelection?: LandTitleSelection;
            };

            const { address, addressDetails, landTitleSelection, ...remainingMeta } = meta;
            const selectionPayload =
              landTitleSelection ?? remainingMeta;

            if (selectionPayload && Object.keys(selectionPayload).length > 0) {
              businessData = {
                ...(businessData || {}),
                landTitleSelection: selectionPayload
              };
            } else if (businessData && 'landTitleSelection' in businessData) {
              const mutableBusiness = { ...businessData };
              delete (mutableBusiness as any).landTitleSelection;
              businessData = mutableBusiness;
            }

            if (address) {
              businessData = {
                ...(businessData || {}),
                address
              };
            }

            if (addressDetails) {
              businessData = {
                ...(businessData || {}),
                addressDetails
              };
            }
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

            console.log(reportData);
          // Call backend to create report
          const reportResponse = await apiService.createReport(reportData);

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
                  <span className={`text-sm font-semibold ${activeStep === 0 ? 'text-red-600' : 'text-gray-600'}`}>Choose Search Type</span>
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
                  <span className={`text-sm font-semibold ${activeStep === 1 ? 'text-red-600' : 'text-gray-600'}`}>Choose Report Type</span>
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
                  <span className={`text-sm font-semibold ${activeStep === 2 ? 'text-red-600' : 'text-gray-600'}`}>Search for Organisation</span>
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
                <>Choose <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20">Search Type</span></>
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
            <div ref={searchesCardRef} className={`bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100 transition-all duration-300 ${
              selectedCategory === 'ORGANISATION' && isCompanyConfirmed 
                ? 'opacity-60 pointer-events-none' 
                : 'hover:shadow-2xl hover:-translate-y-1'
            }`}>
              <h2 className="text-[32px] font-bold text-center mb-10 text-gray-900 tracking-tight">
                {selectedCategory === 'ORGANISATION' || selectedCategory === 'INDIVIDUAL' ? (
                  <>Choose <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20">Report Type</span></>
                ) : (
                  <>Select <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20">Searches</span></>
                )}
              </h2>
              {selectedCategory === 'ORGANISATION' && isCompanyConfirmed && (
                <p className="text-center text-sm font-medium text-gray-500 mb-6">
                  Report types are locked after company confirmation. Please proceed to Additional Searches.
                </p>
              )}

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
                                disabled={isTitleReferenceModalOpen || isTitleReferenceSelectionConfirmed}
                                className={`block w-full px-4 py-3 border-2 rounded-xl shadow-sm transition-colors duration-200 ${
                                  isTitleReferenceModalOpen || isTitleReferenceSelectionConfirmed
                                    ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                                    : 'border-gray-200 focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100'
                                }`}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={handleTitleReferenceSearchClick}
                              disabled={isTitleReferenceModalOpen || isTitleReferenceSelectionConfirmed || !landTitleReferenceId.trim()}
                              className={`w-full rounded-xl py-4 font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 ${
                                isTitleReferenceModalOpen || isTitleReferenceSelectionConfirmed || !landTitleReferenceId.trim()
                                  ? 'bg-gray-400 cursor-not-allowed'
                                  : 'bg-red-600 hover:bg-red-700'
                              }`}
                            >
                              {isTitleReferenceModalOpen ? 'Processing...' : isTitleReferenceSelectionConfirmed ? 'Completed' : 'Search'}
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
                                    resetIndividualSearchState();
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
                                    resetIndividualSearchState();
                                  }}
                                  placeholder="Enter last name"
                                  className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                                />
                              </div>
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
                                {isLoadingLandTitlePersonNames ? (
                                  <div className="flex items-center justify-center py-8">
                                    <svg className="animate-spin h-8 w-8 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span className="ml-3 text-gray-600 font-semibold">Searching person names...</span>
                                  </div>
                                ) : landTitlePersonNamesError ? (
                                  <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                                    {landTitlePersonNamesError}
                                  </div>
                                ) : landTitleIndividualMatches.length > 0 ? (
                                  <div className="rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
                                    Found {landTitleIndividualMatches.length} person name{landTitleIndividualMatches.length !== 1 ? 's' : ''}. Please select from the popup.
                                  </div>
                                ) : null}
                                {confirmedLandTitlePersonDetails && (
                                  <div className="rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
                                    Confirmed Name: {confirmedLandTitlePersonDetails.fullName}
                                  </div>
                                )}
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
                                ref={landTitleAddressInputRef}
                                value={landTitleAddress}
                                onChange={(event) => {
                                  setLandTitleAddress(event.target.value);
                                  setLandTitleAddressDetails(null);
                                }}
                                placeholder="Enter address"
                                className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                              />

                              <button
                                type="button"
                                onClick={handleLandTitleAddressSearchClick}
                                disabled={isAddressSearchDisabled}
                                className={`mt-6 w-full rounded-xl py-4 font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 ${
                                  isAddressSearchDisabled
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'bg-red-600 hover:bg-red-700'
                                }`}
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
              <div ref={detailsCardRef} className="bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 relative z-10">
                <h2 className="text-[32px] font-bold text-center mb-10 text-gray-900 tracking-tight">
                  <span className="text-red-600 relative after:content-[''] after:absolute after:bottom-[-5px] after:left-0 after:right-0 after:h-[3px] after:bg-red-600 after:opacity-20">Search for Organisation</span>
                </h2>

                <div className="max-w-2xl mx-auto">
                  <div>
                    <label htmlFor="organisation-search" className="block text-lg font-semibold text-gray-700 mb-3 sr-only">
                      Search for Organisation
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
                          className="absolute w-full mt-2 bg-white border-2 border-gray-200 rounded-xl shadow-2xl max-h-80 overflow-y-auto"
                          style={{ 
                            backgroundColor: '#ffffff',
                            position: 'absolute',
                            zIndex: 99999,
                            isolation: 'isolate'
                          }}
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
                                className="w-full px-4 py-3 text-left bg-white hover:bg-red-50 transition-colors duration-150 border-b border-gray-100 last:border-b-0 focus:outline-none focus:bg-red-50"
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
                        <div className="flex items-center">
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
                          setIsLandTitleIndividualSearchPerformed(false);
                          setSelectedLandTitleIndividualMatch(null);
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
                          setIsLandTitleIndividualSearchPerformed(false);
                          setSelectedLandTitleIndividualMatch(null);
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
                          setIsLandTitleIndividualSearchPerformed(false);
                          setSelectedLandTitleIndividualMatch(null);
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
                          setIsLandTitleIndividualSearchPerformed(false);
                          setSelectedLandTitleIndividualMatch(null);
                        }}
                        className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                      />
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Start Year<span className="text-red-500">*</span>
                          </label>
                          <select
                            value={landTitleIndividualStartYear}
                            onChange={(event) => {
                              setLandTitleIndividualStartYear(event.target.value);
                              setIsIndividualNameConfirmed(false);
                              setIsLandTitleIndividualSearchPerformed(false);
                              setSelectedLandTitleIndividualMatch(null);
                            }}
                            className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                          >
                            <option value="">Select start year</option>
                            {startYearOptions.map(year => (
                              <option key={year} value={year.toString()}>
                                {year}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">
                            End Year<span className="text-red-500">*</span>
                          </label>
                          <select
                            value={landTitleIndividualEndYear}
                            onChange={(event) => {
                              setLandTitleIndividualEndYear(event.target.value);
                              setIsIndividualNameConfirmed(false);
                              setIsLandTitleIndividualSearchPerformed(false);
                              setSelectedLandTitleIndividualMatch(null);
                            }}
                            className="block w-full px-4 py-3 border-2 border-gray-200 rounded-xl shadow-sm focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 transition-colors duration-200"
                          >
                            <option value="">Select end year</option>
                            {endYearOptions.map(year => (
                              <option key={year} value={year.toString()}>
                                {year}
                              </option>
                            ))}
                          </select>
                        </div>
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

                  {isIndividualNameConfirmed && selectedLandTitleIndividualMatch && (
                    <div className="mt-4 rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
                      Confirmed Name: {selectedLandTitleIndividualMatch}
                    </div>
                  )}
                  {(isLoadingBankruptcyMatches || isLoadingRelatedMatches) && (
                    <div className="mt-4 rounded-xl border-2 border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                      Searching records...
                        </div>
                      )}
                  
                  {/* Inline results removed - now shown in modal */}
                  {isLandTitleIndividualSearchPerformed && false && (
                  <div className="space-y-4">

                      {isIndividualBankruptcySelected &&
                        !isLoadingBankruptcyMatches &&
                        bankruptcyMatchesError && (
                          <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                            {bankruptcyMatchesError}
                        </div>
                      )}

                      {isIndividualRelatedEntitiesSelected &&
                        !isLoadingRelatedMatches &&
                        relatedMatchesError && (
                          <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                            {relatedMatchesError}
                          </div>
                        )}

                      {(() => {
                        const combinedOptions: Array<{
                          key: string;
                          displayLabel: string;
                          source: 'bankruptcy' | 'related' | 'mock';
                          bankruptcyMatch?: BankruptcyMatch | null;
                          relatedMatch?: DirectorRelatedMatch | null;
                        }> = [];

                        if (
                          isIndividualBankruptcySelected &&
                          !isLoadingBankruptcyMatches &&
                          bankruptcyMatchOptions.length > 0
                        ) {
                          const prefix = isIndividualRelatedEntitiesSelected ? '[Bankruptcy] ' : '';
                          combinedOptions.push(
                            ...bankruptcyMatchOptions.map(option => ({
                              key: `bankruptcy-${option.label}`,
                              displayLabel: `${prefix}${option.label}`,
                              source: 'bankruptcy' as const,
                              bankruptcyMatch: option.match
                            }))
                          );
                        }

                        if (
                          isIndividualRelatedEntitiesSelected &&
                          !isLoadingRelatedMatches &&
                          relatedEntityMatchOptions.length > 0
                        ) {
                          const prefix = isIndividualBankruptcySelected ? '[Related] ' : '';
                          combinedOptions.push(
                            ...relatedEntityMatchOptions.map(option => ({
                              key: `related-${option.label}`,
                              displayLabel: `${prefix}${option.label}`,
                              source: 'related' as const,
                              relatedMatch: option.match
                            }))
                          );
                        }

                        if (combinedOptions.length === 0 && !isIndividualBankruptcySelected && !isIndividualRelatedEntitiesSelected) {
                          combinedOptions.push(
                            ...mockLandTitleIndividualMatches.map(label => ({
                              key: `mock-${label}`,
                              displayLabel: label,
                              source: 'mock' as const
                            }))
                          );
                        }

                        return combinedOptions.length > 0 ? (
                      <div className="grid grid-cols-1 gap-3">
                            {combinedOptions.map(option => {
                              const isSelected = selectedLandTitleIndividualMatch === option.displayLabel;
                                      return (
                                        <button
                                  key={option.key}
                                          type="button"
                                          onClick={() => {
                                    setSelectedLandTitleIndividualMatch(option.displayLabel);
                                            setIsIndividualNameConfirmed(false);
                                    if (option.source === 'bankruptcy') {
                                      setSelectedBankruptcyMatch(option.bankruptcyMatch || null);
                                      setSelectedRelatedMatch(null);
                                    } else if (option.source === 'related') {
                                      setSelectedRelatedMatch(option.relatedMatch || null);
                                      setSelectedBankruptcyMatch(null);
                                    } else {
                                      setSelectedBankruptcyMatch(null);
                                      setSelectedRelatedMatch(null);
                                    }
                                  }}
                                  className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${
                                    isSelected
                                  ? 'border-green-500 bg-green-50 text-green-700'
                                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                                }`}
                            >
                                  {option.displayLabel}
                            </button>
                          );
                        })}
                      </div>
                        ) : null;
                      })()}

                      {isIndividualBankruptcySelected &&
                        !isLoadingBankruptcyMatches &&
                        bankruptcyMatchOptions.length === 0 &&
                        !bankruptcyMatchesError && (
                          <div className="rounded-xl border-2 border-yellow-200 bg-yellow-50 px-4 py-3 text-sm font-semibold text-yellow-700">
                            No bankruptcy records found for the provided details. Try adjusting the search.
                    </div>
                        )}

                      {isIndividualRelatedEntitiesSelected &&
                        !isLoadingRelatedMatches &&
                        relatedEntityMatchOptions.length === 0 &&
                        !relatedMatchesError && (
                          <div className="rounded-xl border-2 border-yellow-200 bg-yellow-50 px-4 py-3 text-sm font-semibold text-yellow-700">
                            No related entity records found for the provided details. Try adjusting the search.
                          </div>
                        )}

                    {selectedLandTitleIndividualMatch && (
                      <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        Selected Name: {selectedLandTitleIndividualMatch}
                      </div>
                    )}
                      {selectedLandTitleIndividualMatch && (
                    <button
                      type="button"
                          onClick={handleConfirmIndividualName}
                          className="w-full rounded-xl bg-red-600 py-4 font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
                    >
                      Confirm Name Search
                    </button>
                      )}
                  </div>
                  )}

                </div>
              </div>



            )}


            {selectedCategory === 'INDIVIDUAL' && (isIndividualNameConfirmed || selectedLandTitleIndividualMatch || selectedBankruptcyMatch || selectedRelatedMatch || selectedCourtMatch) && (
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
                className={`bg-white rounded-[20px] p-12 mb-8 shadow-xl border border-gray-100 transition-all duration-300 relative z-0 ${isAdditionalSearchesDisabled ? 'opacity-60' : 'hover:shadow-2xl hover:-translate-y-1'
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
                    .map((search) => {
                      const shouldShowCross = 
                        (selectedCategory === 'ORGANISATION' && !isCompanyConfirmed) ||
                        (selectedCategory === 'INDIVIDUAL' && !isIndividualNameConfirmed);
                      return (
                      <div
                        key={search}
                          className="relative px-6 py-3 rounded-xl font-semibold text-sm uppercase tracking-wide bg-red-600 text-white shadow-md"
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
                          {shouldShowCross && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSearchToggle(search);
                              }}
                              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white text-red-600 flex items-center justify-center hover:bg-red-50 transition-colors duration-200 shadow-md"
                              aria-label={`Remove ${getSearchDisplayName(search)}`}
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                        )}
                      </div>
                      );
                    })}

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
                      const isLandTitle = isLandTitleOption(search);
                      // Show cross icon if:
                      // 1. showCrossIcons is true (not processed yet)
                      // 2. It's NOT a land title option (ABN/ACN LAND TITLE or DIRECTOR LAND TITLE never show cross icon)
                      const shouldShowCross = showCrossIcons && !isLandTitle;
                      return (
                        <div
                          key={search}
                          className="relative px-6 py-3 rounded-xl font-semibold text-sm uppercase tracking-wide bg-red-600 text-white shadow-md"
                        >
                          {getAdditionalSearchLabel(search)}
                          {option?.available && ` (${option.available} available)`}
                          {shouldShowCross && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAdditionalSearchToggle(search);
                              }}
                              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white text-red-600 flex items-center justify-center hover:bg-red-50 transition-colors duration-200 shadow-md"
                              aria-label={`Remove ${getAdditionalSearchLabel(search)}`}
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })}

                  {/* Additional searches for INDIVIDUAL */}
                  {selectedCategory === 'INDIVIDUAL' && Array.from(selectedIndividualAdditionalSearches)
                    .filter(search => search !== 'SELECT ALL')
                    .map((search) => {
                      // Show cross icon if showCrossIcons is true (not processed yet)
                      const shouldShowCross = showCrossIcons;
                      return (
                      <div
                        key={search}
                        className="relative px-6 py-3 rounded-xl font-semibold text-sm uppercase tracking-wide bg-red-600 text-white shadow-md"
                      >
                        {getSearchDisplayName(search)}
                        {shouldShowCross && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleIndividualAdditionalSearchToggle(search);
                            }}
                            className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white text-red-600 flex items-center justify-center hover:bg-red-50 transition-colors duration-200 shadow-md"
                            aria-label={`Remove ${getSearchDisplayName(search)}`}
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
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
          onClick={() => closeCourtModal({ removeSelection: true })}
        >
          <div
            className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => closeCourtModal({ removeSelection: true })}
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

      {isAlreadyOrderedModalOpen && alreadyOrderedLandTitleOption && alreadyOrderedCategory && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-gray-900/60 px-4"
          onClick={() => {
            setIsAlreadyOrderedModalOpen(false);
            setAlreadyOrderedLandTitleOption(null);
            setAlreadyOrderedCategory(null);
          }}
        >
          <div
            className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setIsAlreadyOrderedModalOpen(false);
                setAlreadyOrderedLandTitleOption(null);
                setAlreadyOrderedCategory(null);
              }}
              className="absolute top-4 right-4 text-gray-400 transition-colors duration-200 hover:text-red-600"
              aria-label="Close modal"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="text-center">
              <h3 className="text-2xl font-bold text-gray-900 mb-6">Already Ordered</h3>
              
              <div className="text-left mb-6">
                <p className="text-sm font-semibold text-gray-700 mb-3">Order Summary:</p>
                <ul className="space-y-2 text-sm text-gray-600">
                  {(() => {
                    // Get selection data based on category
                    let selection: LandTitleSelection | undefined;
                    if (alreadyOrderedCategory === 'INDIVIDUAL') {
                      // For INDIVIDUAL category, use LAND_INDIVIDUAL from landTitleCategorySelections
                      selection = landTitleCategorySelections.LAND_INDIVIDUAL;
                    } else {
                      // For ORGANISATION category, use landTitleSelections
                      selection = landTitleSelections[alreadyOrderedLandTitleOption];
                    }
                    
                    const currentCount = selection?.currentCount ?? 0;
                    const historicalCount = selection?.historicalCount ?? 0;
                    const totalReports = currentCount + historicalCount;
                    
                    // For DIRECTOR LAND TITLE in ORGANISATION, calculate based on directors if counts are 0
                    let displayCurrent = currentCount;
                    let displayHistorical = historicalCount;
                    
                    if (alreadyOrderedCategory === 'ORGANISATION' && alreadyOrderedLandTitleOption === 'DIRECTOR LAND TITLE' && totalReports === 0) {
                      const directorCount = companyDetails.directors || 0;
                      const pastDirectorCount = companyDetails.pastDirectors || 0;
                      const detail = selection?.detail || 'SUMMARY';
                      
                      if (detail === 'CURRENT') {
                        displayCurrent = directorCount;
                        displayHistorical = 0;
                      } else if (detail === 'PAST') {
                        displayCurrent = 0;
                        displayHistorical = pastDirectorCount;
                      } else if (detail === 'ALL') {
                        displayCurrent = directorCount;
                        displayHistorical = pastDirectorCount;
                      } else {
                        // SUMMARY - show all
                        displayCurrent = directorCount;
                        displayHistorical = pastDirectorCount;
                      }
                    }
                    
                    const displayTotal = displayCurrent + displayHistorical;
                    
                    return (
                      <>
                        {displayCurrent > 0 && (
                          <li className="flex items-center">
                            <span className="w-2 h-2 bg-red-600 rounded-full mr-3"></span>
                            Current ({displayCurrent} available)
                          </li>
                        )}
                        {displayHistorical > 0 && (
                          <li className="flex items-center">
                            <span className="w-2 h-2 bg-red-600 rounded-full mr-3"></span>
                            Past ({displayHistorical} available)
                          </li>
                        )}
                        <li className="mt-4 pt-3 border-t border-gray-200 font-semibold text-gray-900">
                          Total Reports: {displayTotal}
                        </li>
                      </>
                    );
                  })()}
                </ul>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsAlreadyOrderedModalOpen(false);
                  setAlreadyOrderedLandTitleOption(null);
                  setAlreadyOrderedCategory(null);
                }}
                className="w-full rounded-xl bg-red-600 py-4 font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700"
              >
                Close
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
                <h3 className="text-2xl font-bold text-gray-900 mb-4">Land Title Search - Locate Title Reference</h3>
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

      {(selectedLandTitleOption === 'LAND_INDIVIDUAL' || (selectedCategory === 'INDIVIDUAL' && (selectedSearches.has('INDIVIDUAL LAND TITLE') || selectedIndividualAdditionalSearches.has('INDIVIDUAL LAND TITLE')))) && (
        <>
          {isConfirmPersonNameModalOpen && landTitleIndividualMatches.length > 0 && (
            <div
              className="fixed inset-0 z-[119] flex items-center justify-center bg-gray-900/60 px-4"
              onClick={() => setIsConfirmPersonNameModalOpen(false)}
            >
              <div
                className="relative w-full max-w-2xl rounded-3xl bg-white p-8 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setIsConfirmPersonNameModalOpen(false)}
                  className="absolute top-4 right-4 text-gray-400 transition-colors duration-200 hover:text-red-600 z-10"
                  aria-label="Close modal"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                <h3 className="text-2xl font-bold text-gray-900 mb-4">Select Person Name</h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-6">
                  Please select a person name from the search results and confirm to proceed.
                </p>

                {/* Scrollable list of names */}
                <div className="flex-1 overflow-y-auto mb-6 pr-2">
                  <div className="grid grid-cols-1 gap-3">
                    {landTitleIndividualMatches.map((match, index) => {
                      const isSelected = selectedLandTitleIndividualMatch === match;
                      return (
                        <button
                          key={`${match}-${index}`}
                          type="button"
                          onClick={() => {
                            setSelectedLandTitleIndividualMatch(match);
                            setIsIndividualNameConfirmed(false);
                          }}
                          className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${isSelected
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                            }`}
                        >
                          {match}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Selected name display */}
                {selectedLandTitleIndividualMatch && (
                  <div className="mb-6 rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-4">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Selected Name:</p>
                    <p className="text-lg font-bold text-gray-900 uppercase tracking-wide">
                      {selectedLandTitleIndividualMatch}
                    </p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedLandTitleIndividualMatch) {
                        alert('Please select a name to confirm');
                        return;
                      }
                      handleConfirmIndividualName();
                      setIsConfirmPersonNameModalOpen(false);
                      // Open summary modal after confirmation
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
                  <button
                    type="button"
                    onClick={() => setIsConfirmPersonNameModalOpen(false)}
                    className="w-full rounded-xl border-2 border-gray-200 bg-white py-3 font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {isLandTitleIndividualSummaryModalOpen && (
            <div
              className="fixed inset-0 z-[118] flex items-center justify-center bg-gray-900/60 px-4"
              onClick={() => closeLandTitleIndividualModals({ removeSelection: true })}
            >
              <div
                className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => closeLandTitleIndividualModals({ removeSelection: true })}
                  className="absolute top-4 right-4 text-gray-400 transition-colors duration-200 hover:text-red-600"
                  aria-label="Close modal"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                <h3 className="text-2xl font-bold text-gray-900 mb-4">Land Title Search - Locate Title Reference</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  A summary report will display any recorded title references from your search. For full details on current or past titles, select after processing or continue with the summary only.
                </p>

                <div className="mt-8 space-y-3">
                  <button
                    type="button"
                    onClick={handleLandTitleIndividualSummaryContinue}
                    disabled={isLoadingLandTitleCounts}
                    className="w-full rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isLoadingLandTitleCounts ? 'Processing...' : `Process – ${formatCurrency(landTitleIndividualDetailPricing.SUMMARY)}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeLandTitleIndividualModals({ removeSelection: true })}
                    disabled={isLoadingLandTitleCounts}
                    className="w-full rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
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
              onClick={() => closeLandTitleIndividualModals({ removeSelection: true })}
            >
              <div
                className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => closeLandTitleIndividualModals({ removeSelection: true })}
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
                      <span>Title References Only</span>
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
              onClick={() => closeLandTitleIndividualModals({ removeSelection: true })}
            >
              <div
                className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => closeLandTitleIndividualModals({ removeSelection: true })}
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
                
                {/* State Selection for ABN/ACN LAND TITLE - only show for LAND TITLE category, not ORGANISATION, and only if states haven't been selected yet */}
                {landTitleModalOpen === 'ABN/ACN LAND TITLE' && 
                 selectedCategory !== 'ORGANISATION' && 
                 !(selectedCategory === 'LAND TITLE' && selectedLandTitleOption === 'LAND_ORGANISATION' && landTitleOrganisationStates.size > 0) && (
                  <div className="mt-6">
                    <span className="block text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
                      Select States<span className="text-red-500">*</span>
                    </span>
                    <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                      {landTitleStateOptions.map(state => {
                        const isSelected = landTitleOrganisationStates.has(state);
                        return (
                          <button
                            key={state}
                            type="button"
                            onClick={() => handleLandTitleOrganisationStateToggle(state)}
                            className={`
                              px-4 py-2 rounded-xl border-2 text-xs font-semibold uppercase tracking-wide transition-all duration-200
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
                          px-4 py-2 rounded-xl border-2 text-xs font-semibold uppercase tracking-wide transition-all duration-200
                          ${landTitleOrganisationStates.size === landTitleStateOptions.length
                            ? 'border-red-600 bg-red-600 text-white shadow-red-600/30'
                            : 'border-gray-200 bg-white text-red-600 hover:border-red-600'}
                        `}
                      >
                        Select All
                      </button>
                    </div>
                    {landTitleOrganisationStates.size === 0 && (
                      <p className="mt-2 text-xs text-red-600 font-medium">
                        Please select at least one state
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-8 space-y-3">
                  <button
                    type="button"
                    onClick={handleLandTitleSummaryContinue}
                    disabled={isLoadingLandTitleCounts || (landTitleModalOpen === 'ABN/ACN LAND TITLE' && selectedCategory !== 'ORGANISATION' && !(selectedCategory === 'LAND TITLE' && selectedLandTitleOption === 'LAND_ORGANISATION' && landTitleOrganisationStates.size > 0) && landTitleOrganisationStates.size === 0)}
                    className="w-full rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoadingLandTitleCounts ? 'Processing...' : `Process – ${formatCurrency(landTitlePricingConfig.base[landTitleModalOpen])}`}
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
                    const currentCount = landTitleCounts.current ?? 0;
                    const historicalCount = landTitleCounts.historical ?? 0;
                    const allCount = currentCount + historicalCount;
                    
                    const options =
                      landTitleModalOpen === 'DIRECTOR LAND TITLE'
                        ? [
                          {
                            key: 'CURRENT',
                            label: `Current${currentCount > 0 ? ` (${currentCount} available)` : ''}`
                          },
                          {
                            key: 'PAST',
                            label: `Past${historicalCount > 0 ? ` (${historicalCount} available)` : ''}`
                          },
                          {
                            key: 'ALL',
                            label: `All${allCount > 0 ? ` (${allCount} available)` : ''}`
                          },
                          {
                            key: 'SUMMARY',
                            label: 'Title References Only'
                          }
                        ]
                        : [
                          {
                            key: 'CURRENT',
                            label: `Current${currentCount > 0 ? ` (${currentCount} available)` : ''}`
                          },
                          {
                            key: 'PAST',
                            label: `Past${historicalCount > 0 ? ` (${historicalCount} available)` : ''}`
                          },
                          {
                            key: 'ALL',
                            label: `All${allCount > 0 ? ` (${allCount} available)` : ''}`
                          },
                          { key: 'SUMMARY', label: 'Title References Only' }
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

      {/* Individual Name Search Modal */}
      {isIndividualNameSearchModalOpen && selectedCategory === 'INDIVIDUAL' && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-gray-900/60 px-4"
          onClick={handleIndividualNameSearchModalClose}
        >
          <div
            className="relative w-full max-w-2xl rounded-3xl bg-white p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={handleIndividualNameSearchModalClose}
              className="absolute top-4 right-4 text-gray-400 transition-colors duration-200 hover:text-red-600"
              aria-label="Close modal"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h3 className="text-2xl font-bold text-gray-900 mb-2">
              {individualNameSearchModalType === 'bankruptcy' 
                ? 'Select Bankruptcy Record' 
                : individualNameSearchModalType === 'related'
                ? 'Select Related Entity Record'
                : individualNameSearchModalType === 'court'
                ? 'Select Court Record'
                : 'Select Name Match'}
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              {individualNameSearchModalType === 'bankruptcy'
                ? 'Please select the exact bankruptcy record that matches the person you are searching for.'
                : individualNameSearchModalType === 'related'
                ? 'Please select the exact related entity record that matches the person you are searching for.'
                : individualNameSearchModalType === 'court'
                ? 'Please select the exact court record that matches the person you are searching for.'
                : 'Please select the exact name match.'}
            </p>

            {/* Error Messages */}
            {individualNameSearchModalType === 'bankruptcy' && bankruptcyMatchesError && (
              <div className="mb-4 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {bankruptcyMatchesError}
              </div>
            )}

            {individualNameSearchModalType === 'related' && relatedMatchesError && (
              <div className="mb-4 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {relatedMatchesError}
              </div>
            )}

            {individualNameSearchModalType === 'court' && courtMatchesError && (
              <div className="mb-4 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {courtMatchesError}
              </div>
            )}

            {/* No Results Messages */}
            {individualNameSearchModalType === 'bankruptcy' && 
             !isLoadingBankruptcyMatches && 
             bankruptcyMatchOptions.length === 0 && 
             !bankruptcyMatchesError && (
              <div className="mb-4 rounded-xl border-2 border-yellow-200 bg-yellow-50 px-4 py-3 text-sm font-semibold text-yellow-700">
                No bankruptcy records found for the provided details. Try adjusting the search.
              </div>
            )}

            {individualNameSearchModalType === 'related' && 
             !isLoadingRelatedMatches && 
             relatedEntityMatchOptions.length === 0 && 
             !relatedMatchesError && (
              <div className="mb-4 rounded-xl border-2 border-yellow-200 bg-yellow-50 px-4 py-3 text-sm font-semibold text-yellow-700">
                No related entity records found for the provided details. Try adjusting the search.
              </div>
            )}

            {individualNameSearchModalType === 'court' && 
             !isLoadingCourtMatches && 
             courtMatchOptions.length === 0 && 
             !courtMatchesError && (
              <div className="mb-4 rounded-xl border-2 border-yellow-200 bg-yellow-50 px-4 py-3 text-sm font-semibold text-yellow-700">
                No court records found for the provided details. Try adjusting the search.
              </div>
            )}

            {/* Results List */}
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {(() => {
                let options: Array<{
                  key: string;
                  displayLabel: string;
                  source: 'bankruptcy' | 'related' | 'court' | 'mock';
                  bankruptcyMatch?: BankruptcyMatch | null;
                  relatedMatch?: DirectorRelatedMatch | null;
                }> = [];

                if (individualNameSearchModalType === 'bankruptcy' && !isLoadingBankruptcyMatches && bankruptcyMatchOptions.length > 0) {
                  options = bankruptcyMatchOptions.map(option => ({
                    key: `bankruptcy-${option.label}`,
                    displayLabel: option.label,
                    source: 'bankruptcy' as const,
                    bankruptcyMatch: option.match
                  }));
                } else if (individualNameSearchModalType === 'related' && !isLoadingRelatedMatches && relatedEntityMatchOptions.length > 0) {
                  options = relatedEntityMatchOptions.map(option => ({
                    key: `related-${option.label}`,
                    displayLabel: option.label,
                    source: 'related' as const,
                    relatedMatch: option.match
                  }));
                } else if (individualNameSearchModalType === 'court' && !isLoadingCourtMatches && courtMatchOptions.length > 0) {
                  // Show actual court results
                  options = courtMatchOptions.map(option => ({
                    key: `court-${option.label}`,
                    displayLabel: option.label,
                    source: 'court' as const,
                    courtMatch: option.match
                  }));
                } else if (!individualNameSearchModalType) {
                  // Show mock results for INDIVIDUAL LAND TITLE or when no other search types are selected
                  const isIndividualLandTitleSearch = selectedCategory === 'INDIVIDUAL' && selectedSearches.has('INDIVIDUAL LAND TITLE');
                  const isIndividualCourtSearch = selectedCategory === 'INDIVIDUAL' && selectedSearches.has('COURT');
                  if (isIndividualLandTitleSearch || (!isIndividualBankruptcySelected && !isIndividualRelatedEntitiesSelected && !isIndividualCourtSearch)) {
                    options = mockLandTitleIndividualMatches.map(label => ({
                      key: `mock-${label}`,
                      displayLabel: label,
                      source: 'mock' as const
                    }));
                  }
                }

                return options.length > 0 ? (
                  options.map(option => {
                    const isSelected = pendingIndividualNameSelection?.displayLabel === option.displayLabel && 
                                      pendingIndividualNameSelection?.source === option.source;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => handleIndividualNameSearchSelect(option)}
                        className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${
                          isSelected
                            ? 'border-red-600 bg-red-50 text-red-700'
                            : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-red-600 hover:bg-red-50'
                        }`}
                      >
                        {option.displayLabel}
                      </button>
                    );
                  })
                ) : (
                  <div className="text-center text-gray-500 py-8">
                    {isLoadingBankruptcyMatches || isLoadingRelatedMatches 
                      ? 'Loading results...' 
                      : 'No results found'}
                  </div>
                );
              })()}
            </div>

            {/* Action Buttons */}
            <div className="mt-6 flex justify-between gap-3 pt-6 border-t border-gray-200">
              <button
                type="button"
                onClick={handleIndividualNameSearchModalClose}
                className="flex-1 rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold uppercase tracking-wide text-gray-600 transition-all duration-200 hover:border-gray-300 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleIndividualNameSearchConfirm}
                disabled={!pendingIndividualNameSelection}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition-all duration-200 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm Selection
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Search;
