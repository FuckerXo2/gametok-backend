import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const routesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/ai-engine/routes.js');
const routesSource = readFileSync(routesPath, 'utf8');

function stripDuplicateTopLevelFunctions(content = '', cleanPath = '') {
    const source = String(content || '');
    const normalizedPath = String(cleanPath || '').replace(/\\/g, '/');
    if (!/(^|\/)src\/main\.ts$/i.test(normalizedPath)) {
        return source;
    }

    const declRegex = /^(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
    const blocks = [];
    let match;
    while ((match = declRegex.exec(source)) !== null) {
        const name = match[2];
        const start = match.index;
        const braceStart = source.indexOf('{', declRegex.lastIndex);
        if (braceStart === -1) continue;
        let depth = 0;
        let end = -1;
        for (let i = braceStart; i < source.length; i += 1) {
            if (source[i] === '{') depth += 1;
            if (source[i] === '}') {
                depth -= 1;
                if (depth === 0) {
                    end = i + 1;
                    break;
                }
            }
        }
        if (end === -1) continue;
        blocks.push({ name, start, end });
    }

    const seen = new Set();
    const duplicates = blocks.filter((block) => {
        if (seen.has(block.name)) return true;
        seen.add(block.name);
        return false;
    });
    if (duplicates.length === 0) return source;

    let output = source;
    for (const block of duplicates.sort((a, b) => b.start - a.start)) {
        output = output.slice(0, block.start) + output.slice(block.end);
    }
    return output.replace(/\n{4,}/g, '\n\n\n');
}

const sample = `
function checkShiftEnd() {
  return 1;
}

export function checkShiftEnd() {
  return 2;
}
`;

const cleaned = stripDuplicateTopLevelFunctions(sample, 'src/main.ts');
assert.equal((cleaned.match(/function checkShiftEnd/g) || []).length, 1, 'duplicate function should be removed');
assert.match(cleaned, /return 1;/);

console.log('✅ main.ts duplicate function dedupe check passed');
