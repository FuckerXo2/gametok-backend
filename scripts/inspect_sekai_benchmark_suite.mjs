import { normalizeDreamSpec } from '../src/ai-engine/spec-normalizer.js';
import { buildDreamAssetBundle } from '../src/ai-engine/asset-dictionary.js';
import { buildPhase2_BuildPrototype } from '../src/ai-engine/promptRegistry.js';

const BENCHMARKS = [
  {
    id: 'story_horror',
    title: 'Minimal Story / Horror',
    prompt:
      'Create a minimal psychological horror experience called "Do You Feel Watched?" The screen should open in near-black with subtle grain and vignette, a centered question in small eerie type, and two large choices: YES and NO. Each answer should escalate the scene with different text, slight flicker, and a more unsettling atmosphere. Keep it very minimal, very intentional, and typography-first. No generic game HUD, no bright arcade styling, no random assets.',
    seed: { title: 'Do You Feel Watched?', genre: 'Horror Story', atmosphere: 'Mysterious & Eerie' },
  },
  {
    id: 'story_note',
    title: 'Interactive Note Reveal',
    prompt:
      'Make an interactive horror note experience where a folded letter opens into a disturbing message. The first frame should already feel designed and ominous. Let the player tap to unfold it, then choose whether to KEEP READING or STOP. Use elegant paper/card styling, restrained motion, subtle glow/shadow, and a strong final reveal. Keep it minimal and premium, not cheesy.',
    seed: { title: 'The Letter', genre: 'Horror Story', atmosphere: 'Mysterious & Eerie' },
  },
  {
    id: 'cockpit_driver',
    title: 'Cockpit Driving',
    prompt:
      'Create a retro-futurist cockpit driving game at night where I steer down a neon highway with visible steering, accelerate, and brake controls, dashboard readouts, speed feedback, and obstacles ahead. It should feel like I am driving, not walking through a scene with a car skin.',
    seed: { title: 'Night Driver', genre: 'Driving', atmosphere: 'Neon & Electric' },
  },
  {
    id: 'move_and_fire',
    title: 'Move-And-Fire Room Combat',
    prompt:
      'Make a single-room survival shooter where I move with a visible joystick and fire with a big attack button while enemies rush me from around the room. Keep the room compact but staged, with readable cover, strong hit feedback, and no fake sprawling map.',
    seed: { title: 'Room Siege', genre: 'Action Shooter', atmosphere: 'Tense & Stressful' },
  },
  {
    id: 'runner',
    title: 'Lane Runner',
    prompt:
      'Create a portrait endless lane runner where the player sprints through three clear lanes, swipes left and right to dodge, jumps over barricades, slides under hazards, and follows coin lines. Make the track feel deep and fast, not boxed in.',
    seed: { title: 'Lane Rush', genre: 'Runner', atmosphere: 'Fast / Arcade' },
  },
  {
    id: 'toybox',
    title: 'Simulation / Toybox',
    prompt:
      'Make a playful fusion workshop where I drag ingredients from a shelf into a glowing central machine, trigger a combine reaction, and reveal a surprising result card. The screen should feel like a designed workstation with multiple clear zones, not just random props and one button.',
    seed: { title: 'Fusion Workshop', genre: 'Simulation', atmosphere: 'Bright & Cheerful' },
  },
  {
    id: 'auto_battler',
    title: 'Auto-Battler Arena',
    prompt:
      'Create a compact fantasy auto-battler where I place a few chunky units on a prep grid, tap BATTLE, and watch them clash with goblin waves in a broad staged arena. Keep the battlefield readable with good spacing, strong silhouettes, and a clear BATTLE button.',
    seed: { title: 'Battle Prep', genre: 'Auto Battler', atmosphere: 'Fast / Arcade' },
  },
];

function summarizeAssets(section = [], limit = 4) {
  return section.slice(0, limit).map((asset) => `${asset.label} [${asset.kind}]`).join(' | ') || 'none';
}

function fallbackAssetNotes(spec) {
  switch (spec?.runtimeLane) {
    case 'story_horror_vignette':
      return [
        'No asset bundle attached: this lane is allowed to succeed through typography, atmosphere, and procedural scene styling alone.',
      ];
    case 'simulation_toybox':
      return [
        'No asset bundle attached: this lane should proceduralize the workstation, source shelf, and reveal UI instead of forcing mismatched props.',
      ];
    case 'first_person_threejs':
      return [
        'No asset bundle attached: this lane should proceduralize readable world geometry and cockpit/dashboard cues instead of faking bad asset support.',
      ];
    case 'endless_runner_vertical':
      return [
        'No asset bundle attached: this lane should proceduralize the runner, lanes, and obstacle telegraphing instead of forcing weak sprite support.',
      ];
    default:
      return ['No asset bundle attached for this benchmark prompt.'];
  }
}

function extractPromptHighlights(prompt) {
  const lines = prompt.split('\n');
  return lines.filter((line) =>
    /Runtime Lane:|Control Rig:|Environment Scale:|FIRST-FRAME CHECKLIST:|CONTROL RIG \(MANDATORY|STORY \/ HORROR VIGNETTE SHELL|SIMULATION \/ TOYBOX SHELL|MOVE-AND-FIRE CONTROL SHELL|LANE-SWIPE RUNNER CONTROL SHELL|cockpit-driving fantasy|first-person 3D/i.test(line)
  );
}

function printBenchmark(benchmark) {
  const spec = normalizeDreamSpec(
    {
      ...benchmark.seed,
      summary: benchmark.prompt,
    },
    benchmark.prompt
  );
  const bundle = buildDreamAssetBundle(spec, benchmark.prompt);
  const buildPrompt = buildPhase2_BuildPrototype(spec, bundle, []);
  const highlights = extractPromptHighlights(buildPrompt);

  const output = {
    id: benchmark.id,
    title: benchmark.title,
    runtimeLane: spec.runtimeLane,
    controlRig: spec.controlRig,
    sceneBlueprint: spec.sceneBlueprint,
    firstFrameChecklist: spec.firstFrameChecklist,
    compositionTargets: spec.compositionTargets,
    visualTargets: spec.visualTargets,
    assetSummary: {
      bundlePresent: Boolean(bundle),
      visuals: summarizeAssets(bundle?.visuals || []),
      controls: summarizeAssets(bundle?.controls || []),
      audio: summarizeAssets(bundle?.audio || []),
      notes: bundle?.notes || fallbackAssetNotes(spec),
    },
    promptHighlights: highlights,
  };

  console.log(`\n=== ${benchmark.title} (${benchmark.id}) ===`);
  console.log(JSON.stringify(output, null, 2));
}

const filter = (process.argv[2] || '').trim().toLowerCase();
const selected = filter
  ? BENCHMARKS.filter((benchmark) => benchmark.id.includes(filter) || benchmark.title.toLowerCase().includes(filter))
  : BENCHMARKS;

if (selected.length === 0) {
  console.error(`No benchmark family matched "${filter}".`);
  process.exit(1);
}

for (const benchmark of selected) {
  printBenchmark(benchmark);
}
