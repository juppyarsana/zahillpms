import axios from 'axios';

// Staff surface only. Storage keys are prefixed (restoToken/restoUser, not
// token/user) so this app and the PMS client can coexist on one device
// without stomping each other's storage if ever served from the same origin.
const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('restoToken');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('restoToken');
      localStorage.removeItem('restoUser');
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
