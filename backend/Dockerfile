FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

EXPOSE 3000

# Run node directly, not through npm: npm does not pass SIGTERM on to node, so
# the shutdown handler in src/server.js would never run on a Cloud Run redeploy.
CMD ["node", "src/server.js"]