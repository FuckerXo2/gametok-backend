# Quick Start: Model Orientation Validation

## What It Does

Fixes 3D character models that appear backwards, sideways, or incorrectly positioned in generated games.

## How It Works

1. AI generates game → 2. Screenshots it → 3. Gemini sees the screenshot → 4. AI fixes orientation issues

## Enable It

### Option 1: API Request (Frontend)

```javascript
POST /api/ai/generate

{
  "prompt": "make a fighting game with Scorpion",
  "validateOrientation": true  // ← Add this flag
}
```

### Option 2: Direct Code

```javascript
import { runDirectGenerationLoop } from './gametok-direct-loop.js';

const result = await runDirectGenerationLoop({
  jobId: 'test-123',
  prompt: 'fighting game with scorpion character',
  validateOrientation: true,  // ← Add this flag
  orientation: 'portrait',
});

// Check validation results
console.log('Fixed?', result.validationResult.allFixed);
console.log('Issues:', result.validationResult.iterations[0].validation.issues);
```

## When to Use

✅ **Turn it ON for:**
- Fighting games (characters face each other)
- Third-person games (camera behind character)
- Character showcase/demo games
- Any game using 3D GLB character models

❌ **Turn it OFF for:**
- Pure 2D games
- Abstract puzzle games
- Games without characters
- Fast prototyping (saves 15-20 seconds)

## Performance Impact

- **Without validation:** ~30-60 seconds to generate game
- **With validation:** +15-20 seconds (2 screenshot iterations)

## Example: Fighting Game

```bash
# Test with fighting game prompt
curl -X POST http://localhost:8080/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "make a 3D fighting game where Scorpion battles Green Lantern with punch animations",
    "validateOrientation": true
  }'
```

**What happens:**
1. AI generates game with Scorpion + Green Lantern models
2. Puppeteer launches game, waits 3 seconds, takes screenshot
3. Gemini sees screenshot, notices if characters face wrong way
4. If issues found, AI rotates models and repositions camera
5. Validates again (max 2 times)
6. Returns fixed game

## Debug Mode

```javascript
// See validation details
const result = await runDirectGenerationLoop({
  prompt: 'fighting game',
  validateOrientation: true,
});

// Iteration 1
console.log('Screenshot:', result.validationResult.iterations[0].screenshot);
console.log('Issues found:', result.validationResult.iterations[0].validation.issues);

// Final result
console.log('All fixed?', result.validationResult.allFixed);
```

## Common Fixes Applied

```javascript
// Character facing backwards
character.rotation.y = Math.PI; // Rotate 180°

// Character sideways
character.rotation.y = Math.PI / 2; // Rotate 90°

// Camera too far
camera.position.set(0, 2, -5); // Move closer

// Model upside-down
character.rotation.z = Math.PI; // Flip vertical
```

## Troubleshooting

### Validation times out
- Check if R2 assets are public
- Verify Puppeteer can load GLB files
- Increase timeout in model-orientation-validator.js

### Still backwards after 2 fixes
- Validation stops after 2 iterations
- Check model's default forward axis
- Manually specify rotation in prompt

### No validation happening
- Confirm `validateOrientation: true` is passed
- Check logs for `🔍 [Validator] Starting model orientation validation...`
- Ensure Puppeteer is installed: `npm list puppeteer`

## Cost Considerations

**Gemini API Calls:**
- Normal generation: 1 call
- With validation: 3-5 calls (generation + 2 validation iterations)

**Tokens Used:**
- Screenshot analysis: ~2000 tokens per iteration
- Fix generation: ~4000 tokens per fix

**Estimated cost increase:** ~2-3x for validated games (still pennies per game)

## Next Steps

1. Test with a fighting game: `validateOrientation: true`
2. Check console logs for validation details
3. Compare character positioning before/after
4. Disable if not needed for your use case
