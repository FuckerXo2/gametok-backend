import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

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
    // 1. Write prompt contents to instruction files so the CLI agent can read them
    const instructionsPath = path.join(projectRoot, 'instructions.txt');
    const briefPath = path.join(projectRoot, 'design_brief.md');

    await fs.writeFile(instructionsPath, systemPrompt, 'utf-8');
    await fs.writeFile(briefPath, userPrompt, 'utf-8');

    // Symlink the threejs-skills folder into the project workspace
    const destSkillsPath = path.join(projectRoot, 'threejs-skills');
    try {
        await fs.symlink(path.join(__dirname, 'threejs-skills'), destSkillsPath, 'dir');
        console.log(`🔗 [Kimi Runner] Created symlink for Three.js skills inside workspace`);
    } catch (err) {
        // If symlink fails (e.g. file exists), check and ignore
    }

    // Copy the Sketchfab 3D model search tool into the workspace
    const fetchModelSrc = path.join(__dirname, 'fetch-3d-model.js');
    const fetchModelDest = path.join(projectRoot, 'fetch-3d-model.js');
    try {
        await fs.copyFile(fetchModelSrc, fetchModelDest);
        console.log(`🔗 [Kimi Runner] Copied fetch-3d-model.js into workspace`);
    } catch (err) {
        console.warn(`⚠️ [Kimi Runner] Could not copy fetch-3d-model.js: ${err.message}`);
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
Read instructions.txt and design_brief.md in this directory.
Generate a complete, high-quality, mobile-friendly game in this folder based on the specifications.
CRITICAL Rules:
1. Do NOT use placeholder assets; use ONLY the real asset URLs mapped in design_brief.md.
2. Write a standard static HTML/JS/CSS game. Do NOT use Vite, webpack, or any npm package bundlers.
3. Load any required external libraries (Phaser, Three.js, etc.) via public CDN <script> tags in index.html (e.g. from https://cdnjs.cloudflare.com/ or https://cdn.jsdelivr.net/).
4. Ensure the main entry script is loaded in index.html (e.g. using <script type="module" src="main.js"></script>).
5. Put CSS styles in style.css and load it via a link tag in index.html.
6. If you decide to build a 3D game using Three.js, read the relevant graphics, UI, and gameplay guidelines in the "./threejs-skills" directory to ensure showcase quality.
7. To find 3D models (characters, vehicles, animals, spaceships, etc.) for your game, run: node fetch-3d-model.js "search query"
   It searches Sketchfab for downloadable GLB models under 1MB, downloads the best match, and prints a JSON object with a public CDN "url" you can load directly with THREE.GLTFLoader.
   Example: node fetch-3d-model.js "low poly dragon" → {"url":"https://...glb","name":"Dragon","animated":true}
   Run this for each 3D character/entity you need. Use the returned URL in your GLTFLoader.load() calls.
   If the model has animations (animated: true), inspect gltf.animations at runtime and play the best matching clip.
8. Run "npm run build" to verify everything is set up.
9. Exit once the build is successful.
`;

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
