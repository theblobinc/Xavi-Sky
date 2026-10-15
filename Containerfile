FROM docker.io/library/node:24-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY vendor ./vendor
COPY seed-packs.txt ./seed-packs.txt
RUN mkdir -p /data
ENV XAVI_SKY_DATA_DIR=/data
ENTRYPOINT ["node","src/worker.mjs"]
