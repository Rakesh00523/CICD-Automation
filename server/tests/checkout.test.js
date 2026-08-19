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

describe('POST /api/checkout', () => {
  it('rejects an empty cart', async () => {
    const res = await request(app).post('/api/checkout').send({ items: [] });
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

    const res = await request(app)
      .post('/api/checkout')
      .send({ items: [{ productId: product._id.toString(), quantity: 2 }] });

    expect(res.status).toBe(409);
  });

  it('confirms a valid order and decrements stock', async () => {
    const product = await Product.create({
      name: 'In Stock Item',
      description: 'Plenty available',
      price: 20,
      category: 'Test',
      imageUrl: 'https://example.com/image.png',
      stock: 5,
    });

    const res = await request(app)
      .post('/api/checkout')
      .send({ items: [{ productId: product._id.toString(), quantity: 2 }] });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('confirmed');
    expect(res.body.total).toBe(40);

    const updated = await Product.findById(product._id);
    expect(updated.stock).toBe(3);
  });
});
