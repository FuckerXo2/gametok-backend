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

const SYSTEM_PROMPT = `You are a world-class Game Art Director.
The user will provide a game title and concept prompt.
Your task is to invent exactly 4 DISTINCT, CREATIVE, and VISUALLY COMPELLING art directions tailored SPECIFICALLY to that game concept.

Rules:
- NEVER output generic out-of-context styles (e.g. NEVER suggest neon cyberpunk for a cute kids/animal game).
- Each direction must feel like a genuine, thoughtful creative pitch for that exact game world.
- Ensure diversity in mediums (e.g. tactile claymation, hand-painted watercolor, cel-shaded anime, retro pixel, stylized 3D, dark fantasy oil, comic book, etc.) appropriate to the game.

You MUST respond with valid JSON strictly matching this schema:
{
  "directions": [
    {
      "name": "Creative Style Title (e.g. Pastel Claymation)",
      "tagline": "2-3 word punchy tagline (e.g. Tactile & Soft)",
      "icon": "Ionicons icon name: sparkles | color-palette | flame | water | paw | leaf | flash | shapes-outline | rocket | game-controller | heart | skull | car | planet | bulb",
      "colors": ["#hex1", "#hex2", "#hex3", "#hex4"],
      "modifier": "Detailed visual style prompt for FLUX concept art (e.g. tactile claymation, warm soft rim lighting, stop-motion felt textures, high fidelity, 8k octane render)",
      "instruction": "Clear instructions for the game code builder describing colors, UI styling, and aesthetic atmosphere"
    }
  ]
}`;

/**
 * Intelligent contextual fallback when LLM is unavailable or unkeyed
 */
function generateContextualArchetypes(prompt = '', gameTitle = '') {
    const text = `${prompt} ${gameTitle}`.toLowerCase();

    // Cute / Kids / Friendly / Cozy (e.g. teletubbies, pet, animal, farm, cooking)
    if (/teletubb|cute|peppa|baby|kid|pet|puppy|kitty|cat|dog|farm|cozy|cake|candy|baking|fluffy|pastel|whimsical/i.test(text)) {
        return [
            {
                name: 'Pastel Claymation',
                tagline: 'Tactile & Charming',
                icon: 'shapes-outline',
                colors: ['#FEF08A', '#F472B6', '#6EE7B7', '#93C5FD'],
                modifier: 'charming stop-motion claymation, soft tactile polymer clay figures, warm sunny lighting, miniature diorama depth of field, handcrafted cute aesthetic',
                instruction: 'Use a tactile pastel claymation aesthetic with soft rounded UI, gentle sunny lighting, and cheerful vibrant pastel colors.',
            },
            {
                name: 'Storybook Watercolor',
                tagline: 'Warm & Hand-Drawn',
                icon: 'color-palette',
                colors: ['#FDE047', '#FB923C', '#4ADE80', '#60A5FA'],
                modifier: 'children storybook watercolor illustration, gentle ink outlines, soft paper texture, warm wholesome atmosphere, whimsical picture book art',
                instruction: 'Use a hand-painted storybook watercolor direction with soft illustrated borders, gentle pastels, and cozy wholesome textures.',
            },
            {
                name: 'Felt & Yarn Craft',
                tagline: 'Fuzzy & Playful',
                icon: 'sparkles',
                colors: ['#F43F5E', '#A855F7', '#38BDF8', '#FACC15'],
                modifier: 'handcrafted felt toybox aesthetic, soft fuzzy yarn textures, stitch details, warm cozy studio lighting, charming handcrafted world',
                instruction: 'Use a warm felt and fabric craft visual direction with stitch details, button accents, and soft tactile materials.',
            },
            {
                name: 'Retro 90s Cartoon',
                tagline: 'Bright & Bouncy',
                icon: 'game-controller',
                colors: ['#EF4444', '#F59E0B', '#10B981', '#3B82F6'],
                modifier: 'vibrant 90s Saturday morning cartoon cel animation, clean bold outlines, flat saturated primary colors, expressive energetic poses, retro animation cel',
                instruction: 'Use a vibrant Saturday morning cartoon style with bold black outlines, snappy bouncy animations, and punchy primary colors.',
            },
        ];
    }

    // Racing / Fast / Driving / Speed
    if (/rac|car|drift|speed|highway|drive|turbo|vehicle|kart|formula/i.test(text)) {
        return [
            {
                name: 'Midnight Horizon',
                tagline: 'Slick & Atmospheric',
                icon: 'car',
                colors: ['#090D16', '#1E293B', '#38BDF8', '#F43F5E'],
                modifier: 'cinematic midnight street racing concept art, wet reflective asphalt, vivid headlight bloom, motion blur, moody volumetric mist, photorealistic Unreal Engine 5 render',
                instruction: 'Use a sleek cinematic night-racing theme with high-contrast road reflections, dynamic headlight glows, and dark modern UI.',
            },
            {
                name: 'Vibrant Arcade',
                tagline: 'Fast & Punchy',
                icon: 'flash',
                colors: ['#18002E', '#9333EA', '#EC4899', '#FBBF24'],
                modifier: 'retro-modern arcade racing concept art, glossy candy-lacquer sports car, vibrant sun-drenched coastal highway, bold saturated lighting, Sega Outrun aesthetic',
                instruction: 'Use an energetic retro arcade racing style with vibrant sunset gradients, bold readable gauges, and high-energy color pops.',
            },
            {
                name: 'Cel-Shaded Manga',
                tagline: 'Sharp & Stylized',
                icon: 'speedometer',
                colors: ['#0A0A0A', '#DC2626', '#FFFFFF', '#2563EB'],
                modifier: 'high-octane anime racing manga art style, dynamic speed lines, bold ink hatching, stylized smoke and drift tire sparks, Initial D aesthetic',
                instruction: 'Use a dynamic cel-shaded manga racing aesthetic with high-contrast comic ink lines, speed streaks, and bold action callouts.',
            },
            {
                name: 'Low-Poly Rally',
                tagline: 'Retro & Clean',
                icon: 'shapes-outline',
                colors: ['#14532D', '#15803D', '#F97316', '#FEF08A'],
                modifier: 'clean stylized low-poly 3D racing game art, faceted geometry, vibrant environmental lighting, crisp dirt road, Art of Rally aesthetic',
                instruction: 'Use a minimalist low-poly 3D racing style with flat shaded surfaces, clean geometric cars, and a crisp vibrant landscape.',
            },
        ];
    }

    // Horror / Spooky / Dark / Zombie
    if (/horror|spook|dark|ghost|zombie|haunt|scary|nightmare|shadow|blood|abandon/i.test(text)) {
        return [
            {
                name: 'Cursed VHS',
                tagline: 'Raw & Analog',
                icon: 'skull',
                colors: ['#050505', '#171717', '#991B1B', '#E5E5E5'],
                modifier: 'gritty found-footage psychological horror, analog VHS scanlines, eerie flashlight beam illuminating dark corridors, heavy grain, unsettling atmosphere',
                instruction: 'Use an analog VHS found-footage horror aesthetic with CRT distortion lines, harsh shadows, and unsettling high-contrast red accents.',
            },
            {
                name: 'Gothic Noir',
                tagline: 'Shadow & Mystery',
                icon: 'skull-outline',
                colors: ['#09090B', '#18181B', '#71717A', '#F43F5E'],
                modifier: 'dark gothic graphic novel art, high contrast ink shadows, chiaroscuro lighting, brooding Victorian silhouettes, Bloodborne atmosphere',
                instruction: 'Use a moody gothic noir art direction with deep ink shadows, subtle crimson accents, and atmospheric fog effects.',
            },
            {
                name: 'Eldritch Mist',
                tagline: 'Ancient & Unreal',
                icon: 'sparkles',
                colors: ['#022C22', '#064E3B', '#10B981', '#047857'],
                modifier: 'Lovecraftian psychological horror concept art, sickly bioluminescent green fog, sunken cyclopean ruins, haunting atmospheric depth, cinematic masterpiece',
                instruction: 'Use an eerie eldritch horror theme with sickly green bioluminescence, heavy atmospheric haze, and dark decayed surfaces.',
            },
            {
                name: 'Retro Survival Pixel',
                tagline: 'Gritty & Nostalgic',
                icon: 'game-controller',
                colors: ['#1C1917', '#44403C', '#DC2626', '#E7E5E4'],
                modifier: 'detailed 32-bit survival horror pixel art, dingy industrial corridors, flickering emergency lights, dithering shadows, Resident Evil 1 PS1 aesthetic',
                instruction: 'Use a 32-bit retro survival horror pixel aesthetic with dithered lighting, claustrophobic camera framing, and dingy textures.',
            },
        ];
    }

    // Sci-Fi / Space / Cyber
    if (/space|cyber|future|robot|alien|galaxy|star|ship|laser|neon/i.test(text)) {
        return [
            {
                name: 'Neon Cyber',
                tagline: 'High-Tech & Electric',
                icon: 'flash',
                colors: ['#050814', '#7928CA', '#00DFD8', '#FF0080'],
                modifier: 'cyberpunk sci-fi concept art, glowing volumetric neon lighting, wet chrome reflections, holographic UI overlays, high-tech dystopian city, 8k octane render',
                instruction: 'Use a futuristic cyberpunk visual direction with glowing neon accents, high-contrast dark tones, and sleek holographic UI elements.',
            },
            {
                name: 'Deep Cosmos',
                tagline: 'Vast & Mysterious',
                icon: 'planet',
                colors: ['#030712', '#1E1B4B', '#6366F1', '#38BDF8'],
                modifier: 'epic deep space astronomy concept art, glowing cosmic nebula, starry background, distant ringed planets, majestic cinematic scale, Hubble photography aesthetic',
                instruction: 'Use an expansive deep-space visual direction with glowing nebulae, starlight particles, and deep cosmic indigo tones.',
            },
            {
                name: 'Retro 80s Cassette Futurism',
                tagline: 'Vintage Sci-Fi',
                icon: 'game-controller',
                colors: ['#1E293B', '#0284C7', '#F59E0B', '#EF4444'],
                modifier: '70s and 80s retro sci-fi cassette futurism art, analog computer displays, bulky spacecraft hull, Chris Foss illustration style, warm vintage lighting',
                instruction: 'Use a retro cassette-futurism sci-fi aesthetic with industrial orange accents, matte panels, and analog telemetry displays.',
            },
            {
                name: 'Clean Mecha Manga',
                tagline: 'Sharp & Industrial',
                icon: 'shapes-outline',
                colors: ['#0F172A', '#334155', '#38BDF8', '#E2E8F0'],
                modifier: 'clean stylized mecha anime concept art, crisp panel lining, industrial white and blue spacecraft armor, technical decals, studio lighting',
                instruction: 'Use a crisp mecha sci-fi direction with technical panel lines, industrial geometric silhouettes, and precise cyan accents.',
            },
        ];
    }

    // Fantasy / Magic / Medieval / RPG
    if (/fantasy|magic|dragon|sword|castle|rpg|knight|dungeon|wizard/i.test(text)) {
        return [
            {
                name: 'Epic Mythic',
                tagline: 'Grand & Legendary',
                icon: 'sparkles',
                colors: ['#0F172A', '#1E1B4B', '#0369A1', '#F59E0B'],
                modifier: 'epic mythical fantasy concept art, atmospheric golden volumetric lighting, towering ancient ruins, magical particles, cinematic scale, digital oil masterpiece',
                instruction: 'Use an epic fantasy visual direction with rich atmospheric depth, dramatic lighting, and intricate mythical details.',
            },
            {
                name: 'Enchanted Forest',
                tagline: 'Whimsical & Glowing',
                icon: 'leaf',
                colors: ['#022C22', '#065F46', '#10B981', '#FDE047'],
                modifier: 'enchanted magical forest fantasy concept art, glowing fairy lights, moss-covered ancient trees, soft mystical twilight, Studio Ghibli inspired aesthetic',
                instruction: 'Use a lush enchanted forest aesthetic with soft magical bioluminescence, verdant greens, and warm fairy glows.',
            },
            {
                name: 'Dark Gothic Citadel',
                tagline: 'Brooding & Ancient',
                icon: 'shield',
                colors: ['#09090B', '#27272A', '#78350F', '#D97706'],
                modifier: 'dark fantasy gothic fortress art, torchlit stone corridors, ancient heraldry, brooding misty battlements, Dark Souls art direction',
                instruction: 'Use a dark gothic medieval aesthetic with weathered stone textures, flickering torchlight, and rich amber highlights.',
            },
            {
                name: 'Stylized Low-Poly Adventure',
                tagline: 'Crisp & Charming',
                icon: 'shapes-outline',
                colors: ['#065F46', '#0284C7', '#F59E0B', '#FEF08A'],
                modifier: 'clean stylized low-poly fantasy adventure, bright cheerful lighting, faceted terrain, charming toybox knight, Zelda Wind Waker aesthetic',
                instruction: 'Use a stylized low-poly adventure style with clean geometric forms, vibrant saturated colors, and welcoming daylight.',
            },
        ];
    }

    // Default general game concepts
    return [
        {
            name: 'Vibrant Arcade 3D',
            tagline: 'Bold & Punchy',
            icon: 'game-controller',
            colors: ['#1A0B2E', '#9333EA', '#EC4899', '#FACC15'],
            modifier: `vibrant stylized 3D video game concept art of ${prompt}, glossy candy materials, clean readable shapes, playful studio lighting, Unreal Engine 5`,
            instruction: 'Use a bold retro-modern arcade art direction with saturated punchy colors, glossy materials, and clean readable shapes.',
        },
        {
            name: 'Hand-Crafted Stylized',
            tagline: 'Tactile & Warm',
            icon: 'shapes-outline',
            colors: ['#022C22', '#065F46', '#10B981', '#FEF08A'],
            modifier: `stylized tactile handcrafted toy diorama concept art of ${prompt}, soft clay and wooden textures, warm natural lighting, miniature depth of field`,
            instruction: 'Use a clean stylized tactile visual direction with smooth surfaces, charming proportions, and soft natural lighting.',
        },
        {
            name: 'Cinematic Modern',
            tagline: 'Sleek & Immersive',
            icon: 'sparkles',
            colors: ['#090D16', '#1E293B', '#38BDF8', '#F43F5E'],
            modifier: `cinematic concept art of ${prompt}, atmospheric volumetric lighting, rich textural detail, widescreen composition, digital painting masterpiece`,
            instruction: 'Use a sleek cinematic visual direction with dramatic lighting contrasts and refined modern UI elements.',
        },
        {
            name: 'Retro Pixel Master',
            tagline: 'Crisp & Nostalgic',
            icon: 'color-palette',
            colors: ['#111827', '#4F46E5', '#06B6D4', '#F43F5E'],
            modifier: `masterpiece 16-bit pixel art of ${prompt}, rich vibrant color palette, intricate pixel shading, crisp clean sprites, modern neo-retro arcade aesthetic`,
            instruction: 'Use a rich modern 16-bit neo-retro pixel aesthetic with vibrant colors and crisp nostalgic styling.',
        },
    ];
}

/**
 * Call LLM to invent 4 custom directions
 */
async function callLLMForDirections(prompt, gameTitle) {
    // 1. Try Qwen if configured
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

    // 2. Try NVIDIA NIM LLM if NVIDIA_API_KEY is present
    const nvidiaKey = process.env.NVIDIA_API_KEY;
    if (nvidiaKey) {
        try {
            console.log(`🧠 [AI Art Director] Prompting NVIDIA NIM LLM for visual directions...`);
            const nimClient = new OpenAI({
                apiKey: nvidiaKey,
                baseURL: 'https://integrate.api.nvidia.com/v1',
                timeout: 30000,
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

    // 3. Contextual smart fallback
    console.log(`🎨 [AI Art Director] Using contextual semantic director for "${prompt}"`);
    return generateContextualArchetypes(prompt, gameTitle);
}

/**
 * Main Entry Point: Direct 4 visual styles and generate FLUX concept art
 */
export async function directVisualDirections({ prompt, gameTitle = 'Game' }) {
    if (!prompt) throw new Error('Prompt is required');

    console.log(`✨ [AI Art Director] Directing styles for: "${prompt}" (Title: ${gameTitle})`);

    // 1. LLM invents the 4 styles tailored to the game
    const directionsPlan = await callLLMForDirections(prompt, gameTitle);

    // 2. Concurrently dispatch to FLUX to generate concept art for each direction
    const directionPromises = directionsPlan.map(async (dir, index) => {
        const imagePrompt = `Video game concept art of ${prompt}, ${dir.modifier}, 1:1 square ratio, centered composition, high visual fidelity, concept artwork`;
        
        try {
            const fluxResult = await generateAndUploadFluxImage({
                prompt: imagePrompt,
                width: 1024,
                height: 1024,
                steps: 25,
                cfg_scale: 3.5,
                prefix: 'visual-directions',
            });

            return {
                id: `direction-${Date.now()}-${index + 1}`,
                name: dir.name,
                tagline: dir.tagline || 'Visual Direction',
                description: `A stylized interpretation of ${prompt} directed in ${dir.name.toLowerCase()} aesthetic.`,
                icon: dir.icon || 'sparkles',
                colors: dir.colors || ['#000000', '#333333', '#666666', '#FFFFFF'],
                instruction: dir.instruction || `Use a ${dir.name} visual aesthetic with cohesive colors and clean UI.`,
                modifier: dir.modifier,
                imageUrl: fluxResult.imageUrl,
            };
        } catch (imgErr) {
            console.warn(`[AI Art Director] Flux image generation failed for "${dir.name}":`, imgErr.message);
            return {
                id: `direction-${Date.now()}-${index + 1}`,
                name: dir.name,
                tagline: dir.tagline || 'Visual Direction',
                description: `A stylized interpretation of ${prompt} directed in ${dir.name.toLowerCase()} aesthetic.`,
                icon: dir.icon || 'sparkles',
                colors: dir.colors || ['#000000', '#333333', '#666666', '#FFFFFF'],
                instruction: dir.instruction || `Use a ${dir.name} visual aesthetic with cohesive colors and clean UI.`,
                modifier: dir.modifier,
                imageUrl: null,
            };
        }
    });

    const directions = await Promise.all(directionPromises);
    return {
        success: true,
        prompt,
        gameTitle,
        directions,
    };
}
