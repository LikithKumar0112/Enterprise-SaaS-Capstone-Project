# ---------- Stage 1: production dependencies ----------
# Base image pinned by digest for reproducible builds; Dependabot proposes updates.
FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS runtime
WORKDIR /app
# OS patches come from updating the pinned base image, not `apk upgrade`, so the
# same Dockerfile always builds the same packages. npm/npx/corepack are removed - the container
# only ever runs `node server.js`, but npm ships its own bundled, frequently
# outdated tar/brace-expansion that otherwise fail image vulnerability scans
# for code this image never executes.
RUN apk add --no-cache dumb-init=1.2.5-r4 && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .
USER 1001:1001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "require('http').get('http://localhost:3000/livez',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
