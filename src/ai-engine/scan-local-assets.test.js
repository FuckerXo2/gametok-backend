import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { scanAssets, getAssetsRoot } from './scan-local-assets.js';

// Mock fs module
vi.mock('fs');

describe('scan-local-assets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scanAssets', () => {
    it('should scan and return valid asset files', () => {
      const mockEntries = [
        { name: 'sprite1.png', path: '/assets', isFile: () => true },
        { name: 'audio1.mp3', path: '/assets/sounds', isFile: () => true },
        { name: 'data.json', path: '/assets/data', isFile: () => true },
        { name: 'readme.txt', path: '/assets', isFile: () => true }, // Should be filtered out
      ];

      fs.readdirSync.mockReturnValue(mockEntries);
      fs.accessSync.mockImplementation(() => {}); // No errors

      const assets = scanAssets('/assets');

      expect(assets).toHaveLength(3);
      expect(assets).toContain('sprite1.png');
      expect(assets).toContain('sounds/audio1.mp3');
      expect(assets).toContain('data/data.json');
      expect(assets).not.toContain('readme.txt'); // txt files not supported
    });

    it('should handle ENOENT errors and continue processing', () => {
      const mockEntries = [
        { name: 'sprite1.png', path: '/assets', isFile: () => true },
        { name: 'missing.png', path: '/assets', isFile: () => true },
        { name: 'sprite2.png', path: '/assets', isFile: () => true },
      ];

      fs.readdirSync.mockReturnValue(mockEntries);
      
      // Mock accessSync to throw ENOENT for missing.png
      fs.accessSync.mockImplementation((filePath) => {
        if (filePath.includes('missing.png')) {
          const err = new Error('File not found');
          err.code = 'ENOENT';
          throw err;
        }
      });

      const assets = scanAssets('/assets');

      // Should continue and return the other two files
      expect(assets).toHaveLength(2);
      expect(assets).toContain('sprite1.png');
      expect(assets).toContain('sprite2.png');
      expect(assets).not.toContain('missing.png');
      
      // Should log the ENOENT error
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[ENOENT]')
      );
    });

    it('should handle EACCES errors and continue processing', () => {
      const mockEntries = [
        { name: 'sprite1.png', path: '/assets', isFile: () => true },
        { name: 'protected.png', path: '/assets', isFile: () => true },
        { name: 'sprite2.png', path: '/assets', isFile: () => true },
      ];

      fs.readdirSync.mockReturnValue(mockEntries);
      
      // Mock accessSync to throw EACCES for protected.png
      fs.accessSync.mockImplementation((filePath) => {
        if (filePath.includes('protected.png')) {
          const err = new Error('Permission denied');
          err.code = 'EACCES';
          throw err;
        }
      });

      const assets = scanAssets('/assets');

      // Should continue and return the other two files
      expect(assets).toHaveLength(2);
      expect(assets).toContain('sprite1.png');
      expect(assets).toContain('sprite2.png');
      expect(assets).not.toContain('protected.png');
      
      // Should log the EACCES error
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[EACCES]')
      );
    });

    it('should log timestamp with errors', () => {
      const mockEntries = [
        { name: 'missing.png', path: '/assets', isFile: () => true },
      ];

      fs.readdirSync.mockReturnValue(mockEntries);
      
      const err = new Error('File not found');
      err.code = 'ENOENT';
      fs.accessSync.mockImplementation(() => { throw err; });

      scanAssets('/assets');

      // Check that timestamp is logged (ISO format)
      expect(console.error).toHaveBeenCalledWith(
        expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/)
      );
    });

    it('should filter only supported file extensions', () => {
      const mockEntries = [
        { name: 'sprite.png', path: '/assets', isFile: () => true },
        { name: 'image.jpg', path: '/assets', isFile: () => true },
        { name: 'photo.webp', path: '/assets', isFile: () => true },
        { name: 'music.mp3', path: '/assets', isFile: () => true },
        { name: 'sound.wav', path: '/assets', isFile: () => true },
        { name: 'audio.ogg', path: '/assets', isFile: () => true },
        { name: 'data.json', path: '/assets', isFile: () => true },
        { name: 'readme.txt', path: '/assets', isFile: () => true },
        { name: 'doc.pdf', path: '/assets', isFile: () => true },
        { name: 'script.js', path: '/assets', isFile: () => true },
      ];

      fs.readdirSync.mockReturnValue(mockEntries);
      fs.accessSync.mockImplementation(() => {}); // No errors

      const assets = scanAssets('/assets');

      // Should only include supported extensions
      expect(assets).toHaveLength(7);
      expect(assets).toContain('sprite.png');
      expect(assets).toContain('image.jpg');
      expect(assets).toContain('photo.webp');
      expect(assets).toContain('music.mp3');
      expect(assets).toContain('sound.wav');
      expect(assets).toContain('audio.ogg');
      expect(assets).toContain('data.json');
      
      // Should exclude unsupported extensions
      expect(assets).not.toContain('readme.txt');
      expect(assets).not.toContain('doc.pdf');
      expect(assets).not.toContain('script.js');
    });

    it('should normalize path separators to forward slashes', () => {
      const mockEntries = [
        { name: 'sprite.png', path: '/assets/sprites/characters', isFile: () => true },
      ];

      fs.readdirSync.mockReturnValue(mockEntries);
      fs.accessSync.mockImplementation(() => {}); // No errors

      const assets = scanAssets('/assets');

      // Path should use forward slashes regardless of OS
      expect(assets[0]).toBe('sprites/characters/sprite.png');
      expect(assets[0]).not.toContain('\\');
    });

    it('should skip directories', () => {
      const mockEntries = [
        { name: 'sprites', path: '/assets', isFile: () => false },
        { name: 'sprite.png', path: '/assets', isFile: () => true },
      ];

      fs.readdirSync.mockReturnValue(mockEntries);
      fs.accessSync.mockImplementation(() => {}); // No errors

      const assets = scanAssets('/assets');

      expect(assets).toHaveLength(1);
      expect(assets).toContain('sprite.png');
    });

    it('should return empty array when directory does not exist', () => {
      const err = new Error('Directory not found');
      err.code = 'ENOENT';
      fs.readdirSync.mockImplementation(() => { throw err; });

      const assets = scanAssets('/nonexistent');

      expect(assets).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Assets directory not found')
      );
    });

    it('should return empty array when directory access is denied', () => {
      const err = new Error('Permission denied');
      err.code = 'EACCES';
      fs.readdirSync.mockImplementation(() => { throw err; });

      const assets = scanAssets('/protected');

      expect(assets).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Permission denied accessing')
      );
    });

    it('should warn when error rate exceeds 20%', () => {
      const mockEntries = [
        { name: 'sprite1.png', path: '/assets', isFile: () => true },
        { name: 'error1.png', path: '/assets', isFile: () => true },
        { name: 'error2.png', path: '/assets', isFile: () => true },
        { name: 'error3.png', path: '/assets', isFile: () => true },
        { name: 'sprite2.png', path: '/assets', isFile: () => true },
      ];

      fs.readdirSync.mockReturnValue(mockEntries);
      
      // Mock accessSync to throw errors for 3 out of 5 files (60% error rate)
      fs.accessSync.mockImplementation((filePath) => {
        if (filePath.includes('error')) {
          const err = new Error('File not found');
          err.code = 'ENOENT';
          throw err;
        }
      });

      scanAssets('/assets');

      // Should log warning about high error rate
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('WARNING: High error rate detected')
      );
    });
  });

  describe('getAssetsRoot', () => {
    it('should return the assets root path', () => {
      const assetsRoot = getAssetsRoot();
      expect(assetsRoot).toContain('public/assets');
    });
  });
});
