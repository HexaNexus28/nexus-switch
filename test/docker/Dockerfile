# Fresh-user simulation — the harshest "I just installed nexus" baseline.
#
# Strategy: build EVERYTHING (native deps, TypeScript) in the full image, then
# copy the compiled artefacts + node_modules into node:22-slim which has NO
# python, pip, claude, or litellm. No npm install runs in the slim stage at all
# — native modules are already compiled by the build stage.

# ---- build stage: full toolchain for native deps (node-pty) ----
FROM node:22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npx tsc -p tsconfig.e2e.json

# ---- run stage: bare machine, no python on PATH ----
FROM node:22-slim
WORKDIR /app

# Copy pre-built artefacts and pre-compiled node_modules directly — no npm ci
# in this stage so there is no toolchain requirement and no prepare/tsc run.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-e2e ./dist-e2e
COPY bin ./bin
COPY providers ./providers

# Sanity: report python availability (informational only).
RUN sh -c 'command -v python python3 2>/dev/null && echo "note: python present" || echo "fresh-user: no python on PATH"'

RUN node --test "dist-e2e/**/*.e2e.js"
CMD ["node", "bin/nexus.js", "help"]
