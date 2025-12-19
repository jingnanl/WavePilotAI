FROM --platform=linux/amd64 public.ecr.aws/docker/library/node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . ./

# Build TypeScript
RUN npm run build

# Production stage
FROM --platform=linux/amd64 public.ecr.aws/docker/library/node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Expose port for AgentCore Runtime
EXPOSE 8080

# Start the application
CMD ["npm", "start"]
