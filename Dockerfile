FROM node:20-bookworm-slim

# Install FFmpeg (full version with all codecs)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/* && \
    ffmpeg -version | head -1

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
