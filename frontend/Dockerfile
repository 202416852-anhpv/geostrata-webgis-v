# ---------- Giai đoạn build ----------
FROM node:20-alpine AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json* ./
# Dùng npm ci khi có lock file để build tái lập được, không thì npm install.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY frontend/ ./
RUN npm run build

# ---------- Giai đoạn chạy ----------
FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
# Dùng 127.0.0.1 chứ không phải localhost: trong container "localhost" resolve ra
# ::1 trước, mà nginx chỉ listen IPv4 nên healthcheck sẽ luôn báo connection refused.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -q --spider http://127.0.0.1/ || exit 1
