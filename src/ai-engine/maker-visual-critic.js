// VISUAL CRITIC — the pipeline's eyes.
//
// We have rendered every generated game in a headless browser for months and thrown the screenshot
// away into a thumbnail column. Nothing has ever looked at what the model built. Crash-free was the
// entire quality bar, which is why "flat-shaded cubes on a grey plane" shipped as often as it did.
//
// This module closes that loop:
//
//   1. probeProjectSource()  — deterministic structural read of the code that was written. No LLM.
//                              Catches "every mesh is a BoxGeometry" and "the only light is an
//                              AmbientLight" for free, and catches them the same way every time.
//   2. probeFramePixels()    — cheap image statistics over a captured frame (sharp). Catches the
//                              flat-background / three-colours-on-screen failure without a model.
//   3. critiqueBuild()       — a Kimi vision call that grades the actual frames against the
//                              director's brief and the existing visual scorecard rubric, and
//                              returns a defect list.
//
// The critic runs on Kimi, and only Kimi. K2.7-code is natively multimodal (the MoonViT vision
// encoder — it takes the same base64 image_url content parts the OpenAI SDK sends), so the model
// that BUILDS the game is the one that LOOKS at it. There is no other-vendor fallback on purpose:
// OpenAI's job in this system is image GENERATION (cover art), not judging games. With no Moonshot
// key the critic simply does not run.
//
// Vision-capable Kimi ids (per platform.kimi.ai): kimi-k3, kimi-k2.5, kimi-k2.6, kimi-k2.7-code,
// kimi-k2.7-code-highspeed. Note the vision variant is "-code" suffixed — a plain "kimi-k2.7" is
// NOT in that list, which is why the model id here is resolved separately from MOONSHOT_MODEL.
//
// Everything here soft-fails: no key, no sharp, a malformed response, a timeout — the generation
// continues exactly as it did before. The critic can block a ship, but it can never break one.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { getMoonshotTextConfig } from './moonshot-text-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCORECARD_PATH = path.join(
    __dirname,
    'threejs-skills/threejs-aaa-graphics-builder/references/visual-scorecard.md',
);

/** Source files worth reading for the structural probe. */
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.html', '.css']);

async function readProjectSources(projectRoot, { maxBytes = 1_500_000 } = {}) {
    const collected = [];
    let total = 0;

    async function walk(dir, depth = 0) {
        if (depth > 3 || total > maxBytes) return;
        let entries = [];
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (total > maxBytes) return;
            // Skip the agent's own scaffolding — instructions.txt and the skills symlink would
            // otherwise poison every keyword count in the probe below.
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'threejs-skills') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full, depth + 1);
                continue;
            }
            if (!SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
            try {
                const text = await fs.readFile(full, 'utf-8');
                total += text.length;
                collected.push({ path: path.relative(projectRoot, full), text });
            } catch {
                /* unreadable file — ignore */
            }
        }
    }

    await walk(projectRoot);
    return collected;
}

function countMatches(text, pattern) {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
}

/**
 * Deterministic structural read of the generated code. This is the half of the critique that does
 * not need a model and cannot hallucinate: if the source contains eleven BoxGeometry calls and no
 * other geometry, the world is boxes, and no amount of confident prose from a vision model changes
 * that. These signals are fed to the critic as evidence and also stand alone as hard gates.
 */
export async function probeProjectSource(projectRoot) {
    const files = await readProjectSources(projectRoot);
    if (files.length === 0) return null;
    const source = files.map((file) => file.text).join('\n');

    const geometryTypes = new Set();
    for (const match of source.matchAll(/\b(\w+)Geometry\s*\(/g)) geometryTypes.add(match[1]);

    const materialTypes = new Set();
    for (const match of source.matchAll(/\bMesh(\w+)Material\s*\(/g)) materialTypes.add(match[1]);
    if (/\bShaderMaterial\s*\(/.test(source)) materialTypes.add('Shader');

    const primitiveGeometry = ['Box', 'Sphere', 'Cylinder', 'Cone', 'Plane', 'Torus', 'Circle'];
    const authoredGeometry = ['Buffer', 'Extrude', 'Lathe', 'Shape', 'Tube', 'Capsule', 'Polyhedron'];
    const primitiveCount = primitiveGeometry.reduce(
        (sum, name) => sum + countMatches(source, new RegExp(`\\b${name}Geometry\\s*\\(`, 'g')), 0);
    const authoredCount = authoredGeometry.reduce(
        (sum, name) => sum + countMatches(source, new RegExp(`\\b${name}Geometry\\s*\\(`, 'g')), 0);

    const lights = {
        ambient: countMatches(source, /\bAmbientLight\s*\(/g) + countMatches(source, /\bHemisphereLight\s*\(/g),
        directional: countMatches(source, /\bDirectionalLight\s*\(/g),
        point: countMatches(source, /\bPointLight\s*\(/g) + countMatches(source, /\bSpotLight\s*\(/g),
    };

    const probe = {
        fileCount: files.length,
        totalChars: source.length,
        is3D: /\bTHREE\b|three\.module|three@/.test(source),
        geometryTypes: [...geometryTypes],
        materialTypes: [...materialTypes],
        primitiveGeometryCalls: primitiveCount,
        authoredGeometryCalls: authoredCount,
        lights,
        shadowsEnabled: /castShadow\s*=\s*true|shadowMap\.enabled\s*=\s*true/.test(source),
        usesInstancing: /\bInstancedMesh\s*\(/.test(source),
        usesPostProcessing: /EffectComposer|UnrealBloomPass|ShaderPass|RenderPass/.test(source),
        usesCustomShaders: /ShaderMaterial|onBeforeCompile|fragmentShader/.test(source),
        usesFog: /\bFog(Exp2)?\s*\(|scene\.fog\s*=/.test(source),
        // Textures painted with canvas 2D, which is how a no-external-assets build gets surface
        // detail. Its absence alongside flat colours is a strong "untextured primitives" signal.
        generatesCanvasTextures: /CanvasTexture\s*\(|createElement\(['"]canvas['"]\)/.test(source),
        loadsExternalAssets: /GLTFLoader|TextureLoader|loadModel|\.glb\b|\.gltf\b/.test(source),
        // Distinct hex colours the code actually uses — a proxy for whether a palette was committed
        // to at all. Four colours in a "vibrant tropical" game is a red flag on its own.
        distinctHexColors: new Set(
            [...source.matchAll(/0x[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()),
        ).size,
        hasAudio: /AudioContext|createOscillator/.test(source),
    };

    // Structural auto-failures. Deliberately conservative: each one has to be something no
    // reasonable finished game does, because these block a ship and cost a repair turn.
    probe.structuralFailures = [];
    if (probe.is3D) {
        if (probe.authoredGeometryCalls === 0 && probe.primitiveGeometryCalls > 0 && geometryTypes.size <= 2) {
            probe.structuralFailures.push({
                category: 'world',
                defect: `Every mesh in the game is a ${[...geometryTypes].join('/')}Geometry primitive — the source contains no authored shapes at all.`,
                fix: 'Build the hero and the recurring props as composed forms: group several scaled/rotated parts per object, or use ExtrudeGeometry/BufferGeometry, so each one has a silhouette you could recognise in black.',
            });
        }
        if (lights.directional === 0 && lights.point === 0 && lights.ambient > 0) {
            probe.structuralFailures.push({
                category: 'lighting',
                defect: 'The only light in the scene is ambient/hemisphere, so every face of every object receives identical light and nothing reads as three-dimensional.',
                fix: 'Add a key DirectionalLight with castShadow enabled, a dimmer fill from the opposite side, and a rim light behind the subject. Enable renderer.shadowMap.',
            });
        }
        if (probe.usesFog && !probe.shadowsEnabled && probe.authoredGeometryCalls === 0) {
            probe.structuralFailures.push({
                category: 'world',
                defect: 'Fog is applied over an unlit world of primitives with no shadows — that is concealing missing geometry rather than styling the scene.',
                fix: 'Build and light the geometry first. Re-introduce fog afterwards only as depth cueing, not as cover.',
            });
        }
    }
    if (probe.distinctHexColors > 0 && probe.distinctHexColors < 4) {
        probe.structuralFailures.push({
            category: 'artDirection',
            defect: `Only ${probe.distinctHexColors} distinct colours appear anywhere in the source.`,
            fix: "Apply the brief's full 5-colour palette across world, entities, and HUD, using the exact hex values it specifies.",
        });
    }

    return probe;
}

/**
 * Cheap image statistics over a captured frame. Catches the failure the structural probe cannot see
 * — code that looks varied but renders to a near-empty screen — without spending a vision call.
 */
export async function probeFramePixels(base64Png) {
    let sharp;
    try {
        ({ default: sharp } = await import('sharp'));
    } catch {
        return null; // sharp unavailable — skip pixel stats, the vision pass still runs
    }

    try {
        const input = Buffer.from(base64Png, 'base64');
        // 64x64 is enough for colour-variety and edge-density statistics and keeps this well under
        // a millisecond. We are measuring "is anything happening on screen", not fine detail.
        const { data, info } = await sharp(input)
            .resize(64, 64, { fit: 'fill' })
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const { width, height, channels } = info;
        const buckets = new Set();
        const gray = new Float32Array(width * height);

        for (let i = 0, p = 0; i < data.length; i += channels, p += 1) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            // Quantize to 4 bits per channel: distinguishes real colour variety from gradient noise.
            buckets.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
            gray[p] = 0.299 * r + 0.587 * g + 0.114 * b;
        }

        // Edge density: mean absolute horizontal+vertical neighbour difference. A screen of large
        // flat shapes scores low; a screen with authored detail, props, and HUD scores high.
        let edgeSum = 0;
        let edgeCount = 0;
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const idx = y * width + x;
                if (x + 1 < width) { edgeSum += Math.abs(gray[idx] - gray[idx + 1]); edgeCount += 1; }
                if (y + 1 < height) { edgeSum += Math.abs(gray[idx] - gray[idx + width]); edgeCount += 1; }
            }
        }

        let mean = 0;
        for (let i = 0; i < gray.length; i += 1) mean += gray[i];
        mean /= gray.length;
        let variance = 0;
        for (let i = 0; i < gray.length; i += 1) variance += (gray[i] - mean) ** 2;

        return {
            distinctColorBuckets: buckets.size,
            edgeDensity: Number((edgeSum / Math.max(1, edgeCount)).toFixed(2)),
            brightnessMean: Number(mean.toFixed(1)),
            brightnessStdDev: Number(Math.sqrt(variance / gray.length).toFixed(1)),
        };
    } catch {
        return null;
    }
}

/** Turn the numeric probes into short English the critic can weigh alongside what it sees. */
function describeProbes(sourceProbe, pixelProbe) {
    const lines = [];
    if (sourceProbe) {
        lines.push(`- Geometry used: ${sourceProbe.geometryTypes.join(', ') || 'none detected'} (${sourceProbe.primitiveGeometryCalls} primitive calls, ${sourceProbe.authoredGeometryCalls} authored calls)`);
        lines.push(`- Materials used: ${sourceProbe.materialTypes.join(', ') || 'none detected'}`);
        lines.push(`- Lights: ${sourceProbe.lights.ambient} ambient, ${sourceProbe.lights.directional} directional, ${sourceProbe.lights.point} point/spot; shadows ${sourceProbe.shadowsEnabled ? 'on' : 'OFF'}`);
        lines.push(`- Distinct colours in source: ${sourceProbe.distinctHexColors}`);
        lines.push(`- Canvas-generated textures: ${sourceProbe.generatesCanvasTextures ? 'yes' : 'NO'}; instancing: ${sourceProbe.usesInstancing ? 'yes' : 'no'}; custom shaders: ${sourceProbe.usesCustomShaders ? 'yes' : 'no'}; post-processing: ${sourceProbe.usesPostProcessing ? 'yes' : 'no'}`);
    }
    if (pixelProbe) {
        lines.push(`- Frame statistics: ${pixelProbe.distinctColorBuckets} distinct colour buckets, edge density ${pixelProbe.edgeDensity} (below ~6 means large flat areas with little detail), brightness ${pixelProbe.brightnessMean} ±${pixelProbe.brightnessStdDev}`);
    }
    return lines.join('\n');
}

function criticSystemPrompt(scorecard, is3D) {
    return `You are a harsh art director reviewing a screenshot of a game that a junior developer just built. Your only job is to find what is wrong with it.

You are not here to be encouraging. You do not praise. A defect you fail to name ships to real players. If the frame genuinely has no defects left, say so with an empty defect list — but that should be rare, and you should never reach for it to be polite.

You are looking at frames captured from the RUNNING game during active play${is3D ? ' (a 3D WebGL game)' : ''}. They were rendered in a software renderer, so judge composition, form, colour, density, and readability — do NOT report anti-aliasing quality, frame rate, or shader precision.

# RUBRIC

${scorecard}

# HOW TO REPORT

Score each of the 10 categories 0-3 using the rubric. Then list defects. Every defect must be:
  - SPECIFIC: name the object or region, not "the visuals"
  - VISIBLE: something you can actually see in the frame, or that the probe evidence proves
  - ACTIONABLE: paired with a fix the developer can implement today

  BAD:  "the game looks unpolished and could use more detail"
  GOOD: "the player ship is a single untextured cone with an emissive glow; the three enemy types
         share that same cone silhouette at different scales, so the player cannot tell them apart
         while moving. Fix: give each enemy a distinct built-up form — a wide flat wing, a boxy
         hauler with a cargo pod, a spiked interceptor — and drop the glow."

Severity:
  - "critical" = one of the rubric's Automatic Failures, or the game is unreadable/unplayable from this frame
  - "major"    = a category scoring 0 or 1 that the brief explicitly asked to be better
  - "minor"    = real but cosmetic

Score the "performance" category from the probe evidence below (instancing, draw-heavy patterns, texture
generation) and NEVER emit a defect in that category — you are looking at still frames and cannot observe
frame rate. Do not report anything you would have to be running the game to know.

Return ONLY JSON:
{
  "scores": { "artDirection": 0-3, "hero": 0-3, "obstacles": 0-3, "rewards": 0-3, "world": 0-3, "materials": 0-3, "lighting": 0-3, "vfx": 0-3, "hud": 0-3, "performance": 0-3 },
  "average": number,
  "briefCompliance": "how well the frame matches the design brief — name specific values from the brief that are present or missing",
  "autoFailures": ["any rubric Automatic Failures that apply, quoted"],
  "defects": [ { "severity": "critical|major|minor", "category": "which rubric category", "defect": "what is wrong, specifically", "fix": "what to do about it" } ],
  "verdict": "ship" or "revise"
}`;
}

/**
 * Pick the vision model that will grade the frames.
 *
 * Kimi first, so the critic and the builder are the same model family — one vendor, and the model
 * judging the screenshot is the one that has to act on the critique. OpenAI is a fallback so the
 * critic still works before a Moonshot key is set. Both speak the same OpenAI-shaped
 * image_url/base64 request, so the call site below is identical either way.
 */
export function resolveVisionCritic(env = process.env) {
    const moonshot = getMoonshotTextConfig(env);
    if (!moonshot) return null;
    return {
        client: new OpenAI({
            apiKey: moonshot.apiKey,
            baseURL: moonshot.baseURL,
            timeout: Number(env.GAMETOK_CRITIC_TIMEOUT_MS || 120000),
        }),
        // MOONSHOT_MODEL is deliberately NOT reused: the builder may be pinned to a text id,
        // while vision needs one of the vision-capable ids listed at the top of this file.
        model: String(env.GAMETOK_CRITIC_MODEL || 'kimi-k2.7-code').trim(),
        provider: 'moonshot',
    };
}

/**
 * Grade the captured frames. Returns null when the critic is unavailable or fails — callers must
 * treat a null critique as "no opinion", never as a pass or a fail.
 */
export async function critiqueBuild({
    frames = [],
    brief = null,
    sourceProbe = null,
    orientation = 'portrait',
    env = process.env,
} = {}) {
    if (String(env.GAMETOK_VISUAL_CRITIC || 'true').toLowerCase() === 'false') return null;
    if (!frames.length) return null;

    const vision = resolveVisionCritic(env);
    if (!vision) {
        console.warn('👁️  [Critic] MOONSHOT_API_KEY not set — skipping the visual critique pass (the critic runs on Kimi vision only).');
        return null;
    }

    let scorecard = '';
    try {
        scorecard = await fs.readFile(SCORECARD_PATH, 'utf-8');
    } catch {
        console.warn('👁️  [Critic] visual-scorecard.md not readable — skipping the visual critique pass.');
        return null;
    }

    const pixelProbe = await probeFramePixels(frames[0].base64);
    const evidence = describeProbes(sourceProbe, pixelProbe);
    const is3D = Boolean(sourceProbe?.is3D || brief?.dimension === '3D');

    const briefSection = brief
        ? `# THE DESIGN BRIEF THIS GAME WAS BUILT FROM\n\nThe frames must match this. Check the palette hexes, the named style, the entity silhouettes, and the banned list.\n\n${brief.text}`
        : '# NO DESIGN BRIEF\n\nJudge the frames on the rubric alone.';

    const userContent = [
        {
            type: 'text',
            text: `${briefSection}

# EVIDENCE FROM THE BUILD (deterministic, not your judgement — trust these numbers)

${evidence || '(no probe data available)'}

# THE FRAMES

Orientation: ${orientation}. ${frames.length} frame(s) from the running game:
${frames.map((frame, i) => `  ${i + 1}. ${frame.label}`).join('\n')}

Grade them.`,
        },
        ...frames.map((frame) => ({
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${frame.base64}` },
        })),
    ];

    const { client, model, provider } = vision;
    const startedAt = Date.now();

    try {
        const response = await client.chat.completions.create({
            model,
            max_tokens: 2500,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: criticSystemPrompt(scorecard, is3D) },
                { role: 'user', content: userContent },
            ],
        });

        const critique = JSON.parse(response.choices[0].message.content);
        const defects = Array.isArray(critique.defects) ? critique.defects : [];

        // Structural failures are appended as criticals AFTER the model's own list. They come from
        // reading the source, so they hold regardless of what the vision model believed it saw.
        const structural = (sourceProbe?.structuralFailures || []).map((failure) => ({
            severity: 'critical',
            category: failure.category,
            defect: failure.defect,
            fix: failure.fix,
            source: 'static-probe',
        }));

        const all = [...defects, ...structural];
        const criticals = all.filter((defect) => String(defect.severity).toLowerCase() === 'critical');

        // Models drop the `average` field fairly often even when every score is present. Recompute
        // it rather than logging "avg ?/3" — this number is how we track whether quality is moving.
        const scoreValues = Object.values(critique.scores || {}).map(Number).filter(Number.isFinite);
        const average = Number.isFinite(Number(critique.average))
            ? Number(critique.average)
            : (scoreValues.length ? Number((scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length).toFixed(2)) : null);

        const result = {
            model,
            provider,
            scores: critique.scores || {},
            average,
            briefCompliance: String(critique.briefCompliance || ''),
            autoFailures: Array.isArray(critique.autoFailures) ? critique.autoFailures : [],
            defects: all,
            criticalCount: criticals.length,
            // A model that says "ship" while listing a critical is overruled — the rubric's
            // automatic failures are not advisory.
            verdict: criticals.length > 0 ? 'revise' : (critique.verdict === 'ship' ? 'ship' : 'revise'),
            pixelProbe,
            durationMs: Date.now() - startedAt,
        };

        console.log(`👁️  [Critic] avg ${result.average ?? '?'}/3 · ${result.defects.length} defect(s) (${result.criticalCount} critical) · verdict ${result.verdict} · ${provider}/${model} · ${result.durationMs}ms`);
        return result;
    } catch (error) {
        console.warn(`👁️  [Critic] Critique failed (${error?.message || error}) — continuing without it.`);
        return null;
    }
}

/**
 * Turn a critique into the repair instruction the builder receives. Only the defects worth spending
 * a full CLI re-run on are included: criticals and majors, capped, most severe first. Minors are
 * dropped on purpose — a repair turn that touches nine cosmetic things tends to regress the game.
 */
export function formatCritiqueForRepair(critique, { maxDefects = 6 } = {}) {
    if (!critique) return null;
    const rank = { critical: 0, major: 1, minor: 2 };
    const actionable = critique.defects
        .filter((defect) => String(defect.severity).toLowerCase() !== 'minor')
        .sort((a, b) => (rank[String(a.severity).toLowerCase()] ?? 3) - (rank[String(b.severity).toLowerCase()] ?? 3))
        .slice(0, maxDefects);

    if (actionable.length === 0) return null;

    const list = actionable
        .map((defect, i) => `${i + 1}. [${String(defect.severity).toUpperCase()}] ${defect.category}: ${defect.defect}\n   FIX: ${defect.fix}`)
        .join('\n\n');

    return `The game you built runs without crashing, but an art director reviewed screenshots of it during play and rejected the current build.

${critique.briefCompliance ? `Their note on how well it matches the brief:\n${critique.briefCompliance}\n` : ''}
Defects that must be fixed:

${list}

Fix every defect above in the existing code in this directory. Rules for this pass:
- Do NOT rewrite the game from scratch and do NOT change the core mechanics — they work. This is a visual and presentation pass.
- Do NOT fix a "primitives everywhere" defect by adding glow, fog, bloom, or particles on top of the primitives. Build the actual forms.
- Keep the game playable: it must still boot, run, and respond to touch when you are done.
- Run "npm run build" when you are finished, then exit.`;
}
