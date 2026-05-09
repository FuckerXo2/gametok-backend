/**
 * Astrocade Game Scraper
 * 
 * Scrapes Astrocade games to analyze their AI generation approach
 * - Game structure
 * - Engine choices
 * - Asset strategies
 * - Control schemes
 * - Editor integration
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = path.join(process.cwd(), 'astrocade-analysis');

// Create output directory
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function scrapeAstrocadeGame(url, gameName) {
  console.log(`\n🎮 Scraping: ${gameName}`);
  console.log(`   URL: ${url}`);

  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  try {
    // Go to game page
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    // Wait a bit for game to load
    await new Promise(r => setTimeout(r, 3000));

    // Extract game HTML
    const html = await page.content();

    // Extract all script tags
    const scripts = await page.evaluate(() => {
      const scriptTags = Array.from(document.querySelectorAll('script'));
      return scriptTags.map(script => ({
        src: script.src,
        inline: script.innerHTML,
        type: script.type
      }));
    });

    // Check for frameworks
    const frameworks = await page.evaluate(() => {
      const checks = {
        hasThreeJs: typeof window.THREE !== 'undefined',
        hasPhaser: typeof window.Phaser !== 'undefined',
        hasPixi: typeof window.PIXI !== 'undefined',
        hasBabylon: typeof window.BABYLON !== 'undefined',
        hasP5: typeof window.p5 !== 'undefined'
      };
      return checks;
    });

    // Check for canvas/webgl
    const rendering = await page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      return {
        canvasCount: canvases.length,
        canvasContexts: canvases.map(c => {
          try {
            if (c.getContext('webgl') || c.getContext('webgl2')) return 'webgl';
            if (c.getContext('2d')) return '2d';
            return 'unknown';
          } catch (e) {
            return 'error';
          }
        })
      };
    });

    // Extract game metadata
    const metadata = await page.evaluate(() => {
      return {
        title: document.title,
        metaTags: Array.from(document.querySelectorAll('meta')).map(m => ({
          name: m.name || m.property,
          content: m.content
        })),
        hasEditor: !!document.querySelector('[class*="editor"]') || 
                   !!document.querySelector('[id*="editor"]'),
        hasRemix: document.body.innerHTML.includes('remix') || 
                  document.body.innerHTML.includes('Remix'),
      };
    });

    // Analyze inline scripts for patterns
    const inlineScriptAnalysis = scripts
      .filter(s => s.inline && s.inline.length > 100)
      .map(s => ({
        length: s.inline.length,
        hasPhaser: s.inline.includes('Phaser'),
        hasThree: s.inline.includes('THREE'),
        hasWebGL: s.inline.includes('WebGL') || s.inline.includes('webgl'),
        hasCanvas2D: s.inline.includes('getContext(\'2d\')') || s.inline.includes('getContext("2d")'),
        hasGameLoop: s.inline.includes('requestAnimationFrame') || s.inline.includes('setInterval'),
        hasPhysics: s.inline.includes('physics') || s.inline.includes('collision'),
        hasControls: s.inline.includes('touch') || s.inline.includes('pointer') || s.inline.includes('mouse'),
      }));

    // Save results
    const analysis = {
      gameName,
      url,
      scrapedAt: new Date().toISOString(),
      frameworks,
      rendering,
      metadata,
      scripts: {
        total: scripts.length,
        external: scripts.filter(s => s.src).map(s => s.src),
        inlineCount: scripts.filter(s => s.inline).length,
        analysis: inlineScriptAnalysis
      },
      htmlSize: html.length,
    };

    // Save full HTML
    const htmlPath = path.join(OUTPUT_DIR, `${gameName.replace(/[^a-z0-9]/gi, '_')}.html`);
    fs.writeFileSync(htmlPath, html);

    // Save analysis JSON
    const jsonPath = path.join(OUTPUT_DIR, `${gameName.replace(/[^a-z0-9]/gi, '_')}_analysis.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(analysis, null, 2));

    console.log(`   ✅ Saved to: ${path.basename(htmlPath)}`);
    console.log(`   📊 Frameworks:`, frameworks);
    console.log(`   🎨 Rendering:`, rendering);
    console.log(`   📝 Has Editor:`, metadata.hasEditor);
    console.log(`   🔄 Has Remix:`, metadata.hasRemix);

    return analysis;

  } catch (error) {
    console.error(`   ❌ Error scraping ${gameName}:`, error.message);
    return null;
  } finally {
    await browser.close();
  }
}

async function scrapeAstrocadeGallery() {
  console.log('🚀 Starting Astrocade scraper...\n');

  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();

  try {
    // Go to Astrocade homepage/gallery
    console.log('📡 Loading Astrocade gallery...');
    await page.goto('https://astrocade.com', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    await new Promise(r => setTimeout(r, 3000));

    // Try to find game links
    const gameLinks = await page.evaluate(() => {
      // Look for game cards/links
      const links = Array.from(document.querySelectorAll('a[href*="/games/"]'));
      return links.slice(0, 10).map(link => ({
        url: link.href,
        title: link.textContent.trim() || link.getAttribute('aria-label') || 'Unknown'
      }));
    });

    console.log(`\n📋 Found ${gameLinks.length} games to analyze\n`);

    await browser.close();

    // Scrape each game
    const results = [];
    for (const game of gameLinks) {
      const result = await scrapeAstrocadeGame(game.url, game.title);
      if (result) results.push(result);
      
      // Be nice to their servers
      await new Promise(r => setTimeout(r, 2000));
    }

    // Generate summary report
    const summary = {
      totalGames: results.length,
      scrapedAt: new Date().toISOString(),
      frameworks: {
        threeJs: results.filter(r => r.frameworks.hasThreeJs).length,
        phaser: results.filter(r => r.frameworks.hasPhaser).length,
        pixi: results.filter(r => r.frameworks.hasPixi).length,
        babylon: results.filter(r => r.frameworks.hasBabylon).length,
        p5: results.filter(r => r.frameworks.hasP5).length,
      },
      rendering: {
        webgl: results.filter(r => r.rendering.canvasContexts.includes('webgl')).length,
        canvas2d: results.filter(r => r.rendering.canvasContexts.includes('2d')).length,
      },
      features: {
        hasEditor: results.filter(r => r.metadata.hasEditor).length,
        hasRemix: results.filter(r => r.metadata.hasRemix).length,
      },
      games: results
    };

    const summaryPath = path.join(OUTPUT_DIR, 'SUMMARY.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    console.log('\n\n📊 SUMMARY REPORT');
    console.log('================');
    console.log(`Total games analyzed: ${summary.totalGames}`);
    console.log(`\nFrameworks:`);
    console.log(`  Three.js: ${summary.frameworks.threeJs}`);
    console.log(`  Phaser: ${summary.frameworks.phaser}`);
    console.log(`  Pixi: ${summary.frameworks.pixi}`);
    console.log(`  Babylon: ${summary.frameworks.babylon}`);
    console.log(`  P5.js: ${summary.frameworks.p5}`);
    console.log(`\nRendering:`);
    console.log(`  WebGL: ${summary.rendering.webgl}`);
    console.log(`  Canvas 2D: ${summary.rendering.canvas2d}`);
    console.log(`\nFeatures:`);
    console.log(`  Has Editor: ${summary.features.hasEditor}`);
    console.log(`  Has Remix: ${summary.features.hasRemix}`);
    console.log(`\n✅ Analysis complete! Check ${OUTPUT_DIR} for details.`);

  } catch (error) {
    console.error('❌ Error scraping gallery:', error);
    await browser.close();
  }
}

// Run the scraper
scrapeAstrocadeGallery().catch(console.error);
