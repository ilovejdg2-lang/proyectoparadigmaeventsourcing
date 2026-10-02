# ==========================================
# Etapa 1: Construcción y compilación
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copiar descriptores de dependencias para aprovechar caché de capas Docker
COPY package*.json ./
COPY packages/domain/package*.json ./packages/domain/

# Instalar todas las dependencias
RUN npm ci

# Copiar código fuente y configuraciones del workspace
COPY tsconfig*.json nest-cli.json ./
COPY packages/domain ./packages/domain
COPY src ./src

# Compilar dominio y Transaction API
RUN npm --workspace=@eventsourcing/domain run build
RUN npm run build

# Descartar dependencias de desarrollo para aligerar la imagen
RUN npm prune --omit=dev

# ==========================================
# Etapa 2: Imagen ligera para ejecución
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV EVENT_STORE_FILE=/app/data/event-store.jsonl

# Copiar dependencias de producción y artefactos compilados
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/domain/package*.json ./packages/domain/
COPY --from=builder /app/packages/domain/dist ./packages/domain/dist
COPY --from=builder /app/dist ./dist

# Directorio de persistencia append-only para eventos
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "dist/src/main.js"]
