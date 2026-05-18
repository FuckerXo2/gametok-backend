import { formatMakerTemplateManual, getMakerTemplateManual } from './maker-template-manuals.js';

function listBlock(title, items = []) {
    const clean = (Array.isArray(items) ? items : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    if (clean.length === 0) return [`## ${title}`, '- None specified.'].join('\n');
    return [`## ${title}`, ...clean.map((item) => `- ${item}`)].join('\n');
}

function inlineList(items = [], fallback = 'None specified') {
    const clean = (Array.isArray(items) ? items : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    return clean.length > 0 ? clean.join(', ') : fallback;
}

function valueOrFallback(value, fallback = 'Not specified') {
    const clean = String(value || '').trim();
    return clean || fallback;
}

function markdownTable(headers = [], rows = []) {
    const safe = (value) => String(value ?? '').replace(/\n+/g, '<br>').trim() || ' ';
    return [
        `| ${headers.map(safe).join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.map(safe).join(' | ')} |`),
    ].join('\n');
}

function buildTemplateRules(templateContract = {}) {
    return [
        `Template: ${valueOrFallback(templateContract.templateId)}`,
        `Archetype: ${valueOrFallback(templateContract.archetype)}`,
        `Engine: ${valueOrFallback(templateContract.engine)}`,
        `Recommended library: ${valueOrFallback(templateContract.recommendedLibrary)}`,
        '',
        listBlock('Architecture Rules', templateContract.architecture),
        '',
        listBlock('Required State', templateContract.requiredState),
        '',
        listBlock('Required Functions', templateContract.requiredFunctions),
        '',
        listBlock('Required Probe API', templateContract.requiredProbeApi),
        '',
        listBlock('First Frame Contract', templateContract.firstFrame),
        '',
        listBlock('Acceptance Checks', templateContract.acceptanceChecks),
        '',
        listBlock('Anti-Patterns', templateContract.antiPatterns),
    ].join('\n');
}

function buildAssetRegistry(assetContract = {}, qualityIntent = {}) {
    const slots = Array.isArray(assetContract.slots) ? assetContract.slots : [];
    const rows = slots.map((slot) => [
        slot.assetType || 'sprite',
        slot.id || slot.role || 'asset',
        slot.role || slot.category || 'unknown',
        slot.required ? 'yes' : 'no',
        slot.description || `${slot.role || slot.id || 'asset'} visual asset`,
        [
            slot.size ? `size: ${slot.size}` : null,
            slot.width && slot.height ? `resolution: ${slot.width}x${slot.height}` : null,
            slot.transparent === false ? 'opaque' : 'transparent',
        ].filter(Boolean).join('; ') || 'default',
        slot.consumedBy || 'DreamAssets role lookup',
        slot.fallback || 'code-rendered fallback',
    ]);
    return [
        '## Section 1 — Visual Style & Asset Registry',
        '',
        'Downstream consumer: artist agent, `asset-manifest.json`, `window.DREAM_ASSET_PACK`, and runtime renderers.',
        '',
        `Visual style: ${valueOrFallback(qualityIntent.artDirection?.visualStyle || qualityIntent.artDirection?.mood || qualityIntent.artDirection?.palette)}`,
        `Camera/sprite style: ${valueOrFallback(qualityIntent.artDirection?.camera || qualityIntent.artDirection?.spriteStyle)}`,
        '',
        markdownTable(
            ['type', 'key', 'role', 'required', 'description', 'params', 'consumed by', 'fallback'],
            rows.length > 0 ? rows : [['none', 'none', 'none', 'no', 'No generated visual assets required.', 'none', 'code renderer', 'code renderer']]
        ),
        '',
        listBlock('Asset Hard Rules', assetContract.hardRules),
        '',
        'Generated images are not UI. HUD, text, meters, buttons, controls, hitboxes, collision data, terrain masks, paths, objectives, and tactical logic remain code-owned.',
    ].join('\n');
}

function buildSection0Architecture(qualityIntent = {}, prompt = '', templateContract = null) {
    const playable = qualityIntent.playableExperience || {};
    const classification = templateContract?.classification || null;
    return [
        '## Section 0 — Technical Architecture',
        '',
        'Downstream consumer: builder, selected native template, project files, probe API, and sandbox.',
        '',
        `Title: ${valueOrFallback(qualityIntent.title, 'Untitled Game')}`,
        `Original prompt: ${valueOrFallback(prompt)}`,
        `User intent: ${valueOrFallback(qualityIntent.userIntent)}`,
        `Selected template: ${valueOrFallback(templateContract?.templateId || classification?.selectedTemplateId)}`,
        `Archetype: ${valueOrFallback(templateContract?.archetype || classification?.selectedArchetype)}`,
        `Engine: ${valueOrFallback(templateContract?.engine)}`,
        `Recommended library: ${valueOrFallback(templateContract?.recommendedLibrary)}`,
        `Physics profile: ${valueOrFallback(classification?.physicsProfile?.physics)}`,
        `Perspective: ${valueOrFallback(classification?.physicsProfile?.perspective)}`,
        `Movement model: ${valueOrFallback(classification?.physicsProfile?.movement)}`,
        '',
        `Core loop: ${valueOrFallback(playable.coreLoop)}`,
        `Primary mechanic: ${valueOrFallback(playable.primaryMechanic)}`,
        `First 10 seconds: ${Array.isArray(playable.firstTenSeconds) ? playable.firstTenSeconds.join(' -> ') : valueOrFallback(playable.firstTenSeconds)}`,
        `Win condition: ${valueOrFallback(playable.winCondition)}`,
        `Lose condition: ${valueOrFallback(playable.loseCondition)}`,
        '',
        listBlock('Template Architecture Rules', templateContract?.architecture),
        '',
        listBlock('Common Hard Rules', templateContract?.common?.hardRules),
    ].join('\n');
}

function buildSection2Configuration(qualityIntent = {}, templateContract = {}) {
    const viewport = templateContract.common?.viewport || {};
    const technical = qualityIntent.technicalRequirements || {};
    return [
        '## Section 2 — Game Configuration',
        '',
        'Downstream consumer: game state defaults, constants, tuning values, and responsive layout.',
        '',
        markdownTable(
            ['key', 'value', 'owner'],
            [
                ['screen.targetWidth', viewport.targetWidth || 390, 'layout'],
                ['screen.targetHeight', viewport.targetHeight || 844, 'layout'],
                ['screen.chromeSafeTop', viewport.chromeSafeTop || 112, 'layout'],
                ['screen.chromeSafeBottom', viewport.chromeSafeBottom || 48, 'layout'],
                ['dimension', technical.dimension || '2D', 'renderer'],
                ['perspective', technical.perspective || templateContract.classification?.physicsProfile?.perspective || 'template default', 'renderer'],
                ['genre', technical.genre || templateContract.archetype || 'template default', 'gameplay'],
                ['controls', inlineList(qualityIntent.mobileControls || templateContract.controls), 'input'],
            ]
        ),
        '',
        'Rules:',
        '- Keep exact numeric tuning in code constants, not hidden in prompt prose.',
        '- Read viewport dimensions from runtime and clamp gameplay to the safe rectangle.',
        '- State reset must rebuild all mutable game state without reloading the app.',
    ].join('\n');
}

function buildSection3EntityArchitecture(qualityIntent = {}, templateContract = {}) {
    return [
        '## Section 3 — Entity / Scene Architecture',
        '',
        'Downstream consumer: `src/game.js`, scaffold edits, required functions, and live state model.',
        '',
        listBlock('Required State', templateContract.requiredState),
        '',
        listBlock('Required Functions', templateContract.requiredFunctions),
        '',
        listBlock('Required Probe API', templateContract.requiredProbeApi),
        '',
        listBlock('Player Actions', qualityIntent.playerActions),
        '',
        listBlock('Entity Rules', qualityIntent.entityRules),
        '',
        'Implementation rule: preserve scaffold public function names and probe API names exactly. Extend internals; do not replace the selected template with an unrelated game.',
    ].join('\n');
}

function buildSection4LevelContent(qualityIntent = {}, templateContract = {}) {
    const playable = qualityIntent.playableExperience || {};
    return [
        '## Section 4 — Level / Content Design',
        '',
        'Downstream consumer: world generation, spawn data, terrain/grid/path content, first-frame setup, and first-10-second proof.',
        '',
        `Opening scenario: ${valueOrFallback(Array.isArray(playable.firstTenSeconds) ? playable.firstTenSeconds.join(' -> ') : playable.firstTenSeconds)}`,
        `Core loop content: ${valueOrFallback(playable.coreLoop)}`,
        '',
        listBlock('First Frame Contract', templateContract.firstFrame),
        '',
        listBlock('Must Exist', qualityIntent.mustExist),
        '',
        listBlock('Feel Rules', qualityIntent.feelRules),
        '',
        listBlock('Failure Modes To Avoid', qualityIntent.failureModesToAvoid),
        '',
        'Content ownership rule: visual backgrounds can decorate the world, but gameplay terrain, collision, paths, grid cells, landing pads, objective zones, spawn points, and win/loss checks must be code-defined.',
    ].join('\n');
}

function buildSection5Roadmap(qualityIntent = {}, templateContract = {}, assetContract = {}) {
    return [
        '## Section 5 — Implementation Roadmap',
        '',
        'Downstream consumer: builder task order and repair/debug loop.',
        '',
        '1. Load the selected native scaffold and template manual before editing.',
        '2. Implement or preserve required state and required functions.',
        '3. Implement the first-frame world: player, objective/threat, HUD, controls, and initial feedback.',
        '4. Connect inputs to live state transitions and probe API methods.',
        '5. Connect generated asset slots through DreamAssets / DREAM_ASSET_PACK only after gameplay state works.',
        '6. Keep HUD, controls, labels, meters, and readable text code-rendered.',
        '7. Run sandbox verification and repair the exact failed contract task.',
        '',
        listBlock('Acceptance Checks', templateContract.acceptanceChecks),
        '',
        listBlock('Anti-Patterns', templateContract.antiPatterns),
        '',
        listBlock('Asset Slots That Must Be Consumed', (assetContract.slots || []).filter((slot) => slot.required).map((slot) => `${slot.id || slot.role}: ${slot.consumedBy || slot.role}`)),
    ].join('\n');
}

export function buildMakerDesignBrief({ qualityIntent = {}, prompt = '', templateContract = null, assetContract = null } = {}) {
    const classification = templateContract?.classification || null;
    const templateManual = getMakerTemplateManual(templateContract?.templateId);
    return [
        '# GameTok Maker GDD',
        '',
        'This is the source of truth for the builder, asset pipeline, and debugger. Every section has a downstream consumer; do not treat it as decorative prose.',
        '',
        '## GDD Contract',
        markdownTable(
            ['Section', 'Title', 'Downstream Consumer'],
            [
                ['0', 'Technical Architecture', 'builder, selected template, probe API, sandbox'],
                ['1', 'Visual Style & Asset Registry', 'artist agent, asset-manifest.json, DreamAssets runtime'],
                ['2', 'Game Configuration', 'state constants, layout, tuning values'],
                ['3', 'Entity / Scene Architecture', 'src/game.js, scaffold edits, required functions'],
                ['4', 'Level / Content Design', 'world generation, spawns, terrain/grid/path data'],
                ['5', 'Implementation Roadmap', 'builder task list, repair loop, acceptance checks'],
            ]
        ),
        '',
        '## Classification Trace',
        classification
            ? [
                `Selected template: ${classification.selectedTemplateId}`,
                `Archetype: ${classification.selectedArchetype}`,
                `Confidence: ${classification.confidence}`,
                `Physics: ${classification.physicsProfile?.physics || 'unknown'}`,
                `Movement: ${classification.physicsProfile?.movement || 'unknown'}`,
                `Perspective: ${classification.physicsProfile?.perspective || 'unknown'}`,
                `Reasoning: ${classification.reasoning || 'Not specified'}`,
            ].join('\n')
            : 'No classifier output available.',
        '',
        buildSection0Architecture(qualityIntent, prompt, templateContract || {}),
        '',
        buildAssetRegistry(assetContract || {}, qualityIntent),
        '',
        buildSection2Configuration(qualityIntent, templateContract || {}),
        '',
        buildSection3EntityArchitecture(qualityIntent, templateContract || {}),
        '',
        buildSection4LevelContent(qualityIntent, templateContract || {}),
        '',
        buildSection5Roadmap(qualityIntent, templateContract || {}, assetContract || {}),
        '',
        '## Template Manual Appendix',
        formatMakerTemplateManual(templateManual),
        '',
        '## Full Template Contract Appendix',
        buildTemplateRules(templateContract || {}),
    ].join('\n');
}

export function summarizeMakerDesignBrief(brief = '') {
    const text = String(brief || '');
    return {
        chars: text.length,
        sections: (text.match(/^## /gm) || []).length,
        gddSections: (text.match(/^## Section [0-5] /gm) || []).length,
        hasGddContract: text.includes('## GDD Contract'),
        hasTechnicalArchitecture: text.includes('## Section 0'),
        hasAssetRegistry: text.includes('## Section 1'),
        hasConfiguration: text.includes('## Section 2'),
        hasEntityArchitecture: text.includes('## Section 3'),
        hasLevelContent: text.includes('## Section 4'),
        hasImplementationRoadmap: text.includes('## Section 5'),
        hasTemplateContract: text.includes('## Full Template Contract Appendix'),
        hasTemplateManual: text.includes('## Template Manual Appendix'),
        hasAssetContract: text.includes('## Section 1'),
    };
}

export function formatMakerDesignBriefPromptBlock(brief = '') {
    return [
        'GameTok maker GDD:',
        '```markdown',
        String(brief || '').slice(0, 45000),
        '```',
    ].join('\n');
}
