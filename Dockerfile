FROM node:20-alpine AS builder

WORKDIR /app

# Install native packages required for native builds/sqlite bindings if needed
RUN apk add --no-cache python3 make g++

# Copy dependency graphs
COPY package*.json ./
COPY prisma ./prisma/

# Install exact dependency tree
RUN npm ci

# Copy core codebase assets
COPY . .

# Generate Prisma client bindings and output resilient bundles
RUN npx prisma generate
RUN npm run expo:static:build
RUN npm run server:build

# Minimal runner stage for autoscale Cloud Run execution
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Inherit necessary build artifacts and isolated module contexts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server_dist ./server_dist
COPY --from=builder /app/server/templates ./server/templates
COPY --from=builder /app/static-build ./static-build
COPY --from=builder /app/prisma ./prisma

EXPOSE 5000

# Execute server bundle directly without dev servers/metro overhead
CMD ["npm", "run", "prod"]
