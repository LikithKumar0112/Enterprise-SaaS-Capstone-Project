const request = require('supertest');
const app = require('../../src/server');
const redis = require('redis');

describe('API Integration Tests', () => {
  let redisClient;

  beforeAll(async () => {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379/1'
    });
    await redisClient.connect();
    await redisClient.flushDb();
  });

  afterAll(async () => {
    await redisClient.quit();
  });

  describe('Cache endpoints', () => {
    it('should set and retrieve cache', async () => {
      const key = 'test:integration:key';
      const value = { test: 'data' };
      
      // Set via API
      await request(app).post(`/api/v1/cache/${key}`).send(value);
      
      // Get via API
      const res = await request(app).get(`/api/v1/cache/${key}`);
      expect(res.statusCode).toEqual(200);
      expect(res.body.value).toEqual(value);
    });

    it('should delete cache', async () => {
      const key = 'test:integration:delete';
      await redisClient.set(key, JSON.stringify({ data: 'test' }));
      
      const res = await request(app).delete(`/api/v1/cache/${key}`);
      expect(res.statusCode).toEqual(200);
      expect(res.body.deleted).toBe(true);
      
      const exists = await redisClient.exists(key);
      expect(exists).toBe(0);
    });
  });

  describe('Circuit breaker integration', () => {
    it('should handle external API failures', async () => {
      process.env.EXTERNAL_API_URL = 'http://invalid-url.test';
      
      const res = await request(app).get('/api/v1/external');
      expect(res.statusCode).toEqual(503);
      expect(res.body.circuitState).toBeDefined();
    });
  });
});
