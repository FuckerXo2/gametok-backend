#!/bin/bash
set -e

echo "🚀 [Cloud Boot] Starting Headless Blender MCP Bridge Daemon on 127.0.0.1:9876..."
blender --background --online-mode --python /app/src/ai-engine/start-blender-mcp-daemon.py > /tmp/blender-mcp.log 2>&1 &

# Wait for Blender MCP Bridge to start listening on port 9876
echo "⏳ [Cloud Boot] Waiting for Blender MCP Socket Bridge on 127.0.0.1:9876..."
for i in $(seq 1 30); do
    if python3 -c "import socket; s = socket.socket(); s.connect(('127.0.0.1', 9876)); s.close()" 2>/dev/null; then
        echo "✅ [Cloud Boot] Headless Blender MCP Bridge is active and listening on port 9876!"
        break
    fi
    sleep 0.5
done

echo "🚀 [Cloud Boot] Starting GameTok Backend Node Server on port ${PORT:-3000}..."
exec npm start
