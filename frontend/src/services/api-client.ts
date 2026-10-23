import axios, { type AxiosInstance } from 'axios';

function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    const configured = import.meta.env.VITE_API_BASE_URL;
    if (configured && configured.startsWith('https://')) {
      return `${configured}/api`;
    }
    return '/api';
  }

  if (import.meta.env.VITE_API_BASE_URL !== undefined && import.meta.env.VITE_API_BASE_URL !== '') {
    return `${import.meta.env.VITE_API_BASE_URL}/api`;
  }

  return import.meta.env.DEV ? 'http://localhost:5000/api' : '/api';
}

const apiBaseUrl = getApiBaseUrl();

export const apiClient: AxiosInstance = axios.create({
  baseURL: apiBaseUrl,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Response interceptor for centralized error extraction
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const customMessage = error.response?.data?.error?.message || error.message || 'Network request failed';
    return Promise.reject(new Error(customMessage));
  }
);
