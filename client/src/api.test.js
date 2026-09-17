import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  fetchMyOrders,
  fetchProduct,
  fetchProducts,
  loginUser,
  registerUser,
  submitCheckout,
} from './api';

describe('api wrapper functions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchProducts calls GET /products', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [{ _id: '1' }] });
    const result = await fetchProducts();
    expect(api.get).toHaveBeenCalledWith('/products');
    expect(result).toEqual([{ _id: '1' }]);
  });

  it('fetchProduct calls GET /products/:id', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { _id: '1' } });
    const result = await fetchProduct('1');
    expect(api.get).toHaveBeenCalledWith('/products/1');
    expect(result).toEqual({ _id: '1' });
  });

  it('submitCheckout posts items and payment to /checkout', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { orderId: 'o1' } });
    const items = [{ productId: '1', quantity: 2 }];
    const payment = { cardNumber: '4242424242424242', expiry: '12/99', cvc: '123' };
    const result = await submitCheckout(items, payment);
    expect(api.post).toHaveBeenCalledWith('/checkout', { items, payment });
    expect(result).toEqual({ orderId: 'o1' });
  });

  it('registerUser posts to /auth/register', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { token: 't' } });
    await registerUser('a@b.com', 'password123');
    expect(api.post).toHaveBeenCalledWith('/auth/register', { email: 'a@b.com', password: 'password123' });
  });

  it('loginUser posts to /auth/login', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { token: 't' } });
    await loginUser('a@b.com', 'password123');
    expect(api.post).toHaveBeenCalledWith('/auth/login', { email: 'a@b.com', password: 'password123' });
  });

  it('fetchMyOrders calls GET /orders/me', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] });
    const result = await fetchMyOrders();
    expect(api.get).toHaveBeenCalledWith('/orders/me');
    expect(result).toEqual([]);
  });
});

describe('auth request interceptor', () => {
  const runInterceptor = (config) => api.interceptors.request.handlers.at(-1).fulfilled(config);

  beforeEach(() => {
    localStorage.clear();
  });

  it('attaches a bearer token when one is stored', () => {
    localStorage.setItem('shoppipe.auth', JSON.stringify({ token: 'abc123' }));
    const config = runInterceptor({ headers: {} });
    expect(config.headers.Authorization).toBe('Bearer abc123');
  });

  it('leaves the request unauthenticated when nothing is stored', () => {
    const config = runInterceptor({ headers: {} });
    expect(config.headers.Authorization).toBeUndefined();
  });

  it('leaves the request unauthenticated when storage is corrupt', () => {
    localStorage.setItem('shoppipe.auth', 'not-json');
    expect(() => runInterceptor({ headers: {} })).not.toThrow();
    expect(runInterceptor({ headers: {} }).headers.Authorization).toBeUndefined();
  });
});
