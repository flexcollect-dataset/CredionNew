const envBaseUrls = [
	import.meta.env.VITE_API_URL,
	import.meta.env.VITE_API_BASE_URL,
	import.meta.env.VITE_BACKEND_URL,
].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

const DEFAULT_API_BASE_URL = 'http://localhost:3001';

const API_BASE_URL = envBaseUrls.find((value) => /^https?:\/\//.test(value)) || DEFAULT_API_BASE_URL;

export interface LoginRequest {
	email: string;
	password: string;
	rememberMe?: boolean;
}

export interface SignupRequest {
	email: string;
	password: string;
	firstName: string;
	lastName: string;
	mobileNumber: string;
	currentPlan: 'Monthly' | 'Pay as you go';
}

export interface AuthResponse {
	success: boolean;
	message: string;
	user?: {
		userId: number;
		email: string;
		firstName: string;
		lastName: string;
		mobileNumber?: string;
		currentPlan?: string;
	};
	accessToken?: string;
	refreshToken?: string;
	redirectUrl?: string;
}

export interface ApiError {
	error: string;
	message: string;
	fieldErrors?: Record<string, { msg: string }>;
}

export interface BankruptcyDebtor {
	surname?: string;
	givenNames?: string;
	dateOfBirth?: string;
	aliasIndicator?: boolean;
	addressSuburb?: string | null;
	occupation?: string | null;
}

export interface BankruptcyMatch {
	extractId?: string;
	debtor: BankruptcyDebtor;
	startDate?: string;
	endDate?: string;
	[key: string]: any;
}

export interface BankruptcySearchResponse {
	success: boolean;
	matches: BankruptcyMatch[];
	resultCount?: number;
	resultLimitExceeded?: boolean;
	operationFeeAmount?: number | null;
	error?: string;
	message?: string;
}

export interface DirectorRelatedMatch {
	person_id: string;
	search_id: string;
	name: string;
	dob?: string;
	state?: string;
	suburb?: string | null;
	additional?: any[];
	[key: string]: any;
}

export interface DirectorRelatedSearchResponse {
	success: boolean;
	matches: DirectorRelatedMatch[];
	error?: string;
	message?: string;
}

class ApiService {
	private baseURL: string;

	constructor(baseURL: string = API_BASE_URL) {
		this.baseURL = baseURL;
	}

	private async request<T>(
		endpoint: string,
		options: RequestInit = {}
	): Promise<T> {
		const url = `${this.baseURL}${endpoint}`;

		// Get auth token from localStorage
		const token = localStorage.getItem('accessToken');

		const config: RequestInit = {
			headers: {
				'Content-Type': 'application/json',
				...(token && { 'Authorization': `Bearer ${token}` }),
				...options.headers,
			},
			credentials: 'include', // Include cookies for session management
			...options,
		};

		try {
			const response = await fetch(url, config);
			const data = await response.json();

			if (!response.ok) {
				console.error('API Error Response:', {
					status: response.status,
					statusText: response.statusText,
					data: data
				});
				throw new Error(data.message || data.error || 'An error occurred');
			}

			return data;
		} catch (error) {
			console.error('API request failed:', error);
			throw error;
		}
	}

	// Authentication methods
	async login(credentials: LoginRequest): Promise<AuthResponse> {
		return this.request<AuthResponse>('/auth/login', {
			method: 'POST',
			body: JSON.stringify(credentials),
		});
	}

	async signup(userData: SignupRequest): Promise<AuthResponse> {
		// Convert plan names to backend format
		const planMapping = {
			'Monthly': 'monthly',
			'Pay as you go': 'pay_as_you_go'
		};

		const backendData = {
			...userData,
			currentPlan: planMapping[userData.currentPlan],
			agreeTerms: true // Frontend form should include this
		};

		return this.request<AuthResponse>('/auth/signup', {
			method: 'POST',
			body: JSON.stringify(backendData),
		});
	}

	async logout(): Promise<{ success: boolean; message: string }> {
		return this.request<{ success: boolean; message: string }>('/auth/logout', {
			method: 'POST',
		});
	}

	async checkEmail(email: string): Promise<{ exists: boolean }> {
		return this.request<{ exists: boolean }>('/auth/check-email', {
			method: 'POST',
			body: JSON.stringify({ email }),
		});
	}

	async checkMobile(mobileNumber: string): Promise<{ exists: boolean }> {
		return this.request<{ exists: boolean }>('/auth/check-mobile', {
			method: 'POST',
			body: JSON.stringify({ mobileNumber }),
		});
	}

	// Health check
	async healthCheck(): Promise<{ status: string; message: string; timestamp: string }> {
		return this.request<{ status: string; message: string; timestamp: string }>('/health');
	}

	// Matter API methods
	async createMatter(data: { matterName: string; description?: string | null }) {
		return this.request<{ success: boolean; message: string; matter: any }>('/api/matters/create', {
			method: 'POST',
			body: JSON.stringify(data)
		});
	}

	async getMatters() {
		// Add timestamp to prevent caching
		const timestamp = new Date().getTime();
		return this.request<{ success: boolean; matters: any[]; message?: string }>(`/api/matters/list?t=${timestamp}`);
	}

	async searchMatters(query: string) {
		return this.request<{ success: boolean; matters: any[] }>(`/api/matters/search?query=${encodeURIComponent(query)}`);
	}

	async getMatter(matterId: number) {
		return this.request<{ success: boolean; matter: any }>(`/api/matters/${matterId}`);
	}

	async getMatterReports(matterId: number, page: number = 1, limit: number = 20) {
		return this.request<{ 
			success: boolean; 
			reports: any[];
			pagination?: {
				page: number;
				limit: number;
				totalCount: number;
				totalPages: number;
				hasNextPage: boolean;
				hasPrevPage: boolean;
			}
		}>(`/api/matters/${matterId}/reports?page=${page}&limit=${limit}`);
	}

	async updateMatter(matterId: number, data: { matterName?: string; description?: string; status?: string }) {
		return this.request<{ success: boolean; message: string; matter: any }>(`/api/matters/${matterId}`, {
			method: 'PUT',
			body: JSON.stringify(data)
		});
	}

	async deleteMatter(matterId: number) {
		return this.request<{ success: boolean; message: string }>(`/api/matters/${matterId}`, {
			method: 'DELETE'
		});
	}

	// Search functionality - Direct call to Australian Business Register API
	async searchABNByName(searchTerm: string): Promise<{ success: boolean; results: any[] }> {
		const ABN_GUID = '250e9f55-f46e-4104-b0df-774fa28cff97';

		// Check if search term is a number (ABN/ACN search)
		const isNumeric = /^\d+$/.test(searchTerm.replace(/\s/g, ''));

		if (isNumeric) {
			// Search by ABN/ACN number
			return this.searchByABN(searchTerm.replace(/\s/g, ''));
		}

		// Search by name
		const url = `https://abr.business.gov.au/json/MatchingNames.aspx?name=${encodeURIComponent(searchTerm)}&maxResults=10&guid=${ABN_GUID}`;

		try {
			const response = await fetch(url);
			const text = await response.text();

			// Extract JSON from JSONP response
			const match = text.match(/callback\((.*)\)/);
			if (!match) {
				throw new Error('Invalid ABN lookup response format');
			}

			const data = JSON.parse(match[1]);
			const results = data.Names || [];

			return {
				success: true,
				results: results.map((result: any) => ({
					Abn: result.Abn,
					Name: result.Name || 'Unknown',
					AbnStatus: result.AbnStatus || 'Active',
					Score: result.Score || 0
				}))
			};
		} catch (error) {
			console.error('Error searching ABN by name:', error);
			return {
				success: false,
				results: []
			};
		}
	}

	// Search by ABN/ACN number directly
	async searchByABN(abnNumber: string): Promise<{ success: boolean; results: any[] }> {
		const ABN_GUID = '250e9f55-f46e-4104-b0df-774fa28cff97';
		const url = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${abnNumber}&guid=${ABN_GUID}`;

		try {
			const response = await fetch(url);
			const text = await response.text();

			// Extract JSON from JSONP response
			const match = text.match(/callback\((.*)\)/);
			if (!match) {
				throw new Error('Invalid ABN lookup response format');
			}

			const data = JSON.parse(match[1]);

			// Check if ABN was found
			if (data.Abn) {
				return {
					success: true,
					results: [{
						Abn: data.Abn,
						Name: data.EntityName || 'Unknown',
						AbnStatus: data.AbnStatus || 'Active',
						Score: 100 // Exact match
					}]
				};
			}

			return {
				success: true,
				results: []
			};
		} catch (error) {
			console.error('Error searching by ABN:', error);
			return {
				success: false,
				results: []
			};
		}
	}

	// Get or create report data (checks cache, fetches if not available)
	async checkDataAvailability(abn: string, type: string) {
		return this.request<{
			success: boolean;
			available: boolean;
			data?: { createdAt: string; rdata: any };
		}>(`/api/get-report-data`, {
			method: 'POST',
			body: JSON.stringify({ abn, type })
		});
	}

	// Payment Methods API
	async getPaymentMethods(userId?: number) {
		try {
			const user = userId ? { userId } : JSON.parse(localStorage.getItem('user') || '{}');
			const response = await this.request<{ success: boolean; paymentMethods: any[]; message?: string }>(`/payment-methods?userId=${user.userId}`, {
				method: 'GET'
			});
			return response;
		} catch (error) {
			console.error('Error fetching payment methods:', error);
			throw error;
		}
	}

	async addPaymentMethod(paymentMethod: any) {
		try {
			const user = JSON.parse(localStorage.getItem('user') || '{}');
			const paymentData = {
				...paymentMethod,
				userId: user.userId
			};
			const response = await this.request('/payment-methods', {
				method: 'POST',
				body: JSON.stringify(paymentData)
			});
			return response;
		} catch (error) {
			console.error('Error adding payment method:', error);
			throw error;
		}
	}

	async deletePaymentMethod(id: string) {
		try {
			const user = JSON.parse(localStorage.getItem('user') || '{}');
			const response = await this.request<{ success: boolean; message?: string }>(`/payment-methods/${id}`, {
				method: 'DELETE',
				body: JSON.stringify({ userId: user.userId })
			});
			return response;
		} catch (error) {
			console.error('Error deleting payment method:', error);
			throw error;
		}
	}

	async setDefaultPaymentMethod(id: string) {
		try {
			const user = JSON.parse(localStorage.getItem('user') || '{}');
			const response = await this.request<{ success: boolean; message?: string }>(`/payment-methods/${id}/set-default`, {
				method: 'PUT',
				body: JSON.stringify({ userId: user.userId })
			});
			return response;
		} catch (error) {
			console.error('Error setting default payment method:', error);
			throw error;
		}
	}

	// Create report
	async createReport(reportData: {
		business: { Abn: string; Name?: string; isCompany?: string };
		type: string;
		userId: number;
		matterId?: number;
		ispdfcreate: true;
	}) {
		return this.request<{
			success: boolean;
			message: string;
			report: any;
		}>('/api/create-report', {
			method: 'POST',
			body: JSON.stringify(reportData)
		});
	}

	async sendReports(email: string, pdfFilenames: string[], matterName?: string, documentId?: string) {
		return this.request<{
			success: boolean;
			message: string;
			reportsSent: number;
			messageId: string;
			recipient: string;
		}>('/api/send-reports', {
			method: 'POST',
			body: JSON.stringify({
				email,
				pdfFilenames,
				matterName,
				documentId
			})
		});
	}

	async searchIndividualBankruptcyMatches(params: {
		firstName?: string;
		lastName: string;
		dateOfBirth?: string;
	}): Promise<BankruptcySearchResponse> {
		const searchParams = new URLSearchParams();
		if (params.firstName) {
			searchParams.append('firstName', params.firstName);
		}
		if (params.lastName) {
			searchParams.append('lastName', params.lastName);
		}
		if (params.dateOfBirth) {
			searchParams.append('dateOfBirth', params.dateOfBirth);
		}

		const query = searchParams.toString();
		const basePath = '/api/bankruptcy/matches';
		const endpoint = query.length > 0 ? `${basePath}?${query}` : basePath;

		return this.request<BankruptcySearchResponse>(endpoint);
	}

	async searchIndividualRelatedEntityMatches(params: {
		firstName?: string;
		lastName: string;
		dobFrom?: string;
		dobTo?: string;
	}): Promise<DirectorRelatedSearchResponse> {
		const bearerToken = 'pIIDIt6acqekKFZ9a7G4w4hEoFDqCSMfF6CNjx5lCUnB6OF22nnQgGkEWGhv';
		const apiUrl = 'https://alares.com.au/api/asic/search';

		const requestParams = new URLSearchParams();
		requestParams.append('last_name', params.lastName);

		if (params.firstName) {
			requestParams.append('first_name', params.firstName);
		}
		if (params.dobFrom) {
			requestParams.append('dob_from', params.dobFrom);
		}
		if (params.dobTo) {
			requestParams.append('dob_to', params.dobTo);
		}

		const url = `${apiUrl}?${requestParams.toString()}`;

		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${bearerToken}`,
					'Accept': 'application/json'
				}
			});

			if (!response.ok) {
				throw new Error(`API error: ${response.status} ${response.statusText}`);
			}

			const data = await response.json();
			const matches = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];

			return {
				success: true,
				matches
			};
		} catch (error) {
			console.error('Error searching director related matches:', error);
			return {
				success: false,
				matches: [],
				error: 'DIRECTOR_RELATED_SEARCH_FAILED',
				message: error instanceof Error ? error.message : 'Failed to retrieve director related entities'
			};
		}
	}

	async getLandTitleCounts(params: {
		type: 'organization' | 'individual';
		abn?: string;
		companyName?: string;
		firstName?: string;
		lastName?: string;
		dob?: string;
		startYear?: string;
		endYear?: string;
		states: string[];
	}): Promise<{
		success: boolean;
		current: number;
		historical: number;
		titleReferences: Array<{ titleReference: string; jurisdiction: string }>;
		storedDataIds?: Array<{ titleReference: string; jurisdiction: string; dataId: number }>;
	}> {
		return this.request<{
			success: boolean;
			current: number;
			historical: number;
			titleReferences: Array<{ titleReference: string; jurisdiction: string }>;
		}>('/api/land-title/counts', {
			method: 'POST',
			body: JSON.stringify(params)
		});
	}

	async searchIndividualCourtMatches(params: {
		firstName?: string;
		lastName: string;
		state?: string;
		courtType?: 'ALL' | 'CRIMINAL' | 'CIVIL';
	}): Promise<{
		success: boolean;
		matches: Array<{
			fullname?: string;
			given_name?: string;
			surname?: string;
			state?: string;
			courtType?: string;
			source?: string;
			[key: string]: any;
		}>;
		error?: string;
		message?: string;
	}> {
		const searchParams = new URLSearchParams();
		if (params.firstName) {
			searchParams.append('firstName', params.firstName);
		}
		if (params.lastName) {
			searchParams.append('lastName', params.lastName);
		}
		if (params.state) {
			searchParams.append('state', params.state);
		}
		if (params.courtType) {
			searchParams.append('courtType', params.courtType);
		}

		const query = searchParams.toString();
		const basePath = '/api/court/name-search';
		const endpoint = query.length > 0 ? `${basePath}?${query}` : basePath;

		return this.request<{
			success: boolean;
			matches: Array<any>;
			error?: string;
			message?: string;
		}>(endpoint);
	}

	async searchLandTitlePersonNames(params: {
		firstName?: string;
		lastName: string;
		state: string;
	}): Promise<{
		success: boolean;
		personNames: string[];
		fullApiResponse?: any;
		error?: string;
		message?: string;
	}> {
		return this.request<{
			success: boolean;
			personNames: string[];
			fullApiResponse?: any;
			error?: string;
			message?: string;
		}>('/api/land-title/search-person-names', {
			method: 'POST',
			body: JSON.stringify(params)
		});
	}

}

export const apiService = new ApiService();
export default apiService;
