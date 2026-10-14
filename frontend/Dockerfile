# syntax=docker/dockerfile:1
# Frontend React + Vite → dibangun lalu disajikan nginx (sekaligus proxy /api ke backend).
# Build context = folder ini (frontend/), lihat docker-compose.yml.
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# `npm run build` = `tsc --noEmit && vite build`; butuh devDependencies (typescript, vite) → jangan `--omit=dev`.
RUN npm run build


FROM nginx:1.27-alpine

# Target proxy `/api` (dan `/health`). Nama `backend` = nama service di docker-compose.yml.
ENV BACKEND_ORIGIN=http://backend:8000

COPY --from=build /app/dist /usr/share/nginx/html
# Entrypoint resmi nginx menjalankan envsubst pada /etc/nginx/templates/*.template → `${BACKEND_ORIGIN}` terisi.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
