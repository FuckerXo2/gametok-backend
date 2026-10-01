/**
 * Character Rigging Service for GameTok (Hermes + Gemini)
 * 
 * Automatically detects whether incoming 3D character models (.glb) already possess
 * skeletal bones, or executes headless Blender auto-rigging to bind them to the
 * Master UE5 Armature for instant compatibility with all 2,457 MoCap animations.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const SKELETON_PATH = path.join(__dirname, '../../storage/skeletons/ue5_master_skeleton.glb');
const RIGGED_CACHE_DIR = path.join(__dirname, '../../storage/models3d/rigged');
const AUTO_RIG_SCRIPT = path.join(__dirname, 'blender-auto-rig.py');

/**
 * Rapidly check if a .glb file has an embedded armature / skeleton
 * Reads only the first 1KB of the GLB JSON header in ~2ms.
 */
export function isGlbRigged(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(20);
    fs.readSync(fd, headerBuf, 0, 20, 0);

    const magic = headerBuf.toString('ascii', 0, 4);
    if (magic !== 'glTF') {
      fs.closeSync(fd);
      return false;
    }

    const chunkLen = headerBuf.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(chunkLen);
    fs.readSync(fd, jsonBuf, 0, chunkLen, 20);
    fs.closeSync(fd);

    const json = JSON.parse(jsonBuf.toString('utf8'));
    return Array.isArray(json.skins) && json.skins.length > 0;
  } catch (err) {
    console.warn(`[CharacterRigger] Error checking rig for ${filePath}:`, err.message);
    return false;
  }
}

/**
 * Check if the Blender binary is available on the machine
 */
export async function isBlenderAvailable() {
  const customBin = process.env.BLENDER_BIN;
  const candidates = [customBin, 'blender', '/Applications/Blender.app/Contents/MacOS/Blender'].filter(Boolean);

  for (const bin of candidates) {
    try {
      const available = await new Promise((resolve) => {
        const proc = spawn(bin, ['--version']);
        proc.on('error', () => resolve(false));
        proc.on('close', (code) => resolve(code === 0));
      });
      if (available) return bin;
    } catch {
      // Continue check
    }
  }
  return null;
}

/**
 * Ensure character model is rigged with the Master UE5 Skeleton
 * @param {string} inputPath - Absolute path to character .glb or .obj
 * @param {object} [opts] - Options { forceReRig: boolean, outputDir: string }
 * @returns {Promise<{ success: boolean, riggedPath: string, cached: boolean, hasBones: boolean }>}
 */
export async function ensureCharacterRigged(inputPath, opts = {}) {
  const resolvedInput = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`[CharacterRigger] Input character not found: ${resolvedInput}`);
  }

  const baseName = path.basename(resolvedInput, path.extname(resolvedInput));
  fs.mkdirSync(RIGGED_CACHE_DIR, { recursive: true });
  const targetRiggedPath = path.join(opts.outputDir || RIGGED_CACHE_DIR, `${baseName}_rigged.glb`);

  // 1. Check if input model is ALREADY rigged
  if (!opts.forceReRig && isGlbRigged(resolvedInput)) {
    console.log(`✨ [CharacterRigger] "${baseName}" is already rigged with skeleton. Ready for animations.`);
    return {
      success: true,
      riggedPath: resolvedInput,
      cached: true,
      hasBones: true,
    };
  }

  // 2. Check if cached rigged version already exists on disk
  if (!opts.forceReRig && fs.existsSync(targetRiggedPath) && isGlbRigged(targetRiggedPath)) {
    console.log(`📦 [CharacterRigger] Loaded pre-rigged cached version: ${targetRiggedPath}`);
    return {
      success: true,
      riggedPath: targetRiggedPath,
      cached: true,
      hasBones: true,
    };
  }

  // 3. Model needs auto-rigging -> Check Blender
  const blenderBin = await isBlenderAvailable();
  if (!blenderBin) {
    console.warn(`⚠️ [CharacterRigger] Blender is not installed on this host. Cannot execute auto-rigging.`);
    console.warn(`👉 Character "${baseName}" will load as static mesh (procedural animations will be used).`);
    return {
      success: false,
      riggedPath: resolvedInput,
      cached: false,
      hasBones: false,
      warning: 'blender_not_installed',
    };
  }

  // 4. Execute Headless Blender Auto-Rigging
  console.log(`🦾 [CharacterRigger] Running Headless Blender Auto-Rigger for "${baseName}"...`);
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const proc = spawn(blenderBin, [
      '-b',
      '-P', AUTO_RIG_SCRIPT,
      '--',
      resolvedInput,
      targetRiggedPath,
      SKELETON_PATH
    ]);

    let outputLog = '';
    proc.stdout.on('data', (d) => { outputLog += d.toString(); });
    proc.stderr.on('data', (d) => { outputLog += d.toString(); });

    proc.on('close', (code) => {
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      if (code === 0 && fs.existsSync(targetRiggedPath)) {
        console.log(`🎉 [CharacterRigger] Auto-rigged "${baseName}" successfully in ${elapsedSec}s!`);
        resolve({
          success: true,
          riggedPath: targetRiggedPath,
          cached: false,
          hasBones: true,
          elapsedSec,
        });
      } else {
        console.error(`💥 [CharacterRigger] Auto-rig failed for "${baseName}" (exit code ${code}):\n`, outputLog);
        resolve({
          success: false,
          riggedPath: resolvedInput,
          cached: false,
          hasBones: false,
          error: outputLog,
        });
      }
    });

    proc.on('error', (err) => {
      console.error(`💥 [CharacterRigger] Process spawn error:`, err.message);
      resolve({
        success: false,
        riggedPath: resolvedInput,
        cached: false,
        hasBones: false,
        error: err.message,
      });
    });
  });
}
