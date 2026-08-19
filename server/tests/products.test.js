const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../src/app');
const Product = require('../src/models/Product');

let mongod;
let app;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp();
});

afterEach(async () => {
  await Product.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('GET /api/products', () => {
  it('returns an empty list when no products exist', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns seeded products', async () => {
    await Product.create({
      name: 'Test Product',
      description: 'A product for testing',
      price: 9.99,
      category: 'Test',
      imageUrl: 'https://example.com/image.png',
      stock: 5,
    });

    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Test Product');
  });
});

describe('GET /api/products/:id', () => {
  it('returns 404 for a non-existent product', async () => {
    const res = await request(app).get('/api/products/64b64b64b64b64b64b64b64b');
    expect(res.status).toBe(404);
  });

  it('returns the product by id', async () => {
    const product = await Product.create({
      name: 'Lookup Product',
      description: 'A product to look up',
      price: 12.5,
      category: 'Test',
      imageUrl: 'https://example.com/image.png',
      stock: 3,
    });

    const res = await request(app).get(`/api/products/${product._id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Lookup Product');
  });
});
