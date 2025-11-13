FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies for build
COPY package*.json ./
RUN npm ci

# Copy source and assets needed for the build
COPY tsconfig.json ./
COPY src ./src
COPY personas ./personas
COPY panels.json ./panels.json

# Compile TypeScript to JavaScript
RUN npm run build

# Remove development-only dependencies before shipping
RUN npm prune --omit=dev

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Copy only what is required to run the CLI
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/personas ./personas
COPY --from=builder /app/panels.json ./panels.json

ENTRYPOINT ["node", "dist/index.js"]
