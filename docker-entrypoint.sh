#!/bin/bash
set -e

echo "🚀 [Cloud Boot] Starting GameTok Backend Node Server on port ${PORT:-8080}..."
exec npm start
