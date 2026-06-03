import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_ROOT = path.join(__dirname, 'maker', 'templates');

// Recursively get all files in a directory
async function walkDir(dir, fileList = []) {
    const files = await fs.promises.readdir(dir);
    for (const file of files) {
        // Skip ignored directories
        if (file === 'node_modules' || file === 'dist' || file === '.git' || file === '.vite') {
            continue;
        }
        
        const filePath = path.join(dir, file);
        const stat = await fs.promises.stat(filePath);
        if (stat.isDirectory()) {
            await walkDir(filePath, fileList);
        } else {
            // Ignore binaries or irrelevant files
            if (!file.endsWith('.json') && !file.endsWith('.ts') && !file.endsWith('.js') && !file.endsWith('.html') && !file.endsWith('.css') && !file.endsWith('.md')) {
                continue;
            }
            fileList.push(filePath);
        }
    }
    return fileList;
}

export async function loadMakerTemplateScaffold(templateId) {
    const root = path.join(TEMPLATE_ROOT, templateId);
    
    // Check if the template exists
    try {
        await fs.promises.access(root);
    } catch {
        console.warn(`[Template Scaffold] Scaffold folder not found: ${root}`);
        return null;
    }

    const loadedFiles = [];
    const absoluteFiles = await walkDir(root);

    for (const absolutePath of absoluteFiles) {
        const relativePath = path.relative(root, absolutePath);
        const content = await fs.promises.readFile(absolutePath, 'utf8');
        loadedFiles.push({
            path: relativePath,
            sourcePath: relativePath,
            content,
        });
    }

    return {
        templateId,
        source: 'gametok-native-scaffold',
        rule: 'Start from these files. Preserve the working systems and customize them for the user prompt. DO NOT REMOVE the Vite config or build scripts.',
        files: loadedFiles,
    };
}

export function summarizeMakerTemplateScaffold(scaffold = null) {
    if (!scaffold) return null;
    return {
        templateId: scaffold.templateId,
        files: scaffold.files.map((file) => ({
            path: file.path,
            chars: file.content.length,
        })),
    };
}
