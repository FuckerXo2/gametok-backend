import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureKimiCliAuth } from './kimi-cli-auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Runs the Kimi Code CLI globally installed on the system to autonomously write
 * and compile the game inside projectRoot.
 * 
 * @param {string} projectRoot - The path where Kimi should write files and compile the game.
 * @param {string} systemPrompt - The detailed guidelines, game rules, and Phaser specs.
 * @param {string} userPrompt - The specific game concept and the assets list.
 * @returns {Promise<void>} Resolves when the Kimi CLI completes successfully.
 */
export async function runKimiCliAgent(projectRoot, systemPrompt, userPrompt) {
    // 1. Write the full prompt (build rules + game idea, or repair instructions) into a single
    //    instruction file the CLI agent reads. There is no separate design brief anymore.
    const instructionsPath = path.join(projectRoot, 'instructions.txt');
    const combined = userPrompt ? `${systemPrompt}\n\n${userPrompt}` : systemPrompt;
    await fs.writeFile(instructionsPath, combined, 'utf-8');

    // Symlink the threejs-skills folder into the project workspace
    const destSkillsPath = path.join(projectRoot, 'threejs-skills');
    try {
        await fs.symlink(path.join(__dirname, 'threejs-skills'), destSkillsPath, 'dir');
        console.log(`🔗 [Kimi Runner] Created symlink for Three.js skills inside workspace`);
    } catch (err) {
        // If symlink fails (e.g. file exists), check and ignore
    }

    // 2. Prepare a package.json with a simple dummy build script.
    // This allows the agent to run "npm run build" and pass verification immediately.
    const packageJsonPath = path.join(projectRoot, 'package.json');
    const minimalPackageJson = {
        name: "gametok-kimi-game",
        version: "1.0.0",
        type: "module",
        scripts: {
            "build": "echo 'Build successful'"
        }
    };
    await fs.writeFile(packageJsonPath, JSON.stringify(minimalPackageJson, null, 2), 'utf-8');

    // 3. Define the instruction for Kimi CLI
    const instructionPrompt = `
Read instructions.txt in this directory.
Generate a complete, high-quality, mobile-friendly game in this folder based on the specifications.
CRITICAL Rules:
1. Write a standard static HTML/JS/CSS game. Do NOT use Vite, webpack, or any npm package bundlers.
2. Load any required external libraries (Phaser, Three.js, etc.) via public CDN <script> tags in index.html (e.g. from https://cdnjs.cloudflare.com/ or https://cdn.jsdelivr.net/).
3. Ensure the main entry script is loaded in index.html (e.g. using <script type="module" src="main.js"></script>).
4. Put CSS styles in style.css and load it via a link tag in index.html.
5. If you decide to build a 3D game using Three.js, read the relevant graphics, UI, and gameplay guidelines in the "./threejs-skills" directory to ensure showcase quality.
6. ASSETS — optional, but powerful. You have full web access (curl/wget/node). You MAY pull free public-domain / CC0 art assets directly from these libraries to make the game look great, instead of drawing everything in code:
   - Poly Haven (https://polyhaven.com, JSON API at https://api.polyhaven.com) — CC0 3D models (.glb/.gltf), PBR textures, and HDRI environment maps. Great for realistic lighting and ground/wall/sky.
   - Quaternius (https://quaternius.com) — CC0 low-poly 3D character/creature/vehicle packs, many with baked animations (.glb). Best source for animated characters.
   - AmbientCG (https://ambientcg.com, API at https://ambientcg.com/api/v2/full_json) — CC0 PBR material textures (grass, dirt, wood, metal, stone).
   - Kenney (https://kenney.nl) — CC0 2D sprites/tilesets AND 3D packs, clean and game-ready.
   - OpenGameArt (https://opengameart.org, filter to CC0/Public Domain) — 2D sprites, tilesets, backgrounds.
   These are only suggestions — use them when they raise quality, otherwise code-draw. Nothing is mandatory.
7. VERIFY EVERY ASSET BEFORE USING IT — this is the one hard rule for assets. For each asset URL you intend to load, first confirm it actually works: fetch it and check HTTP 200 + correct content-type, and for a .glb confirm the file begins with the "glTF" magic bytes, for an image confirm it decodes (non-zero dimensions). If an asset fails verification (404, wrong type, corrupt, too large to load quickly), DO NOT ship it — pick another candidate or fall back to drawing that entity in code. Never leave a broken/placeholder asset reference in the final game.
8. Run "npm run build" to verify everything is set up.
9. Exit once the build is successful.
`;

    // The CLI cannot read an API key from the environment — it only reads
    // <KIMI_CODE_HOME>/config.toml (normally written by the interactive `kimi
    // login`). Write that file ourselves, or the spawn below dies with
    // "No model configured" before generating anything.
    const auth = ensureKimiCliAuth();
    if (auth.ok) {
        console.log(`🔑 [Kimi Runner] Auth ready: ${auth.reason}`);
    } else {
        console.error(`❌ [Kimi Runner] KIMI CLI IS NOT AUTHENTICATED: ${auth.reason}`);
        console.error(`   The CLI will fail with "No model configured". Set NVIDIA_API_KEY (default) or MOONSHOT_API_KEY.`);
    }

    // Determine target kimi executable by checking multiple possible container/system paths
    const candidatePaths = [
        process.env.KIMI_PATH,
        path.join(process.env.HOME || '', '.kimi-code', 'bin', 'kimi'),
        '/root/.kimi-code/bin/kimi',
        '/home/nixpacks/.kimi-code/bin/kimi',
        '/usr/local/bin/kimi',
        '/app/.kimi-code/bin/kimi'
    ].filter(Boolean);

    let kimiCmd = 'kimi'; // Default fallback to system PATH search
    for (const p of candidatePaths) {
        try {
            await fs.access(p);
            kimiCmd = p;
            console.log(`🔍 [Kimi Runner] Found Kimi CLI executable at: ${p}`);
            break;
        } catch {
            // Check next candidate
        }
    }

    console.log(`🤖 [Kimi Runner] Spawning global Kimi CLI (${kimiCmd}) in: ${projectRoot}`);

    return new Promise((resolve, reject) => {
        // Spawn the global 'kimi' executable
        const kimiProcess = spawn(kimiCmd, [
            '--prompt', instructionPrompt,
            '--yolo', // Auto-approve file modifications and shell executions (like npm run build)
            '--output-format', 'text'
        ], {
            cwd: projectRoot,
            env: { 
                ...process.env, 
                // Ensure Kimi CLI has access to the Moonshot API Key
                MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY 
            }
        });

        // Track output and print it. This will automatically stream into AsyncLocalStorage genLogStore for DB telemetry.
        kimiProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) console.log(`[Kimi CLI] ${trimmed}`);
            }
        });

        kimiProcess.stderr.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) console.error(`[Kimi CLI Error] ${trimmed}`);
            }
        });

        kimiProcess.on('error', (err) => {
            console.error(`❌ [Kimi Runner] Failed to start Kimi CLI process:`, err);
            reject(err);
        });

        kimiProcess.on('close', (code) => {
            console.log(`ℹ [Kimi Runner] Kimi CLI exited with code: ${code}`);
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Kimi CLI failed with exit code ${code}`));
            }
        });
    });
}
