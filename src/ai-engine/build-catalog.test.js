import { describe, it, expect, beforeAll } from 'vitest';
import { buildCatalog, generateDescription } from './build-catalog.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('build-catalog', () => {
  describe('generateDescription', () => {
    it('should generate description for sprite with dimensions', () => {
      const desc = generateDescription('sprites/zombie.png', 'sprite', {
        dimensions: { width: 256, height: 256 }
      });
      expect(desc).toBe('zombie sprite (256x256)');
    });

    it('should generate description for spritesheet with frames', () => {
      const desc = generateDescription('animations/player.json', 'spritesheet_data', {
        frames: 24
      });
      expect(desc).toBe('player spritesheet_data [24 frames]');
    });

    it('should generate description for audio without metadata', () => {
      const desc = generateDescription('audio/music.mp3', 'audio', {});
      expect(desc).toBe('music audio');
    });

    it('should generate description with both dimensions and frames', () => {
      const desc = generateDescription('animations/enemy.png', 'spritesheet', {
        dimensions: { width: 512, height: 128 },
        frames: 8
      });
      expect(desc).toBe('enemy spritesheet (512x128) [8 frames]');
    });
  });

  describe('buildCatalog', () => {
    let catalog;
    const catalogPath = path.join(__dirname, 'phaser-cdn-catalog.json');

    beforeAll(async () => {
      // Build the catalog (this will take a few seconds)
      catalog = await buildCatalog();
    });

    it('should create a catalog object', () => {
      expect(catalog).toBeDefined();
      expect(catalog).not.toBeNull();
    });

    it('should have metadata section with required fields', () => {
      expect(catalog.metadata).toBeDefined();
      expect(catalog.metadata.version).toBe('1.0.0');
      expect(catalog.metadata.lastUpdated).toBeDefined();
      expect(catalog.metadata.totalAssets).toBeGreaterThan(0);
      expect(catalog.metadata.assetsPath).toBeDefined();
      expect(catalog.metadata.baseUrl).toBeDefined();
    });

    it('should set baseUrl based on environment', () => {
      if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        expect(catalog.metadata.baseUrl).toBe(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}/assets/`);
      } else {
        expect(catalog.metadata.baseUrl).toBe('http://localhost:3000/assets/');
      }
    });

    it('should have assets array', () => {
      expect(catalog.assets).toBeDefined();
      expect(Array.isArray(catalog.assets)).toBe(true);
      expect(catalog.assets.length).toBeGreaterThan(0);
    });

    it('should have valid asset entries', () => {
      const asset = catalog.assets[0];
      expect(asset.path).toBeDefined();
      expect(asset.filename).toBeDefined();
      expect(asset.type).toBeDefined();
      expect(asset.themes).toBeDefined();
      expect(Array.isArray(asset.themes)).toBe(true);
      expect(asset.extension).toBeDefined();
      expect(asset.description).toBeDefined();
    });

    it('should normalize path separators to forward slashes', () => {
      catalog.assets.forEach(asset => {
        expect(asset.path).not.toContain('\\');
      });
    });

    it('should have categories summary', () => {
      expect(catalog.categories).toBeDefined();
      expect(typeof catalog.categories).toBe('object');
      
      // Should have at least sprite and audio categories
      expect(catalog.categories.sprite).toBeGreaterThan(0);
    });

    it('should have themes summary', () => {
      expect(catalog.themes).toBeDefined();
      expect(typeof catalog.themes).toBe('object');
      
      // Should have at least generic theme
      expect(catalog.themes.generic).toBeGreaterThan(0);
    });

    it('should write catalog file to disk', () => {
      expect(fs.existsSync(catalogPath)).toBe(true);
      
      // Verify file is valid JSON
      const fileContent = fs.readFileSync(catalogPath, 'utf8');
      const parsedCatalog = JSON.parse(fileContent);
      
      expect(parsedCatalog.metadata).toBeDefined();
      expect(parsedCatalog.assets).toBeDefined();
      expect(parsedCatalog.categories).toBeDefined();
      expect(parsedCatalog.themes).toBeDefined();
    });

    it('should match totalAssets count with assets array length', () => {
      expect(catalog.metadata.totalAssets).toBe(catalog.assets.length);
    });

    it('should have category counts matching asset types', () => {
      const countedCategories = {};
      catalog.assets.forEach(asset => {
        countedCategories[asset.type] = (countedCategories[asset.type] || 0) + 1;
      });
      
      expect(catalog.categories).toEqual(countedCategories);
    });

    it('should have theme counts matching asset themes', () => {
      const countedThemes = {};
      catalog.assets.forEach(asset => {
        asset.themes.forEach(theme => {
          countedThemes[theme] = (countedThemes[theme] || 0) + 1;
        });
      });
      
      expect(catalog.themes).toEqual(countedThemes);
    });
  });
});
