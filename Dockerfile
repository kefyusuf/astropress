# Geliştirme imajı: web / admin / backend / mcp-http servisleri aynı imajı farklı command ile kullanır.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci && npm --prefix backend ci
COPY . .
EXPOSE 4321 4322 3000 4323
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]