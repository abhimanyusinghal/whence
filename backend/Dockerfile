FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY openapi.yaml ./openapi.yaml
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/prompts ./dist/prompts
COPY --from=build /app/openapi.yaml ./openapi.yaml
# Run as the built-in non-root `node` user; give it a writable dir for the
# default ./data/chains.jsonl log (chain logging degrades gracefully if absent).
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 8787
CMD ["node", "dist/server.js"]
