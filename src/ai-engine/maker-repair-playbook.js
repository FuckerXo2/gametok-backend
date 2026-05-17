const REPAIR_RECIPES = [
    {
        match: /trajectory|arc|setAim/i,
        title: 'Artillery trajectory preview does not respond',
        steps: [
            'Find the angle/power/wind state used by setAim() and by drawTrajectoryPreview().',
            'Make setAim(angle, power) mutate the same live state the renderer uses.',
            'Make trajectorySignature() derive from computed trajectory points, not a constant string.',
            'Do not fake the probe output; the visible arc should change too.',
        ],
    },
    {
        match: /fire\(\)|projectile|shell/i,
        title: 'Fire action does not create live projectile state',
        steps: [
            'Find the fire button/input path and the probe fire() method.',
            'Route both through the same fireProjectile()/fireWeapon() implementation.',
            'Create a projectile entity with position, velocity, active/flying state, and owner/turn metadata.',
            'Disable repeat fire until the projectile resolves.',
        ],
    },
    {
        match: /terrain|deform/i,
        title: 'Destructible terrain is visual-only',
        steps: [
            'Find the code-owned terrain heightfield/mask.',
            'Make explosions mutate terrain data inside the radius.',
            'Make drawing read from the mutated terrain data.',
            'Make the probe sample terrain before and after deformation and report changed=true.',
        ],
    },
    {
        match: /move\(\)|player position|movement/i,
        title: 'Movement probe does not move player',
        steps: [
            'Find the visible player state used by drawing.',
            'Make probe move() and pointer controls mutate that same state.',
            'Step the update loop long enough for velocity/input to affect position.',
            'Keep player within safe world bounds after movement.',
        ],
    },
    {
        match: /enemy|spawn/i,
        title: 'Enemy/threat spawn does not affect live entity arrays',
        steps: [
            'Find the live enemies array used by update and draw.',
            'Make spawnEnemy()/spawnEnemyNearPlayer() push into that same array.',
            'Place spawned enemies onscreen and near enough to test interactions quickly.',
            'Update snapshot() to report the live enemy count.',
        ],
    },
    {
        match: /score|health|collision|combat/i,
        title: 'Combat state does not progress',
        steps: [
            'Verify projectile/enemy/player collision checks run during step/update.',
            'On collision, mutate score, health, enemy alive state, particles, or wave progress.',
            'Make snapshot() expose the same live score/health/entity counts used by the UI.',
            'Avoid decorative-only hit flashes that do not mutate gameplay state.',
        ],
    },
    {
        match: /choice|story|node|meter|ending/i,
        title: 'Story choices do not mutate story state',
        steps: [
            'Make choose(index) and visible choice buttons call the same state transition.',
            'Record history and mutate flags/meters/consequences on each choice.',
            'Ensure later node text/visuals depend on those flags/meters.',
            'Make forceEnding() reach a real ending state and reset() clear it.',
        ],
    },
    {
        match: /canvas|viewport|overflow|outside|safe/i,
        title: 'Mobile viewport or chrome-safe layout failure',
        steps: [
            'Compute safe bounds from window.innerWidth/window.innerHeight.',
            'Clamp canvas, HUD, and controls inside the safe rectangle.',
            'Avoid fixed desktop widths, negative offsets, and oversized canvas backing stores.',
            'Recompute layout on resize/orientation changes.',
        ],
    },
    {
        match: /DreamAssets|asset|role|image ui|HUD/i,
        title: 'Asset contract violation',
        steps: [
            'Use DreamAssets only for approved gameplay art roles like player, enemy, prop, item, effect, or background.',
            'Keep HUD text, meters, buttons, sliders, labels, and hitboxes code-rendered.',
            'If a required generated role exists, consume it through DreamAssets.firstByRole(role) or getImage(key).',
            'Preserve intentional code fallback art when an asset is missing.',
        ],
    },
];

export function buildMakerRepairPlaybook(tasks = []) {
    const text = JSON.stringify(tasks || []);
    const matched = REPAIR_RECIPES.filter((recipe) => recipe.match.test(text));
    const recipes = matched.length > 0 ? matched : REPAIR_RECIPES.slice(0, 3);
    return {
        version: 1,
        source: 'gametok-maker-repair-playbook',
        recipes: recipes.map(({ title, steps }) => ({ title, steps })),
    };
}
