/**
 * AI Art Director
 * 
 * Dynamically conceptualizes 4 tailored visual art directions for ANY game prompt.
 * Uses AGY Agent powered by Gemini 3.8 Flash to conceptualize directions and
 * render high-fidelity concept art screenshot cards.
 */

import fs from 'fs';
import { executeHermesAgent, extractJsonFromHermes, uploadLocalImageFileToR2, getHermesGeneratedImagesSince } from './official-hermes-client.js';
import { callGeminiFlashJson } from './gemini-client.js';
import { generateConceptCardImage } from './openai-image-client.js';
import { recordImageGeneration, recordGeminiUsage } from './token-tracker.js';
import { broadcastHermesThought, broadcastHermesCommand, broadcastHermesError } from '../forge-socket.js';
import { saveForgeSession } from './forge-session-store.js';
import { sendPushToTokenOrUser } from '../notifications.js';
import { isLandscape } from './orientation.js';

/**
 * Sanitize image prompts to avoid OpenAI safety filter rejections.
 * Replaces common game/combat terms with softer visual alternatives.
 */
function sanitizeImagePrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') return prompt;
    return prompt
        .replace(/\bninja combat(\s+gear)?/gi, 'heroic martial arts outfit')
        .replace(/\bcombat\b/gi, 'action')
        .replace(/\bfight(ing|er|ers)?\b/gi, 'competitive action')
        .replace(/\bweapon(s)?\b/gi, 'energy construct$1')
        .replace(/\bkill(ing|ed|s)?\b/gi, 'defeat$1')
        .replace(/\bblood(y)?\b/gi, 'energy')
        .replace(/\bgore\b/gi, '')
        .replace(/\bsword(s)?\b/gi, 'luminous blade$1')
        .replace(/\bknife\b/gi, 'energy arc')
        .replace(/\bknives\b/gi, 'energy arcs')
        .replace(/\bgun(s)?\b/gi, 'energy blaster$1')
        .replace(/\bpistol(s)?\b/gi, 'energy blaster$1')
        .replace(/\brifl(e|es)\b/gi, 'ranged blaster$1')
        .replace(/\bshotgun(s)?\b/gi, 'heavy blaster$1')
        .replace(/\bbullet(s)?\b/gi, 'energy bolt$1')
        .replace(/\bexplosion(s)?\b/gi, 'energy burst$1')
        .replace(/\bstab(bing|bed)?\b/gi, 'strik$1')
        .replace(/\bimpale(d|ment)?\b/gi, 'clash$1')
        .replace(/\bdecapitat(e|ion|ed)\b/gi, 'defeat')
        .replace(/\b(murder|assassin)(s|ation|ate|ed)?\b/gi, 'rival$2')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

const SYSTEM_PROMPT = `You are a world-class Video Game Art Director and Camera Designer.
The user will provide a game title, concept prompt, and any attached or selected assets.
Your task is to invent exactly 4 DISTINCT, CREATIVE, and VISUALLY COMPELLING art directions tailored SPECIFICALLY to that game concept. Each direction MUST include BOTH a visual art style AND a camera perspective/angle baked together.

Rules:
- NEVER output generic out-of-context styles or default to clay/cute styles unless the game explicitly asks for it.
- Each direction must feel like a genuine, thoughtful creative pitch for that exact game world.
- THE TWO-WAY ASSET & STYLE PRINCIPLE:
  1. If user assets (3D models, sprites, videos, audio) ARE active: The assets are the visual anchors. Derive the color palette, lighting atmosphere, rendering fidelity, and UI to harmonize directly with those assets.
  2. If NO assets are provided: Establish a strong, unified creative vision first. The game code will either query matching catalog assets or generate everything procedurally so the aesthetic is never compromised.
- Ensure diversity in mediums (e.g. 16-Bit Masterpiece Pixel Art, High-Octane Cel-Shaded Anime, Stylized Low-Poly 3D, Vibrant Neo-Arcade, Hand-Inked Graphic Novel, Moody Dark Fantasy, Retro Synthwave, Clean Vector 2D, etc.) appropriate to the game genre.
- CONTENT SAFETY FOR VISUAL PROMPTS: Keep all visual style descriptions and modifiers strictly PG-13 / game-safe. NEVER use explicit violence, stabbing, spear impalement, blood, decapitation, or graphic gore. Describe heroic character standoffs, energy construct clashes, martial arts poses, and stylized particle effects so image generators process them without safety filter rejections.
- CAMERA PERSPECTIVE per direction: Each direction MUST include a camera angle/perspective that best showcases that visual style for this game concept. Choose from: Side-Scrolling 2.5D, Top-Down, Isometric, Third-Person Over-Shoulder, First-Person, Bird's-Eye Aerial, Low-Angle Dutch Tilt, Cinematic Fixed, Dynamic Tracking, etc.
  - For 2D games (Match-3, puzzle, card, platformer): use appropriate fixed 2D perspectives.
  - For 3D games (racing, action, fighting, adventure): use cinematic 3D perspectives.

You MUST respond with valid JSON strictly matching this schema:
{
  "directions": [
    {
      "name": "Creative Style Title (e.g. 16-Bit Neo Pixel)",
      "tagline": "2-3 word punchy tagline (e.g. Crisp & Retro)",
      "icon": "Ionicons icon name: sparkles | color-palette | flame | water | paw | leaf | flash | shapes-outline | rocket | game-controller | heart | skull | car | planet | bulb",
      "colors": ["#hex1", "#hex2", "#hex3", "#hex4"],
      "modifier": "visual concept preview of playable video game, authentic HUD, crisp rendering, high visual fidelity",
      "instruction": "Clear instructions for the game code builder describing colors, UI styling, and aesthetic atmosphere",
      "dimension": "2D | 2.5D | 3D",
      "cameraInstruction": "Technical camera setup details for game runtime (e.g. Set camera to horizontal tracking rail at Y:1.4m, FOV 50deg)",
      "cameraModifier": "camera angle description for the in-game screenshot render (e.g. side-profile 2.5D tracking camera)"
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
async function generateConceptCard({ prompt, styleName, prefix = 'visual-directions', orientation = 'portrait' }) {
    const isLand = isLandscape(orientation) || (typeof prompt === 'string' && /orientation:\s*landscape/i.test(prompt));
    const size = isLand ? '1792x1024' : '1024x1024';
    const aspectDesc = isLand ? '16:9 widescreen landscape aspect ratio' : '1:1 aspect ratio';
    const imagePrompt = sanitizeImagePrompt(`Video game visual concept preview, ${prompt}, art style: ${styleName}, clean UI HUD mockup, ${aspectDesc}, high visual fidelity`);
    try {
        const imgRes = await generateConceptCardImage({
            prompt: imagePrompt,
            size,
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
export async function directVisualDirections({ prompt, gameTitle = 'Game', selectedAssets = [], onProgress, sessionId, userId = null, pushToken = null, orientation = 'portrait' }) {
    if (!prompt) throw new Error('Prompt is required');

    const activeSessionId = sessionId || `forge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const isLand = isLandscape(orientation) || (typeof prompt === 'string' && /orientation:\s*landscape/i.test(prompt));
    const targetAspectRatio = isLand ? 'landscape' : 'square';
    const aspectPromptNote = isLand ? '16:9 widescreen landscape' : 'portrait';

    const notifyProgress = async ({ step, phase, message }) => {
        try {
            broadcastHermesThought(activeSessionId, { step, phase, message });
            await saveForgeSession(activeSessionId, {
                sessionId: activeSessionId,
                step,
                phase,
                statusMessage: message,
                updatedAt: Date.now(),
            });
        } catch (e) {
            console.warn('[Forge Session] Progress update error:', e.message);
        }
        if (typeof onProgress === 'function') {
            try { onProgress({ step, phase, message }); } catch (_) {}
        }
    };

    try {
        await saveForgeSession(activeSessionId, {
            sessionId: activeSessionId,
            userId,
            prompt,
            gameTitle,
            journeyView: 'understanding',
            step: 0,
            phase: 'analyzing',
            statusMessage: 'Analyzing your game idea and core vision...',
            updatedAt: Date.now(),
        }).catch(e => console.warn('[Forge Session] Initial save error:', e.message));

        await notifyProgress({ step: 0, phase: 'analyzing', message: 'Analyzing your game idea and core vision...' });

        console.log(`✨ [AI Art Director] Hermes directing styles & firing parallel image generation for: "${prompt}" (Title: ${gameTitle}, Assets: ${selectedAssets?.length || 0}, Session: ${activeSessionId})`);

        let assetContext = '';
        if (Array.isArray(selectedAssets) && selectedAssets.length > 0) {
            assetContext = '\nActive Game Assets:\n' + selectedAssets.map(a => `- ${a.role || a.type || 'asset'}: ${a.label || a.title || a.url}`).join('\n');
        }

        const runStartTime = Date.now();

        await notifyProgress({ step: 1, phase: 'mechanics', message: 'Exploring game mechanics, core systems, and platforms...' });

        const hermesPrompt = `${SYSTEM_PROMPT}

Game Title: ${gameTitle || 'Untitled Game'}
Game Concept: ${prompt}${assetContext}

TASK:
1. Conceptualize exactly 4 DISTINCT, CREATIVE, and VISUALLY COMPELLING art directions with baked-in camera perspectives tailored SPECIFICALLY to this game concept and its assets.
2. For EACH of the 4 directions, IMMEDIATELY call your \`image_generate\` tool with arguments (prompt: "...", aspect_ratio: "${targetAspectRatio}") to generate an authentic in-game screenshot preview card. You MUST issue all 4 \`image_generate\` tool calls concurrently in parallel in a single turn so they generate simultaneously.
   - Craft a detailed visual prompt for each card: e.g. "In-game screenshot, ${aspectPromptNote} playable video game viewport, authentic game HUD, game engine render of ${prompt}, <style details>, <camera angle>, crisp game UI, clean graphics".
3. Return a JSON object with a "directions" array containing the 4 directions matching the schema (including dimension, cameraInstruction, cameraModifier).
`;

        await notifyProgress({ step: 2, phase: 'directions', message: 'AGY is brainstorming 4 unique visual art directions...' });

        // Try AGY Agent with model fallbacks (3.8 → 3.7 → 3.6)
        let parsed = null;
        const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'];

        for (let i = 0; i < FALLBACK_MODELS.length; i++) {
            const model = FALLBACK_MODELS[i];
            const isLastModel = i === FALLBACK_MODELS.length - 1;
            
            try {
                console.log(`🎨 [AI Art Director] Attempting AGY with ${model}...`);
                const agyOutput = await executeHermesAgent(hermesPrompt, {
                    sessionId: activeSessionId,
                    model,
                });
                parsed = extractJsonFromHermes(agyOutput);
                
                if (parsed && Array.isArray(parsed.directions) && parsed.directions.length >= 4) {
                    console.log(`✅ [AI Art Director] Successfully conceptualized 4 directions with ${model}`);
                    break; // Success - exit retry loop
                }
                
                console.warn(`⚠️ [AI Art Director] ${model} returned invalid/incomplete response, ${isLastModel ? 'no more fallbacks' : 'trying next model'}...`);
                
            } catch (agyErr) {
                const status = agyErr?.status || (String(agyErr.message).match(/(\d{3})/)?.[1]);
                const isRetryable = status === '503' || status === '429' || status === 503 || status === 429;
                
                if (isLastModel) {
                    console.error(`❌ [AI Art Director] All AGY models exhausted. Last error: ${agyErr.message}`);
                    throw new Error(`AI Art Director failed after trying all models (${FALLBACK_MODELS.join(', ')}): ${agyErr.message}`);
                }
                
                console.warn(`⚠️ [AI Art Director] ${model} failed (${agyErr.message}), waiting 1s before trying ${FALLBACK_MODELS[i + 1]}...`);
                await new Promise(r => setTimeout(r, 1000)); // 1s backoff between retries
            }
        }

        if (!parsed || !Array.isArray(parsed.directions) || parsed.directions.length < 4) {
            throw new Error(`AI Art Director failed to conceptualize 4 directions for "${prompt}"`);
        }

        // 2. Locate generated images in Hermes cache
        const generatedImages = getHermesGeneratedImagesSince(runStartTime);
        console.log(`🖼️ [AI Art Director] Found ${generatedImages.length} images in Hermes cache`);

        await notifyProgress({ step: 3, phase: 'assets', message: 'Synthesizing concept art and visual preview cards...' });

        // 3. Upload each generated image to Cloudflare R2 and construct card objects
        const directions = await Promise.all(parsed.directions.slice(0, 4).map(async (dir, index) => {
            let localPath = dir.image_path || generatedImages[index] || null;
            let imageUrl = null;

            if (localPath && fs.existsSync(localPath)) {
                imageUrl = await uploadLocalImageFileToR2(localPath, 'visual-directions');
                console.log(`☁️ [AI Art Director] Uploaded Hermes image to R2 (${dir.name}): ${imageUrl}`);
                if (activeSessionId) recordImageGeneration(activeSessionId, 1);
            }

            // If Hermes didn't generate image or localPath is missing, generate concept card via OpenAI
            if (!imageUrl) {
                console.log(`🎨 [AI Art Director] Generating concept preview card for "${dir.name}"...`);
                imageUrl = await generateConceptCard({
                    prompt,
                    styleName: `${dir.name} - ${dir.modifier || ''}`,
                    prefix: 'visual-directions',
                    orientation: isLand ? 'landscape' : 'portrait',
                });
                if (imageUrl) {
                    console.log(`✅ [AI Art Director] Successfully acquired preview card for "${dir.name}": ${imageUrl}`);
                    if (activeSessionId) recordImageGeneration(activeSessionId, 1);
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
                dimension: dir.dimension || '3D',
                cameraInstruction: dir.cameraInstruction || 'Default camera setup',
                cameraModifier: dir.cameraModifier || '',
                imageUrl,
            };
        }));

        await notifyProgress({ step: 4, phase: 'ready', message: 'All set! Choose your visual direction to begin building.' });

        const hasAllVisualImages = Array.isArray(directions) && directions.length === 4 && directions.every(d => Boolean(d.imageUrl));
        await saveForgeSession(activeSessionId, {
            sessionId: activeSessionId,
            userId,
            prompt,
            gameTitle,
            journeyView: 'directions',
            visualDirections: directions,
            isDirectionsReady: hasAllVisualImages,
            step: 4,
            phase: 'ready',
            statusMessage: 'Visual directions ready!',
            updatedAt: Date.now(),
        }).catch(e => console.warn('[Forge Session] save error:', e.message));

        // Direct Agent Command: tell client to navigate to directions screen with ready cards!
        broadcastHermesCommand(activeSessionId, 'NAVIGATE_TO', {
            view: 'directions',
            visualDirections: directions,
            gameTitle,
            prompt,
        });

        if (pushToken || userId) {
            sendPushToTokenOrUser({
                userId,
                pushToken,
                title: 'Art styles ready! 🎨',
                body: `Choose your visual direction for "${gameTitle || prompt}"`,
                data: {
                    type: 'creation',
                    action: 'visual_directions_ready',
                    journeyView: 'directions',
                    sessionId: activeSessionId,
                    prompt,
                    gameTitle,
                }
            }).catch(err => console.warn('[Visual Directions] Push notification error:', err.message));
        }

        return {
            success: true,
            sessionId: activeSessionId,
            prompt,
            gameTitle,
            directions,
        };
    } catch (err) {
        const isRetryable = err?.status === 503 || err?.status === 429 || 
                           String(err.message).includes('503') || 
                           String(err.message).includes('429') ||
                           String(err.message).includes('UNAVAILABLE');
        
        const userMessage = isRetryable 
            ? 'Our AI servers are experiencing high demand. Please wait a moment and try again.'
            : (err.message || 'Visual direction generation failed');
        
        console.error('❌ [Visual Directions] Generation error:', err.message);
        try {
            broadcastHermesError(activeSessionId, {
                message: userMessage,
                canRetry: isRetryable,
            });
            await saveForgeSession(activeSessionId, {
                sessionId: activeSessionId,
                phase: 'failed',
                statusMessage: userMessage,
                error: err.message || 'Visual direction generation failed',
                updatedAt: Date.now(),
            });
        } catch (e) {
            console.warn('[Forge Session] Error handling failure:', e.message);
        }
        throw err;
    }
}
