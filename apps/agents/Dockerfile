FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . ./

# Build TypeScript
RUN npm run build

# Expose port for AgentCore Runtime
EXPOSE 8080

# Start the application
CMD ["npm", "start"]
