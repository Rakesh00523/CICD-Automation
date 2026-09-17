const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../src/app');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');

let mongod;
let app;
let token;

const validPayment = { cardNumber: '4242424242424242', expiry: '12/99', cvc: '123' };
const decliningPayment = { ...validPayment, cardNumber: '4000000000000002' };

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret';
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp();

  const registerRes = await request(app)
    .post('/api/auth/register')
    .send({ email: 'checkout-shopper@example.com', password: 'password123' });
  token = registerRes.body.token;
});

afterEach(async () => {
  await Product.deleteMany({});
  await Order.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

function authedPost(path) {
  return request(app).post(path).set('Authorization', `Bearer ${token}`);
}

describe('POST /api/checkout', () => {
  it('rejects a request with no auth token', async () => {
    const res = await request(app)
      .post('/api/checkout')
      .send({ items: [], payment: validPayment });

    expect(res.status).toBe(401);
  });

  it('rejects an empty cart', async () => {
    const res = await authedPost('/api/checkout').send({ items: [], payment: validPayment });
    expect(res.status).toBe(400);
  });

  it('rejects a checkout with no payment details', async () => {
    const product = await Product.create({
      name: 'No Payment Item',
      description: 'Missing payment block',
      price: 10,
      category: 'Test',
      imageUrl: 'https://example.com/image.png',
      stock: 5,
    });

    const res = await authedPost('/api/checkout').send({
      items: [{ productId: product._id.toString(), quantity: 1 }],
    });

    expect(res.status).toBe(400);
  });

  it('rejects checkout when stock is insufficient', async () => {
    const product = await Product.create({
      name: 'Limited Item',
      description: 'Only one left',
      price: 10,
      category: 'Test',
      imageUrl: 'https://example.com/image.png',
      stock: 1,
    });

    const res = await authedPost('/api/checkout').send({
      items: [{ productId: product._id.toString(), quantity: 2 }],
      payment: validPayment,
    });

    expect(res.status).toBe(409);
  });

  it('declines a checkout with a declining test card and leaves stock untouched', async () => {
    const product = await Product.create({
      name: 'Declined Item',
      description: 'Paid for with a declining card',
      price: 10,
      category: 'Test',
      imageUrl: 'https://example.com/image.png',
      stock: 5,
    });

    const res = await authedPost('/api/checkout').send({
      items: [{ productId: product._id.toString(), quantity: 2 }],
      payment: decliningPayment,
    });

    expect(res.status).toBe(402);

    const updated = await Product.findById(product._id);
    expect(updated.stock).toBe(5);
    expect(await Order.countDocuments()).toBe(0);
  });

  it('confirms a valid order, decrements stock, and links the order to the authenticated user', async () => {
    const product = await Product.create({
      name: 'In Stock Item',
      description: 'Plenty available',
      price: 20,
      category: 'Test',
      imageUrl: 'https://example.com/image.png',
      stock: 5,
    });

    const res = await authedPost('/api/checkout').send({
      items: [{ productId: product._id.toString(), quantity: 2 }],
      payment: validPayment,
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('confirmed');
    expect(res.body.total).toBe(40);

    const updated = await Product.findById(product._id);
    expect(updated.stock).toBe(3);

    const order = await Order.findById(res.body.orderId);
    expect(order.user.toString()).toEqual(expect.any(String));
    expect(order.payment.cardLast4).toBe('4242');
  });

  it('rejects a duplicate line item that would oversell stock', async () => {
    const product = await Product.create({
      name: 'Duplicated Item',
      description: 'Requested twice in one cart',
      price: 15,
      category: 'Test',
      imageUrl: 'https://example.com/image.png',
      stock: 8,
    });

    // Same product listed twice, 5 units each: 10 units requested, only 8 in stock.
    const res = await authedPost('/api/checkout').send({
      items: [
        { productId: product._id.toString(), quantity: 5 },
        { productId: product._id.toString(), quantity: 5 },
      ],
      payment: validPayment,
    });

    expect(res.status).toBe(409);

    const updated = await Product.findById(product._id);
    expect(updated.stock).toBe(8);
  });

  it('merges a duplicate line item and decrements stock by the combined quantity', async () => {
    const product = await Product.create({
      name: 'Merged Item',
      description: 'Requested twice in one cart, within stock',
      price: 15,
      category: 'Test',
      imageUrl: 'https://example.com/image.png',
      stock: 10,
    });

    const res = await authedPost('/api/checkout').send({
      items: [
        { productId: product._id.toString(), quantity: 3 },
        { productId: product._id.toString(), quantity: 2 },
      ],
      payment: validPayment,
    });

    expect(res.status).toBe(201);
    expect(res.body.total).toBe(75); // 5 units * $15

    const updated = await Product.findById(product._id);
    expect(updated.stock).toBe(5);
  });
});
