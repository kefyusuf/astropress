# Geliştirme imajı: web / admin / backend / mcp-http servisleri aynı imajı farklı command ile kullanır.
FROM node:22-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci && npm --prefix backend ci
COPY . .

# Production hedefi (issue #16): derlenmiş backend, dev-only bağımlılıklar ayıklanmış,
# non-root kullanıcı, HEALTHCHECK ve exec-form CMD (node PID 1 — SIGTERM graceful shutdown).
FROM base AS production
RUN npm --prefix backend run build \
 && npm prune --omit=dev --prefix backend \
 && npm prune --omit=dev
ENV NODE_ENV=production \
    HOST=0.0.0.0
USER node
EXPOSE 3000 4322 4324 4323
# healthz probe'u üzerinden konteyner sağlığı (ReadinessState'e bağlı değil — liveness).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "backend/dist/src/main.js"]
