import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Assets root path
const ASSETS_ROOT = path.join(__dirname, '../../public/assets');

// Supported file extensions for asset discovery
const SUPPORTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.mp3', '.wav', '.ogg', '.json'];

/**
 * Log file system errors with detailed information
 * @param {string} filePath - Path where error occurred
 * @param {string} errorCode - Error code (ENOENT, EACCES, etc.)
 * @param {string} errorMessage - Detailed error message
 */
function logFileSystemError(filePath, errorCode, errorMessage) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] File system error [${errorCode}]: ${filePath}`);
  console.error(`  Message: ${errorMessage}`);
}

/**
 * Recursively scan the assets directory for supported asset files
 * @param {string} rootPath - Root path to scan (defaults to ASSETS_ROOT)
 * @returns {string[]} Array of relative file paths from the assets root
 */
export function scanAssets(rootPath = ASSETS_ROOT) {
  const assets = [];
  let errorCount = 0;
  let totalFiles = 0;
  
  console.log(`🔍 Scanning assets in: ${rootPath}`);
  
  try {
    // Recursively walk the directory tree
    function walkDirectory(currentPath) {
      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          
          if (entry.isDirectory()) {
            // Recursively walk subdirectories
            walkDirectory(fullPath);
          } else if (entry.isFile()) {
            totalFiles++;
            
            // Get file extension
            const ext = path.extname(entry.name).toLowerCase();
            
            // Filter by supported extensions
            if (!SUPPORTED_EXTENSIONS.includes(ext)) {
              continue;
            }
            
            try {
              // Try to access the file to catch ENOENT and EACCES errors
              try {
                fs.accessSync(fullPath, fs.constants.R_OK);
              } catch (accessErr) {
                // Handle file access errors
                if (accessErr.code === 'ENOENT') {
                  logFileSystemError(fullPath, 'ENOENT', 'File not found');
                  errorCount++;
                  continue;
                } else if (accessErr.code === 'EACCES') {
                  logFileSystemError(fullPath, 'EACCES', 'Permission denied');
                  errorCount++;
                  continue;
                } else {
                  // Log other access errors but continue
                  logFileSystemError(fullPath, accessErr.code || 'UNKNOWN', accessErr.message);
                  errorCount++;
                  continue;
                }
              }
              
              // Calculate relative path from assets root
              const relativePath = path.relative(rootPath, fullPath);
              
              // Normalize path separators to forward slashes
              const normalizedPath = relativePath.replace(/\\/g, '/');
              
              assets.push(normalizedPath);
              
            } catch (err) {
              // Catch any unexpected errors during path processing
              logFileSystemError(fullPath, err.code || 'UNKNOWN', err.message);
              errorCount++;
              // Continue processing other files
            }
          }
        }
      } catch (err) {
        // Handle directory read errors
        if (err.code === 'EACCES') {
          logFileSystemError(currentPath, 'EACCES', 'Permission denied');
          errorCount++;
        } else {
          logFileSystemError(currentPath, err.code || 'UNKNOWN', err.message);
          errorCount++;
        }
      }
    }
    
    // Start walking from the root path
    walkDirectory(rootPath);
    
    console.log(`✅ Scan complete: Found ${assets.length} assets (${totalFiles} files scanned, ${errorCount} errors)`);
    
    // Check if error rate is too high (>20% as per requirement 9.5)
    if (totalFiles > 0) {
      const errorRate = errorCount / totalFiles;
      if (errorRate > 0.2) {
        console.error(`⚠️  WARNING: High error rate detected: ${(errorRate * 100).toFixed(1)}% (${errorCount}/${totalFiles})`);
        console.error(`   This may indicate a serious file system issue.`);
      }
    }
    
  } catch (err) {
    // Handle errors at the root level
    if (err.code === 'ENOENT') {
      console.error(`❌ Assets directory not found: ${rootPath}`);
      console.error(`   Please ensure the directory exists.`);
    } else if (err.code === 'EACCES') {
      console.error(`❌ Permission denied accessing: ${rootPath}`);
      console.error(`   Please check directory permissions.`);
    } else {
      console.error(`❌ Failed to scan assets directory:`, err.message);
      console.error(`   Error code: ${err.code || 'UNKNOWN'}`);
    }
    return [];
  }
  
  return assets;
}

/**
 * Get the assets root path
 * @returns {string} Absolute path to assets directory
 */
export function getAssetsRoot() {
  return ASSETS_ROOT;
}

// Export for use in other modules
export { ASSETS_ROOT };
