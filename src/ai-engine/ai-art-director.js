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

import fs from 'fs';
import { executeHermesAgent, extractJsonFromHermes, uploadLocalImageFileToR2, getHermesGeneratedImagesSince } from './official-hermes-client.js';
import { callGeminiFlashJson } from './gemini-client.js';
import { generateGameScreenshotImage, uploadBufferToR2 } from './openai-image-client.js';
import { generateFluxImage } from './nvidia-flux-client.js';

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
export async function directVisualDirections({ prompt, gameTitle = 'Game', selectedAssets = [], onProgress }) {
    if (!prompt) throw new Error('Prompt is required');

    onProgress?.({ step: 0, phase: 'analyzing', message: 'Analyzing your game idea and core vision...' });

    console.log(`✨ [AI Art Director] Hermes directing styles & firing parallel image generation for: "${prompt}" (Title: ${gameTitle}, Assets: ${selectedAssets?.length || 0})`);

    let assetContext = '';
    if (Array.isArray(selectedAssets) && selectedAssets.length > 0) {
        assetContext = '\nActive Game Assets:\n' + selectedAssets.map(a => `- ${a.role || a.type || 'asset'}: ${a.label || a.title || a.url}`).join('\n');
    }

    const runStartTime = Date.now();

    onProgress?.({ step: 1, phase: 'mechanics', message: 'Exploring game mechanics, core systems, and platforms...' });

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

    onProgress?.({ step: 2, phase: 'directions', message: 'Hermes is brainstorming 4 unique visual art directions...' });

    // 1. Try official Nous Research Hermes Agent first
    let parsed = null;
    try {
        const hermesOutput = await executeHermesAgent(hermesPrompt, {
            toolsets: 'image_gen,file',
        });
        parsed = extractJsonFromHermes(hermesOutput);
    } catch (hermesErr) {
        console.warn(`⚠️ [AI Art Director] Hermes Agent CLI: ${hermesErr.message}, conceptualizing with Gemini Flash...`);
    }

    if (!parsed || !Array.isArray(parsed.directions) || parsed.directions.length < 4) {
        console.log(`🧠 [AI Art Director] Prompting Gemini Flash for visual directions...`);
        parsed = await callGeminiFlashJson({
            systemPrompt: SYSTEM_PROMPT,
            messages: [
                { role: 'user', content: `Game Title: ${gameTitle || 'Untitled Game'}\nGame Concept: ${prompt}${assetContext}\n\nRespond with valid JSON containing 4 distinct visual directions strictly matching the schema.` },
            ],
            temperature: 0.7,
            maxTokens: 1500,
        });
    }

    if (!parsed || !Array.isArray(parsed.directions) || parsed.directions.length < 4) {
        throw new Error(`AI Art Director failed to conceptualize 4 directions for "${prompt}"`);
    }

    // 2. Locate generated images in Hermes cache
    const generatedImages = getHermesGeneratedImagesSince(runStartTime);
    console.log(`🖼️ [AI Art Director] Found ${generatedImages.length} images in Hermes cache`);

    onProgress?.({ step: 3, phase: 'assets', message: 'Synthesizing concept art and visual preview cards...' });

    // 3. Upload each generated image to Cloudflare R2 and construct card objects
    const directions = await Promise.all(parsed.directions.slice(0, 4).map(async (dir, index) => {
        let localPath = dir.image_path || generatedImages[index] || null;
        let imageUrl = null;

        if (localPath && fs.existsSync(localPath)) {
            imageUrl = await uploadLocalImageFileToR2(localPath, 'visual-directions');
            console.log(`☁️ [AI Art Director] Uploaded Hermes image to R2 (${dir.name}): ${imageUrl}`);
        }

        // If Hermes didn't generate image or localPath is missing, generate real in-game screenshot via OpenAI / Flux
        if (!imageUrl) {
            console.log(`🎨 [AI Art Director] Generating real concept screenshot for "${dir.name}"...`);
            const imagePrompt = `In-game screenshot of playable video game, authentic game HUD, ${prompt}, ${dir.modifier || dir.name}, crisp rendering, 1:1 aspect ratio, high visual fidelity`;
            try {
                const imgRes = await generateGameScreenshotImage({
                    prompt: imagePrompt,
                    size: '1024x1024',
                    prefix: 'visual-directions',
                });
                imageUrl = imgRes.imageUrl;
            } catch (imgErr) {
                console.warn(`⚠️ [OpenAI Image] failed (${imgErr.message}), generating with Flux...`);
                try {
                    const fluxRes = await generateFluxImage({ prompt: imagePrompt });
                    imageUrl = await uploadBufferToR2(fluxRes.buffer, 'visual-directions', 'image/png');
                } catch (fluxErr) {
                    console.error(`❌ [Image Generation] All image providers failed for "${dir.name}":`, fluxErr.message);
                }
            }
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

    onProgress?.({ step: 4, phase: 'ready', message: 'All set! Choose your visual direction to begin building.' });

    return {
        success: true,
        prompt,
        gameTitle,
        directions,
    };
}

const PERSPECTIVE_SYSTEM_PROMPT = `You are a world-class Game Designer and Technical Camera Director.
The user has chosen a game concept, visual art direction, and optional assets.
Your task is to invent exactly 4 DISTINCT, CREATIVE, and LOGICAL camera perspectives tailored specifically to this game concept and rendered in the chosen visual art style.

RULES:
1. Conceptualize exactly 4 distinct camera angles appropriate to the game (e.g. Dynamic Third-Person, Top-Down Aerial, Immersive First-Person, Isometric 3/4 Angle, Side-Scrolling 2.5D, Cinematic Fixed Angle, Orbit Cam).
2. For EACH perspective, craft a visual prompt describing an authentic in-game screenshot from that exact camera angle in the chosen visual style.
3. Specify the dimension ("2D", "2.5D", or "3D") and exact technical cameraInstruction for setting up the camera in the game engine.

You MUST respond with valid JSON strictly matching this schema:
{
  "perspectives": [
    {
      "name": "Perspective Name (e.g. Dynamic Third-Person)",
      "tagline": "2-3 word punchy tagline (e.g. Behind Hero)",
      "dimension": "2D" | "2.5D" | "3D",
      "icon": "Ionicons icon name: eye | airplane | walk | cube | videocam | grid | navigate | telescope",
      "cameraInstruction": "Technical camera setup details for game runtime",
      "modifier": "camera angle description for in-game screenshot render"
    }
  ]
}`;

/**
 * Step 2: Direct camera perspectives tailored to the game, chosen style, and assets
 * Fully unified pipeline: Hermes conceptualizes 4 camera perspective angles in the chosen visual style
 * and generates authentic in-game screenshot previews from each camera perspective.
 */
export async function directPerspectives({ prompt, gameTitle = 'Game', selectedDirection, selectedAssets = [], onProgress }) {
    if (!prompt) throw new Error('Prompt is required');

    onProgress?.({ step: 0, phase: 'analyzing', message: 'Analyzing gameplay space & movement...' });

    const styleName = selectedDirection?.name || 'Selected Visual Style';
    const styleModifier = selectedDirection?.modifier || '';

    console.log(`🎥 [Camera Perspective] Hermes directing 4 perspectives for: "${prompt}" (Style: ${styleName})`);

    let assetContext = '';
    if (Array.isArray(selectedAssets) && selectedAssets.length > 0) {
        assetContext = '\nActive Game Assets:\n' + selectedAssets.map(a => `- ${a.role || a.type}: ${a.label || a.title || a.url}`).join('\n') + '\nFrame camera perspectives around these active assets.';
    }

    const runStartTime = Date.now();

    onProgress?.({ step: 1, phase: 'camera_rigs', message: `Styling camera rigs for ${styleName}...` });

    const hermesPrompt = `${PERSPECTIVE_SYSTEM_PROMPT}

Game Title: ${gameTitle || 'Untitled Game'}
Game Concept: ${prompt}
Chosen Art Direction: ${styleName}
Style Details: ${styleModifier}${assetContext}

TASK:
1. Conceptualize exactly 4 DISTINCT, EXCITING camera perspectives tailored specifically to this game concept and its chosen visual art style.
2. For EACH of the 4 perspectives, IMMEDIATELY call your \`image_generate\` tool 4 times concurrently in parallel to generate an in-game screenshot preview representing each of the 4 camera viewports (1024x1024, 1:1 aspect ratio) showing the game rendered from that specific camera angle in ${styleName}.
3. Return the JSON matching the schema with 4 perspectives.
`;

    // 1. Try official Nous Research Hermes Agent first
    let parsed = null;
    try {
        const hermesOutput = await executeHermesAgent(hermesPrompt, {
            toolsets: 'image_gen,file',
        });
        parsed = extractJsonFromHermes(hermesOutput);
    } catch (hermesErr) {
        console.warn(`⚠️ [Camera Perspective] Hermes Agent CLI: ${hermesErr.message}, conceptualizing with Gemini Flash...`);
    }

    if (!parsed || !Array.isArray(parsed.perspectives) || parsed.perspectives.length < 4) {
        console.log(`🧠 [Camera Perspective] Directing camera perspectives via Gemini Flash...`);
        parsed = await callGeminiFlashJson({
            systemPrompt: PERSPECTIVE_SYSTEM_PROMPT,
            messages: [
                { role: 'user', content: `Game Title: ${gameTitle || 'Untitled Game'}\nGame Concept: ${prompt}\nChosen Art Direction: ${styleName}\nStyle Details: ${styleModifier}${assetContext}\n\nRespond with valid JSON containing 4 distinct camera perspectives.` },
            ],
            temperature: 0.7,
            maxTokens: 1500,
        });
    }

    if (!parsed || !Array.isArray(parsed.perspectives) || parsed.perspectives.length < 4) {
        throw new Error(`AI Camera Director failed to evaluate 4 camera perspectives for "${prompt}"`);
    }

    onProgress?.({ step: 2, phase: 'rendering', message: 'Rendering in-game screenshot angles with GPT Image...' });

    // Locate generated images in Hermes cache
    const generatedImages = getHermesGeneratedImagesSince(runStartTime);
    console.log(`🖼️ [Camera Perspective] Found ${generatedImages.length} perspective images in Hermes cache`);

    if (!Array.isArray(parsed.perspectives) || parsed.perspectives.length < 4) {
        throw new Error(`Camera Director failed to conceptualize 4 camera perspectives for "${prompt}"`);
    }

    const perspectives = await Promise.all(parsed.perspectives.slice(0, 4).map(async (p, index) => {
        let localPath = p.image_path || generatedImages[index] || null;
        let imageUrl = null;
        if (localPath && fs.existsSync(localPath)) {
            imageUrl = await uploadLocalImageFileToR2(localPath, 'camera-perspectives');
            console.log(`☁️ [Camera Perspective] Uploaded Hermes perspective image to R2 (${p.name}): ${imageUrl}`);
        }

        // If Hermes didn't generate image or localPath is missing, generate real in-game screenshot via OpenAI / Flux
        if (!imageUrl) {
            console.log(`🎨 [Camera Perspective] Generating perspective screenshot for "${p.name}"...`);
            const imagePrompt = `In-game screenshot of playable video game, authentic game HUD, ${prompt}, viewed from ${p.name} camera perspective, ${styleName}, ${p.modifier || ''}, crisp 3D rendering, 1:1 aspect ratio`;
            try {
                const imgRes = await generateGameScreenshotImage({
                    prompt: imagePrompt,
                    size: '1024x1024',
                    prefix: 'camera-perspectives',
                });
                imageUrl = imgRes.imageUrl;
            } catch (imgErr) {
                console.warn(`⚠️ [OpenAI Image] failed (${imgErr.message}), generating with Flux...`);
                try {
                    const fluxRes = await generateFluxImage({ prompt: imagePrompt });
                    imageUrl = await uploadBufferToR2(fluxRes.buffer, 'camera-perspectives', 'image/png');
                } catch (fluxErr) {
                    console.error(`❌ [Image Generation] All image providers failed for "${p.name}":`, fluxErr.message);
                }
            }
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

    onProgress?.({ step: 3, phase: 'ready', message: 'Camera perspectives ready!' });

    return {
        success: true,
        prompt,
        gameTitle,
        selectedDirection,
        perspectives,
    };
}

