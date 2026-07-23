FROM node:18-bullseye-slim

# Install ffmpeg and python3 (required for yt-dlp)
RUN apt-get update && \
    apt-get install -y ffmpeg python3 curl && \
    rm -rf /var/lib/apt/lists/*

# Download yt-dlp and make it executable
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --production

# Copy backend source code
COPY server.js ./
COPY src/ ./src/

# Create a symlink for yt-dlp in the /app folder as well, 
# because server.js expects it to be in the root directory on Linux
RUN ln -s /usr/local/bin/yt-dlp /app/yt-dlp

EXPOSE 3000

CMD ["node", "server.js"]
