# The No Rules FC multiplayer server, for Cloud Run (gametok-backend services/nrfc-online, deployed
# by its cloudbuild.yaml). No dependencies: plain Node. The match logic is the game's own js/sim.js.
# Accounts, coins and bans live in DATA_DIR, a mounted bucket.
FROM node:22-alpine
WORKDIR /app
COPY server/*.mjs ./server/
COPY js/sim.js ./js/
ENV NODE_ENV=production DATA_DIR=/data
CMD ["node", "server/server.mjs"]
