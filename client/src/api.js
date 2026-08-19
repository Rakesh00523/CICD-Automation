import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

export const api = axios.create({ baseURL });

export const fetchProducts = () => api.get('/products').then((res) => res.data);
export const fetchProduct = (id) => api.get(`/products/${id}`).then((res) => res.data);
export const submitCheckout = (items) => api.post('/checkout', { items }).then((res) => res.data);
