FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PATH="/usr/local/bin:$PATH"

# Install required system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    blender \
    libgl1 \
    libxrender1 \
    libxi6 \
    python3 \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Antigravity CLI (agy) — successor to Gemini CLI
RUN curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/agy-install.sh \
    && bash /tmp/agy-install.sh \
    && rm /tmp/agy-install.sh \
    && ln -sf "$(find /root/.local -name agy -type f 2>/dev/null | head -1)" /usr/local/bin/agy || true

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

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
