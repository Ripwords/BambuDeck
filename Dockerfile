FROM node:26-bookworm-slim AS node-toolchain
FROM oven/bun:1.4.2 AS build
COPY --from=node-toolchain /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY index.html vite.config.ts tsconfig*.json tokens.css ./
COPY src/ ./src/
COPY public/ ./public/
RUN bun run build

FROM oven/bun:1.4.2-slim AS runtime
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production && mkdir -p /data/filament-profiles && chown -R bun:bun /data /app
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --chown=bun:bun server/ ./server/
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data BAMBUDECK_FILAMENT_DIR=/data/filament-profiles
USER bun
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD bun -e "const r=await fetch((process.env.TLS_CERT_FILE?'https':'http')+'://127.0.0.1:3000/api/health',{tls:{rejectUnauthorized:false}});process.exit(r.ok?0:1)"
CMD ["bun", "run", "server/index.ts"]
