// Dependency-failure scenarios. A TCP proxy sits between the app and the real Redis
// (redis://localhost:6379 by default) so a test can cut and restore the connection.
const http = require('http');
const net = require('net');

const REDIS_TARGET = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
const PROXY_PORT = 16399;

process.env.REDIS_URL = `redis://127.0.0.1:${PROXY_PORT}`;
process.env.RATE_LIMIT_MAX = '100000';
process.env.CIRCUIT_RESET_MS = '500';

const request = require('supertest');
const app = require('../../src/server');

let proxy;
const sockets = new Set();

const startProxy = () => new Promise((resolve) => {
  proxy = net.createServer((client) => {
    const upstream = net.connect(Number(REDIS_TARGET.port) || 6379, REDIS_TARGET.hostname);
    [client, upstream].forEach((socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
    });
    client.pipe(upstream).pipe(client);
  });
  proxy.listen(PROXY_PORT, resolve);
});

const stopProxy = () => new Promise((resolve) => {
  sockets.forEach((socket) => socket.destroy());
  proxy.close(resolve);
});

const waitFor = async (check, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('Condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const redisHealthy = async () => (await request(app).get('/health')).statusCode === 200;

describe('Redis outage and recovery', () => {
  beforeAll(async () => {
    await startProxy();
    await request(app).get('/health');
    await waitFor(redisHealthy);
  });

  afterAll(async () => {
    await Promise.all(Object.values(app.redisPool.clients).map((client) => client.disconnect()));
    await stopProxy();
  });

  it('serves from the cache while Redis is up', async () => {
    await request(app).get('/api/v1/products');
    const res = await request(app).get('/api/v1/products');
    expect(res.body.cached).toBe(true);
  });

  it('keeps pods healthy and answers quickly while Redis is down', async () => {
    await stopProxy();
    await waitFor(async () => !(await redisHealthy()));

    const started = Date.now();
    const products = await request(app).get('/api/v1/products');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(products.statusCode).toEqual(200);
    expect(products.body.degraded).toBe(true);

    expect((await request(app).get('/health')).statusCode).toEqual(503);
    expect((await request(app).get('/livez')).statusCode).toEqual(200);
    expect((await request(app).get('/readyz')).statusCode).toEqual(200);
  });

  it('reconnects and uses the cache again once Redis returns', async () => {
    await startProxy();
    await waitFor(redisHealthy);

    await request(app).get('/api/v1/products');
    const res = await request(app).get('/api/v1/products');
    expect(res.body.degraded).toBeUndefined();
    expect(res.body.cached).toBe(true);
  });
});

describe('Circuit breaker recovery', () => {
  let api;
  let apiHealthy = false;

  beforeAll((done) => {
    api = http.createServer((req, res) => {
      res.statusCode = apiHealthy ? 200 : 500;
      res.end(JSON.stringify({ status: apiHealthy ? 'ok' : 'failing' }));
    });
    api.listen(0, () => {
      process.env.EXTERNAL_API_URL = `http://127.0.0.1:${api.address().port}/`;
      done();
    });
  });

  afterAll((done) => {
    api.close(done);
  });

  const circuitState = async () => (await request(app).get('/api/v1/circuit-status')).body.circuitState;

  it('opens on failures, then closes again after the API recovers', async () => {
    await waitFor(async () => {
      await request(app).get('/api/v1/external');
      return (await circuitState()) === 'OPEN';
    });

    const whileOpen = await request(app).get('/api/v1/external');
    expect(whileOpen.statusCode).toEqual(503);
    expect(whileOpen.body.circuitState).toEqual('open');

    apiHealthy = true;
    await waitFor(async () => {
      const res = await request(app).get('/api/v1/external');
      return res.statusCode === 200 && (await circuitState()) === 'CLOSED';
    });
  });
});
