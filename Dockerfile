FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/pages/public ./dist/pages/public
COPY bin/start.sh ./bin/start.sh
EXPOSE 8080
# Runs both the web server and the firehose ingester as separate processes on
# this machine so they share the SQLite volume. See bin/start.sh.
CMD ["bash", "bin/start.sh"]
