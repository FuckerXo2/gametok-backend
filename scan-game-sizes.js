// Run this locally to scan game sizes using Puppeteer
// Usage: node scan-game-sizes.js
// Requires: npm install puppeteer

import puppeteer from 'puppeteer';

const API = 'https://gametok-backend-production.up.railway.app';
const MAX_SIZE_MB = 8;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

// Unity/heavy game file extensions to watch for
const HEAVY_EXTENSIONS = ['.wasm', '.data', '.unityweb', '.bundle', '.assets'];

async function getGames() {
  const res = await fetch(`${API}/api/admin/games`);
  const data = await res.json();
  return data.games.filter(g => g.id.startsWith('gm-') && g.embedUrl);
}

async function measureGameSize(browser, game) {
  const page = await browser.newPage();
  let totalBytes = 0;
  let pendingRequests = new Set();
  let isUnityGame = false;
  let hasHeavyAssets = false;
  
  // Track all network requests
  await page.setRequestInterception(true);
  
  page.on('request', request => {
    const url = request.url().toLowerCase();
    
    // Detect Unity/heavy games
    if (url.includes('.wasm') || url.includes('.data') || url.includes('unity')) {
      isUnityGame = true;
    }
    if (HEAVY_EXTENSIONS.some(ext => url.includes(ext))) {
      hasHeavyAssets = true;
      pendingRequests.add(request.url());
    }
    
    request.continue();
  });
  
  page.on('response', async response => {
    const url = response.url();
    pendingRequests.delete(url);
    
    try {
      const headers = response.headers();
      const contentLength = headers['content-length'];
      
      if (contentLength) {
        totalBytes += parseInt(contentLength, 10);
      } else {
        // Try to get actual size from buffer for smaller responses
        // Skip for very large files to avoid memory issues
        const buffer = await response.buffer().catch(() => null);
        if (buffer) {
          totalBytes += buffer.length;
        }
      }
    } catch (e) {
      // Ignore errors
    }
  });
  
  page.on('requestfailed', request => {
    pendingRequests.delete(request.url());
  });
  
  try {
    // Initial page load
    await page.goto(game.embedUrl, { 
      waitUntil: 'networkidle0', // Wait for no network activity
      timeout: 90000 // 90 second timeout for heavy games
    });
    
    // Check if it's a Unity game by looking for Unity elements
    const hasUnityElements = await page.evaluate(() => {
      return !!(
        document.querySelector('#unity-canvas') ||
        document.querySelector('#unity-container') ||
        document.querySelector('.unity-loader') ||
        document.querySelector('#unityContainer') ||
        window.unityInstance ||
        window.UnityLoader ||
        document.querySelector('canvas[id*="unity"]')
      );
    });
    
    if (hasUnityElements) {
      isUnityGame = true;
    }
    
    // For Unity games, wait for the loader to finish
    if (isUnityGame || hasHeavyAssets) {
      console.log(`  🎮 Detected Unity/heavy game, waiting for full load...`);
      
      // Wait for Unity progress bar to disappear or reach 100%
      try {
        await page.waitForFunction(() => {
          // Check if Unity loader is gone
          const loader = document.querySelector('#unity-loading-bar, .unity-loader, #unity-progress, [class*="loading"]');
          if (!loader || loader.style.display === 'none' || loader.style.opacity === '0') {
            return true;
          }
          
          // Check if progress is at 100%
          const progress = document.querySelector('#unity-progress-bar-full, [class*="progress"]');
          if (progress && progress.style.width === '100%') {
            return true;
          }
          
          // Check if game canvas is visible and has content
          const canvas = document.querySelector('canvas');
          if (canvas && canvas.width > 100 && canvas.height > 100) {
            return true;
          }
          
          return false;
        }, { timeout: 60000 }); // Wait up to 60s for Unity to load
      } catch (e) {
        console.log(`  ⏱️ Unity load timeout, using current size`);
      }
      
      // Extra wait for any streaming assets
      await new Promise(r => setTimeout(r, 10000));
      
      // Wait for pending heavy asset downloads
      let waitCount = 0;
      while (pendingRequests.size > 0 && waitCount < 30) {
        console.log(`  ⏳ Waiting for ${pendingRequests.size} pending downloads...`);
        await new Promise(r => setTimeout(r, 2000));
        waitCount++;
      }
    } else {
      // Regular game - shorter wait
      await new Promise(r => setTimeout(r, 5000));
    }
    
  } catch (e) {
    console.log(`  Error loading ${game.id}: ${e.message}`);
  }
  
  await page.close();
  return { totalBytes, isUnityGame };
}

async function main() {
  console.log('Fetching games from API...');
  const games = await getGames();
  console.log(`Found ${games.length} GameMonetize games to scan\n`);
  
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-web-security', // Allow cross-origin requests
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });
  
  const largeGames = [];
  const unityGames = [];
  
  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    console.log(`[${i + 1}/${games.length}] Scanning ${game.name} (${game.id})...`);
    
    const { totalBytes, isUnityGame } = await measureGameSize(browser, game);
    const sizeMB = (totalBytes / 1024 / 1024).toFixed(1);
    
    if (isUnityGame) {
      unityGames.push({ id: game.id, name: game.name, sizeMB });
    }
    
    if (totalBytes > MAX_SIZE_BYTES) {
      console.log(`  ❌ ${sizeMB}MB - TOO LARGE${isUnityGame ? ' (Unity)' : ''}`);
      largeGames.push({ id: game.id, name: game.name, sizeMB, isUnity: isUnityGame });
    } else {
      console.log(`  ✅ ${sizeMB}MB${isUnityGame ? ' (Unity)' : ''}`);
    }
    
    // Report size to API
    let reported = false;
    for (let retry = 0; retry < 3 && !reported; retry++) {
      try {
        const response = await fetch(`${API}/api/games/${game.id}/size`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            sizeBytes: totalBytes,
            sizeMB: parseFloat(sizeMB),
            isUnityGame,
            gameName: game.name,
            totalGames: games.length
          })
        });
        
        if (response.ok) {
          reported = true;
        } else {
          console.log(`  Failed to report size (attempt ${retry + 1}): ${response.status}`);
          if (retry < 2) await new Promise(r => setTimeout(r, 1000));
        }
      } catch (e) {
        console.log(`  Failed to report size (attempt ${retry + 1}): ${e.message}`);
        if (retry < 2) await new Promise(r => setTimeout(r, 1000));
      }
    }
    
    if (!reported) {
      console.log(`  ⚠️ Could not report size after 3 attempts`);
    }
  }
  
  await browser.close();
  
  console.log('\n========================================');
  console.log(`SCAN COMPLETE`);
  console.log(`Total games: ${games.length}`);
  console.log(`Unity games: ${unityGames.length}`);
  console.log(`Large games (>${MAX_SIZE_MB}MB): ${largeGames.length}`);
  console.log('========================================\n');
  
  if (largeGames.length > 0) {
    console.log('Large games to delete:');
    largeGames.forEach(g => console.log(`  ${g.id} - ${g.name} (${g.sizeMB}MB)${g.isUnity ? ' [Unity]' : ''}`));
    
    console.log('\nGame IDs (copy for bulk delete):');
    console.log(largeGames.map(g => g.id).join(','));
  }
  
  if (unityGames.length > 0) {
    console.log('\nAll Unity games detected:');
    unityGames.forEach(g => console.log(`  ${g.id} - ${g.name} (${g.sizeMB}MB)`));
  }
}

main().catch(console.error);
