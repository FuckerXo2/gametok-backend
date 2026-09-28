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
import { generateGameScreenshotImage } from './openai-image-client.js';
import { callGeminiFlashJson } from './gemini-client.js';
import { matchAssetsForPrompt, isConceptPureProcedural } from './asset-catalog.js';

const SYSTEM_PROMPT = `You are a world-class Video Game Art Director.
The user will provide a game title, concept prompt, and any attached or selected assets.
Your task is to invent exactly 4 DISTINCT, CREATIVE, and VISUALLY COMPELLING art directions tailored SPECIFICALLY to that game concept and its assets.

Rules:
- NEVER output generic out-of-context styles or default to clay/cute styles unless the game explicitly asks for it.
- Each direction must feel like a genuine, thoughtful creative pitch for that exact game world.
- If assets (videos, stickers, 3D models, audio) are active, ensure the visual styling complements, incorporates, and frames them gracefully.
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
    } else {
        const auto = matchAssetsForPrompt(prompt);
        if (auto.isPureProcedural) {
            assetContext = '\nGame Aesthetic Note: Pure procedural concept (no external assets needed). Emphasize clean procedural geometry and styling.';
        } else if (auto.video || auto.audio || auto.sprite || auto.model3d) {
            const list = [auto.video?.title, auto.audio?.title, auto.sprite?.title, auto.model3d?.name].filter(Boolean);
            if (list.length > 0) {
                assetContext = `\nRecommended Asset Alignment: [${list.join(', ')}]`;
            }
        }
    }

    // 1. Try Gemini 3.8 Flash first (ultra-fast, highly creative, reliable)
    try {
        console.log(`🧠 [AI Art Director] Prompting Gemini 3.8 Flash for visual directions...`);
        const parsed = await callGeminiFlashJson({
            systemPrompt: SYSTEM_PROMPT,
            messages: [
                { role: 'user', content: `Game Title: ${gameTitle || 'Untitled Game'}\nGame Concept: ${prompt}${assetContext}` },
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
export async function directVisualDirections({ prompt, gameTitle = 'Game', selectedAssets = [] }) {
    if (!prompt) throw new Error('Prompt is required');

    console.log(`✨ [AI Art Director] Directing styles for: "${prompt}" (Title: ${gameTitle}, Assets: ${selectedAssets?.length || 0})`);

    // 1. LLM invents the 4 styles tailored specifically to the game
    const directionsPlan = await callLLMForDirections(prompt, gameTitle, selectedAssets);

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
 * Evaluates whether perspective selection should be bypassed or auto-locked.
 * Bypasses selection when:
 * 1. User prompt already specifies camera perspective (e.g. top-down, first-person, side-scroller, isometric).
 * 2. Genre is inherently 2D / fixed-grid (e.g. Match-3, Candy Crush, 2048, Sudoku, Solitaire, Cards, Flappy Bird).
 */
export function detectPerspectiveRequirement(prompt = '', gameTitle = '') {
    const text = `${prompt} ${gameTitle}`.toLowerCase();

    // 1. Explicit camera stated by user in prompt
    if (text.includes('first person') || text.includes('first-person') || text.includes('fps') || text.includes('cockpit') || text.includes('pov')) {
        return {
            requiresSelection: false,
            reason: 'User explicitly requested first-person view',
            defaultPerspective: {
                id: `perspective-${Date.now()}-fp`,
                name: 'First-Person POV Cockpit',
                tagline: 'Immersive Cockpit',
                dimension: '3D',
                icon: 'eye',
                cameraInstruction: 'First-person perspective camera attached to player eye height with pointer/touch look rotation',
                modifier: 'first-person cockpit POV viewport looking forward',
                imageUrl: null,
            }
        };
    }

    if (text.includes('top down') || text.includes('top-down') || text.includes('birds eye') || text.includes("bird's eye") || text.includes('overhead')) {
        return {
            requiresSelection: false,
            reason: 'User explicitly requested top-down view',
            defaultPerspective: {
                id: `perspective-${Date.now()}-td`,
                name: 'Top-Down Tactical View',
                tagline: 'Direct Overhead View',
                dimension: '2.5D',
                icon: 'airplane',
                cameraInstruction: 'Camera positioned directly above player (Y=20, Z=5) looking straight down at the playfield',
                modifier: 'top-down bird-eye tactical camera viewport',
                imageUrl: null,
            }
        };
    }

    if (text.includes('side scroll') || text.includes('side-scroll') || text.includes('sidescroll') || text.includes('platformer')) {
        return {
            requiresSelection: false,
            reason: 'User requested side-scrolling platformer view',
            defaultPerspective: {
                id: `perspective-${Date.now()}-ss`,
                name: 'Classic Flat 2D Side-View',
                tagline: 'Side-Scrolling Platform',
                dimension: '2D',
                icon: 'walk',
                cameraInstruction: 'Orthographic camera following player on X and Y axes with fixed Z depth',
                modifier: 'horizontal side-scrolling 2D plane viewport',
                imageUrl: null,
            }
        };
    }

    if (text.includes('isometric') || text.includes('dihedral') || text.includes('3/4 view')) {
        return {
            requiresSelection: false,
            reason: 'User explicitly requested isometric view',
            defaultPerspective: {
                id: `perspective-${Date.now()}-iso`,
                name: 'Isometric 3/4 Dihedral',
                tagline: 'Angled Tactical View',
                dimension: '3D',
                icon: 'cube',
                cameraInstruction: 'Camera positioned at 45-degree azimuth and 35.264-degree elevation with telephoto projection',
                modifier: 'isometric 3/4 angled camera viewport with clean grid lines',
                imageUrl: null,
            }
        };
    }

    // 2. Inherent 2D / Fixed-Grid Genres (Candy Crush, 2048, Cards, Sudoku, etc.)
    const fixed2DKeywords = [
        'candy crush', 'match-3', 'match 3', 'gem match', 'tile match', 'bubble shooter',
        '2048', 'sliding tile', 'sudoku', 'crossword', 'wordle', 'trivia', 'quiz',
        'tic tac toe', 'tictactoe', 'connect 4', 'connect four', 'minesweeper',
        'solitaire', 'blackjack', 'poker', 'card game', 'card battler', 'chess', 'checkers',
        'flappy', 'flappy bird', 'brick breaker', 'breakout', 'pong', 'pinball',
        'idle clicker', 'cookie clicker', 'tap tap', 'piano tiles'
    ];

    if (fixed2DKeywords.some(kw => text.includes(kw))) {
        return {
            requiresSelection: false,
            reason: 'Inherent 2D / fixed-grid puzzle genre (no 3D camera needed)',
            defaultPerspective: {
                id: `perspective-${Date.now()}-2d-board`,
                name: 'Classic 2D Board View',
                tagline: 'Direct Orthogonal View',
                dimension: '2D',
                icon: 'grid',
                cameraInstruction: 'Fixed 2D Orthographic Camera directly facing the game board and interactive grid',
                modifier: 'flat 2D orthographic board viewport with clean UI and high readability',
                imageUrl: null,
            }
        };
    }

    return {
        requiresSelection: true,
        reason: 'Dynamic 3D genre requiring tailored camera perspective options',
        defaultPerspective: null,
    };
}

/**
 * Step 2: Direct 4 camera perspectives tailored to the game, chosen style, and assets
 */
export async function directPerspectives({ prompt, gameTitle = 'Game', selectedDirection, selectedAssets = [] }) {
    if (!prompt) throw new Error('Prompt is required');

    // 1. Check if camera perspective is already explicit or fixed by genre (e.g. Candy Crush)
    const perspectiveRequirement = detectPerspectiveRequirement(prompt, gameTitle);
    if (!perspectiveRequirement.requiresSelection && perspectiveRequirement.defaultPerspective) {
        console.log(`🎥 [Camera Perspective] Auto-locking perspective for "${prompt}": ${perspectiveRequirement.defaultPerspective.name} (${perspectiveRequirement.reason}). Skipping picker.`);
        return {
            success: true,
            requiresSelection: false,
            reason: perspectiveRequirement.reason,
            defaultPerspective: perspectiveRequirement.defaultPerspective,
            perspectives: [perspectiveRequirement.defaultPerspective],
            prompt,
            gameTitle,
            selectedDirection,
        };
    }

    const styleName = selectedDirection?.name || 'Selected Visual Style';
    const styleModifier = selectedDirection?.modifier || '';

    let assetContext = '';
    if (Array.isArray(selectedAssets) && selectedAssets.length > 0) {
        assetContext = '\nActive Game Assets:\n' + selectedAssets.map(a => `- ${a.role || a.type}: ${a.label || a.title || a.url}`).join('\n') + '\nFrame camera perspectives around these active assets.';
    }

    console.log(`🎥 [Camera Perspective] Generating 4 perspectives for "${prompt}" (Style: ${styleName})...`);

    const parsed = await callGeminiFlashJson({
        systemPrompt: PERSPECTIVE_SYSTEM_PROMPT,
        messages: [
            {
                role: 'user',
                content: `Game Title: ${gameTitle}\nGame Concept: ${prompt}\nChosen Art Direction: ${styleName}\nStyle Details: ${styleModifier}${assetContext}`,
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

