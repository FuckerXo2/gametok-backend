function listBlock(title, items = []) {
    const clean = (Array.isArray(items) ? items : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    if (clean.length === 0) return [`## ${title}`, '- None specified.'].join('\n');
    return [`## ${title}`, ...clean.map((item) => `- ${item}`)].join('\n');
}

function valueOrFallback(value, fallback = 'Not specified') {
    const clean = String(value || '').trim();
    return clean || fallback;
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

function buildAssetRules(assetContract = {}) {
    const slots = Array.isArray(assetContract.slots) ? assetContract.slots : [];
    const slotLines = slots.map((slot) => [
        `- ${slot.id || slot.role || 'asset'}: ${slot.assetType || 'sprite'} / role=${slot.role || 'unknown'} / required=${slot.required ? 'yes' : 'no'}`,
        slot.consumedBy ? `  Consumed by: ${slot.consumedBy}` : null,
        slot.fallback ? `  Fallback: ${slot.fallback}` : null,
    ].filter(Boolean).join('\n'));

    return [
        listBlock('Asset Slots', slotLines),
        '',
        listBlock('Asset Hard Rules', assetContract.hardRules),
        '',
        'Important: gameplay geometry, controls, HUD text, hitboxes, meters, and collision data stay code-owned. Generated images only replace visual art for approved asset slots.',
    ].join('\n');
}

function buildPlayerExperience(qualityIntent = {}, prompt = '') {
    const playable = qualityIntent.playableExperience || {};
    return [
        `Title: ${valueOrFallback(qualityIntent.title, 'Untitled Game')}`,
        `Original prompt: ${valueOrFallback(prompt)}`,
        `User intent: ${valueOrFallback(qualityIntent.userIntent)}`,
        `Core loop: ${valueOrFallback(playable.coreLoop)}`,
        `Primary mechanic: ${valueOrFallback(playable.primaryMechanic)}`,
        `First 10 seconds: ${Array.isArray(playable.firstTenSeconds) ? playable.firstTenSeconds.join(' -> ') : valueOrFallback(playable.firstTenSeconds)}`,
        `Win condition: ${valueOrFallback(playable.winCondition)}`,
        `Lose condition: ${valueOrFallback(playable.loseCondition)}`,
        '',
        listBlock('Player Actions', qualityIntent.playerActions),
        '',
        listBlock('Entity Rules', qualityIntent.entityRules),
        '',
        listBlock('Must Exist', qualityIntent.mustExist),
        '',
        listBlock('Feel Rules', qualityIntent.feelRules),
        '',
        listBlock('Failure Modes To Avoid', qualityIntent.failureModesToAvoid),
    ].join('\n');
}

function buildMobileRules(templateContract = {}) {
    const viewport = templateContract.common?.viewport || {};
    return [
        `Target viewport: ${viewport.targetWidth || 390}x${viewport.targetHeight || 844}`,
        `Top chrome safe space: ${viewport.chromeSafeTop || 112}px`,
        `Bottom chrome safe space: ${viewport.chromeSafeBottom || 48}px`,
        valueOrFallback(viewport.rule, 'Keep all gameplay and controls inside the safe rectangle.'),
        '',
        listBlock('Common Hard Rules', templateContract.common?.hardRules),
    ].join('\n');
}

export function buildMakerDesignBrief({ qualityIntent = {}, prompt = '', templateContract = null, assetContract = null } = {}) {
    const classification = templateContract?.classification || null;
    return [
        '# GameTok Maker Design Brief',
        '',
        'This brief is the source of truth for the builder. Follow it before writing code.',
        '',
        '## Classification',
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
        '## Player Experience',
        buildPlayerExperience(qualityIntent, prompt),
        '',
        '## Template Contract',
        buildTemplateRules(templateContract || {}),
        '',
        '## Asset Contract',
        buildAssetRules(assetContract || {}),
        '',
        '## Mobile And Product Contract',
        buildMobileRules(templateContract || {}),
        '',
        '## Builder Order',
        '- Start from the native scaffold if provided.',
        '- Preserve required state, functions, and probe API names.',
        '- Implement the core loop before decorative polish.',
        '- Use generated assets only through DreamAssets and only for approved art slots.',
        '- Verify the first frame, first interaction, and first 10 seconds against this brief.',
    ].join('\n');
}

export function summarizeMakerDesignBrief(brief = '') {
    const text = String(brief || '');
    return {
        chars: text.length,
        sections: (text.match(/^## /gm) || []).length,
        hasTemplateContract: text.includes('## Template Contract'),
        hasAssetContract: text.includes('## Asset Contract'),
    };
}

export function formatMakerDesignBriefPromptBlock(brief = '') {
    return [
        'GameTok maker design brief:',
        '```markdown',
        String(brief || '').slice(0, 45000),
        '```',
    ].join('\n');
}
