FROM --platform=linux/amd64 node:20-alpine

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json* ./

# Copy shared package
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/dist/ ./packages/shared/dist/

# Copy worker package files
COPY apps/worker/package.json ./apps/worker/

# Install dependencies from root (workspace-aware)
# --ignore-scripts prevents potential security issues from postinstall scripts
RUN npm ci --workspace=wavepilot-worker --only=production --ignore-scripts

# Copy worker built files
COPY apps/worker/dist/ ./apps/worker/dist/

WORKDIR /app/apps/worker

# Health check (start-period matches CDK task definition)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Run the worker
CMD ["node", "dist/index.js"]
