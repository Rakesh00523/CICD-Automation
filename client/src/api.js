import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
const AUTH_STORAGE_KEY = 'shoppipe.auth';

export const api = axios.create({ baseURL });

// Attach the JWT (if any) to every request. Read straight from localStorage
// rather than through AuthContext so plain api.js functions don't need a
// React context threaded through every call site.
api.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    const token = raw ? JSON.parse(raw).token : null;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Corrupt/unavailable storage: send the request unauthenticated rather
    // than blocking it.
  }
  return config;
});

export const fetchProducts = () => api.get('/products').then((res) => res.data);
export const fetchProduct = (id) => api.get(`/products/${id}`).then((res) => res.data);
export const submitCheckout = (items, payment) =>
  api.post('/checkout', { items, payment }).then((res) => res.data);

export const registerUser = (email, password) =>
  api.post('/auth/register', { email, password }).then((res) => res.data);
export const loginUser = (email, password) =>
  api.post('/auth/login', { email, password }).then((res) => res.data);
export const fetchMyOrders = () => api.get('/orders/me').then((res) => res.data);
