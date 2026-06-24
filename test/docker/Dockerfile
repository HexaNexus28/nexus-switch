# Fresh-user simulation — the harshest "I just installed nexus" baseline.
#
# Strategy: build EVERYTHING in the full image (native deps, TypeScript), then
# copy pre-built artefacts + node_modules into node:22-slim which has NO
# python, pip, claude, or litellm. No compilation runs in the slim stage.
#
# npm ci --ignore-scripts: skips the `prepare` lifecycle hook (tsc) that would
# fail because the source tree is not yet present at that step. We run the
# build explicitly afterwards once COPY . . has brought in the source.

# ---- build stage: full toolchain for native deps (node-pty) + tsc ----
FROM node:22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npx tsc -p tsconfig.e2e.json

# ---- run stage: bare machine, no python on PATH ----
FROM node:22-slim
WORKDIR /app

# Copy pre-built artefacts and already-compiled node_modules — nothing to build.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-e2e ./dist-e2e
COPY bin ./bin
COPY providers ./providers

# Report python availability (informational — the CLI handles the absent case).
RUN sh -c 'command -v python python3 2>/dev/null && echo "note: python present" || echo "fresh-user: no python on PATH"'

RUN node --test "dist-e2e/**/*.e2e.js"
CMD ["node", "bin/nexus.js", "help"]
