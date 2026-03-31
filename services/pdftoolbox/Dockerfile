FROM callassoftware/pdftoolbox-cli:latest AS base

USER root

# Install Node.js 20 from NodeSource (includes npm)
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends ca-certificates curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y -qq --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the HTTP wrapper
COPY package.json server.js ./
RUN npm install --omit=dev

# Process plans, profiles, fonts
RUN mkdir -p /app/process-plans /app/profiles /app/fonts
COPY process-plans/ /app/process-plans/

EXPOSE 8080

# Run as callas user for license compatibility
USER callas

CMD ["node", "server.js"]
