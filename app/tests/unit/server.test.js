const request = require('supertest');
const app = require('../../src/server');
const { createClient } = require('redis');

jest.mock('redis', () => {
  const mockClient = {
    connect: jest.fn(),
    get: jest.fn(),
    setEx: jest.fn(),
    ping: jest.fn(),
    quit: jest.fn(),
    info: jest.fn(() => 'used_memory:1048576'),
    on: jest.fn(),
    del: jest.fn()
  };
  return { createClient: jest.fn(() => mockClient) };
});

describe('Enterprise DevOps Application - Unit Tests', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  afterAll(async () => {
    jest.clearAllMocks();
  });

  describe('GET /', () => {
    it('should return welcome message with request ID', async () => {
      const res = await request(app).get('/');
      expect(res.statusCode).toEqual(200);
      expect(res.body.message).toContain('Enterprise DevOps');
      expect(res.body.requestId).toBeDefined();
      expect(res.body.features).toContain('Circuit Breaker Pattern');
    });
  });

  describe('GET /health', () => {
    it('should return comprehensive health status', async () => {
      const res = await request(app).get('/health');
      expect(res.statusCode).toBeOneOf([200, 503]);
      expect(res.body.service).toEqual('enterprise-devops-app');
      expect(res.body.dependencies).toBeDefined();
    });
  });

  describe('Probes', () => {
    it('should report alive and ready without touching Redis', async () => {
      const redisClient = require('redis').createClient();
      redisClient.ping.mockClear();

      expect((await request(app).get('/livez')).statusCode).toEqual(200);
      expect((await request(app).get('/readyz')).statusCode).toEqual(200);
      expect(redisClient.ping).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/products', () => {
    it('should return products with caching metadata', async () => {
      const res = await request(app).get('/api/v1/products');
      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(res.body.cached).toBeDefined();
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('should keep serving, uncached, when Redis fails', async () => {
      const redisClient = require('redis').createClient();
      redisClient.get.mockRejectedValueOnce(new Error('Redis error'));

      const res = await request(app).get('/api/v1/products');
      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(res.body.cached).toBe(false);
      expect(res.body.degraded).toBe(true);
    });
  });

  describe('GET /api/v1/circuit-status', () => {
    it('should return circuit breaker status', async () => {
      const res = await request(app).get('/api/v1/circuit-status');
      expect(res.statusCode).toEqual(200);
      expect(res.body.circuitState).toBeOneOf(['OPEN', 'CLOSED']);
      expect(res.body.stats).toBeDefined();
    });
  });

  describe('Request ID middleware', () => {
    it('should generate request ID if not provided', async () => {
      const res = await request(app).get('/');
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('should use provided request ID', async () => {
      const customId = 'test-request-123';
      const res = await request(app)
        .get('/')
        .set('x-request-id', customId);
      expect(res.headers['x-request-id']).toEqual(customId);
      expect(res.body.requestId).toEqual(customId);
    });
  });

  describe('Error handling', () => {
    it('should handle simulated errors', async () => {
      const res = await request(app).get('/api/v1/error?type=server');
      expect(res.statusCode).toEqual(500);
    });

    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/unknown-route');
      expect(res.statusCode).toEqual(404);
    });
  });

  describe('Rate limiting', () => {
    it('should enforce rate limits', async () => {
      const requests = Array(101).fill().map(() =>
        request(app).get('/')
      );

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.statusCode === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    });

    it('should never limit probes, /health or /metrics', async () => {
      // The limit is already exhausted by the previous test.
      expect((await request(app).get('/')).statusCode).toEqual(429);
      for (const path of ['/livez', '/readyz', '/metrics', '/health']) {
        const res = await request(app).get(path);
        expect(res.statusCode).not.toEqual(429);
      }
    });
  });
});
