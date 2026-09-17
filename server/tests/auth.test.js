const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../src/app');
const User = require('../src/models/User');

let mongod;
let app;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret';
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp();
});

afterEach(async () => {
  await User.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('POST /api/auth/register', () => {
  it('rejects an invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'password123' });

    expect(res.status).toBe(400);
  });

  it('rejects a short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'shopper@example.com', password: 'short' });

    expect(res.status).toBe(400);
  });

  it('registers a new user and returns a usable token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'shopper@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.email).toBe('shopper@example.com');
  });

  it('rejects a duplicate email', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'shopper@example.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'shopper@example.com', password: 'anotherpassword' });

    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'shopper@example.com', password: 'password123' });
  });

  it('rejects a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'shopper@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  it('rejects an unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' });

    expect(res.status).toBe(401);
  });

  it('logs in with correct credentials and returns a usable token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'shopper@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));

    // The returned token should actually authenticate a protected route.
    const meRes = await request(app).get('/api/orders/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(meRes.status).toBe(200);
  });
});
