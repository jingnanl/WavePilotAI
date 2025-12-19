FROM --platform=linux/amd64 public.ecr.aws/docker/library/node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --only=production

# Copy built files
COPY dist/ ./dist/

# Run the worker
CMD ["node", "dist/index.js"]
