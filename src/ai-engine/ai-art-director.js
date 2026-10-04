/**
 * AI Art Director
 * 
 * Dynamically conceptualizes 4 tailored visual art directions for ANY game prompt.
 * Uses Hermes Agent powered by Gemini 3.8 Flash to conceptualize directions and
 * render high-fidelity concept art screenshot cards.
 */

import fs from 'fs';
import { executeHermesAgent, extractJsonFromHermes, uploadLocalImageFileToR2, getHermesGeneratedImagesSince } from './official-hermes-client.js';
import { callGeminiFlashJson } from './gemini-client.js';
import { generateConceptCardImage } from './openai-image-client.js';
import { recordImageGeneration, recordGeminiUsage } from './token-tracker.js';

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
- CONTENT SAFETY FOR VISUAL PROMPTS: Keep all visual style descriptions and modifiers strictly PG-13 / game-safe. NEVER use explicit violence, stabbing, spear impalement, blood, decapitation, or graphic gore. Describe heroic character standoffs, energy construct clashes, martial arts poses, and stylized particle effects so image generators process them without safety filter rejections.
- PERSPECTIVE AUTONOMY (HERMES SKILL):
  You must autonomously evaluate whether this game concept needs user camera perspective selection (requiresPerspectiveSelection: true) or has an inherent fixed view (requiresPerspectiveSelection: false):
  - Set requiresPerspectiveSelection to FALSE if the game mechanics operate on a fixed flat 2D plane or fixed vantage point (e.g. Match-3 / Candy Crush, tile puzzles, card/deck games, tabletop board games, trivia, word games, or explicit 2D platformers). In this case, provide the optimal defaultPerspective.
  - Set requiresPerspectiveSelection to TRUE if the game features 3D navigation, spatial depth, racing, action, or where camera perspective fundamentally changes the gameplay experience.

You MUST respond with valid JSON strictly matching this schema:
{
  "requiresPerspectiveSelection": true,
  "perspectiveRationale": "Clear explanation of whether camera selection is needed or if the game has an inherent fixed view",
  "defaultPerspective": {
    "name": "Top-Down 2D Grid",
    "dimension": "2D",
    "cameraInstruction": "Fixed top-down orthographic camera focused directly on the 2D playfield",
    "modifier": "top-down 2D view"
  },
  "directions": [
    {
      "name": "Creative Style Title (e.g. 16-Bit Neo Pixel)",
      "tagline": "2-3 word punchy tagline (e.g. Crisp & Retro)",
      "icon": "Ionicons icon name: sparkles | color-palette | flame | water | paw | leaf | flash | shapes-outline | rocket | game-controller | heart | skull | car | planet | bulb",
      "colors": ["#hex1", "#hex2", "#hex3", "#hex4"],
      "modifier": "visual concept preview of playable video game, authentic HUD, crisp rendering, high visual fidelity",
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
 * Visual style concept card generator using OpenAI gpt-image-2.5-flare.
 * NO FALLBACKS: If image generation fails, logs error and returns null.
 */
async function generateConceptCard({ prompt, styleName, prefix = 'visual-directions' }) {
    const imagePrompt = `Video game visual concept preview, ${prompt}, art style: ${styleName}, clean UI HUD mockup, 1:1 aspect ratio, high visual fidelity`;
    try {
        const imgRes = await generateConceptCardImage({
            prompt: imagePrompt,
            size: '1024x1024',
            prefix,
        });
        return imgRes?.imageUrl || null;
    } catch (err) {
        console.error(`❌ [Concept Card Gen] Image generation failed (${err.message}) for "${styleName}"`);
        return null;
    }
}

/**
 * Main Entry Point: Direct 4 visual styles and generate concept art
 * Fully unified pipeline: Hermes conceptualizes the directions AND fires all 4 image_generate
 * tool calls in parallel to OpenAI (gpt-image-2.5-flare), then uploads the results to Cloudflare R2.
 */
export async function directVisualDirections({ prompt, gameTitle = 'Game', selectedAssets = [], onProgress, sessionId }) {
    if (!prompt) throw new Error('Prompt is required');

    onProgress?.({ step: 0, phase: 'analyzing', message: 'Analyzing your game idea and core vision...' });

    console.log(`✨ [AI Art Director] Hermes directing styles & firing parallel image generation for: "${prompt}" (Title: ${gameTitle}, Assets: ${selectedAssets?.length || 0}${sessionId ? `, Session: ${sessionId}` : ''})`);

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
            sessionId,
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
            jobId: sessionId,
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
            if (sessionId) recordImageGeneration(sessionId, 1);
        }

        // If Hermes didn't generate image or localPath is missing, generate concept card via OpenAI
        if (!imageUrl) {
            console.log(`🎨 [AI Art Director] Generating concept preview card for "${dir.name}"...`);
            imageUrl = await generateConceptCard({
                prompt,
                styleName: `${dir.name} - ${dir.modifier || ''}`,
                prefix: 'visual-directions',
            });
            if (imageUrl) {
                console.log(`✅ [AI Art Director] Successfully acquired preview card for "${dir.name}": ${imageUrl}`);
                if (sessionId) recordImageGeneration(sessionId, 1);
            } else {
                console.error(`❌ [AI Art Director] Failed to acquire preview card for "${dir.name}"`);
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

    // Hermes Agent's autonomous determination
    let requiresPerspectiveSelection = true;
    let perspectiveRationale = '';
    let defaultPerspective = null;

    if (parsed && typeof parsed.requiresPerspectiveSelection === 'boolean') {
        requiresPerspectiveSelection = parsed.requiresPerspectiveSelection;
        perspectiveRationale = parsed.perspectiveRationale || '';
        defaultPerspective = parsed.defaultPerspective || null;
    } else {
        const isFixed = isFixedPerspectiveGame(prompt, gameTitle, selectedAssets);
        requiresPerspectiveSelection = !isFixed;
        perspectiveRationale = isFixed ? 'Game mechanics operate on a fixed 2D viewport.' : 'Game benefits from user camera angle selection.';
    }

    if (!requiresPerspectiveSelection && !defaultPerspective) {
        defaultPerspective = {
            id: 'perspective-fixed-2d-1',
            name: 'Top-Down 2D Grid',
            tagline: 'Direct Overhead',
            dimension: '2D',
            icon: 'grid',
            cameraInstruction: 'Fixed 2D top-down camera with centered viewport',
            modifier: 'top-down 2D view',
            imageUrl: directions[0]?.imageUrl || null,
        };
    }

    return {
        success: true,
        prompt,
        gameTitle,
        requiresPerspectiveSelection,
        perspectiveRationale,
        defaultPerspective,
        directions,
    };
}

/**
 * Determine if a game concept is inherently 2D or has a fixed camera perspective
 * (e.g. Candy Crush, Match-3, 2D platformer, card games, puzzles).
 * These games DO NOT need a separate 3D camera perspective picker or extra image generation!
 */
export function isFixedPerspectiveGame(prompt = '', gameTitle = '', selectedAssets = []) {
    const text = `${prompt} ${gameTitle}`.toLowerCase();
    const fixedPatterns = [
        /match[-\s]?3/i,
        /candy[-\s]?crush/i,
        /grid[-\s]?puzzle/i,
        /tile[-\s]?(match|puzzle|connect)/i,
        /tetris/i,
        /2048/i,
        /flappy/i,
        /side[-\s]?scroll/i,
        /2d\s+(platform|runner|shooter|fighter|arcade|game)/i,
        /platformer/i,
        /doodle[-\s]?jump/i,
        /card[-\s]?(game|deck|battle)/i,
        /solitaire|poker|blackjack/i,
        /board[-\s]?game/i,
        /chess|checkers/i,
        /trivia|wordle|word[-\s]?game|crossword/i,
        /top[-\s]?down\s+2d/i,
        /tower[-\s]?defense/i,
        /clicker|idle[-\s]?game|tap[-\s]?game/i,
        /visual[-\s]?novel/i,
        /bubble[-\s]?shooter/i,
        /brick[-\s]?breaker|breakout|pong/i,
    ];
    return fixedPatterns.some(pattern => pattern.test(text));
}

const PERSPECTIVE_SYSTEM_PROMPT = `You are a world-class Game Designer and Technical Camera Director.
The user has chosen a game concept, visual art direction, and optional assets.
Your task is to invent exactly 4 DISTINCT, CREATIVE, and LOGICAL camera perspectives tailored specifically to this game concept and rendered in the chosen visual art style.

RULES:
1. Conceptualize exactly 4 distinct camera angles appropriate to the game (e.g. Dynamic Third-Person, Top-Down Aerial, Immersive First-Person, Isometric 3/4 Angle, Side-Scrolling 2.5D, Cinematic Fixed Angle, Orbit Cam).
2. For EACH perspective, craft a visual modifier describing the camera placement, lens angle, and composition constraints. The camera angle description MUST lead with explicit camera placement (e.g. 'tight over-the-shoulder third-person camera positioned directly behind the hero's back and shoulder looking forward toward the opponent', 'aerial top-down bird's-eye camera looking straight down at the ground arena floor', 'dramatic low-angle Dutch-tilt 3D action camera looking up from floor level', 'side-profile horizontal 2.5D tracking camera'). DO NOT use generic side-view standoff compositions for all angles. Each perspective MUST have a completely distinct camera coordinate and viewpoint!
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
 * 
 * SMART BYPASS: For 2D/grid/puzzle games, instantly returns fixed 2D perspectives anchored
 * to the selected visual style image without firing a second round of image generation!
 */
export async function directPerspectives({ prompt, gameTitle = 'Game', selectedDirection, selectedAssets = [], onProgress, sessionId, requiresPerspectiveSelection }) {
    if (!prompt) throw new Error('Prompt is required');

    const anchorImage = selectedDirection?.imageUrl || null;
    const isFixed = requiresPerspectiveSelection === false || isFixedPerspectiveGame(prompt, gameTitle, selectedAssets);

    if (isFixed) {
        console.log(`⏩ [Camera Perspective] Fixed 2D perspective confirmed for "${prompt}". Bypassing second generation cycle!`);
        onProgress?.({ step: 1, phase: 'camera_rigs', message: 'Configuring fixed 2D viewport...' });
        onProgress?.({ step: 3, phase: 'ready', message: 'Camera perspective locked for 2D gameplay!' });

        const fixedPerspectives = [
            {
                id: `perspective-fixed-2d-1`,
                name: 'Top-Down 2D View',
                tagline: 'Direct Overhead',
                dimension: '2D',
                icon: 'grid',
                cameraInstruction: 'Fixed 2D top-down camera with centered viewport',
                modifier: 'top-down 2D view',
                imageUrl: anchorImage,
            },
            {
                id: `perspective-fixed-2d-2`,
                name: 'Classic Arcade 2D',
                tagline: 'Clean Viewport',
                dimension: '2D',
                icon: 'tablet-landscape',
                cameraInstruction: 'Full-screen 2D orthogonal playfield',
                modifier: 'classic arcade 2D view',
                imageUrl: anchorImage,
            },
            {
                id: `perspective-fixed-2d-3`,
                name: 'Isometric 2.5D Angle',
                tagline: 'Subtle Depth',
                dimension: '2.5D',
                icon: 'cube',
                cameraInstruction: 'Tilted 30-degree isometric view with depth parallax',
                modifier: 'isometric 2.5D view',
                imageUrl: anchorImage,
            },
            {
                id: `perspective-fixed-2d-4`,
                name: 'Dynamic Zoom 2D',
                tagline: 'Action Focused',
                dimension: '2D',
                icon: 'scan',
                cameraInstruction: 'Reactive 2D camera with subtle screen zoom on matches and combos',
                modifier: 'dynamic zoom 2D view',
                imageUrl: anchorImage,
            },
        ];

        return {
            success: true,
            prompt,
            gameTitle,
            selectedDirection,
            requiresPerspectiveSelection: false,
            perspectives: fixedPerspectives,
            selectedPerspective: fixedPerspectives[0],
        };
    }

    onProgress?.({ step: 0, phase: 'analyzing', message: 'Analyzing gameplay space & movement...' });

    const styleName = selectedDirection?.name || 'Selected Visual Style';
    const styleModifier = selectedDirection?.modifier || '';

    console.log(`🎥 [Camera Perspective] Hermes directing 4 perspectives for: "${prompt}" (Style: ${styleName}${sessionId ? `, Session: ${sessionId}` : ''})`);

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
            sessionId,
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
            jobId: sessionId,
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
            if (sessionId) recordImageGeneration(sessionId, 1);
        }

        // If Hermes didn't generate image or localPath is missing, generate perspective preview card via OpenAI
        if (!imageUrl) {
            console.log(`🎨 [Camera Perspective] Generating perspective preview card for "${p.name}"...`);
            const colorHint = selectedDirection?.colors?.length ? ` Palette: ${selectedDirection.colors.join(', ')}.` : '';
            const styleDetails = selectedDirection?.instruction || selectedDirection?.modifier || '';
            const cameraLead = p.modifier || p.cameraInstruction || p.name;
            const perspectivePrompt = `Authentic in-game screenshot viewed from ${cameraLead}, ${p.name} camera perspective showing ${prompt}, rendered in ${styleName} visual style (${styleDetails}), matching camera viewport with authentic HUD elements, 1:1 aspect ratio, crisp 3D fidelity${colorHint}`;
            imageUrl = await generateConceptCardImage({
                prompt: perspectivePrompt,
                size: '1024x1024',
                prefix: 'camera-perspectives',
            }).then(r => r?.imageUrl).catch(err => {
                console.error(`❌ [Camera Perspective] Error generating card for "${p.name}":`, err?.message);
                return null;
            });
            if (!imageUrl && anchorImage) {
                console.log(`🖼️ [Camera Perspective] Anchoring to chosen visual style image for "${p.name}"`);
                imageUrl = anchorImage;
            }
            if (imageUrl) {
                console.log(`✅ [Camera Perspective] Successfully acquired preview card for "${p.name}": ${imageUrl}`);
                if (sessionId) recordImageGeneration(sessionId, 1);
            } else {
                console.error(`❌ [Camera Perspective] Failed to acquire preview card for "${p.name}"`);
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

