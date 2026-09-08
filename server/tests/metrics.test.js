const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../src/app');

let mongod;
let app;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('GET /metrics', () => {
  it('exposes Prometheus-format metrics, including our custom ones', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('http_request_duration_seconds');
  });

  it('counts a request made against a real route, labeled by its parameterized path', async () => {
    await request(app).get('/api/products');
    const res = await request(app).get('/metrics');
    expect(res.text).toMatch(
      /http_requests_total\{method="GET",route="\/api\/products",status_code="200"\} \d+/,
    );
  });
});
