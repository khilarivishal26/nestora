# ==============================================================================
# Nestora — Production Multi-Stage Dockerfile
# ==============================================================================

FROM node:20-alpine AS base

# Install build dependencies if needed for native modules (e.g. bcrypt)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------------------------------------------------------
# Final lean runtime stage
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=8080

# Copy node_modules from base build stage
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package*.json ./

# Copy application source code
COPY . .

# Run as non-root user for security hardening
USER node

# Expose production port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start production server
CMD ["node", "app.js"]
