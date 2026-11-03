const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { createClient } = require('redis');
const rateLimit = require('express-rate-limit');
const CircuitBreaker = require('opossum');
const { randomUUID } = require('crypto');
const winston = require('winston');
const axios = require('axios');
const client = require('prom-client');
const { loadRuntimeSecrets } = require('./secrets');
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2],
  registers: [register],
});

// Configure Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
    winston.format.errors({ stack: true })
  ),
  defaultMeta: { service: 'enterprise-devops-app' },
  // stdout only: the container runtime collects it and Fluent Bit ships it to
  // CloudWatch. Log files inside the container would never leave the pod.
  silent: process.env.NODE_ENV === 'test',
  transports: [new winston.transports.Console()]
});

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.RATE_LIMIT_MAX) || 100, // Per client IP, per windowMs
  // Prometheus and humans checking status must not consume (or hit) the limit.
  skip: (req) => req.path === '/health' || req.path === '/metrics',
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Redis connection pool
const redisPool = {
  clients: {},
  getClient: function(db = 0) {
    if (!this.clients[db]) {
      this.clients[db] = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        password: process.env.REDIS_PASSWORD || undefined,
        database: db,
        // Fail fast while disconnected. The default queues commands until Redis
        // returns, so requests would hang for the whole outage.
        disableOfflineQueue: true,
        socket: {
          connectTimeout: 3000,
          reconnectStrategy: (retries) => Math.min(retries * 200, 5000)
        }
      });
      
      this.clients[db].on('error', (err) => 
        logger.error('Redis Client Error', { error: err.message })
      );
      
      this.clients[db].connect().catch(err => 
        logger.error('Redis Connection Error', { error: err.message })
      );
    }
    return this.clients[db];
  }
};

// Circuit breaker for external API calls
const circuitBreakerOptions = {
  timeout: 3000, // If our function takes longer than 3 seconds, trigger a failure
  errorThresholdPercentage: 50, // When 50% of requests fail, trip the circuit
  resetTimeout: Number(process.env.CIRCUIT_RESET_MS) || 30000, // Then try again.
  rollingCountTimeout: 60000,
  rollingCountBuckets: 10
};

const externalApiBreaker = new CircuitBreaker(async () => {
  const response = await axios.get(
    process.env.EXTERNAL_API_URL || 'https://api.mocki.io/v2/5143e9e3',
    { timeout: 2000 }
  );
  return response.data;
}, circuitBreakerOptions);

externalApiBreaker.on('open', () => 
  logger.warn('Circuit breaker opened for external API')
);
externalApiBreaker.on('close', () => 
  logger.info('Circuit breaker closed for external API')
);
externalApiBreaker.on('halfOpen', () => 
  logger.info('Circuit breaker half-open for external API')
);

const app = express();
const port = process.env.PORT || 3000;

// Number of proxies in front of the app (1 for the ALB). Without this, req.ip is
// the ALB's address and every client shares one rate-limit bucket.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 0);

let isShuttingDown = false;

// Kubernetes probes. Registered first so they bypass the rate limiter and request
// logging, and they deliberately check no dependencies: a Redis or third-party
// outage must not restart or de-register pods that can still serve requests.
app.get('/livez', (req, res) => res.status(200).json({ status: 'alive' }));
app.get('/readyz', (req, res) => {
  res.status(isShuttingDown ? 503 : 200).json({ status: isShuttingDown ? 'shutting_down' : 'ready' });
});

const TEST_ENDPOINTS_ENABLED = process.env.NODE_ENV !== 'production' ||
  process.env.ENABLE_TEST_ENDPOINTS === 'true';
// Fault injection and the open cache API must not be reachable in production.
const testEndpointsOnly = (req, res, next) => {
  if (TEST_ENDPOINTS_ENABLED) return next();
  return res.status(404).json({ error: 'Not Found', requestId: req.id });
};

// Request ID middleware
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
});

app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    // Unmatched paths share one label so scanners can't create unlimited series.
    const route = req.route ? req.route.path : 'unmatched';
    const labels = { method: req.method, route, status: res.statusCode };
    httpRequests.inc(labels);
    end(labels);
  });
  next();
});

// Request/Response logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  
  // Log request
  logger.info('Request', {
    requestId: req.id,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    timestamp: new Date().toISOString()
  });
  
  // Capture response
  const originalSend = res.send;
  res.send = function(body) {
    const responseTime = Date.now() - startTime;
    
    logger.info('Response', {
      requestId: req.id,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      contentLength: res.get('Content-Length') || Buffer.byteLength(JSON.stringify(body)),
      timestamp: new Date().toISOString()
    });
    
    originalSend.call(this, body);
  };
  
  next();
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id']
}));

app.use(express.json());
app.use(morgan('combined', { 
  stream: { 
    write: (message) => logger.http(message.trim()) 
  } 
}));

// Apply rate limiting to all routes
app.use(limiter);

// Detailed status for humans and dashboards (not used by probes - see /livez, /readyz).
app.get('/health', async (req, res) => {
  const checks = {
    app: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'enterprise-devops-app',
    version: process.env.APP_VERSION || '1.0.0',
    uptime: process.uptime(),
    dependencies: {}
  };

  try {
    // Check Redis
    const redisClient = redisPool.getClient(0);
    await Promise.race([
      redisClient.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timed out')), 1000).unref())
    ]);
    checks.dependencies.redis = 'healthy';
  } catch (error) {
    checks.dependencies.redis = 'unhealthy';
    logger.error('Redis health check failed', { error: error.message });
  }

  try {
    // Check external API via circuit breaker
    const result = await externalApiBreaker.fire();
    checks.dependencies.externalApi = 'healthy';
    checks.externalApiStatus = result.status;
  } catch (error) {
    checks.dependencies.externalApi = externalApiBreaker.opened ? 'circuit_open' : 'unhealthy';
    logger.warn('External API health check failed', { 
      error: error.message,
      circuitState: externalApiBreaker.opened ? 'open' : 'closed'
    });
  }

  // Reports Redis as the deciding dependency; the external API is informational.
  const overallStatus = checks.dependencies.redis === 'healthy' ? 200 : 503;
  res.status(overallStatus).json(checks);
});

// Main endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Enterprise DevOps Application - Pipeline dry-run',
    environment: process.env.NODE_ENV || 'development',
    requestId: req.id,
    features: [
      'Kubernetes Deployment',
      'CI/CD Pipeline',
      'Infrastructure as Code',
      'Security Scanning',
      'Monitoring & Observability',
      'Circuit Breaker Pattern',
      'Rate Limiting',
      'Request Correlation IDs',
      'Redis Connection Pooling'
    ],
    endpoints: {
      health: '/health',
      api: '/api/v1/products',
      metrics: '/metrics',
      cache: '/api/v1/cache/:key',
      circuit: '/api/v1/circuit-status'
    }
  });
});

// API endpoints with Redis caching
app.get('/api/v1/products', async (req, res) => {
  const cacheKey = 'products:all';
  const cacheTTL = 300; // 5 minutes
  const products = [
    { id: 1, name: 'DevOps Platform', category: 'Infrastructure', price: 999 },
    { id: 2, name: 'Monitoring Suite', category: 'Observability', price: 499 },
    { id: 3, name: 'Security Scanner', category: 'Security', price: 799 },
    { id: 4, name: 'CI/CD Pipeline', category: 'Automation', price: 1299 },
    { id: 5, name: 'Kubernetes Operator', category: 'Orchestration', price: 899 }
  ];

  try {
    const redisClient = redisPool.getClient(0);
    const cachedData = await redisClient.get(cacheKey);

    if (cachedData) {
      logger.debug('Cache hit for products', { requestId: req.id });
      const data = JSON.parse(cachedData);
      return res.json({
        success: true,
        data,
        count: data.length,
        cached: true,
        timestamp: new Date().toISOString()
      });
    }

    await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify(products));
    logger.debug('Cache miss for products, stored', { requestId: req.id });
  } catch (error) {
    // Redis is only a cache: keep serving, uncached, and flag it in the response.
    logger.warn('Redis unavailable, serving products uncached', {
      requestId: req.id,
      error: error.message
    });
    return res.json({
      success: true,
      data: products,
      count: products.length,
      cached: false,
      degraded: true,
      timestamp: new Date().toISOString()
    });
  }

  return res.json({
    success: true,
    data: products,
    count: products.length,
    cached: false,
    timestamp: new Date().toISOString()
  });
});
// Set a cache value (used by integration tests + manual seeding)
app.post('/api/v1/cache/:key', testEndpointsOnly, async (req, res) => {
  try {
    const redisClient = redisPool.getClient(0);
    const ttl = Number(req.query.ttl) || 300;
    await redisClient.setEx(req.params.key, ttl, JSON.stringify(req.body));
    res.json({ key: req.params.key, value: req.body, stored: true, ttl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cache management endpoints
app.get('/api/v1/cache/:key', testEndpointsOnly, async (req, res) => {
  try {
    const redisClient = redisPool.getClient(0);
    const value = await redisClient.get(req.params.key);
    
    res.json({
      key: req.params.key,
      value: value ? JSON.parse(value) : null,
      exists: value !== null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/v1/cache/:key', testEndpointsOnly, async (req, res) => {
  try {
    const redisClient = redisPool.getClient(0);
    const deleted = await redisClient.del(req.params.key);
    
    res.json({
      key: req.params.key,
      deleted: deleted === 1
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Circuit breaker status endpoint
app.get('/api/v1/circuit-status', (req, res) => {
  const stats = externalApiBreaker.stats;
  res.json({
    circuitState: externalApiBreaker.opened ? 'OPEN' : 'CLOSED',
    stats: {
      failures: stats.failures,
      successes: stats.successes,
      fallbacks: stats.fallbacks,
      timeouts: stats.timeouts,
      errorRate: stats.fires > 0 ? (stats.failures / stats.fires * 100).toFixed(2) + '%' : '0%'
    },
    lastFailure: stats.lastFailure ? new Date(stats.lastFailure).toISOString() : null
  });
});

// External API with circuit breaker
app.get('/api/v1/external', async (req, res) => {
  try {
    const result = await externalApiBreaker.fire();
    
    res.json({
      success: true,
      message: 'External API call successful',
      data: result,
      circuitState: externalApiBreaker.opened ? 'open' : 'closed',
      requestId: req.id
    });
  } catch (error) {
    logger.error('External API call failed', { 
      requestId: req.id, 
      error: error.message,
      circuitState: externalApiBreaker.opened ? 'open' : 'closed'
    });
    
    res.status(503).json({ 
      error: 'External service unavailable',
      fallback: 'Using cached data',
      circuitState: externalApiBreaker.opened ? 'open' : 'closed',
      requestId: req.id
    });
  }
});

// Error simulation endpoint for testing
app.get('/api/v1/error', testEndpointsOnly, (req, res) => {
  const errorType = req.query.type || 'server';
  
  switch(errorType) {
    case 'timeout':
      setTimeout(() => {
        res.status(504).json({ error: 'Request timeout' });
      }, 5000);
      break;
    case 'memory': {
      const largeArray = [];
      for(let i = 0; i < 1000000; i++) {
        largeArray.push(new Array(1000).join('x'));
      }
      res.json({ message: 'Memory test completed', arraySize: largeArray.length });
      break;
    }
    case 'circuit':
      externalApiBreaker.open();
      res.json({ message: 'Circuit breaker manually opened' });
      break;
    default:
      logger.error('Simulated server error', { errorType, requestId: req.id });
      throw new Error('Simulated server error for testing');
  }
});

// Metrics endpoint (Prometheus format)
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    requestId: req.id,
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
    requestId: req.id,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  logger.warn('404 Not Found', {
    requestId: req.id,
    url: req.url,
    method: req.method
  });
  
  res.status(404).json({
    error: 'Not Found',
    requestId: req.id,
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown: fail readiness first so the ALB and Service stop sending traffic,
// then finish in-flight requests and close Redis.
let server;
const SHUTDOWN_DELAY_MS = process.env.SHUTDOWN_DELAY_MS !== undefined
  ? Number(process.env.SHUTDOWN_DELAY_MS)
  : 5000;

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received, starting graceful shutdown`);
  await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_DELAY_MS));

  if (server) {
    await new Promise((resolve) => server.close(resolve));
    logger.info('HTTP server closed');
  }

  for (const [db, client] of Object.entries(redisPool.clients)) {
    try {
      await client.quit();
      logger.info(`Redis connection ${db} closed`);
    } catch (error) {
      logger.error(`Error closing Redis connection ${db}`, { error: error.message });
    }
  }

  logger.info('Graceful shutdown completed');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const start = async () => {
  const loaded = await loadRuntimeSecrets();
  logger.info(loaded ? 'Runtime secrets loaded from Secrets Manager' : 'No AWS_SECRET_NAME set, skipping Secrets Manager');
  redisPool.getClient(0); // Connect before taking traffic; the password is known by now.

  server = app.listen(port, () => {
    logger.info(`Enterprise DevOps App running on port ${port}`, {
      environment: process.env.NODE_ENV || 'development',
      version: process.env.APP_VERSION || '1.0.0',
      nodeVersion: process.version
    });
  });
};

if (require.main === module) {
  start().catch((error) => {
    logger.error('Startup failed', { error: error.message });
    process.exit(1);
  });
}

// Exposed so tests can close pooled Redis connections in afterAll - without
// this the sockets stay open and Jest hangs after the suite finishes.
app.redisPool = redisPool;

module.exports = app;
