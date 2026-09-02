FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY database ./database
RUN pnpm build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/dist ./dist
COPY --from=build /app/database ./database
RUN corepack enable && pnpm install --prod --frozen-lockfile
USER node
EXPOSE 4300
CMD ["node", "dist/main.js"]
