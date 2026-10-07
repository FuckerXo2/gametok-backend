# 3D Model Orientation Validation

## Overview

The model orientation validator uses Puppeteer + Gemini's multimodal vision to detect and fix 3D character model positioning issues in generated games.

## Problem

When AI generates games with 3D character models (GLB files), it cannot "see" the model to know:
- Which direction is the model's front/forward axis
- If the model is facing the camera or showing its back
- If the model is rotated incorrectly (sideways, upside-down)

This leads to games where characters face away from the camera or appear in wrong orientations.

## Solution

**Multimodal Feedback Loop:**

1. **Generate** - AI creates game with best-guess positioning
2. **Screenshot** - Puppeteer launches game in headless browser and captures screenshot
3. **Analyze** - Gemini sees the screenshot and detects orientation issues
4. **Fix** - If issues found, AI generates corrected code with proper rotations/camera angles
5. **Verify** - Process repeats (max 2 iterations) until orientation is correct

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ gametok-direct-loop.js                                      │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 1. Generate game with Gemini                            │ │
│ │    - Loads asset catalogs (animations + models)         │ │
│ │    - AI writes Three.js code                            │ │
│ └──────────────────┬──────────────────────────────────────┘ │
│                    │                                          │
│                    ▼                                          │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 2. Optional: validateAndFixOrientation()                │ │
│ │    (model-orientation-validator.js)                     │ │
│ └──────────────────┬──────────────────────────────────────┘ │
└────────────────────┼──────────────────────────────────────────┘
                     │
        ┌────────────┴───────────┐
        ▼                        ▼
┌────────────────┐      ┌────────────────┐
│ Puppeteer      │      │ Gemini Vision  │
│ - Launch game  │──────│ - See screenshot│
│ - Wait 3s      │      │ - Detect issues │
│ - Screenshot   │      │ - Suggest fixes │
└────────────────┘      └────────────────┘
        │                        │
        └────────────┬───────────┘
                     ▼
        ┌───────────────────────┐
        │ Fixed game code       │
        └───────────────────────┘
```

## Usage

### Enable Validation (Optional)

In generation request, pass `validateOrientation: true`:

```javascript
const result = await runDirectGenerationLoop({
  jobId,
  prompt: 'fighting game with scorpion character',
  validateOrientation: true, // Enable screenshot validation
  // ... other params
});
```

### API Usage

From frontend, include in jobPayload:

```javascript
POST /api/ai/generate

{
  "prompt": "make a fighting game with my Scorpion character",
  "validateOrientation": true
}
```

### Response

```javascript
{
  "gameScript": "<!DOCTYPE html>...",
  "validationResult": {
    "iterations": [
      {
        "screenshot": "data:image/jpeg;base64,...",
        "validation": {
          "hasOrientationIssues": true,
          "issues": [
            {
              "problem": "Character facing backwards",
              "severity": "high",
              "recommendation": "Rotate 180° on Y-axis"
            }
          ],
          "suggestedFixes": [
            "character.rotation.y = Math.PI;"
          ]
        },
        "needsFix": true
      }
    ],
    "finalScript": "<!DOCTYPE html>...",
    "allFixed": true
  }
}
```

## Configuration

### Validation Parameters

```javascript
validateAndFixOrientation({
  gameScript: '<html>...</html>',
  prompt: 'fighting game',
  sessionId: 'job-123',
  orientation: 'portrait',
  maxIterations: 2, // Max fix attempts (default: 2)
})
```

### Puppeteer Settings

- **Headless:** true (no visible browser)
- **Timeout:** 30s for page load + 3s for scene initialization
- **Viewport:** Matches game orientation (393×852 or 852×393)
- **CORS:** Disabled to allow R2 asset loading

### Gemini Settings

- **Model:** gemini-3.8-flash (multimodal support)
- **Temperature:** 0.3 (analytical task, need precision)
- **Max Tokens:** 2048 (validation response)

## Performance

- **Adds 5-10 seconds** per validation iteration
- **Max 2 iterations** = ~15-20 seconds overhead
- **Optional** - only runs when `validateOrientation: true`

## When to Use

✅ **Enable when:**
- Game uses custom 3D character models
- Fighting games, third-person games, character-focused games
- User reports "character is backwards"

❌ **Skip when:**
- Pure 2D games (no 3D models)
- Abstract/puzzle games without characters
- Performance is critical (instant generation needed)
- Game uses only procedural geometry (no GLB files)

## Limitations

1. **Requires R2 assets to be public** - Puppeteer needs to load GLB files
2. **Adds latency** - Screenshot + analysis takes extra time
3. **Not foolproof** - Complex scenes may still have issues
4. **No physics validation** - Only checks visual appearance
5. **Browser resources** - Puppeteer launches Chrome instance

## Future Improvements

1. **Model metadata** - Pre-compute forward vectors and default scales
2. **Cached previews** - Pre-render common models from different angles
3. **Faster validation** - Use WebGL context directly instead of full page
4. **Smart filtering** - Only validate games likely to have orientation issues

## Debugging

### Check validation logs

```bash
# Enable verbose logging
DEBUG=validator* npm start
```

### Manual testing

```javascript
import { validateModelOrientation } from './model-orientation-validator.js';

const result = await validateModelOrientation({
  gameScript: fs.readFileSync('game.html', 'utf-8'),
  prompt: 'fighting game',
  sessionId: 'test-123',
  orientation: 'portrait',
});

console.log('Issues:', result.validation.issues);
console.log('Screenshot:', result.screenshot); // base64 data URL
```

## Files

- **model-orientation-validator.js** - Core validation logic
- **gametok-direct-loop.js** - Integration with generation loop
- **routes.js** - API endpoint support
