FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PATH="/usr/local/bin:$PATH"

# Install required system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    git \
    curl \
    ca-certificates \
    # Shared libraries for Puppeteer's bundled Chrome (game thumbnail screenshots).
    # Without these Chrome exits with "libglib-2.0.so.0: cannot open shared object file".
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libdbus-1-3 libexpat1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 libx11-6 libxcb1 libxext6 libxshmfence1 \
    fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Install Antigravity CLI (agy) — optional fallback (skipped if unreachable)
RUN (curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/agy-install.sh \
    && bash /tmp/agy-install.sh \
    && rm -f /tmp/agy-install.sh \
    && ln -sf "$(find /root/.local -name agy -type f 2>/dev/null | head -1)" /usr/local/bin/agy) || echo "AGY CLI install skipped"

# Configure agy for headless API key auth (no browser OAuth)
RUN mkdir -p /root/.gemini/antigravity-cli \
    && echo '{"modelProvider":"gemini"}' > /root/.gemini/antigravity-cli/settings.json

WORKDIR /app

# Install Node dependencies first for Docker layer caching
COPY package*.json ./
RUN npm install --production

# Copy application source code
COPY . .

# Setup entrypoint script
RUN cp docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
