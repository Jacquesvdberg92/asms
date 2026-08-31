# ASMS - Ark Server Management Suite
#
# The image contains the manager and SteamCMD, not the ARK server itself:
# server files are downloaded into a volume on first use, exactly as they are
# on Windows. See the "Running in Docker" section of README.md - in particular
# the note about Proton, because ARK's dedicated server is a Windows binary.

# ---------------------------------------------------------------- build
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build

# -------------------------------------------------------------- runtime
FROM node:22-bookworm-slim

# i386 libraries are what SteamCMD itself needs; tar unpacks its tarball.
RUN dpkg --add-architecture i386 \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl tar lib32gcc-s1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

ENV NODE_ENV=production \
    ASMS_DATA=/data \
    ASMS_ARK_ROOT=/ark \
    ASMS_HOST=0.0.0.0 \
    ASMS_PORT=8787 \
    ASMS_NO_OPEN=1

RUN mkdir -p /data /ark && chown -R node:node /data /ark
USER node
VOLUME ["/data", "/ark"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.ASMS_PORT||8787)+'/api/auth/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
