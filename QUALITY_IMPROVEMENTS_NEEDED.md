# Quality Improvements Needed

## Issues Identified:

### 1. ❌ Limited Asset Variety (Only 6-8 assets shown to AI)
**Problem:** 
- `buildDreamAssetBundle()` hardcodes `limit: 6`, `limit: 8` in every call
- AI only sees 6-8 assets per category instead of the thousands available
- This kills variety and quality

**Fix:**
- Increase all hardcoded limits to 20-30
- Let AI see more options to choose from
- Better asset selection = better visual quality

### 2. ❌ Art Quality Issues
**Problem:**
- AI generates poor procedural art
- No guidance on visual quality standards
- No examples of good vs bad art

**Potential Fixes:**
- Add visual quality guidelines to prompts
- Provide art style examples
- Use more Phaser/Kenney assets (they're high quality)
- Add "juice" requirements (particles, animations, polish)

### 3. ❌ Phase 2 Not Updated for Flexible Spec
**Problem:**
- We updated Phase 1 to extract flexible spec
- But `buildLabsSoloPrototype()` (Phase 2) still has old guidance
- Mismatch between what Phase 1 extracts and what Phase 2 uses

**Fix:**
- Update `buildLabsSoloPrototype()` engine guidance
- Make it use the new spec fields properly
- Ensure it understands `renderingApproach`, `gameStructure`, etc.

### 4. ❌ Phaser Assets Not Fully Utilized
**Problem:**
- 3,349 Phaser assets available
- But only showing 6-8 to AI
- Missing out on high-quality official assets

**Fix:**
- Increase Phaser asset limits
- Better Phaser asset selection
- Prioritize Phaser assets (they're higher quality than procedural)

## Recommended Action Plan:

### Step 1: Fix Asset Limits (CRITICAL)
```javascript
// In buildDreamAssetBundle(), change ALL:
limit: 6  → limit: 25
limit: 8  → limit: 30
limit: 10 → limit: 35
```

This alone will massively improve variety and quality.

### Step 2: Improve Art Quality Prompts
Add to Phase 2 prompt:
```
VISUAL QUALITY STANDARDS:
- Use high-quality assets from the provided kit
- If generating procedural art, make it polished and professional
- Add visual juice: particles, animations, screen shake, etc.
- Ensure readable silhouettes and clear visual hierarchy
- Match the visual style consistently throughout
```

### Step 3: Better Asset Selection Strategy
```javascript
// Prioritize quality:
1. Phaser official assets (highest quality)
2. Kenney assets (high quality, consistent)
3. Procedural generation (only if needed)
```

### Step 4: Add Quality Validation
- Check if game uses provided assets
- Validate visual consistency
- Ensure animations and juice are present

## Expected Impact:

### Before:
- AI sees 6-8 assets per category
- Limited variety
- Poor procedural art
- Generic looking games

### After:
- AI sees 25-35 assets per category
- Much more variety
- Better asset utilization
- Higher quality visuals
- More unique games

## Quick Win:

The FASTEST improvement is increasing asset limits. This requires minimal code changes but will have MASSIVE impact on quality and variety.

**Estimated Time:** 30 minutes to update all limits
**Expected Impact:** 3-5x improvement in visual quality and variety

---

**Priority:** HIGH
**Effort:** LOW
**Impact:** MASSIVE
