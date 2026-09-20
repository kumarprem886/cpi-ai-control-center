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

export const previewMappingSheet = (formData) =>
  api.post('/mapping/preview-sheet', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });

export const deployIflows   = (iflowIds) => api.post('/cpi/deploy',   { iflowIds });
export const undeployIflows = (iflowIds) => api.post('/cpi/undeploy', { iflowIds });
export const whereUsed      = (alias)    => api.get('/cpi/where-used', { params: { alias } });

export async function getArtifactsByType(packageId, type) {
  // type is 'valuemappings', 'messagemappings', 'scriptcollections', 'functionlibraries', 'all-artifacts'
  const { data } = await api.get(`/cpi/packages/${packageId}/${type}`);
  return data.results || [];
}

export async function deployArtifact(id, version = 'active') {
  const { data } = await api.post('/cpi/artifacts/deploy', { id, version });
  return data;
}

export const apiClient = api;

export async function importZipToCpi(packageId, artifactId, artifactName, artifactType, file) {
  const formData = new FormData();
  formData.append('zipFile', file);
  formData.append('packageId', packageId);
  formData.append('artifactId', artifactId);
  formData.append('artifactName', artifactName);
  formData.append('artifactType', artifactType);
  const { data } = await api.post('/cpi/import-zip', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export default api;
