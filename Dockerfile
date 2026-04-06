FROM node:20-bookworm-slim

# Install FFmpeg and curl
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg curl && \
    rm -rf /var/lib/apt/lists/* && \
    ffmpeg -version | head -1 && \
    curl --version | head -1

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
