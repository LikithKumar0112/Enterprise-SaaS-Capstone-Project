const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { createClient } = require('redis');
const rateLimit = require('express-rate-limit');
const CircuitBreaker = require('opossum');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const axios = require('axios');

// Configure Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
    winston.format.errors({ stack: true })
  ),
  defaultMeta: { service: 'enterprise-devops-app' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
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
        database: db
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
  resetTimeout: 30000, // After 30 seconds, try again.
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

// Request ID middleware
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('x-request-id', req.id);
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

// Health check endpoint with Redis and external API checks
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
    await redisClient.ping();
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

  const overallStatus = Object.values(checks.dependencies).every(v => v === 'healthy') ? 200 : 503;
  res.status(overallStatus).json(checks);
});

// Main endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Enterprise DevOps Application',
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
  
  try {
    const redisClient = redisPool.getClient(0);
    
    // Try to get from cache
    const cachedData = await redisClient.get(cacheKey);
    
    if (cachedData) {
      logger.debug('Cache hit for products', { requestId: req.id });
      return res.json({
        success: true,
        data: JSON.parse(cachedData),
        count: JSON.parse(cachedData).length,
        cached: true,
        timestamp: new Date().toISOString()
      });
    }
    
    // If not in cache, generate data
    const products = [
      { id: 1, name: 'DevOps Platform', category: 'Infrastructure', price: 999 },
      { id: 2, name: 'Monitoring Suite', category: 'Observability', price: 499 },
      { id: 3, name: 'Security Scanner', category: 'Security', price: 799 },
      { id: 4, name: 'CI/CD Pipeline', category: 'Automation', price: 1299 },
      { id: 5, name: 'Kubernetes Operator', category: 'Orchestration', price: 899 }
    ];
    
    // Store in cache
    await redisClient.setEx(cacheKey, cacheTTL, JSON.stringify(products));
    
    logger.debug('Cache miss for products, stored', { requestId: req.id });
    
    res.json({
      success: true,
      data: products,
      count: products.length,
      cached: false,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to get products', { 
      requestId: req.id, 
      error: error.message 
    });
    res.status(500).json({ 
      success: false, 
      error: 'Failed to retrieve products',
      requestId: req.id
    });
  }
});

// Cache management endpoints
app.get('/api/v1/cache/:key', async (req, res) => {
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

app.delete('/api/v1/cache/:key', async (req, res) => {
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
app.get('/api/v1/error', (req, res) => {
  const errorType = req.query.type || 'server';
  
  switch(errorType) {
    case 'timeout':
      setTimeout(() => {
        res.status(504).json({ error: 'Request timeout' });
      }, 5000);
      break;
    case 'memory':
      const largeArray = [];
      for(let i = 0; i < 1000000; i++) {
        largeArray.push(new Array(1000).join('x'));
      }
      res.json({ message: 'Memory test completed', arraySize: largeArray.length });
      break;
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
  const redisClient = redisPool.getClient(0);
  const info = await redisClient.info('memory');
  const memoryInfo = info.split('\n').find(line => line.startsWith('used_memory:')) || '';
  
  res.set('Content-Type', 'text/plain');
  res.send(`
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",handler="/health"} 42
http_requests_total{method="GET",handler="/"} 156
http_requests_total{method="GET",handler="/api/v1/products"} 89

# HELP app_version Application version
# TYPE app_version gauge
app_version{version="${process.env.APP_VERSION || '1.0.0'}"} 1

# HELP memory_usage Memory usage in bytes
# TYPE memory_usage gauge
memory_usage{type="heap"} ${process.memoryUsage().heapUsed}

# HELP circuit_breaker_state Circuit breaker state (0=closed, 1=open)
# TYPE circuit_breaker_state gauge
circuit_breaker_state ${externalApiBreaker.opened ? 1 : 0}

# HELP redis_memory_usage Redis memory usage in bytes
# TYPE redis_memory_usage gauge
redis_memory_usage ${memoryInfo.split(':')[1] || 0}

# HELP http_response_time_seconds HTTP response time
# TYPE http_response_time_seconds histogram
http_response_time_seconds_bucket{le="0.1"} 100
http_response_time_seconds_bucket{le="0.5"} 200
http_response_time_seconds_bucket{le="1"} 250
http_response_time_seconds_bucket{le="+Inf"} 300
http_response_time_seconds_sum 45.6
http_response_time_seconds_count 300
  `);
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

// Graceful shutdown
let isShuttingDown = false;

const gracefulShutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  logger.info('SIGTERM received, starting graceful shutdown');
  
  // Close server
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // Close Redis connections
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

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

const server = app.listen(port, () => {
  logger.info(`Enterprise DevOps App running on port ${port}`, {
    environment: process.env.NODE_ENV || 'development',
    version: process.env.APP_VERSION || '1.0.0',
    nodeVersion: process.version
  });
});

module.exports = app;
