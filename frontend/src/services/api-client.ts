import axios, { type AxiosInstance } from 'axios';

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL !== undefined
    ? `${import.meta.env.VITE_API_BASE_URL}/api`
    : import.meta.env.DEV
      ? 'http://localhost:5000/api'
      : '/api';

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
