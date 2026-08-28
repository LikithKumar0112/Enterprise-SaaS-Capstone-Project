const request = require('supertest');
const app = require('../../src/server');

describe('Load and Performance Tests', () => {
  it('should handle concurrent requests', async () => {
    const concurrentRequests = 50;
    const requests = Array(concurrentRequests).fill().map((_, i) => 
      request(app).get(`/api/v1/products?index=${i}`)
    );
    
    const responses = await Promise.all(requests);
    const successCount = responses.filter(r => r.statusCode === 200).length;
    const rateLimitedCount = responses.filter(r => r.statusCode === 429).length;
    
    console.log(`Success: ${successCount}, Rate Limited: ${rateLimitedCount}`);
    
    expect(successCount).toBeGreaterThan(0);
    expect(successCount + rateLimitedCount).toEqual(concurrentRequests);
  });

  it('should maintain performance under load', async () => {
    const startTime = Date.now();
    const requestCount = 100;
    
    for (let i = 0; i < requestCount; i++) {
      await request(app).get('/health');
    }
    
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    const avgTime = totalTime / requestCount;
    
    console.log(`Average response time: ${avgTime.toFixed(2)}ms`);
    
    expect(avgTime).toBeLessThan(100); // Should be under 100ms average
  });
});
