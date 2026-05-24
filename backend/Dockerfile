FROM node:20-bookworm-slim

# better-sqlite3 needs build tools on arm64 if no prebuilt binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3001
CMD ["node", "src/server.js"]
