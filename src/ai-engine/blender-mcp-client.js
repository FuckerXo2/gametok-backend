/**
 * Blender MCP Client for GameTok AI Engine
 * 
 * Communicates with the Blender MCP server (port 9876) or falls back to headless
 * Blender execution (blender -b -P) so the AI agent can inspect, model, proceduralize,
 * and export 3D scenes, level geometry, and props dynamically.
 */

import net from 'net';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BLENDER_HOST = process.env.BLENDER_MCP_HOST || '127.0.0.1';
const BLENDER_PORT = Number(process.env.BLENDER_MCP_PORT || 9876);
const BLENDER_BIN = process.env.BLENDER_BIN || (
    fs.existsSync('/opt/homebrew/bin/blender') ? '/opt/homebrew/bin/blender' :
    fs.existsSync('/Applications/Blender.app/Contents/MacOS/Blender') ? '/Applications/Blender.app/Contents/MacOS/Blender' :
    'blender'
);

const STORAGE_ROOT = process.env.ASSET_STORAGE_ROOT || path.resolve(__dirname, '../../storage');
const SCENES_DIR = path.join(STORAGE_ROOT, 'models3d', 'scenes');

/**
 * Rapid probe if the Blender MCP socket is currently reachable
 */
export async function isBlenderMcpLive(timeoutMs = 800) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let resolved = false;

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => {
            if (!resolved) {
                resolved = true;
                socket.destroy();
                resolve(true);
            }
        });

        socket.once('timeout', () => {
            if (!resolved) {
                resolved = true;
                socket.destroy();
                resolve(false);
            }
        });

        socket.once('error', () => {
            if (!resolved) {
                resolved = true;
                socket.destroy();
                resolve(false);
            }
        });

        try {
            socket.connect(BLENDER_PORT, BLENDER_HOST);
        } catch {
            resolve(false);
        }
    });
}

/**
 * Execute Python code via the Blender MCP TCP socket
 */
function executeViaSocket(pythonCode, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        let buffer = '';
        let timer = null;

        timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`Blender MCP socket request timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        socket.connect(BLENDER_PORT, BLENDER_HOST, () => {
            const payload = JSON.stringify({
                type: 'execute',
                code: pythonCode,
                strict_json: false
            }) + '\0';
            socket.write(payload);
        });

        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            if (buffer.includes('\0')) {
                clearTimeout(timer);
                const raw = buffer.slice(0, buffer.indexOf('\0'));
                socket.destroy();
                try {
                    const parsed = JSON.parse(raw);
                    resolve(parsed);
                } catch (err) {
                    reject(new Error(`Failed to parse Blender MCP response: ${err.message}. Raw: ${raw.slice(0, 300)}`));
                }
            }
        });

        socket.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

/**
 * Fallback: Execute Python code via headless Blender subprocess
 */
async function executeViaHeadlessSubprocess(pythonCode, timeoutMs = 60000) {
    fs.mkdirSync(path.join(__dirname, '.tmp_blender'), { recursive: true });
    const tempScript = path.join(__dirname, '.tmp_blender', `exec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.py`);
    const tempOutput = path.join(__dirname, '.tmp_blender', `out_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.json`);

    const wrappedCode = `
import bpy
import json
import traceback

__output_path = ${JSON.stringify(tempOutput)}
result = {}

try:
${pythonCode.split('\n').map(l => '    ' + l).join('\n')}

    with open(__output_path, 'w') as f:
        json.dump({"status": "ok", "result": result}, f, default=str)
except Exception as ex:
    with open(__output_path, 'w') as f:
        json.dump({"status": "error", "message": traceback.format_exc()}, f)
`;

    await fs.promises.writeFile(tempScript, wrappedCode, 'utf8');

    return new Promise((resolve, reject) => {
        const proc = spawn(BLENDER_BIN, ['-b', '-P', tempScript], {
            timeout: timeoutMs,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('close', async (code) => {
            try {
                if (fs.existsSync(tempOutput)) {
                    const data = await fs.promises.readFile(tempOutput, 'utf8');
                    await fs.promises.unlink(tempOutput).catch(() => {});
                    await fs.promises.unlink(tempScript).catch(() => {});
                    resolve(JSON.parse(data));
                } else {
                    await fs.promises.unlink(tempScript).catch(() => {});
                    resolve({
                        status: code === 0 ? 'ok' : 'error',
                        message: stderr || stdout || `Blender exited with code ${code}`,
                        stdout: stdout.slice(-1000)
                    });
                }
            } catch (readErr) {
                await fs.promises.unlink(tempScript).catch(() => {});
                reject(readErr);
            }
        });

        proc.on('error', async (err) => {
            await fs.promises.unlink(tempScript).catch(() => {});
            reject(err);
        });
    });
}

/**
 * Universal Blender code execution: Tries MCP socket first, auto-falls back to headless CLI
 */
export async function executeBlenderCode(pythonCode) {
    const isLive = await isBlenderMcpLive(400);
    if (isLive) {
        try {
            console.log('⚡ [Blender MCP] Executing via live TCP socket bridge...');
            return await executeViaSocket(pythonCode);
        } catch (socketErr) {
            console.warn(`⚠️ [Blender MCP] Socket error (${socketErr.message}). Falling back to headless Blender...`);
        }
    }

    console.log('⚙️ [Blender MCP] Executing via headless Blender CLI fallback...');
    return await executeViaHeadlessSubprocess(pythonCode);
}

/**
 * Get active Blender scene summary (objects, meshes, materials, vertex counts)
 */
export async function getBlenderSceneSummary() {
    const code = `
import bpy

objects = []
for obj in bpy.context.scene.objects:
    item = {
        "name": obj.name,
        "type": obj.type,
        "location": [round(v, 2) for v in obj.location],
        "scale": [round(v, 2) for v in obj.scale],
        "visible": obj.visible_get()
    }
    if obj.type == 'MESH' and obj.data:
        item["vertices"] = len(obj.data.vertices)
        item["polygons"] = len(obj.data.polygons)
        item["materials"] = [m.name for m in obj.data.materials if m]
    objects.append(item)

result = {
    "scene_name": bpy.context.scene.name,
    "total_objects": len(objects),
    "objects": objects
}
`;
    return await executeBlenderCode(code);
}

/**
 * Export current Blender scene to GLB with manifest
 */
export async function exportBlenderSceneGlb({ filename = 'world.glb', worldName = 'Custom World' } = {}) {
    fs.mkdirSync(SCENES_DIR, { recursive: true });
    const cleanFilename = filename.endsWith('.glb') ? filename : `${filename}.glb`;
    const targetGlbPath = path.join(SCENES_DIR, cleanFilename);
    const targetManifestPath = path.join(SCENES_DIR, `${path.basename(cleanFilename, '.glb')}_manifest.json`);

    const code = `
import bpy
import json
import os
import mathutils

glb_path = ${JSON.stringify(targetGlbPath)}
manifest_path = ${JSON.stringify(targetManifestPath)}

# Compute overall scene bounding box
min_x = min_y = min_z = float('inf')
max_x = max_y = max_z = float('-inf')
mesh_count = 0

for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        mesh_count += 1
        matrix = obj.matrix_world
        for corner in obj.bound_box:
            wc = matrix @ mathutils.Vector(corner)
            min_x = min(min_x, wc.x)
            max_x = max(max_x, wc.x)
            min_y = min(min_y, wc.y)
            max_y = max(max_y, wc.y)
            min_z = min(min_z, wc.z)
            max_z = max(max_z, wc.z)

if mesh_count == 0:
    min_x = min_y = min_z = -10
    max_x = max_y = max_z = 10

# Export GLB
bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format='GLB',
    use_selection=False,
    export_apply=True,
    export_yup=True
)

# Export Manifest
manifest = {
    "worldName": ${JSON.stringify(worldName)},
    "glbFile": os.path.basename(glb_path),
    "meshCount": mesh_count,
    "bounds": {
        "minX": round(min_x, 2), "maxX": round(max_x, 2),
        "minY": round(min_y, 2), "maxY": round(max_y, 2),
        "minZ": round(min_z, 2), "maxZ": round(max_z, 2)
    },
    "playerSpawn": {
        "x": 0.0,
        "y": round(max(0.0, min_z + 0.5), 2),
        "z": round((min_y + max_y) / 2.0, 2)
    },
    "objects": [obj.name for obj in bpy.context.scene.objects if obj.type == 'MESH']
}

with open(manifest_path, 'w') as f:
    json.dump(manifest, f, indent=2)

result = {
    "status": "success",
    "glbPath": glb_path,
    "manifestPath": manifest_path,
    "manifest": manifest
}
`;

    const res = await executeBlenderCode(code);
    return res;
}
