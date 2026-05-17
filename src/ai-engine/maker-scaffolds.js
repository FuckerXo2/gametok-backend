import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_ROOT = path.join(__dirname, 'maker', 'templates');

const SCAFFOLD_FILES = {
    'phaser-artillery': [
        'template-api.md',
        'project/index.html',
        'project/src/styles.css',
        'project/src/game.js',
    ],
    'phaser-top-down-action': [
        'template-api.md',
        'project/index.html',
        'project/src/styles.css',
        'project/src/game.js',
    ],
    'phaser-platformer': [
        'template-api.md',
        'project/index.html',
        'project/src/styles.css',
        'project/src/game.js',
    ],
    'canvas-grid-puzzle': [
        'template-api.md',
        'project/index.html',
        'project/src/styles.css',
        'project/src/game.js',
    ],
    'canvas-simulation': [
        'template-api.md',
        'project/index.html',
        'project/src/styles.css',
        'project/src/game.js',
    ],
    'story-vignette': [
        'template-api.md',
        'project/index.html',
        'project/src/styles.css',
        'project/src/game.js',
    ],
};

function normalizeScaffoldPath(filePath) {
    return filePath.replace(/^project\//, '');
}

export async function loadMakerTemplateScaffold(templateId) {
    const files = SCAFFOLD_FILES[templateId];
    if (!files) return null;

    const root = path.join(TEMPLATE_ROOT, templateId);
    const loadedFiles = [];
    for (const relativePath of files) {
        const absolutePath = path.join(root, relativePath);
        const content = await fs.promises.readFile(absolutePath, 'utf8');
        loadedFiles.push({
            path: normalizeScaffoldPath(relativePath),
            sourcePath: relativePath,
            content,
        });
    }

    return {
        templateId,
        source: 'gametok-native-scaffold',
        rule: 'Start from these files. Preserve the working systems and customize them for the user prompt.',
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
