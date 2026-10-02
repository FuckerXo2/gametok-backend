FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PATH="/usr/local/bin:/opt/hermes-venv/bin:$PATH"

# Install required system packages for Node, Python, and Headless Blender
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    git \
    curl \
    xz-utils \
    ca-certificates \
    libgl1 \
    libxi6 \
    libxrender1 \
    libxfixes3 \
    libxkbcommon0 \
    libsm6 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast Python toolchain)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install Blender 5.2.2 for Linux x64
RUN curl -fsSL https://download.blender.org/release/Blender5.2/blender-5.2.2-linux-x64.tar.xz \
    | tar -xJ -C /opt/ \
    && ln -s /opt/blender-5.2.2-linux-x64/blender /usr/local/bin/blender

# Install Nous Research Hermes Agent
RUN git clone --depth 1 https://github.com/NousResearch/hermes-agent.git /opt/hermes-agent \
    && cd /opt/hermes-agent \
    && uv venv /opt/hermes-venv --python 3.12 \
    && . /opt/hermes-venv/bin/activate \
    && uv pip install -e . \
    && ln -s /opt/hermes-venv/bin/hermes /usr/local/bin/hermes

# Pre-warm Blender MCP isolated tool environment in uv
RUN uv tool run --from "git+https://projects.blender.org/lab/blender_mcp.git@2cea8d566dde07fbac28a61d698909d69724e853#subdirectory=mcp" blender-mcp --help

WORKDIR /app

# Install Node dependencies first for Docker layer caching
COPY package*.json ./
RUN npm install --production

# Copy application source code
COPY . .

# Setup Blender add-on and GameTok rigger module in Linux Blender user paths
RUN mkdir -p /root/.config/blender/5.2/scripts/addons \
    && mkdir -p /root/.config/blender/5.2/scripts/modules \
    && cp src/ai-engine/gametok_rigger.py /root/.config/blender/5.2/scripts/modules/ \
    && cp -r src/ai-engine/blender_mcp_addon /root/.config/blender/5.2/scripts/addons/

# Install Hermes Blender Plugin
RUN hermes plugins install /app/src/ai-engine/hermes-plugin-blender || true

# Configure Blender online access, enable add-on, and save preferences
RUN blender --background --python-expr "
import bpy
bpy.context.preferences.system.use_online_access = True
try:
    bpy.ops.preferences.addon_enable(module='blender_mcp_addon')
except Exception as e:
    print('Addon enable deferred:', e)
bpy.ops.wm.save_userpref()
"

# Copy entrypoint script
RUN cp docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
