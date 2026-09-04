# syntax=docker/dockerfile:1.7

# Keep both build and runtime bases reproducible. Update this digest deliberately
# with the Node 22 Bookworm security-refresh process rather than floating tags.
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS package-manager
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml ./

FROM package-manager AS build
RUN --mount=type=cache,id=kokoro-bff-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY database ./database
RUN pnpm build

FROM package-manager AS production-dependencies
RUN --mount=type=cache,id=kokoro-bff-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV KOKORO_BFF_HOST=0.0.0.0
ENV KOKORO_BFF_PORT=4300

# Runtime executes prebuilt JavaScript only; remove unused package managers and
# their transitive attack surface from the final image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v1.22.22 \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY package.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/database ./database

EXPOSE 4300
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4300/healthz').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]
USER node
CMD ["node", "dist/main.js"]
