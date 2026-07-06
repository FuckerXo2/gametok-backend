import { describe, it, expect, beforeEach } from 'vitest';
import { getCatalog, getAssetsByTheme, getDiverseSample } from './load-catalog.js';

describe('load-catalog', () => {
  describe('getCatalog', () => {
    it('should return a valid catalog object', () => {
      const catalog = getCatalog();
      
      expect(catalog).toBeDefined();
      expect(catalog).not.toBeNull();
      expect(catalog).toHaveProperty('metadata');
      expect(catalog).toHaveProperty('assets');
      expect(catalog).toHaveProperty('categories');
      expect(catalog).toHaveProperty('themes');
    });
    
    it('should have valid metadata', () => {
      const catalog = getCatalog();
      
      expect(catalog.metadata).toHaveProperty('version');
      expect(catalog.metadata).toHaveProperty('lastUpdated');
      expect(catalog.metadata).toHaveProperty('totalAssets');
      expect(catalog.metadata.totalAssets).toBeGreaterThan(0);
    });
    
    it('should have assets array with proper structure', () => {
      const catalog = getCatalog();
      
      expect(Array.isArray(catalog.assets)).toBe(true);
      expect(catalog.assets.length).toBeGreaterThan(0);
      
      const asset = catalog.assets[0];
      expect(asset).toHaveProperty('path');
      expect(asset).toHaveProperty('filename');
      expect(asset).toHaveProperty('type');
      expect(asset).toHaveProperty('themes');
      expect(Array.isArray(asset.themes)).toBe(true);
    });
  });
  
  describe('getAssetsByTheme', () => {
    it('should return assets matching single theme', () => {
      const assets = getAssetsByTheme(['zombie'], 10);
      
      expect(Array.isArray(assets)).toBe(true);
      expect(assets.length).toBeGreaterThan(0);
      expect(assets.length).toBeLessThanOrEqual(10);
      
      // All assets should have zombie theme
      assets.forEach(asset => {
        expect(asset.themes.some(t => t.toLowerCase() === 'zombie')).toBe(true);
      });
    });
    
    it('should return assets matching multiple themes', () => {
      const assets = getAssetsByTheme(['space', 'shooter'], 20);
      
      expect(Array.isArray(assets)).toBe(true);
      
      // All assets should have at least one of the themes
      assets.forEach(asset => {
        const hasTheme = asset.themes.some(t => 
          ['space', 'shooter'].includes(t.toLowerCase())
        );
        expect(hasTheme).toBe(true);
      });
    });
    
    it('should respect the limit parameter', () => {
      const limit = 5;
      const assets = getAssetsByTheme(['generic'], limit);
      
      expect(assets.length).toBeLessThanOrEqual(limit);
    });
    
    it('should be case-insensitive for theme matching', () => {
      const assetsLower = getAssetsByTheme(['zombie'], 5);
      const assetsUpper = getAssetsByTheme(['ZOMBIE'], 5);
      const assetsMixed = getAssetsByTheme(['ZoMbIe'], 5);
      
      expect(assetsLower.length).toBe(assetsUpper.length);
      expect(assetsLower.length).toBe(assetsMixed.length);
    });
    
    it('should return empty array for non-existent theme', () => {
      const assets = getAssetsByTheme(['nonexistent_theme_xyz'], 10);
      
      expect(Array.isArray(assets)).toBe(true);
      expect(assets.length).toBe(0);
    });
    
    it('should use default limit of 100 when not specified', () => {
      const assets = getAssetsByTheme(['generic']);
      
      expect(assets.length).toBeLessThanOrEqual(100);
    });
  });
  
  describe('getDiverseSample', () => {
    it('should return a diverse sample of assets', () => {
      const assets = getDiverseSample(50);
      
      expect(Array.isArray(assets)).toBe(true);
      expect(assets.length).toBeGreaterThan(0);
      expect(assets.length).toBeLessThanOrEqual(50);
    });
    
    it('should include assets from multiple themes', () => {
      const assets = getDiverseSample(50);
      
      const uniqueThemes = new Set();
      assets.forEach(asset => {
        asset.themes.forEach(theme => uniqueThemes.add(theme));
      });
      
      // Should have multiple themes represented
      expect(uniqueThemes.size).toBeGreaterThan(1);
    });
    
    it('should respect the limit parameter', () => {
      const limit = 20;
      const assets = getDiverseSample(limit);
      
      expect(assets.length).toBeLessThanOrEqual(limit);
    });
    
    it('should use default limit of 100 when not specified', () => {
      const assets = getDiverseSample();
      
      expect(assets.length).toBeLessThanOrEqual(100);
    });
    
    it('should distribute samples across themes', () => {
      const assets = getDiverseSample(30);
      
      // Count how many themes are represented
      const themeCount = new Map();
      assets.forEach(asset => {
        asset.themes.forEach(theme => {
          themeCount.set(theme, (themeCount.get(theme) || 0) + 1);
        });
      });
      
      // Should have some distribution (not all from one theme)
      const themeCounts = Array.from(themeCount.values());
      expect(Math.max(...themeCounts) - Math.min(...themeCounts)).toBeLessThan(20);
    });
  });
  
  describe('edge cases', () => {
    it('should handle empty theme array', () => {
      const assets = getAssetsByTheme([], 10);
      
      expect(Array.isArray(assets)).toBe(true);
      expect(assets.length).toBe(0);
    });
    
    it('should handle limit of 0', () => {
      const assets = getAssetsByTheme(['zombie'], 0);
      
      expect(Array.isArray(assets)).toBe(true);
      expect(assets.length).toBe(0);
    });
    
    it('should handle very large limit', () => {
      const assets = getAssetsByTheme(['generic'], 10000);
      
      expect(Array.isArray(assets)).toBe(true);
      // Should return all matching assets, not crash
    });
  });
});
