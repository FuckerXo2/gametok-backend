// Run this locally to scan game sizes using Puppeteer
// Usage: node scan-game-sizes.js
// Requires: npm install puppeteer

import puppeteer from 'puppeteer';

const API = 'https://gametok-backend-production.up.railway.app';
const MAX_SIZE_MB = 10;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

async function getGames() {
  const res = await fetch(`${API}/api/admin/games`);
  const data = await res.json();
  return data.games.filter(g => g.id.startsWith('gm-') && g.embedUrl);
}

async function measureGameSize(browser, game) {
  const page = await browser.newPage();
  let totalBytes = 0;
  
  // Track all network requests
  await page.setRequestInterception(true);
  
  page.on('request', request => {
    request.continue();
  });
  
  page.on('response', async response => {
    try {
      const headers = response.headers();
      const contentLength = headers['content-length'];
      if (contentLength) {
        totalBytes += parseInt(contentLength, 10);
      } else {
        // Try to get actual size from buffer
        const buffer = await response.buffer().catch(() => null);
        if (buffer) {
          totalBytes += buffer.length;
        }
      }
    } catch (e) {
      // Ignore errors
    }
  });
  
  try {
    await page.goto(game.embedUrl, { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });
    
    // Wait a bit more for lazy-loaded resources
    await new Promise(r => setTimeout(r, 5000));
    
  } catch (e) {
    console.log(`  Error loading ${game.id}: ${e.message}`);
  }
  
  await page.close();
  return totalBytes;
}

async function main() {
  console.log('Fetching games from API...');
  const games = await getGames();
  console.log(`Found ${games.length} GameMonetize games to scan\n`);
  
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const largeGames = [];
  
  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    console.log(`[${i + 1}/${games.length}] Scanning ${game.name} (${game.id})...`);
    
    const sizeBytes = await measureGameSize(browser, game);
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
    
    if (sizeBytes > MAX_SIZE_BYTES) {
      console.log(`  ❌ ${sizeMB}MB - TOO LARGE`);
      largeGames.push({ id: game.id, name: game.name, sizeMB });
    } else {
      console.log(`  ✅ ${sizeMB}MB`);
    }
    
    // Report size to API
    try {
      await fetch(`${API}/api/games/${game.id}/size`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sizeBytes })
      });
    } catch (e) {
      console.log(`  Failed to report size: ${e.message}`);
    }
  }
  
  await browser.close();
  
  console.log('\n========================================');
  console.log(`SCAN COMPLETE`);
  console.log(`Total games: ${games.length}`);
  console.log(`Large games (>${MAX_SIZE_MB}MB): ${largeGames.length}`);
  console.log('========================================\n');
  
  if (largeGames.length > 0) {
    console.log('Large games to delete:');
    largeGames.forEach(g => console.log(`  ${g.id} - ${g.name} (${g.sizeMB}MB)`));
    
    console.log('\nGame IDs (copy for bulk delete):');
    console.log(largeGames.map(g => g.id).join(','));
  }
}

main().catch(console.error);
