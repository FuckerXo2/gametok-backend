#!/bin/bash
set -e

echo "🚀 [Cloud Boot] Starting Headless Blender MCP Bridge Daemon on 127.0.0.1:9876..."
blender --background --command blender_mcp --port 9876 &

echo "🚀 [Cloud Boot] Starting GameTok Backend Node Server on port ${PORT:-3000}..."
exec npm start
