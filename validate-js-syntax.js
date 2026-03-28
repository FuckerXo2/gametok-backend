import pkg from 'pg';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
const { Pool } = pkg;
const execAsync = promisify(exec);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: { rejectUnauthorized: false }
});

async function validateJSSyntax() {
  try {
    const result = await pool.query(`
      SELECT 
        ag.id,
        ag.title,
        ag.html_payload
      FROM ai_games ag
      WHERE ag.is_draft = true
      ORDER BY ag.created_at DESC
    `);

    console.log(`\n🔍 Validating JavaScript syntax in ${result.rows.length} drafts...\n`);
    
    const problematicDrafts = [];

    for (const draft of result.rows) {
      // Extract script content
      const scriptMatches = draft.html_payload.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
      
      if (!scriptMatches) continue;

      for (let i = 0; i < scriptMatches.length; i++) {
        const scriptContent = scriptMatches[i].replace(/<script[^>]*>|<\/script>/gi, '');
        
        // Write to temp file
        const tempFile = `/tmp/validate_${draft.id}_${i}.js`;
        await fs.writeFile(tempFile, scriptContent);
        
        try {
          // Use node to check syntax
          await execAsync(`node --check ${tempFile}`);
        } catch (error) {
          problematicDrafts.push({
            id: draft.id,
            title: draft.title || 'Untitled',
            scriptIndex: i,
            error: error.stderr || error.message
          });
        }
        
        // Clean up
        try {
          await fs.unlink(tempFile);
        } catch (e) {}
      }
    }

    console.log(`\n❌ Found ${problematicDrafts.length} drafts with actual JavaScript syntax errors:\n`);
    
    if (problematicDrafts.length === 0) {
      console.log('✅ All drafts have valid JavaScript syntax!');
    } else {
      const uniqueDrafts = {};
      problematicDrafts.forEach(draft => {
        if (!uniqueDrafts[draft.id]) {
          uniqueDrafts[draft.id] = draft;
        }
      });

      Object.values(uniqueDrafts).forEach((draft, i) => {
        console.log(`${i + 1}. "${draft.title}"`);
        console.log(`   ID: ${draft.id}`);
        console.log(`   Error: ${draft.error.split('\n')[0]}`);
        console.log('');
      });

      console.log('\n📋 Draft IDs with syntax errors:');
      console.log(Object.keys(uniqueDrafts).join('\n'));
    }

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

validateJSSyntax();
