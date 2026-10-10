import axios from 'axios';

// Every request gives up after 20 s: without a limit a request on weak WiFi
// never ends, and a tapped button just sits there.
const api = axios.create({ baseURL: '/api', timeout: 20_000 });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('displayToken');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

export default api;
