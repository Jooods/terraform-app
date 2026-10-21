FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY backend/package*.json backend/
COPY frontend/package*.json frontend/
RUN npm install --prefix backend --omit=dev && npm install --prefix frontend
COPY frontend frontend
RUN npm run build --prefix frontend

FROM node:20-bookworm-slim
ARG TF_VERSION=1.9.8
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && curl -fsSL https://releases.hashicorp.com/terraform/${TF_VERSION}/terraform_${TF_VERSION}_linux_amd64.zip -o /tmp/tf.zip \
 && unzip /tmp/tf.zip -d /usr/local/bin && rm /tmp/tf.zip \
 && apt-get purge -y unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/backend/node_modules backend/node_modules
COPY --from=build /app/frontend/dist frontend/dist
COPY backend backend
COPY terraform terraform
ENV NODE_ENV=production WORK_DIR=/data/work TF_PLUGIN_CACHE_DIR=/tmp/tf-plugins
RUN mkdir -p /data/work /tmp/tf-plugins
CMD ["node", "backend/src/server.js"]