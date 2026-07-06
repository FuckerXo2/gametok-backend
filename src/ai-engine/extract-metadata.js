import fs from 'fs';
import path from 'path';
import sizeOf from 'image-size';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Assets root path
const ASSETS_ROOT = path.join(__dirname, '../../public/assets');

/**
 * Extract metadata for an asset file
 * @param {string} filePath - Relative path to asset file (from /assets/)
 * @param {string} type - Asset type (sprite, spritesheet, audio, spritesheet_data, etc.)
 * @returns {Promise<Object>} Metadata object with fileSize, dimensions, frames, duration
 */
async function extractMetadata(filePath, type) {
  const fullPath = path.join(ASSETS_ROOT, filePath);
  
  const metadata = {
    fileSize: 0,
    dimensions: null,
    frames: null,
    duration: null
  };
  
  try {
    // Extract file size
    const stats = fs.statSync(fullPath);
    metadata.fileSize = stats.size;
    
    // Extract dimensions for images
    if (type === 'sprite' || type === 'spritesheet') {
      try {
        const buffer = fs.readFileSync(fullPath);
        const dimensions = sizeOf(buffer);
        metadata.dimensions = {
          width: dimensions.width,
          height: dimensions.height
        };
      } catch (err) {
        console.warn(`Failed to get dimensions for ${filePath}:`, err.message);
      }
    }
    
    // Parse spritesheet JSON for frame data
    if (type === 'spritesheet_data') {
      try {
        const jsonData = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        
        // Detect spritesheet format (TexturePacker, Phaser, etc.)
        if (jsonData.frames) {
          metadata.frames = Array.isArray(jsonData.frames) 
            ? jsonData.frames.length 
            : Object.keys(jsonData.frames).length;
        }
      } catch (err) {
        console.warn(`Failed to parse JSON ${filePath}:`, err.message);
      }
    }
    
    // Audio duration extraction (optional - skip for now to avoid heavy deps)
    // Can add later with music-metadata library if needed
    
  } catch (err) {
    console.error(`Failed to extract metadata for ${filePath}:`, err.message);
  }
  
  return metadata;
}

export { extractMetadata, ASSETS_ROOT };
