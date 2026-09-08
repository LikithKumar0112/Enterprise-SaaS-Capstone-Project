# ---------- Stage 1: production dependencies ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
# apk upgrade picks up patched OS packages (e.g. libcrypto3/openssl CVEs)
# within this Alpine release. npm/npx/corepack are removed - the container
# only ever runs `node server.js`, but npm ships its own bundled, frequently
# outdated tar/brace-expansion that otherwise fail image vulnerability scans
# for code this image never executes.
RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache dumb-init=1.2.5-r3 && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /app/logs && chown -R nodejs:nodejs /app && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .
USER 1001:1001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "require('http').get('http://localhost:3000/health',r=>process.exit([200,503].includes(r.statusCode)?0:1)).on('error',()=>process.exit(1))"]
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
