import axios from 'axios';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || '/api';

export const API_ORIGIN = API_BASE_URL.replace(/\/api$/, '');

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

const BACKEND_API_KEY = import.meta.env.VITE_BACKEND_API_KEY || '';
if (BACKEND_API_KEY) {
  api.defaults.headers.common['x-api-key'] = BACKEND_API_KEY;
}

export const getHealth = () => api.get('/health');
export const getDashboardStats = () => api.get('/dashboard-stats');
export const getPackages = (search = '', top = 50) => api.get('/packages', { params: { search, top } });
export const getPackageIflows = (packageId) => api.get(`/packages/${packageId}/iflows`);
export const getRuntimeArtifacts = () => api.get('/runtime-artifacts');
export const getMessages = (params = {}) => api.get('/messages', { params });
export const getCredentials = () => api.get('/credentials');
export const getKeystore = () => api.get('/keystore');

export const getConfig = () => api.get('/config');
export const saveConfig = (data) => api.post('/config', data);

export const getProviders = () => api.get('/ai/providers');
export const testProvider = (provider) => api.post('/ai/test-provider', { provider });

export const aiGenerate = (prompt) => api.post('/ai/generate', { prompt });
export const aiAnalyze = (error) => api.post('/ai/analyze', { error });
export const aiOptimize = (code) => api.post('/ai/optimize', { code });
export const aiChat = (message, history = []) => api.post('/ai/chat', { message, history, useGroq: true });
export const askAssistant = (message, useGroq = true) => api.post('/assistant', { message, useGroq });

export const generateMappingZip = (formData) =>
  api.post('/mapping/generate', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });

export const deployIflows   = (iflowIds) => api.post('/cpi/deploy',   { iflowIds });
export const undeployIflows = (iflowIds) => api.post('/cpi/undeploy', { iflowIds });
export const whereUsed      = (alias)    => api.get('/cpi/where-used', { params: { alias } });

export default api;
