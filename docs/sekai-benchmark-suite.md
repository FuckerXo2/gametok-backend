# Sekai Benchmark Suite

This is the reusable prompt suite we should keep running while hardening DreamStream toward the Sekai baseline.

Why this exists:
- screenshots are helpful, but benchmark prompts are easier to rerun
- the extracted Sekai templates gave us clear structural target families
- we need a stable way to inspect whether lane detection, first-frame rules, asset restraint, and control shells are still aligned

This suite is not trying to copy Sekai prompt-for-prompt.
It is trying to preserve the same product pressure:
- believable control fantasy
- readable first frame
- lane-appropriate staging
- asset discipline
- simple but intentional scope

## Benchmark Families

### 1. Minimal Story / Horror
Reference family:
- note / survey / ominous prompt interactions

Prompt:
`Create a minimal psychological horror experience called "Do You Feel Watched?" The screen should open in near-black with subtle grain and vignette, a centered question in small eerie type, and two large choices: YES and NO. Each answer should escalate the scene with different text, slight flicker, and a more unsettling atmosphere. Keep it very minimal, very intentional, and typography-first. No generic game HUD, no bright arcade styling, no random assets.`

What good looks like:
- `story_horror_vignette`
- `binary_choice_story`
- sparse asset bundle
- readable prompt on first frame
- visible choice UI on first frame

### 2. Interactive Note Reveal
Reference family:
- folded note / letter / reveal-card style interaction

Prompt:
`Make an interactive horror note experience where a folded letter opens into a disturbing message. The first frame should already feel designed and ominous. Let the player tap to unfold it, then choose whether to KEEP READING or STOP. Use elegant paper/card styling, restrained motion, subtle glow/shadow, and a strong final reveal. Keep it minimal and premium, not cheesy.`

What good looks like:
- `story_horror_vignette`
- one strong focal object
- no random environment clutter
- first frame already staged

### 3. Cockpit Driving
Reference family:
- first-person drive with explicit steering / speed fantasy

Prompt:
`Create a retro-futurist cockpit driving game at night where I steer down a neon highway with visible steering, accelerate, and brake controls, dashboard readouts, speed feedback, and obstacles ahead. It should feel like I am driving, not walking through a scene with a car skin.`

What good looks like:
- `first_person_threejs`
- `cockpit_driver`
- visible dashboard / road / controls on first frame

### 4. Move-And-Fire Room Combat
Reference family:
- simple combat scene made legit by visible controls and room staging

Prompt:
`Make a single-room survival shooter where I move with a visible joystick and fire with a big attack button while enemies rush me from around the room. Keep the room compact but staged, with readable cover, strong hit feedback, and no fake sprawling map.`

What good looks like:
- `single_room_shooter`
- `move_and_fire`
- room depth, controls, and enemy pressure immediately visible

### 5. Lane Runner
Reference family:
- simple runner made strong by lane clarity and forward depth

Prompt:
`Create a portrait endless lane runner where the player sprints through three clear lanes, swipes left and right to dodge, jumps over barricades, slides under hazards, and follows coin lines. Make the track feel deep and fast, not boxed in.`

What good looks like:
- `endless_runner_vertical`
- `lane_swipe_runner`
- runner, lanes, and first obstacle visible immediately

### 6. Simulation / Toybox
Reference family:
- central machine + source shelf + reveal state

Prompt:
`Make a playful fusion workshop where I drag ingredients from a shelf into a glowing central machine, trigger a combine reaction, and reveal a surprising result card. The screen should feel like a designed workstation with multiple clear zones, not just random props and one button.`

What good looks like:
- `simulation_toybox`
- `drag_drop_toybox`
- centerpiece + source zone + action cue visible immediately

### 7. Auto-Battler Arena
Reference family:
- staged battle spectacle with clear prep-to-battle loop

Prompt:
`Create a compact fantasy auto-battler where I place a few chunky units on a prep grid, tap BATTLE, and watch them clash with goblin waves in a broad staged arena. Keep the battlefield readable with good spacing, strong silhouettes, and a clear BATTLE button.`

What good looks like:
- `auto_battler_arena`
- prep grid or battle stage visible immediately
- not a muddy crowd pile

## How To Use

Run the inspection script:

`npm run benchmark:sekai`

Optional family filter:

`node scripts/inspect_sekai_benchmark_suite.mjs story_horror`

What the script should help us inspect:
- runtime lane
- control rig
- first-frame checklist
- asset bundle taste
- prompt contract excerpts

## Pass / Fail Heuristic

A benchmark family is not “good enough” if:
- it lands in the wrong lane
- the control rig is generic
- the first-frame checklist is weak or off-theme
- the asset bundle is loud, mismatched, or over-helpful
- the prompt contract does not clearly push the right fantasy

If any of those are wrong, we are not done.
