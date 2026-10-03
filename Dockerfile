# LookBlog for hosting (Railway). Data lives on a mounted volume at /data.
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json server.js ./
COPY server ./server
COPY public ./public
ENV NODE_ENV=production LOOKBLOG_DATA=/data TRUST_PROXY=1
EXPOSE 3000
CMD ["node", "server.js"]
