/**
 * AI Art Director
 * 
 * Dynamically conceptualizes 4 tailored visual art directions for ANY game prompt.
 * Seamlessly interfaces with:
 * 1. Qwen (DashScope / OpenRouter / QWEN_API_KEY) when keys are provided.
 * 2. NVIDIA NIM LLM (Llama 3.3 / Mixtral) using existing NVIDIA_API_KEY.
 * 3. Smart contextual semantic fallbacks (no hardcoded static archetypes).
 * 
 * Then concurrently dispatches to FLUX.1-dev to paint high-fidelity concept art cards.
 */

import { executeHermesAgent, extractJsonFromHermes, uploadLocalImageFileToR2, getHermesGeneratedImagesSince } from './official-hermes-client.js';

const SYSTEM_PROMPT = `You are a world-class Video Game Art Director.
The user will provide a game title, concept prompt, and any attached or selected assets.
Your task is to invent exactly 4 DISTINCT, CREATIVE, and VISUALLY COMPELLING art directions tailored SPECIFICALLY to that game concept and its assets.

Rules:
- NEVER output generic out-of-context styles or default to clay/cute styles unless the game explicitly asks for it.
- Each direction must feel like a genuine, thoughtful creative pitch for that exact game world.
- THE TWO-WAY ASSET & STYLE PRINCIPLE:
  1. If user assets (3D models, sprites, videos, audio) ARE active: The assets are the visual anchors. Derive the color palette, lighting atmosphere, rendering fidelity, and UI to harmonize directly with those assets.
  2. If NO assets are provided: Establish a strong, unified creative vision first. The game code will either query matching catalog assets or generate everything procedurally so the aesthetic is never compromised.
- Ensure diversity in mediums (e.g. 16-Bit Masterpiece Pixel Art, High-Octane Cel-Shaded Anime, Stylized Low-Poly 3D, Vibrant Neo-Arcade, Hand-Inked Graphic Novel, Moody Dark Fantasy, Retro Synthwave, Clean Vector 2D, etc.) appropriate to the game genre.
- The modifier MUST be structured for generating an authentic IN-GAME PLAYABLE SCREENSHOT (with game HUD, player character/vehicle, environment, and clean game graphics), NOT generic poster art.

You MUST respond with valid JSON strictly matching this schema:
{
  "directions": [
    {
      "name": "Creative Style Title (e.g. 16-Bit Neo Pixel)",
      "tagline": "2-3 word punchy tagline (e.g. Crisp & Retro)",
      "icon": "Ionicons icon name: sparkles | color-palette | flame | water | paw | leaf | flash | shapes-outline | rocket | game-controller | heart | skull | car | planet | bulb",
      "colors": ["#hex1", "#hex2", "#hex3", "#hex4"],
      "modifier": "in-game screenshot of playable video game, authentic HUD, crisp rendering, high visual fidelity",
      "instruction": "Clear instructions for the game code builder describing colors, UI styling, and aesthetic atmosphere"
    }
  ]
}`;

/**
 * Call LLM to invent 4 custom directions tailored specifically to the game and its assets
 */
async function callLLMForDirections(prompt, gameTitle, selectedAssets = []) {
    let assetContext = '';
    if (Array.isArray(selectedAssets) && selectedAssets.length > 0) {
        assetContext = '\nActive Game Assets:\n' + selectedAssets.map(a => `- ${a.role || a.type || 'asset'}: ${a.label || a.title || a.url}`).join('\n');
    }

    // 1. Try official Nous Research Hermes Agent
    const hermesPrompt = `${SYSTEM_PROMPT}\n\nGame Title: ${gameTitle || 'Untitled Game'}\nGame Concept: ${prompt}${assetContext}\n\nRespond with valid JSON containing "directions" array.`;
    const hermesOutput = await executeHermesAgent(hermesPrompt);
    if (hermesOutput) {
        const parsed = extractJsonFromHermes(hermesOutput);
        if (parsed && Array.isArray(parsed.directions) && parsed.directions.length >= 4) {
            console.log(`✅ [AI Art Director] Official Hermes Agent conceptualized 4 directions:`, parsed.directions.map(d => d.name));
            return parsed.directions.slice(0, 4);
        }
    }

    console.log(`🧠 [AI Art Director] Prompting Gemini Flash for visual directions...`);
    const parsed = await callGeminiFlashJson({
        systemPrompt: SYSTEM_PROMPT,
        messages: [
            { role: 'user', content: `Game Title: ${gameTitle || 'Untitled Game'}\nGame Concept: ${prompt}${assetContext}` },
        ],
        temperature: 0.7,
        maxTokens: 1500,
    });

    if (parsed && Array.isArray(parsed.directions) && parsed.directions.length >= 4) {
        console.log(`✅ [AI Art Director] Gemini conceptualized 4 directions:`, parsed.directions.map(d => d.name));
        return parsed.directions.slice(0, 4);
    }

    throw new Error(`Gemini failed to return 4 visual directions for "${prompt}"`);
}

function inferThemeType(name = '', modifier = '') {
    const combined = `${name} ${modifier}`.toLowerCase();
    if (/coral|reef|pink.*sea|tropical.*fish/i.test(combined)) return 'coral';
    if (/abyss|deep.*ocean|trench|sapphire/i.test(combined)) return 'ocean';
    if (/marine|cartoon.*fish|aquatic|aquarium/i.test(combined)) return 'marine';
    if (/atlantis|sunken.*palace|golden.*temple/i.test(combined)) return 'atlantis';
    if (/cyber|neon|synth|hologram|tokyo|glitch|future/i.test(combined)) return 'cyber';
    if (/void|space|cosm|galaxy|planet|orbit|nebula|star/i.test(combined)) return 'void';
    if (/arcade|pixel|16-bit|8-bit|retro|voxel/i.test(combined)) return 'arcade';
    if (/sci-fi|mecha|station|laser|tech/i.test(combined)) return 'scifi';
    if (/fantasy|citadel|castle|medieval|knight|magic/i.test(combined)) return 'fantasy';
    if (/forest|grove|nature|mushroom|wood|plant/i.test(combined)) return 'nature';
    if (/dark|gothic|shadow|horror|spooky|vampire|skull/i.test(combined)) return 'dark';
    if (/celestial|sun|ethereal|radiant|angel|cloud/i.test(combined)) return 'celestial';
    return 'arcade';
}

/**
 * Main Entry Point: Direct 4 visual styles and generate concept art
 * Fully unified pipeline: Hermes conceptualizes the directions AND fires all 4 image_generate
 * tool calls in parallel to OpenAI (gpt-image-2.5-flare), then uploads the results to Cloudflare R2.
 */
export async function directVisualDirections({ prompt, gameTitle = 'Game', selectedAssets = [] }) {
    if (!prompt) throw new Error('Prompt is required');

    console.log(`✨ [AI Art Director] Hermes directing styles & firing parallel image generation for: "${prompt}" (Title: ${gameTitle}, Assets: ${selectedAssets?.length || 0})`);

    let assetContext = '';
    if (Array.isArray(selectedAssets) && selectedAssets.length > 0) {
        assetContext = '\nActive Game Assets:\n' + selectedAssets.map(a => `- ${a.role || a.type || 'asset'}: ${a.label || a.title || a.url}`).join('\n');
    }

    const runStartTime = Date.now();

    const hermesPrompt = `${SYSTEM_PROMPT}

Game Title: ${gameTitle || 'Untitled Game'}
Game Concept: ${prompt}${assetContext}

TASK:
1. Conceptualize exactly 4 DISTINCT, CREATIVE, and VISUALLY COMPELLING art directions tailored SPECIFICALLY to this game concept and its assets.
2. For EACH of the 4 directions, IMMEDIATELY call your \`image_generate\` tool to generate an authentic in-game screenshot preview card (1024x1024, 1:1 aspect ratio). You MUST issue all 4 \`image_generate\` tool calls concurrently in parallel in a single turn so they generate simultaneously.
   - Craft a detailed visual prompt for each card: e.g. "In-game screenshot, playable video game viewport, authentic game HUD, game engine render of ${prompt}, <style details>, 1:1 square ratio, crisp game UI, clean graphics".
3. Return a JSON object with a "directions" array containing the 4 directions:
   - "name": Style title (e.g. "Hyper-Stylized Comic Noir")
   - "tagline": Short punchy hook
   - "description": 1-2 sentence aesthetic summary
   - "modifier": Visual prompt modifier
   - "colors": Array of 3-4 hex color codes
   - "themeType": One of "cyberpunk", "fantasy", "retro", "noir", "neon", "celestial", "arcade"
   - "image_path": The exact file path of the image generated by your image_generate tool
`;

    // 1. Execute Hermes Agent with image_gen and file toolsets enabled
    const hermesOutput = await executeHermesAgent(hermesPrompt, {
        toolsets: 'image_gen,file',
    });

    const parsed = extractJsonFromHermes(hermesOutput);
    if (!parsed || !Array.isArray(parsed.directions) || parsed.directions.length < 4) {
        throw new Error(`Hermes failed to conceptualize 4 directions. Raw output: ${hermesOutput?.slice(0, 300)}`);
    }

    // 2. Locate generated images in Hermes cache
    const generatedImages = getHermesGeneratedImagesSince(runStartTime);
    console.log(`🖼️ [AI Art Director] Hermes generated ${generatedImages.length} images in cache`);

    // 3. Upload each generated image to Cloudflare R2 and construct card objects
    const directions = await Promise.all(parsed.directions.slice(0, 4).map(async (dir, index) => {
        let localPath = dir.image_path || generatedImages[index] || null;
        let imageUrl = null;

        if (localPath) {
            imageUrl = await uploadLocalImageFileToR2(localPath, 'visual-directions');
            console.log(`☁️ [AI Art Director] Uploaded Hermes image to R2 (${dir.name}): ${imageUrl}`);
        }

        if (!imageUrl) {
            throw new Error(`Failed to generate or upload preview image for direction "${dir.name}"`);
        }

        const themeType = dir.themeType || inferThemeType(dir.name, dir.modifier);

        return {
            id: `direction-${Date.now()}-${index + 1}`,
            name: dir.name,
            tagline: dir.tagline || 'Visual Direction',
            description: dir.description || `A stylized interpretation of ${prompt} directed in ${dir.name.toLowerCase()} aesthetic.`,
            icon: dir.icon || 'sparkles',
            colors: dir.colors && dir.colors.length >= 3 ? dir.colors : ['#0F172A', '#38BDF8', '#818CF8', '#F43F5E'],
            instruction: dir.instruction || `Use a ${dir.name} visual aesthetic with cohesive colors and clean UI.`,
            modifier: dir.modifier,
            themeType,
            imageUrl,
        };
    }));

    return {
        success: true,
        prompt,
        gameTitle,
        directions,
    };
}

const PERSPECTIVE_SYSTEM_PROMPT = `You are a world-class Game Designer and Technical Camera Director.
The user has chosen a game concept, visual art direction, and optional assets.
Your task is to conceptualize camera perspectives tailored specifically to the game mechanics and active assets, and generate authentic in-game screenshot previews from each camera perspective.

CRITICAL DECISION & GENERATION RULES:
1. AUTO-LOCK PERSPECTIVE (requiresSelection = false):
   - Does the user's prompt ALREADY explicitly specify the camera angle (e.g. "first-person view", "top-down shooter", "side-scrolling platformer", "isometric builder")?
   - OR is this game an inherently fixed 2D / flat grid / board game (such as match-3, candy crush style, card games, sudoku, tile puzzles, 2D boards, flappy clones) where multi-angle 3D camera selection makes zero sense and would confuse the player?
   - In either case: set "requiresSelection": false, explain your reasoning in "reason", and provide the single locked perspective in "defaultPerspective".
   - Set "perspectives" to contain just that single perspective.
   - Do NOT call image_generate for locked perspectives; the mobile app skips the picker screen directly to building.

2. DYNAMIC PERSPECTIVE SELECTION (requiresSelection = true):
   - If the game is a dynamic 3D experience (such as 3D runners, driving/racing, flight simulators, arena brawlers, or 3D adventure) where multiple camera angles genuinely alter the gameplay experience:
   - Set "requiresSelection": true.
   - Invent exactly 4 DISTINCT, LOGICAL, and EXCITING camera perspectives tailored specifically to the game mechanics and active assets.
   - For EACH of the 4 perspectives, IMMEDIATELY call your \`image_generate\` tool to generate an authentic in-game screenshot preview card (1024x1024, 1:1 aspect ratio) showing the game rendered from that specific camera angle.
   - You MUST issue all 4 \`image_generate\` tool calls concurrently in parallel in a single turn so they generate simultaneously.
   - Craft a detailed visual prompt for each: "In-game screenshot, playable video game viewport, authentic game HUD, game engine render of <prompt> viewed from <camera angle details>, rendered in <chosen style>, 1:1 square ratio, crisp game UI".

3. PERSPECTIVE SPECIFICATIONS:
   - Each perspective must specify its dimension: "2D", "2.5D", or "3D".
   - cameraInstruction MUST be exact technical instructions for setting up the camera in the game engine.
   - image_path MUST be the exact file path of the image generated by your image_generate tool (or null if requiresSelection is false).

You MUST respond with valid JSON strictly matching this schema:
{
  "requiresSelection": boolean,
  "reason": "Detailed reasoning on why perspective was locked or why multiple choices are offered",
  "defaultPerspective": {
    "name": "Perspective Name",
    "tagline": "2-3 word punchy tagline",
    "dimension": "2D" | "2.5D" | "3D",
    "icon": "Ionicons icon name: eye | airplane | walk | cube | videocam | grid",
    "cameraInstruction": "Technical camera setup details for game runtime",
    "modifier": "camera angle description for in-game screenshot render"
  },
  "perspectives": [
    {
      "name": "Perspective Name",
      "tagline": "2-3 word punchy tagline",
      "dimension": "2D" | "2.5D" | "3D",
      "icon": "Ionicons icon name",
      "cameraInstruction": "Technical camera setup details for game runtime",
      "modifier": "camera angle description for in-game screenshot render",
      "image_path": "path to generated image or null"
    }
  ]
}`;

/**
 * Step 2: Direct camera perspectives tailored to the game, chosen style, and assets
 * Fully unified pipeline: Hermes conceptualizes the perspectives AND fires parallel image_generate
 * tool calls to OpenAI (gpt-image-2.5-flare) ONLY when dynamic selection is needed (4 choices).
 */
export async function directPerspectives({ prompt, gameTitle = 'Game', selectedDirection, selectedAssets = [] }) {
    if (!prompt) throw new Error('Prompt is required');

    const styleName = selectedDirection?.name || 'Selected Visual Style';
    const styleModifier = selectedDirection?.modifier || '';

    console.log(`🎥 [Camera Perspective] Hermes directing perspectives for: "${prompt}" (Style: ${styleName})`);

    let assetContext = '';
    if (Array.isArray(selectedAssets) && selectedAssets.length > 0) {
        assetContext = '\nActive Game Assets:\n' + selectedAssets.map(a => `- ${a.role || a.type}: ${a.label || a.title || a.url}`).join('\n') + '\nFrame camera perspectives around these active assets.';
    }

    const runStartTime = Date.now();

    const hermesPrompt = `${PERSPECTIVE_SYSTEM_PROMPT}

Game Title: ${gameTitle || 'Untitled Game'}
Game Concept: ${prompt}
Chosen Art Direction: ${styleName}
Style Details: ${styleModifier}${assetContext}

TASK:
1. Determine whether camera perspective selection is required or locked.
2. If requiresSelection is TRUE: IMMEDIATELY call your \`image_generate\` tool 4 times concurrently in parallel to generate an in-game screenshot preview representing each of the 4 camera viewports (1024x1024, 1:1 aspect ratio).
3. If requiresSelection is FALSE: Do NOT generate images (the app skips the selection screen directly to game building).
4. Return the JSON matching the schema.
`;

    // Execute Hermes Agent with image_gen and file toolsets enabled
    const hermesOutput = await executeHermesAgent(hermesPrompt, {
        toolsets: 'image_gen,file',
    });

    const parsed = extractJsonFromHermes(hermesOutput);
    if (!parsed) {
        throw new Error(`Hermes failed to evaluate camera perspectives. Raw output: ${hermesOutput?.slice(0, 300)}`);
    }

    // If camera perspective is auto-locked, skip image generation and return immediately
    if (parsed.requiresSelection === false && parsed.defaultPerspective) {
        console.log(`🎥 [Camera Perspective] Perspective auto-locked (${parsed.defaultPerspective.name}): ${parsed.reason}. Skipping image generation.`);
        const locked = {
            id: `perspective-${Date.now()}-locked`,
            name: parsed.defaultPerspective.name,
            tagline: parsed.defaultPerspective.tagline || 'Direct View',
            dimension: parsed.defaultPerspective.dimension || '2D',
            icon: parsed.defaultPerspective.icon || 'grid',
            cameraInstruction: parsed.defaultPerspective.cameraInstruction || 'Fixed camera setup',
            modifier: parsed.defaultPerspective.modifier || 'gameplay viewport',
            imageUrl: selectedDirection?.imageUrl || null,
        };

        return {
            success: true,
            requiresSelection: false,
            reason: parsed.reason,
            defaultPerspective: locked,
            perspectives: [locked],
            prompt,
            gameTitle,
            selectedDirection,
        };
    }

    // Locate generated images in Hermes cache
    const generatedImages = getHermesGeneratedImagesSince(runStartTime);
    console.log(`🖼️ [Camera Perspective] Hermes generated ${generatedImages.length} perspective images in cache`);

    if (!Array.isArray(parsed.perspectives) || parsed.perspectives.length < 4) {
        throw new Error(`Hermes failed to conceptualize 4 camera perspectives for "${prompt}"`);
    }

    const perspectives = await Promise.all(parsed.perspectives.slice(0, 4).map(async (p, index) => {
        let localPath = p.image_path || generatedImages[index] || null;
        let imageUrl = null;
        if (localPath) {
            imageUrl = await uploadLocalImageFileToR2(localPath, 'camera-perspectives');
            console.log(`☁️ [Camera Perspective] Uploaded Hermes perspective image to R2 (${p.name}): ${imageUrl}`);
        }

        if (!imageUrl) {
            throw new Error(`Failed to generate or upload preview image for perspective "${p.name}"`);
        }

        return {
            id: `perspective-${Date.now()}-${index + 1}`,
            name: p.name,
            tagline: p.tagline || 'Camera Perspective',
            dimension: p.dimension || '3D',
            icon: p.icon || 'videocam',
            cameraInstruction: p.cameraInstruction || `Set camera rig to ${p.name}`,
            modifier: p.modifier,
            imageUrl,
        };
    }));

    return {
        success: true,
        prompt,
        gameTitle,
        selectedDirection,
        perspectives,
    };
}

