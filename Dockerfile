# Stage 1: Build the web interface
FROM node:22-alpine AS builder
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package*.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund
COPY . .
RUN npm run build

# Stage 2: Production runtime (supports linux/amd64 and linux/arm64)
FROM node:22-alpine
WORKDIR /app

# Install ffmpeg (includes ffprobe), timezone data, and SMB/NFS mount utilities for NAS shares
RUN apk add --no-cache ffmpeg tzdata cifs-utils nfs-utils && \
    mkdir -p /config /music/albums /music/singles

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src ./src

ENV NODE_ENV=production \
    PORT=8484 \
    CONFIG_DIR=/config \
    MUSIC_DIR=/music \
    TZ=UTC \
    TRANSCODE_BITRATE_KBPS=192 \
    TRANSCODE_CACHE_MAX_MB=2048 \
    STREAM_BITRATE_KBPS=192

VOLUME ["/config", "/music"]
EXPOSE 8484

CMD ["node", "--import", "tsx", "server.ts"]
