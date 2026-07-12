# ==========================================
# 1. Build Stage
# ==========================================
FROM node:20-slim AS builder

# Install build dependencies required for compiling native addons (bcrypt, better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package management files
COPY package*.json ./

# Install all dependencies (including devDependencies needed for building CSS)
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Compile Tailwind CSS styles
RUN npm run build:css

# Prune devDependencies to keep the production build clean
RUN npm prune --omit=dev

# ==========================================
# 2. Production Stage
# ==========================================
FROM node:20-slim

WORKDIR /app

# Copy built application and production dependencies from builder stage
# Ensure files are owned by the node user for security
COPY --from=builder --chown=node:node /app /app

# Create sqlite directory and ensure proper permissions
RUN mkdir -p /app/sqlite && chown -R node:node /app/sqlite

# Set runtime environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Use the non-root node user provided by the base image
USER node

# Expose the application port
EXPOSE 5678

# Start the application
CMD ["npm", "start"]
