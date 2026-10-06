// Quick script to inspect the latest generated game
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon.tech') || process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

async function inspectLatestGame() {
  try {
    // Get the most recent draft
    const result = await pool.query(`
      SELECT 
        id,
        title,
        orientation,
        LENGTH(html_payload) as html_length,
        LENGTH(script_payload) as script_length,
        html_payload,
        script_payload,
        runtime,
        created_at
      FROM ai_games
      WHERE is_draft = true
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log('❌ No game drafts found');
      return;
    }

    const draft = result.rows[0];
    console.log('\n📋 Latest Game Draft:');
    console.log('  ID:', draft.id);
    console.log('  Title:', draft.title);
    console.log('  Orientation:', draft.orientation);
    console.log('  Runtime:', draft.runtime);
    console.log('  HTML Length:', draft.html_length, 'characters');
    console.log('  Script Length:', draft.script_length, 'characters');
    console.log('  Created:', draft.created_at);
    console.log('\n');

    const html = draft.html_payload || draft.script_payload;
    
    if (html) {
      // Extract canvas dimensions
      const canvasMatches = html.matchAll(/<canvas[^>]*(?:width=["']?(\d+)["']?[^>]*height=["']?(\d+)["']?|height=["']?(\d+)["']?[^>]*width=["']?(\d+)["']?)[^>]*>/gi);
      let foundCanvas = false;
      for (const match of canvasMatches) {
        foundCanvas = true;
        const width = match[1] || match[4];
        const height = match[2] || match[3];
        console.log('🎮 Canvas Dimensions:');
        console.log('  Width:', width, 'px');
        console.log('  Height:', height, 'px');
      }

      // Extract config dimensions
      const configMatch = html.match(/config\s*=\s*{[^}]*width\s*:\s*(\d+)[^}]*height\s*:\s*(\d+)/i);
      if (configMatch) {
        console.log('\n⚙️ Config Dimensions:');
        console.log('  Width:', configMatch[1], 'px');
        console.log('  Height:', configMatch[2], 'px');
      }

      // Extract any hardcoded style dimensions
      const styleMatches = [...html.matchAll(/(?:width|height)\s*:\s*(\d+)px/gi)];
      if (styleMatches.length > 0) {
        console.log('\n📐 Hardcoded Dimensions Found:', styleMatches.length, 'occurrences');
        styleMatches.slice(0, 10).forEach(match => console.log('  -', match[0]));
        if (styleMatches.length > 10) console.log('  ... and', styleMatches.length - 10, 'more');
      }

      // Check for viewport meta
      const viewportMatch = html.match(/<meta[^>]*name=["']viewport["'][^>]*>/i);
      if (viewportMatch) {
        console.log('\n📱 Viewport Meta:');
        console.log(' ', viewportMatch[0]);
      } else {
        console.log('\n⚠️ No viewport meta found');
      }

      // Show first 2000 chars of HTML
      console.log('\n📄 HTML Preview (first 2000 chars):');
      console.log('─'.repeat(80));
      console.log(html.substring(0, 2000));
      console.log('─'.repeat(80));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

inspectLatestGame();
