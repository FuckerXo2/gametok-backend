FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PATH="/usr/local/bin:/opt/hermes-venv/bin:$PATH"

# Install required system packages for Node and Python
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install uv (high-performance Python package installer)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install Official Nous Research Hermes Agent CLI
RUN git clone --depth 1 https://github.com/NousResearch/hermes-agent.git /opt/hermes-agent \
    && cd /opt/hermes-agent \
    && uv venv /opt/hermes-venv --python 3.12 \
    && . /opt/hermes-venv/bin/activate \
    && uv pip install -e . \
    && ln -s /opt/hermes-venv/bin/hermes /usr/local/bin/hermes

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
