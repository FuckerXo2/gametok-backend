# Canvas 2D REMOVED - Forces Asset Usage

## The Problem with Canvas 2D

**Canvas 2D = AI draws its own ugly shapes:**
```javascript
ctx.fillRect(x, y, width, height)  // Ugly rectangles
ctx.arc(x, y, radius, 0, Math.PI * 2)  // Ugly circles
ctx.fillStyle = '#ff0000'  // Flat colors
```

This creates SHIT ART because AI is drawing procedural shapes instead of using our 81,092 Kenney assets and 3,349 Phaser assets.

## The Solution

**Force AI to use engines that LOAD ASSETS:**

### For 2D Games: PHASER 3 (REQUIRED)
```javascript
// Phaser loads PNG/sprite assets from URLs
this.load.image('player', 'https://gametok.app/assets/player.png')
this.load.spritesheet('enemy', 'https://gametok.app/assets/enemy.png')
```

### For 3D Games: THREE.JS (REQUIRED)
```javascript
// Three.js loads GLB 3D models from URLs
const loader = new GLTFLoader()
loader.load('https://gametok.app/assets/model.glb', (gltf) => {
  scene.add(gltf.scene)
})
```

### For Text Games: DOM/CSS (ALLOWED)
```html
<!-- Can display images but no game physics -->
<img src="https://gametok.app/assets/image.png">
```

## Changes Made

### 1. Removed Canvas 2D from Engine Options

**Before:**
```
1. THREE.JS - for 3D games
2. P5.JS - for creative art
3. CANVAS 2D - for 2D arcade games  ❌ REMOVED
4. DOM/CSS - for card games
```

**After:**
```
1. PHASER 3 - REQUIRED for ALL 2D games (loads our PNG assets!)
2. THREE.JS - REQUIRED for ALL 3D games (loads our GLB models!)
3. DOM/CSS - ONLY for text-heavy games
```

### 2. Added Explicit Warnings

```
CRITICAL: DO NOT use native Canvas 2D (ctx.fillRect, ctx.arc, etc.) - it creates ugly procedural shapes.
ALWAYS use Phaser for 2D games or Three.js for 3D games so you can load our high-quality assets!
```

### 3. Updated buildLabsSoloPrototype

**Before:**
```
- Use Phaser 3 as the rendering engine
- Use Phaser's sprite system for all visual elements
```

**After:**
```
ENGINE: PHASER 3 FOR 2D GAMES (REQUIRED - DO NOT USE CANVAS 2D!)
- Load PNG/sprite assets from the provided asset kit
- Use Phaser's sprite system for ALL visual elements
- CRITICAL: DO NOT use native Canvas 2D - it creates ugly shapes!
- ALWAYS load and use the high-quality PNG assets provided!
```

## Why This Matters

### Before (with Canvas 2D):
- AI draws ugly rectangles and circles
- Ignores our 81,092 Kenney assets
- Ignores our 3,349 Phaser assets
- Games look like shit

### After (Phaser/Three.js only):
- AI MUST load assets from URLs
- Uses our high-quality Kenney PNG sprites
- Uses our high-quality Phaser assets
- Uses our 3D GLB models
- Games look PROFESSIONAL

## Asset Loading Flow

### Phaser 2D Games:
```javascript
class GameScene extends Phaser.Scene {
  preload() {
    // AI MUST load assets from the provided kit
    this.load.image('player', assetKit.player.url)
    this.load.image('enemy', assetKit.enemy.url)
    this.load.image('background', assetKit.background.url)
  }
  
  create() {
    // Use loaded assets, not drawn shapes
    this.add.image(x, y, 'player')  // ✅ Uses PNG asset
    // NOT: ctx.fillRect(x, y, 50, 50)  // ❌ Ugly shape
  }
}
```

### Three.js 3D Games:
```javascript
const loader = new GLTFLoader()
// AI MUST load 3D models from the provided kit
loader.load(assetKit.player3D.url, (gltf) => {
  scene.add(gltf.scene)  // ✅ Uses GLB model
  // NOT: new THREE.BoxGeometry()  // ❌ Ugly box
})
```

## Expected Impact

### Visual Quality:
- **Before:** Ugly procedural shapes (rectangles, circles)
- **After:** Professional PNG sprites and 3D models

### Asset Utilization:
- **Before:** 0% of our 84,441 assets used (AI draws its own)
- **After:** High utilization of our asset library

### Consistency:
- **Before:** Every game looks different (random shapes)
- **After:** Consistent quality (curated asset library)

## Files Modified:

1. `/src/ai-engine/promptRegistry.js`
   - Removed Canvas 2D from engine options
   - Added explicit warnings against Canvas 2D
   - Updated buildLabsSoloPrototype to force Phaser
   - Made asset loading REQUIRED, not optional

---

**Status:** COMPLETE
**Impact:** Forces AI to use our high-quality assets instead of drawing ugly shapes
**Risk:** NONE - Canvas 2D was making games look like shit anyway
