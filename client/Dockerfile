# --- build ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts confirmed safe in Phase 2 (modern esbuild ships prebuilt
# platform binaries via optionalDependencies, not a postinstall script).
RUN npm ci --ignore-scripts
COPY . .

# Vite bakes VITE_* env vars into the bundle at build time, not runtime —
# must be supplied as a build arg, not a docker-compose `environment:` entry.
ARG VITE_API_BASE_URL=http://localhost:5000/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# --- runtime ---
# nginx-unprivileged: same nginx image, but already configured to run as a
# non-root user and listen on an unprivileged port (8080) out of the box --
# avoids hand-patching directory permissions to make stock nginx:alpine
# work as non-root.
FROM nginxinc/nginx-unprivileged:1.27-alpine
# Pick up patched OS packages ahead of the base image's own next release.
USER root
RUN apk update && apk upgrade --no-cache
USER nginx
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
