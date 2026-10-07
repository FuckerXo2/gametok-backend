/**
 * Model Orientation Validator
 * 
 * Uses Puppeteer to screenshot generated games and Gemini's multimodal vision
 * to validate that 3D models are properly oriented (not backwards/sideways).
 * 
 * Workflow:
 * 1. Launch game in headless browser
 * 2. Wait for Three.js scene to load
 * 3. Capture screenshot
 * 4. Send screenshot to Gemini for visual validation
 * 5. If orientation issues detected, generate fix code
 */

import puppeteer from 'puppeteer';
import { generateText } from './gemini-direct.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Screenshot game and validate 3D model orientation
 * 
 * @param {object} params
 * @param {string} params.gameScript - Complete HTML game code
 * @param {string} params.prompt - Original user prompt
 * @param {string} params.sessionId - Session ID for conversation memory
 * @param {string} [params.orientation] - portrait | landscape
 * @returns {Promise<object>} Validation result with screenshot and fixes
 */
export async function validateModelOrientation({
  gameScript,
  prompt,
  sessionId,
  orientation = 'portrait',
}) {
  console.log(`🔍 [Validator] Starting model orientation validation...`);
  
  let browser = null;
  try {
    // Launch headless browser
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security', // Allow CORS for R2 assets
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });
    
    const page = await browser.newPage();
    
    // Set viewport based on orientation
    const dimensions = orientation === 'landscape'
      ? { width: 852, height: 393 }
      : { width: 393, height: 852 };
    
    await page.setViewport(dimensions);
    
    console.log(`  📱 Viewport: ${dimensions.width}×${dimensions.height}`);
    
    // Set page content to game script
    await page.setContent(gameScript, {
      waitUntil: 'networkidle0', // Wait for all assets to load
      timeout: 30000,
    });
    
    // Wait for Three.js scene to initialize
    await page.waitForTimeout(3000); // Give scene time to render
    
    // Try to detect if scene is ready
    const isReady = await page.evaluate(() => {
      // Check if window has common Three.js indicators
      return !!(window.scene || window.renderer || window.camera);
    });
    
    console.log(`  🎮 Scene ready: ${isReady}`);
    
    // Capture screenshot
    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      encoding: 'base64',
    });
    
    console.log(`  📸 Screenshot captured (${Math.round(screenshot.length / 1024)}KB)`);
    
    await browser.close();
    browser = null;
    
    // Ask Gemini to analyze the screenshot
    console.log(`  🧠 Sending to Gemini for visual analysis...`);
    
    const validationPrompt = [
      {
        type: 'text',
        text: `You are analyzing a screenshot of a 3D game that was just generated. The original prompt was: "${prompt}"

TASK: Check if 3D character models are properly oriented for the game's camera perspective.

Common issues:
1. Character facing away from camera (showing back instead of front)
2. Character rotated 90° (showing side profile when front view expected)
3. Character upside-down or tilted
4. Camera positioned incorrectly (too close/far, wrong angle)

RESPOND WITH JSON:
{
  "hasOrientationIssues": true/false,
  "issues": [
    {
      "problem": "Character is facing backwards",
      "severity": "high",
      "recommendation": "Rotate character model 180° on Y-axis"
    }
  ],
  "suggestedFixes": [
    "character.rotation.y = Math.PI;",
    "camera.position.set(0, 2, -5);"
  ]
}

If everything looks correct, return:
{
  "hasOrientationIssues": false,
  "issues": [],
  "suggestedFixes": []
}`
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${screenshot}`
        }
      }
    ];
    
    const validationResponse = await generateText(validationPrompt, {
      sessionId: `${sessionId}-validation`,
      model: 'gemini-3.8-flash',
      maxTokens: 2048,
      temperature: 0.3, // Lower temp for analytical task
    });
    
    // Parse validation result
    let validation;
    try {
      const jsonMatch = validationResponse.text.match(/\{[\s\S]*\}/);
      validation = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.warn(`⚠️ [Validator] Could not parse validation JSON, treating as no issues`);
      validation = {
        hasOrientationIssues: false,
        issues: [],
        suggestedFixes: [],
      };
    }
    
    console.log(`  ✅ Validation complete: ${validation.hasOrientationIssues ? 'ISSUES FOUND' : 'LOOKS GOOD'}`);
    
    if (validation.hasOrientationIssues) {
      console.log(`  🔧 Issues detected:`);
      validation.issues.forEach(issue => {
        console.log(`     - ${issue.problem} (${issue.severity})`);
      });
    }
    
    return {
      screenshot: `data:image/jpeg;base64,${screenshot}`,
      validation,
      needsFix: validation.hasOrientationIssues,
    };
    
  } catch (error) {
    console.error(`❌ [Validator] Failed:`, error.message);
    
    if (browser) {
      await browser.close();
    }
    
    // Return non-fatal error - don't block game generation
    return {
      screenshot: null,
      validation: {
        hasOrientationIssues: false,
        issues: [{ problem: `Validation failed: ${error.message}`, severity: 'low' }],
        suggestedFixes: [],
      },
      needsFix: false,
      error: error.message,
    };
  }
}

/**
 * Apply orientation fixes to game script
 * 
 * @param {object} params
 * @param {string} params.gameScript - Original game HTML
 * @param {object} params.validation - Validation result from validateModelOrientation
 * @param {string} params.sessionId - Session ID for conversation memory
 * @returns {Promise<string>} Fixed game script
 */
export async function applyOrientationFixes({
  gameScript,
  validation,
  sessionId,
}) {
  console.log(`🔧 [Validator] Applying orientation fixes...`);
  
  const fixPrompt = `The game has the following orientation issues:

${validation.issues.map(issue => `- ${issue.problem}: ${issue.recommendation}`).join('\n')}

Suggested code fixes:
${validation.suggestedFixes.join('\n')}

Update the game code to fix these issues. Return the COMPLETE fixed HTML game.`;

  const fixResponse = await generateText(fixPrompt, {
    sessionId, // Use main session so AI has full game context
    model: 'gemini-3.8-flash',
    maxTokens: 65536,
    temperature: 0.7,
  });
  
  // Extract HTML from response
  const htmlMatch = fixResponse.text.match(/<!DOCTYPE[\s\S]*<\/html>/i);
  if (!htmlMatch) {
    console.warn(`⚠️ [Validator] Could not extract fixed HTML, returning original`);
    return gameScript;
  }
  
  console.log(`  ✅ Fixes applied`);
  return htmlMatch[0];
}

/**
 * Full validation + fix loop
 * 
 * @param {object} params - Same as validateModelOrientation
 * @param {number} [params.maxIterations=2] - Max fix attempts
 * @returns {Promise<object>} Final result with fixed game + screenshots
 */
export async function validateAndFixOrientation(params) {
  const maxIterations = params.maxIterations || 2;
  const results = {
    iterations: [],
    finalScript: params.gameScript,
    allFixed: false,
  };
  
  let currentScript = params.gameScript;
  
  for (let i = 0; i < maxIterations; i++) {
    console.log(`\n🔄 [Validator] Iteration ${i + 1}/${maxIterations}`);
    
    const validation = await validateModelOrientation({
      ...params,
      gameScript: currentScript,
    });
    
    results.iterations.push(validation);
    
    if (!validation.needsFix) {
      console.log(`✅ [Validator] No issues found, validation complete`);
      results.allFixed = true;
      results.finalScript = currentScript;
      break;
    }
    
    // Apply fixes
    const fixedScript = await applyOrientationFixes({
      gameScript: currentScript,
      validation: validation.validation,
      sessionId: params.sessionId,
    });
    
    currentScript = fixedScript;
    results.finalScript = fixedScript;
    
    // If this is the last iteration, accept it even if not perfect
    if (i === maxIterations - 1) {
      console.log(`⚠️ [Validator] Max iterations reached, accepting current version`);
      results.allFixed = false;
    }
  }
  
  return results;
}
