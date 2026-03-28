import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: { rejectUnauthorized: false }
});

// Common syntax errors to check for
const syntaxPatterns = [
  { pattern: /\bcatch\s*\(/g, name: 'catch without try', check: (html) => {
    // Check if catch appears without a proper try block
    const catchMatches = html.match(/\bcatch\s*\(/g) || [];
    const tryMatches = html.match(/\btry\s*\{/g) || [];
    return catchMatches.length > tryMatches.length;
  }},
  { pattern: /\bfinally\s*\{/g, name: 'finally without try', check: (html) => {
    const finallyMatches = html.match(/\bfinally\s*\{/g) || [];
    const tryMatches = html.match(/\btry\s*\{/g) || [];
    return finallyMatches.length > tryMatches.length;
  }},
  { pattern: /}\s*catch/g, name: 'misplaced catch', check: (html) => {
    // Look for catch that doesn't follow a try block properly
    return /[^}]\s*catch\s*\(/.test(html);
  }},
  { pattern: /\basync\s+catch/g, name: 'async catch (invalid)', check: (html) => {
    return /\basync\s+catch/.test(html);
  }}
];

async function checkDraftErrors() {
  try {
    const result = await pool.query(`
      SELECT 
        ag.id,
        ag.title,
        ag.html_payload,
        u.username
      FROM ai_games ag
      JOIN users u ON ag.user_id = u.id
      WHERE ag.is_draft = true
      ORDER BY ag.created_at DESC
    `);

    console.log(`\n🔍 Checking ${result.rows.length} drafts for syntax errors...\n`);
    
    const problematicDrafts = [];

    for (const draft of result.rows) {
      const errors = [];
      
      // Check for syntax patterns
      for (const { name, check } of syntaxPatterns) {
        if (check(draft.html_payload)) {
          errors.push(name);
        }
      }

      // Check for unmatched braces
      const openBraces = (draft.html_payload.match(/{/g) || []).length;
      const closeBraces = (draft.html_payload.match(/}/g) || []).length;
      if (openBraces !== closeBraces) {
        errors.push(`unmatched braces (${openBraces} open, ${closeBraces} close)`);
      }

      // Check for unmatched parentheses in script tags
      const scriptContent = draft.html_payload.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
      if (scriptContent) {
        scriptContent.forEach((script, idx) => {
          const openParens = (script.match(/\(/g) || []).length;
          const closeParens = (script.match(/\)/g) || []).length;
          if (openParens !== closeParens) {
            errors.push(`unmatched parentheses in script ${idx + 1} (${openParens} open, ${closeParens} close)`);
          }
        });
      }

      // Look for specific "catch" error pattern
      if (/SyntaxError.*catch/i.test(draft.html_payload) || 
          /catch\s*\(/.test(draft.html_payload) && !/try\s*{[\s\S]*?}\s*catch/.test(draft.html_payload)) {
        errors.push('catch keyword issue detected');
      }

      if (errors.length > 0) {
        problematicDrafts.push({
          id: draft.id,
          title: draft.title || 'Untitled',
          username: draft.username,
          errors: errors
        });
      }
    }

    console.log(`\n❌ Found ${problematicDrafts.length} drafts with potential errors:\n`);
    
    if (problematicDrafts.length === 0) {
      console.log('✅ No obvious syntax errors detected in any drafts!');
    } else {
      problematicDrafts.forEach((draft, i) => {
        console.log(`${i + 1}. "${draft.title}"`);
        console.log(`   User: ${draft.username}`);
        console.log(`   ID: ${draft.id}`);
        console.log(`   Errors: ${draft.errors.join(', ')}`);
        console.log('');
      });

      // Output IDs for easy deletion
      console.log('\n📋 Draft IDs with errors:');
      console.log(problematicDrafts.map(d => d.id).join('\n'));
    }

    await pool.end();
  } catch (error) {
    console.error('Error checking drafts:', error.message);
    process.exit(1);
  }
}

checkDraftErrors();
