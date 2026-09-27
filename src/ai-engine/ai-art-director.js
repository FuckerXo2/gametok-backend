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

import OpenAI from 'openai';
import { getQwenConfig, createQwenClient } from './qwen-multimodal-client.js';
import { generateAndUploadFluxImage } from './nvidia-flux-client.js';
import { generateGameScreenshotImage } from './openai-image-client.js';
import { callGeminiFlashJson } from './gemini-client.js';

const SYSTEM_PROMPT = `You are a world-class Video Game Art Director.
The user will provide a game title and concept prompt.
Your task is to invent exactly 4 DISTINCT, CREATIVE, and VISUALLY COMPELLING art directions tailored SPECIFICALLY to that game concept.

Rules:
- NEVER output generic out-of-context styles or default to clay/cute styles unless the game explicitly asks for it.
- Each direction must feel like a genuine, thoughtful creative pitch for that exact game world.
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
 * Removed hardcoded regex archetypes. Directions must always be generated dynamically by Gemini 3.7 Flash.
 */

/**
 * Call LLM to invent 4 custom directions tailored specifically to the game
 */
async function callLLMForDirections(prompt, gameTitle) {
    // 1. Try Gemini 3.7 Flash first (ultra-fast, highly creative, reliable)
    try {
        console.log(`🧠 [AI Art Director] Prompting Gemini 3.7 Flash for visual directions...`);
        const parsed = await callGeminiFlashJson({
            systemPrompt: SYSTEM_PROMPT,
            messages: [
                { role: 'user', content: `Game Title: ${gameTitle || 'Untitled Game'}\nGame Concept: ${prompt}` },
            ],
            temperature: 0.7,
            maxTokens: 1500,
        });

        if (parsed && Array.isArray(parsed.directions) && parsed.directions.length >= 4) {
            console.log(`✅ [AI Art Director] Gemini 3.7 Flash conceptualized 4 directions:`, parsed.directions.map(d => d.name));
            return parsed.directions.slice(0, 4);
        }
    } catch (geminiErr) {
        console.warn(`⚠️ [AI Art Director] Gemini 3.7 Flash call failed, trying backup:`, geminiErr.message);
    }

    // 2. Try Qwen if configured
    const qwenConfig = getQwenConfig();
    if (qwenConfig) {
        try {
            console.log(`🧠 [AI Art Director] Prompting Qwen (${qwenConfig.model}) for visual directions...`);
            const client = createQwenClient();
            const response = await client.chat.completions.create({
                model: qwenConfig.model,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: `Game Title: ${gameTitle || 'Untitled Game'}\nGame Concept: ${prompt}` },
                ],
                temperature: 0.7,
                max_tokens: 1500,
            });

            const parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');
            if (Array.isArray(parsed.directions) && parsed.directions.length >= 4) {
                return parsed.directions.slice(0, 4);
            }
        } catch (err) {
            console.warn(`⚠️ [AI Art Director] Qwen call failed, trying backup:`, err.message);
        }
    }

    // 3. Try NVIDIA NIM LLM if NVIDIA_API_KEY is present
    const nvidiaKey = process.env.NVIDIA_API_KEY;
    if (nvidiaKey) {
        try {
            console.log(`🧠 [AI Art Director] Prompting NVIDIA NIM LLM for visual directions...`);
            const nimClient = new OpenAI({
                apiKey: nvidiaKey,
                baseURL: 'https://integrate.api.nvidia.com/v1',
                timeout: 10000,
            });

            const response = await nimClient.chat.completions.create({
                model: 'meta/llama-3.3-70b-instruct',
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: `Game Title: ${gameTitle || 'Untitled Game'}\nGame Concept: ${prompt}` },
                ],
                temperature: 0.7,
                max_tokens: 1500,
            });

            const parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');
            if (Array.isArray(parsed.directions) && parsed.directions.length >= 4) {
                return parsed.directions.slice(0, 4);
            }
        } catch (nimErr) {
            console.warn(`⚠️ [AI Art Director] NVIDIA NIM LLM failed:`, nimErr.message);
        }
    }

    throw new Error(`AI Art Director failed to generate visual directions dynamically for "${prompt}"`);
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
 */
export async function directVisualDirections({ prompt, gameTitle = 'Game' }) {
    if (!prompt) throw new Error('Prompt is required');

    console.log(`✨ [AI Art Director] Directing styles for: "${prompt}" (Title: ${gameTitle})`);

    // 1. LLM invents the 4 styles tailored specifically to the game
    const directionsPlan = await callLLMForDirections(prompt, gameTitle);

    // 2. Concurrently render in-game screenshot cards using OpenAI gpt-image-2.5-flare (Low/Fast quality)
    const directionPromises = directionsPlan.map(async (dir, index) => {
        const imagePrompt = `In-game screenshot, playable video game viewport, authentic game HUD, game engine render of ${prompt}, ${dir.modifier}, 1:1 square ratio, crisp game UI, clean graphics`;
        const themeType = dir.themeType || inferThemeType(dir.name, dir.modifier);
        
        let imageUrl = null;
        try {
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Image timeout')), 7500));
            const imgResult = await Promise.race([
                generateGameScreenshotImage({
                    prompt: imagePrompt,
                    size: '512x512',
                    quality: 'low',
                    prefix: 'visual-directions',
                }),
                timeoutPromise
            ]);

            if (imgResult?.imageUrl) {
                imageUrl = imgResult.imageUrl;
            }
        } catch (imgErr) {
            console.log(`ℹ️ [AI Art Director] Using dynamic styling for "${dir.name}" (${imgErr.message})`);
        }

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
    });

    const directions = await Promise.all(directionPromises);
    return {
        success: true,
        prompt,
        gameTitle,
        directions,
    };
}

const PERSPECTIVE_SYSTEM_PROMPT = `You are a world-class Game Designer and Technical Camera Director.
The user has chosen a game concept and a visual art direction.
Your task is to invent exactly 4 DISTINCT, LOGICAL, and EXCITING camera/view perspectives specifically tailored to this game genre and visual style.

Critical Rules:
- Analyze whether this game is naturally 2D, 2.5D, or 3D (e.g. Card battlers, 2D platformers, flappy birds, match-3 puzzles, roguelikes, 3D racers, space dogfights, FPS, etc.).
- NEVER suggest an irrelevant perspective (e.g. NEVER suggest a 3D chase cam for a flat 2D game or card game).
- For 2D games, provide perspectives like: "Classic Flat 2D Side-View", "2.5D Layered Parallax", "Dynamic Zoom Action Cam", "Vertical Scrolling Stage", "Tabletop Overhead", etc.
- For 3D or Isometric games, provide perspectives like: "Isometric 3/4 Dihedral", "Top-Down Tactical", "Third-Person Follow Cam", "First-Person Cockpit/POV", "Dynamic Cinematic Cam", etc.
- Each perspective must specify its dimension: "2D", "2.5D", or "3D".
- cameraInstruction MUST be exact technical instructions for the Three.js / Canvas2D / Metal engine on how to set up the camera.

You MUST respond with valid JSON strictly matching this schema:
{
  "perspectives": [
    {
      "name": "Perspective Name (e.g. Classic Flat 2D Side-View)",
      "tagline": "2-3 word punchy tagline (e.g. Pure Retro Readability)",
      "dimension": "2D",
      "icon": "eye",
      "cameraInstruction": "Technical camera setup details for game runtime",
      "modifier": "camera angle description for in-game screenshot render (e.g. flat horizontal side-scrolling 2D plane viewport)"
    }
  ]
}`;

/**
 * Step 2: Direct 4 camera perspectives tailored to the game and chosen style
 */
export async function directPerspectives({ prompt, gameTitle = 'Game', selectedDirection }) {
    if (!prompt) throw new Error('Prompt is required');

    const styleName = selectedDirection?.name || 'Selected Visual Style';
    const styleModifier = selectedDirection?.modifier || '';

    console.log(`🎥 [Camera Perspective] Generating 4 perspectives for "${prompt}" (Style: ${styleName})...`);

    const parsed = await callGeminiFlashJson({
        systemPrompt: PERSPECTIVE_SYSTEM_PROMPT,
        messages: [
            {
                role: 'user',
                content: `Game Title: ${gameTitle}\nGame Concept: ${prompt}\nChosen Art Direction: ${styleName}\nStyle Details: ${styleModifier}`,
            },
        ],
        temperature: 0.7,
        maxTokens: 1500,
    });

    if (!parsed || !Array.isArray(parsed.perspectives) || parsed.perspectives.length < 4) {
        throw new Error(`Gemini failed to dynamically conceptualize 4 camera perspectives for "${prompt}"`);
    }

    const perspectivesPlan = parsed.perspectives.slice(0, 4);

    // Concurrently render in-game screenshot previews from each perspective
    const perspectivePromises = perspectivesPlan.map(async (p, index) => {
        const imagePrompt = `In-game screenshot, playable video game viewport, authentic game HUD, game engine render of ${prompt} viewed from ${p.modifier || p.name}, rendered in ${styleModifier || styleName}, 1:1 square ratio, crisp game UI`;

        let imageUrl = null;
        try {
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Image timeout')), 7500));
            const imgResult = await Promise.race([
                generateGameScreenshotImage({
                    prompt: imagePrompt,
                    size: '512x512',
                    quality: 'low',
                    prefix: 'camera-perspectives',
                }),
                timeoutPromise
            ]);

            if (imgResult?.imageUrl) {
                imageUrl = imgResult.imageUrl;
            }
        } catch (imgErr) {
            console.log(`ℹ️ [Camera Perspective] Thumbnail generated via styling for "${p.name}" (${imgErr.message})`);
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
    });

    const perspectives = await Promise.all(perspectivePromises);
    return {
        success: true,
        prompt,
        gameTitle,
        selectedDirection,
        perspectives,
    };
}

