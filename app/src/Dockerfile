# Multi-stage build for production
# Stage 1: Builder
FROM node:18-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies including devDependencies
RUN npm ci

# Copy source code
COPY . .

# Run tests
RUN npm run test

# Stage 2: Production dependencies
FROM node:18-alpine AS deps

WORKDIR /app

COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Stage 3: Final image
FROM node:18-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /app/logs && \
    chown -R nodejs:nodejs /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy production dependencies
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application code
COPY --chown=nodejs:nodejs . .

# Switch to non-root user
USER nodejs

# Health check with circuit breaker consideration
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http = require('http'); \
    const options = { \
      hostname: 'localhost', \
      port: 3000, \
      path: '/health', \
      method: 'GET', \
      timeout: 3000 \
    }; \
    const req = http.request(options, (res) => { \
      if (res.statusCode === 200 || res.statusCode === 503) process.exit(0); \
      process.exit(1); \
    }); \
    req.on('error', () => process.exit(1)); \
    req.end();"

# Expose port
EXPOSE 3000

# Use dumb-init as entrypoint
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "src/server.js"]
