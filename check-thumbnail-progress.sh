#!/bin/bash
# Monitor thumbnail regeneration progress

echo "🎨 Thumbnail Regeneration Monitor"
echo "=================================="
echo ""

# Check Railway logs for progress
echo "📊 Recent Activity:"
railway logs --service gametok-backend 2>&1 | grep -E "thumbnail-regen.*✅|thumbnail-regen.*❌|thumbnail-regen.*Complete" | tail -10

echo ""
echo "📈 Summary:"
SUCCESS=$(railway logs --service gametok-backend 2>&1 | grep "thumbnail-regen.*✅" | wc -l | tr -d ' ')
FAILED=$(railway logs --service gametok-backend 2>&1 | grep "thumbnail-regen.*❌" | wc -l | tr -d ' ')
echo "   ✅ Success: $SUCCESS"
echo "   ❌ Failed: $FAILED"

echo ""
echo "🔄 To see live updates, run:"
echo "   railway logs --service gametok-backend --follow | grep thumbnail-regen"
