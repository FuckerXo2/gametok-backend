# The GTA Lagos multiplayer server, for Cloud Run (see tools/deploy_server.sh). No dependencies:
# plain Node. Its files (money, reports, bans, ad counts) live in DATA_DIR, a mounted bucket.
FROM node:22-alpine
WORKDIR /app
COPY *.mjs ./
ENV NODE_ENV=production DATA_DIR=/data
CMD ["node", "server.mjs"]
