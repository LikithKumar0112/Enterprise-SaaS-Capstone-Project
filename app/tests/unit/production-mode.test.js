process.env.NODE_ENV = 'production';
const request = require('supertest');

jest.mock('redis', () => {
  const mockClient = {
    connect: jest.fn().mockResolvedValue(),
    on: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn(),
    setEx: jest.fn()
  };
  return { createClient: jest.fn(() => mockClient) };
});

const app = require('../../src/server');

describe('Production mode', () => {
  it.each([
    ['get', '/api/v1/error?type=memory'],
    ['get', '/api/v1/error?type=circuit'],
    ['get', '/api/v1/cache/some-key'],
    ['post', '/api/v1/cache/some-key'],
    ['delete', '/api/v1/cache/some-key']
  ])('hides %s %s', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.statusCode).toEqual(404);
  });

  it('still serves the product API', async () => {
    const res = await request(app).get('/api/v1/products');
    expect(res.statusCode).toEqual(200);
  });
});
