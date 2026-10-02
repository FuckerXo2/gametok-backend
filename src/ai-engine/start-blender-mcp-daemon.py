#!/usr/bin/env python3
"""
Headless Blender MCP Socket Server Daemon for GameTok / Hermes
Starts the Blender Lab MCP bridge on 127.0.0.1:9876 in background mode
and maintains a blocking socket event loop so Blender stays alive to serve requests.
"""

import sys
import os

current_dir = os.path.dirname(os.path.abspath(__file__))
user_addons = os.path.expanduser('~/.config/blender/5.2/scripts/addons')

for p in [current_dir, user_addons]:
    if os.path.exists(p) and p not in sys.path:
        sys.path.insert(0, p)

try:
    from blender_mcp_addon import mcp_to_blender_server, execute_blocking
except ImportError as e:
    print(f"❌ [Blender MCP Bridge] Failed to import blender_mcp_addon: {e}", flush=True)
    sys.exit(1)

HOST = os.environ.get("BLENDER_MCP_HOST", "127.0.0.1")
PORT = int(os.environ.get("BLENDER_MCP_PORT", 9876))

print(f"🚀 [Headless Blender MCP] Starting bridge on {HOST}:{PORT}...", flush=True)

try:
    mcp_to_blender_server.start(HOST, PORT)
    print(f"✅ [Headless Blender MCP] Bridge is LIVE and serving requests on {HOST}:{PORT}", flush=True)
except Exception as ex:
    print(f"❌ [Headless Blender MCP] Failed to bind to {HOST}:{PORT}: {ex}", flush=True)
    sys.exit(1)

try:
    execute_blocking.run()
except KeyboardInterrupt:
    print("🛑 [Headless Blender MCP] Received shutdown signal.", flush=True)
finally:
    print("🛑 [Headless Blender MCP] Stopping bridge server...", flush=True)
    mcp_to_blender_server.stop()
