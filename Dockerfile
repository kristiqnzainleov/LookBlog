# LookBlog for hosting (Railway). Data lives on a mounted volume at /data.
# (pinned: the exact image, so a build never picks up something unexpected; update the tag and digest together)
FROM node:24.22.1-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json server.js ./
COPY server ./server
COPY public ./public
ENV NODE_ENV=production LOOKBLOG_DATA=/data TRUST_PROXY=1
# Not as root: the app runs as the image's "node" user (the data volume must be writable by it)
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
