const axios = require("axios");

/* -------------------------------
   TOKEN CACHE (per service)
-------------------------------- */
const tokenCache = {};
const refreshingPromises = {};

/* -------------------------------
   CONFIGURE YOUR API ENDPOINTS
-------------------------------- */
const SERVICES = {
  ppsr: {
    baseURL: "https://uat-gateway.ppsrcloud.com/",
    authURL: "https://uat-gateway.ppsrcloud.com/connect/token",
    getToken: async () => {
      // PPSR uses form-urlencoded body
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('scope', 'integrationaccess');
      params.append('client_id', process.env.PPSR_CLIENT_ID || 'flexcollect-api-integration');
      params.append('client_secret', process.env.PPSR_CLIENT_SECRET || 'uwbEpma9DnOS8pgl_n4Wcp91E7');
      
      const { data } = await axios.post("https://uat-gateway.ppsrcloud.com/connect/token", params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      
      return {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh 1 min early (expires_in is in seconds)
      };
    },
  },
  bankruptcy: {
    baseURL: "https://services.afsa.gov.au",
    authURL: "https://services.afsa.gov.au/authentication-service/api/v2/login",
    getToken: async () => {
      // Bankruptcy uses JSON body
      const { data } = await axios.post("https://services.afsa.gov.au/authentication-service/api/v2/login", {
        clientId: process.env.BANKRUPTCY_CLIENT_ID || '8d2e211a-88d5-446f-b355-6b10a8278e3f',
        clientSecret: process.env.BANKRUPTCY_CLIENT_SECRET || 'VBqsIg9683V652UadICDkjNw205h576mnw1Y23Gw5y7isp9hR1AC28c9RCBcYjYj'
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      // Assuming the response has a token field (adjust based on actual response)
      // If response structure differs, update this accordingly
      const token = data.accessToken;
      const expiresIn = data.expiryDate;
      
      return {
        token: token,
        expiresAt: Date.now() + (expiresIn - 60) * 1000, // refresh 1 min early
      };
    },
  },
  // add more services below 👇
  // asic: { baseURL: "...", getToken: async () => { ... } }
};

/* -------------------------------
   TOKEN MANAGER LOGIC
-------------------------------- */
async function getToken(serviceName) {
  const cached = tokenCache[serviceName];
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  if (refreshingPromises[serviceName]) {
    return (await refreshingPromises[serviceName]).token;
  }

  const service = SERVICES[serviceName];
  if (!service) throw new Error(`Unknown service: ${serviceName}`);

  const promise = service
    .getToken()
    .then((data) => {
      tokenCache[serviceName] = data;
      return data;
    })
    .finally(() => delete refreshingPromises[serviceName]);

  refreshingPromises[serviceName] = promise;
  const { token } = await promise;
  return token;
}

/* -------------------------------
   AXIOS CLIENT FACTORY
-------------------------------- */
function createApiClient(serviceName) {
  const service = SERVICES[serviceName];
  if (!service) throw new Error(`Unknown service: ${serviceName}`);

  const client = axios.create({ baseURL: service.baseURL });

  // Attach token before each request
  client.interceptors.request.use(async (config) => {
    const token = await getToken(serviceName);
    config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  // Optionally retry once on 401 (token expired early)
  client.interceptors.response.use(undefined, async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      const token = await getToken(serviceName);
      error.config.headers.Authorization = `Bearer ${token}`;
      return client.request(error.config);
    }
    throw error;
  });

  return client;
}

/* -------------------------------
   EXPORT READY CLIENTS
-------------------------------- */
const apiClients = Object.keys(SERVICES).reduce((acc, key) => {
  acc[key] = createApiClient(key);
  return acc;
}, {});

// Export for use in other files
module.exports = {
  apiClients,
  getToken
};
