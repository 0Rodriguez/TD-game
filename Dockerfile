# Stage 1: build the Vite bundle
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

# Optional build-arg: lets you point the bundle at an external backend (e.g.
# https://api.your-domain.com).  Leave unset to use the relative `/api/*`
# default — Nginx (production) and Vite (dev) both proxy `/api/` to the
# backend container, so relative URLs are the right choice for Coolify too.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY . .
RUN npm run build

# Stage 2: production — Nginx serves the bundle and proxies /api to the backend
FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
