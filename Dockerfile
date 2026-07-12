# ==========================================
# 1. Build Stage
# ==========================================
FROM node:20-slim AS builder

# Install build dependencies required for compiling native addons (like bcrypt)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package management files
COPY package*.json ./

# Install all dependencies (including devDependencies needed for compiling CSS)
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Prune devDependencies to keep the production build clean
RUN npm prune --omit=dev

# ==========================================
# 2. Production Stage
# ==========================================
FROM node:20-slim

WORKDIR /app

# Copy built application and production dependencies from builder stage
COPY --from=builder --chown=node:node /app /app

# Set runtime environment variables
ENV NODE_ENV=production
ENV PORT=5678

# Use the non-root node user provided by the base image
USER node

# Expose the application port
EXPOSE 5678

# Start the application
CMD ["npm", "start"]
