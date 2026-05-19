import axios from 'axios';

const api = axios.create({
  baseURL: '/api/display',
  timeout: 15_000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('displayToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
