# --- deps: install production dependencies only ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts is safe here: this is a --omit=dev (production-only)
# install, and none of express/mongoose/cors/dotenv/morgan/
# express-mongo-sanitize need install-time scripts (verified by building
# and smoke-testing the image with this flag before adding it).
RUN npm ci --omit=dev --ignore-scripts

# --- runtime ---
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# Pick up patched OS packages (e.g. OpenSSL) ahead of the base image's own
# next release, rather than carry known-fixed CVEs unnecessarily.
RUN apk update && apk upgrade --no-cache

# Run as a non-root user rather than the image's default root.
RUN addgroup -S app && adduser -S app -G app

# The base image bundles npm/npx/corepack for build-time use, but this
# container only ever runs `node src/index.js` -- npm's own vendored
# dependencies (tar, glob, minimatch, cross-spawn, pacote, ...) are pure
# attack surface here with zero runtime benefit, and have carried real
# CRITICAL/HIGH CVEs. Strip them from the shipped image entirely.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER app

EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/health || exit 1

CMD ["node", "src/index.js"]
