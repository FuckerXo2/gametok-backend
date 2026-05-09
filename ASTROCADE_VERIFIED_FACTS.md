# Astrocade Verified Facts (From Scraper Analysis)

**Date:** May 8, 2026  
**Source:** Direct scraping of 10 Astrocade games  
**Method:** Puppeteer scraper + HTML analysis

---

## KEY FINDINGS

### 1. **NO GAME FRAMEWORKS** ❌
- **Zero** games use Phaser, Three.js, Pixi, Babylon, or P5.js
- **Zero** games have `<canvas>` elements in the DOM
- All games use **pure Canvas 2D** rendering (80KB inline script with `getContext('2d')`)
- Games are **self-contained HTML** with inline JavaScript

### 2. **GAME DELIVERY METHOD** 📦
- Games are embedded in **iframe srcdoc** (not external URLs)
- Complete game code is **inline** in the iframe's `srcdoc` attribute
- No external game files or CDN dependencies for game logic
- Only external dependencies: Google Fonts (Press Start 2P, VT323)

### 3. **GAME STRUCTURE** 🏗️
```html
<iframe srcdoc="
  <!DOCTYPE html>
  <html>
    <head>
      <style>/* All CSS inline */</style>
      <script>/* All game logic inline */</script>
    </head>
    <body>
      <div id='game-world'>
        <canvas id='game-canvas'></canvas>
        <div class='ui-overlay'>/* UI elements */</div>
      </div>
    </body>
  </html>
">
```

### 4. **RENDERING APPROACH** 🎨
- **Canvas 2D** with `getContext('2d')` (not WebGL)
- Pure JavaScript game loops with `requestAnimationFrame`
- Custom physics and collision detection (no physics engine)
- Pixel art style with CSS gradients for backgrounds

### 5. **NO RIGID CATEGORIES** 🎯
- Games don't follow predefined "lanes" or templates
- Each game is **unique** with custom mechanics
- Examples from scrape:
  - "Pixel Merge Mania" - 5×5 grid merge puzzle
  - "Counter-strike Knife IDLE" - idle clicker
  - "Pengu Adventure" - platformer
  - "Dirtbike" - racing game
  - "Ultimate Carrom" - physics board game
  - "99 Days as a Boxer" - progression game
  - "Demon Slayer Memory Match" - memory card game

### 6. **REMIX FEATURE** 🔄
- **100%** of games have remix capability
- Users can modify and republish games
- No editor UI detected in game pages (likely separate editor page)

### 7. **GAME METADATA** 📊
From schema.org structured data:
```json
{
  "@type": "VideoGame",
  "genre": "Arcade",
  "applicationCategory": "Game",
  "operatingSystem": "HTML5",
  "gamePlatform": "Web",
  "playMode": ["SinglePlayer"]
}
```

### 8. **ASTROCADE INJECTED CODE** 💉
Every game has Astrocade-injected scripts for:
- Error handling and reporting
- Gesture tracking (touch/swipe/long-press)
- Disabling context menus and text selection
- Parent-iframe communication via `postMessage`

---

## WHAT THIS MEANS FOR GAMETOK

### ❌ **What We're Doing WRONG:**
1. **Using rigid lane system** (11 predefined game types)
2. **Forcing games into categories** with `pickLane()` classifier
3. **Using Phaser/Three.js** when Astrocade uses pure Canvas 2D
4. **Limiting creativity** with predefined templates

### ✅ **What We Should Do:**
1. **Remove lane system entirely**
2. **Let Kimi decide everything:**
   - Game type (no categories)
   - Rendering approach (Canvas 2D, WebGL, or framework)
   - Game mechanics (no templates)
   - UI layout (no predefined structure)
   - Controls (no predefined schemes)
3. **Generate self-contained HTML** like Astrocade (all inline)
4. **Focus on variety** - every game should be unique

---

## TECHNICAL COMPARISON

| Feature | Astrocade | GameTok (Current) |
|---------|-----------|-------------------|
| **Frameworks** | None (pure Canvas 2D) | Phaser 3 + Three.js |
| **Game Categories** | None (AI decides) | 11 rigid lanes |
| **Rendering** | Canvas 2D | Phaser WebGL / Three.js |
| **Game Delivery** | Inline srcdoc | External HTML files |
| **Physics** | Custom inline | Phaser physics |
| **Variety** | Every game unique | Template-based |
| **Remix** | Yes (100%) | No |

---

## NEXT STEPS

1. **Read current lane system:**
   - `spec-normalizer.js` - contains `pickLane()` classifier
   - `promptRegistry.js` - uses lanes for prompts

2. **Design new AI-driven approach:**
   - Remove `pickLane()` function
   - Update Kimi prompt to decide game type freely
   - Let Kimi choose rendering approach (Canvas 2D, WebGL, framework)
   - Remove rigid templates and let AI design mechanics

3. **Test with variety:**
   - Generate 10 games with new system
   - Verify each game is unique
   - Check for repetition or template-like patterns

---

## CONCLUSION

**Astrocade's secret:** They don't limit their AI. No lanes, no categories, no templates. Just pure AI-driven game generation with Canvas 2D rendering. Every game is unique because the AI decides everything from scratch.

**Our problem:** We're forcing games into 11 predefined categories with rigid templates. This kills variety and creativity.

**Solution:** Remove the lane system and let Kimi decide everything. Trust the AI.
