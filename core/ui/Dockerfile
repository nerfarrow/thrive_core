FROM node:20-alpine AS builder
WORKDIR /app
# build context is the repo root (see docker-compose ui.build.context)
COPY ui/package.json .
RUN npm install
COPY ui .
# shared renderer library, imported via the `blackhole-lensing` Vite alias
COPY blackhole-lensing /blackhole-lensing
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
