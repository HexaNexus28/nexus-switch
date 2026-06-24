# Fresh-user simulation — the harshest "I just installed nexus" baseline.
#
# Why two stages:
# - Build stage: full node:22 image with python/make/g++ for native deps
#   (node-pty). Compiles the CLI (dist/) and the e2e tests (dist-e2e/).
# - Run stage: node:22-slim with NO python, pip, claude or litellm.
#   npm ci --ignore-scripts avoids re-running `prepare` (tsc) which needs
#   the source tree. We only copy the pre-built artefacts and run the tests.

# ---- build stage ----
FROM node:22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npx tsc -p tsconfig.e2e.json

# ---- run stage: bare machine, no python on PATH ----
FROM node:22-slim
WORKDIR /app

# Copy only what the e2e suite needs at runtime — no src/, no tsconfig.
# --ignore-scripts skips `prepare` (tsc) which would fail without the source.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-e2e ./dist-e2e
COPY bin ./bin
COPY providers ./providers

# Sanity: report python availability (informational only — the test must pass
# whether or not python is on this base image, because the CLI guards it).
RUN sh -c 'command -v python python3 2>/dev/null && echo "note: python present" || echo "fresh-user: no python on PATH"'

RUN node --test "dist-e2e/**/*.e2e.js"
CMD ["node", "bin/nexus.js", "help"]
