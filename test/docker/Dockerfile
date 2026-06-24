# Fresh-user simulation — the harshest "I just installed nexus" baseline.
#
# Why two stages: node-pty (a devDep used by the PTY test) is a native module.
# A bare slim image has no toolchain, so installing it there would fail the whole
# run for the wrong reason. We build everything in the full node:22 image, then
# copy the result into node:22-slim — which has NO python, pip, claude or litellm
# — and run the e2e suite there. If anything in the CLI assumes the dev's tooling
# exists, the suite fails here and the docker build (hence CI) goes red.

# ---- build stage: full image, has python3/make/g++ for native deps ----
FROM node:22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Compile both the CLI and the e2e tests so the slim stage needs no toolchain.
RUN npm run build && npx tsc -p tsconfig.e2e.json

# ---- run stage: bare machine, no python on PATH ----
FROM node:22-slim
WORKDIR /app
COPY --from=build /app /app
# Report the baseline (informational), then run the e2e suite for real. The
# suite must pass whether or not python happens to exist on the base image.
RUN sh -c 'command -v python python3 >/dev/null 2>&1 && echo "note: python present on base image" || echo "fresh-user baseline: no python on PATH"'
RUN node --test "dist-e2e/**/*.e2e.js"
CMD ["node", "bin/nexus.js", "help"]
