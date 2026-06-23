# Backend — Doodle Defense leaderboard API
FROM node:20-alpine

WORKDIR /app

# Install deps first for better Docker layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY index.js ./

# Persisted scores live here.  In docker-compose this directory is
# bind-mounted to a named volume so data survives container rebuilds.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]
