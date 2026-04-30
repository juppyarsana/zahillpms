import axios from 'axios';

const api = axios.create({ baseURL: '/api/display' });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('displayToken');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

export default api;
