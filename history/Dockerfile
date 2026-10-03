# ==========================================
# History API — solo lectura del event store
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/domain/package*.json ./packages/domain/

RUN npm ci

COPY packages/domain ./packages/domain
COPY history ./history
COPY scripts/copy-history-assets.js ./scripts/copy-history-assets.js

RUN npm --workspace=@eventsourcing/domain run build
RUN npm run build:history
RUN npm prune --omit=dev

# ==========================================
# Imagen de ejecución
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
# Mismo archivo que Transaction API. En la etapa 5 el compose lo monta en solo lectura:
#   target: /data/event-store.jsonl
#   read_only: true
ENV EVENT_STORE_FILE=/data/event-store.jsonl

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=builder /app/packages/domain/dist ./packages/domain/dist
COPY --from=builder /app/dist-history ./dist-history

RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 3001

CMD ["node", "dist-history/main.js"]
