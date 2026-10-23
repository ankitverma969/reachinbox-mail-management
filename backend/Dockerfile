# ==============================================================================
# ReachInbox Backend - Production Multi-Stage Dockerfile
# ==============================================================================

# Stage 1: Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Install OpenSSL and certificates required by Prisma engine
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install all dependencies (including devDependencies for TypeScript compilation)
COPY package.json package-lock.json ./
RUN npm ci

# Generate Prisma Client
COPY prisma ./prisma
RUN npx prisma generate

# Copy TypeScript configuration and source files
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript to JavaScript in /app/dist
RUN npm run build

# Stage 2: Production runtime stage
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Install runtime dependencies: OpenSSL for Prisma, CA certs for external APIs, curl for healthcheck
RUN apt-get update && apt-get install -y openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*

# Install production-only dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy Prisma schema and generate Linux-compatible runtime client
COPY prisma ./prisma
RUN npx prisma generate

# Copy compiled JavaScript output from builder stage
COPY --from=builder /app/dist ./dist

# Security: Run as non-root node user
USER node

EXPOSE 5000

# Container healthcheck targeting Express health probe
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:5000/api/health || exit 1

# Start ReachInbox Backend HTTP & Queue Worker Server
CMD ["node", "dist/server.js"]
