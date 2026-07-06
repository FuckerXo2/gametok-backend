# Claude-Style Game Generation

This is a **simplified alternative** to the complex template/scaffold system. It generates Phaser games exactly like Claude does: no templates, no contracts, no probe APIs - just clean Phaser 3 + TypeScript + CDN assets.

## How It Works

### Your Old System (Complex)
```
User Prompt
  → Phase 1: Extract intent (JSON spec)
  → Phase 1.5: Generate foundation contract
  → Select template (canvas-kernel, phaser-minimal, threejs-kernel)
  → Copy scaffold files
  → Phase 2: Multi-turn AI agent modifies scaffold
    → Tool-based file editing
    → Compile checks
    → Repair loops
    → Probe API validation
  → Build with Vite
  → Sandbox verification
  → 20+ rounds when things go wrong
```

### Claude-Style (Simple)
```
User Prompt
  → AI generates complete game files in ONE SHOT
    → index.html
    → package.json
    → tsconfig.json
    → vite.config.js
    → src/main.ts (Phaser config)
    → src/scenes/GameScene.ts (game logic)
  → Write files to disk
  → Build with Vite
  → Done
```

## Key Differences

| Feature | Old System | Claude-Style |
|---------|-----------|--------------|
| Templates | Required | None |
| Scaffolds | Complex pre-built structure | AI writes from scratch |
| Probe API | `window.__GAMETOK_TEMPLATE_PROBE__` | Not needed |
| Game dimensions | Sometimes uses `window.innerWidth` | Always fixed (390x844 or 800x600) |
| Assets | Mix of generated + CDN | **Always CDN** (`https://labs.phaser.io/assets/`) |
| Generation | Multi-turn agent with repairs | **Single AI call** |
| Failures | 20+ repair loops | Rare (clean prompt = clean output) |

## How Claude Generates Games

When you ask me to make a Phaser game, I:

1. **Write from memory** - no templates or scaffolds
2. **Use fixed dimensions** - never `window.innerWidth` (causes overflow in headless tests)
3. **Load all assets from CDN** - `https://labs.phaser.io/assets/`
4. **Keep it simple** - pure Phaser 3 API, no custom wrappers
5. **Output one clean project** - ready to build with Vite

## Files Generated

### index.html
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Game</title>
</head>
<body>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

### package.json
```json
{
  "dependencies": {
    "phaser": "^3.80.1"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "vite": "^5.0.0",
    "vite-plugin-singlefile": "^2.0.0"
  }
}
```

### src/main.ts
```typescript
import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 390,
  height: 844,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [GameScene],
};

new Phaser.Game(config);
```

### src/scenes/GameScene.ts
```typescript
import Phaser from 'phaser';

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  preload() {
    // Load from CDN
    this.load.image('player', 'https://labs.phaser.io/assets/sprites/phaser-dude.png');
  }

  create() {
    // Game setup
  }

  update(time: number, delta: number) {
    // Game loop
  }
}
```

## Testing

### Test from command line:
```bash
cd gametok-backend
export DEEPSEEK_API_KEY="your-key-here"
node test-claude-style.js "Create a flappy bird clone"
```

This will:
1. Generate all game files
2. Build with Vite
3. Save the output to `test-claude-game.html`
4. You can open that file in a browser

### Test with custom prompt:
```bash
node test-claude-style.js "Create a zombie shooter with waves of enemies"
```

## Integration with Your Backend

To use this in your actual `/dream` endpoint, you have two options:

### Option 1: Environment Variable Toggle
Add to your `.env`:
```bash
GAMETOK_USE_CLAUDE_STYLE=true
```

Then modify `executeDreamJob` to check this flag and call `generateClaudeStyleGame()` instead of the complex pipeline.

### Option 2: Separate Endpoint
Add a new route:
```javascript
router.post('/dream-simple', async (req, res) => {
    // Call generateClaudeStyleGame()
    // Save to database
    // Return jobId
});
```

## Why This Works Better

### For Phaser Games:

1. **No Template Confusion** - AI doesn't waste time reading scaffold files
2. **No Probe API** - Your test was failing because of `window.__GAMETOK_TEMPLATE_PROBE__` requirement
3. **Fixed Dimensions** - Never generates `window.innerWidth` that causes 17747px canvas overflow
4. **Clean Code** - Pure Phaser 3, easy to read and debug
5. **Fast** - One AI call instead of 20+ repair rounds
6. **Reliable** - Simple prompt = predictable output

### When to Use Which:

| Use Case | System |
|----------|--------|
| Simple 2D games (shooters, runners, platformers) | **Claude-style** |
| Complex 3D games with Three.js | Your existing system |
| Games needing custom kernel features | Your existing system |
| Rapid prototyping | **Claude-style** |
| Production polish with repair loops | Your existing system |

## Next Steps

1. **Test it**: Run `node test-claude-style.js "your game idea"`
2. **Compare**: Generate the same game with both systems
3. **Integrate**: Add the toggle to your `/dream` endpoint
4. **Monitor**: Track success rates (I bet Claude-style will have fewer failures for Phaser games)

## The Core Insight

Your system got complex trying to handle every edge case. But for Phaser games:
- **Simpler is better**
- **Less infrastructure = fewer failure points**
- **Direct generation = faster results**

My approach isn't "smarter" - it's just **optimized for the 80% case** (simple 2D games).

Your infrastructure is great for complex cases, but Phaser games don't need it.

---

**TL;DR**: This generates Phaser games like I do - from scratch, with CDN assets, no templates. Test with `node test-claude-style.js`. Way simpler than your current system for 2D games.
