# Sekai Template Baseline

This document is the baseline we should build GameTOK toward first.

Why this baseline matters:
- the extracted Sekai templates are more reliable than screenshots for product comparison
- we have the actual code structure in front of us
- they show what a shippable “good enough” result looks like without guessing

This is not saying “copy Sekai.”
This is saying:
- use the extracted Sekai games as a floor for control quality, runtime structure, and scene composition
- then exceed them with our own model and asset pipeline

## What The Templates Prove

From [/Users/abiolalimitless/gameidea/sekai-templates/README.md](/Users/abiolalimitless/gameidea/sekai-templates/README.md) and the extracted `assets/game.html` files:

- Sekai uses a shared runtime shell across games
- each game exposes a consistent editable contract via `window.sekaiEditable`
- many successful games are mechanically simple
- many successful games use few or even zero custom images
- what makes them feel complete is often:
  - clear control rigs
  - intentional framing
  - immediate first-frame readability
  - lane-appropriate UI
  - disciplined scope

## Baseline Principles

When evaluating GameTOK output against Sekai, we should prioritize:

1. A believable control fantasy
2. A readable first frame
3. A lane-appropriate environment composition
4. A stable editable/runtime contract
5. Asset restraint and consistency

Do not use “more content” as the main quality metric.
Several Sekai examples feel finished because they commit hard to one interaction, not because they have more art.

## Reference Targets

### 1. Rhythm / Timeline Interaction
Reference:
- [/Users/abiolalimitless/gameidea/sekai-templates/game_02ab279f-a2f5-47eb-9ab9-a2335e6cb6a5/assets/game.html](/Users/abiolalimitless/gameidea/sekai-templates/game_02ab279f-a2f5-47eb-9ab9-a2335e6cb6a5/assets/game.html)

What to match:
- timeline-driven interaction
- obvious performance feedback
- strong central focal object
- readable state changes without huge asset load

GameTOK bar:
- our rhythm-style outputs must feel authored, not just “tap on beat”
- stage composition and hit feedback must carry the experience

### 2. Interactive Story / Minimal Horror
Reference:
- [/Users/abiolalimitless/gameidea/sekai-templates/game_05a9a97d-444c-498e-8512-b577294645cc/assets/game.html](/Users/abiolalimitless/gameidea/sekai-templates/game_05a9a97d-444c-498e-8512-b577294645cc/assets/game.html)

What to match:
- minimal assets but strong mood
- typography and spacing doing real work
- single-scene interaction that still feels intentional

GameTOK bar:
- our minimal story/horror outputs should not look empty-by-accident
- dark scenes must feel designed, not unfinished

### 3. Simulation / Multi-System Toy
Reference:
- [/Users/abiolalimitless/gameidea/sekai-templates/game_cd2a25fb-a5ae-4e0c-892d-38a134704e71/assets/game.html](/Users/abiolalimitless/gameidea/sekai-templates/game_cd2a25fb-a5ae-4e0c-892d-38a134704e71/assets/game.html)

What to match:
- more complex state
- multiple interaction zones
- clearer “toybox” feeling
- richer asset usage without total chaos

GameTOK bar:
- our simulation outputs need stronger system framing
- if we use more assets, they must reinforce the same fantasy instead of mixing styles

### 4. Minimal Asset Success Cases
Reference summary:
- 4 extracted Sekai games use 0 custom images
- 5 use only 1 to 4 custom images
- only 1 is asset-heavy

Source:
- [/Users/abiolalimitless/gameidea/sekai-templates/INDEX.txt](/Users/abiolalimitless/gameidea/sekai-templates/INDEX.txt)

What to learn:
- we do not need asset-heavy output to feel good
- strong interaction + strong framing can beat weak art abundance

GameTOK bar:
- do not overload games with mismatched props just because assets exist
- if a lane can win with restraint, we should prefer restraint

## Capability Checklist For GameTOK

We should consider a GameTOK lane “Sekai-baseline capable” only if it can reliably do all of these:

### Shared Runtime
- common iframe/runtime bridge
- editable metadata contract
- boot-safe first frame
- lane-safe mobile input handling

### Control Rig
- controls match the fantasy
- controls are visible when the lane needs visible controls
- controls are not generic overlays pasted onto every game

### Scene Composition
- not trapped in a tiny accidental box
- enough environment depth for the lane
- strong focal area
- enough negative space for clarity

### Asset Discipline
- lane-specific environment kit
- lane-specific control/UI kit
- background support, not just character support
- consistent style within one output

### Scope Discipline
- one polished loop beats a sprawling broken one
- if the lane is simple, commit to simplicity instead of fake complexity

## Immediate Product Targets

These are the next capability targets we should hold ourselves to:

1. First-person / cockpit driving should feel like driving, not walking with a car skin
2. Runner/platformer environments should imply continuation instead of boxed stages
3. Single-room games should feel intentionally staged, not cramped by accident
4. Minimal horror/story games should win through typography, spacing, and mood
5. Auto-battler arenas should feel like broad staged battlefields, not narrow clutter piles

## How To Use This Baseline

When we improve a lane, ask:

1. Which Sekai template is the nearest structural reference?
2. What is that template doing well with:
   - controls
   - first frame
   - environment scale
   - asset discipline
3. Is our output at least as readable and intentional as that reference?

If not, we are not done.

## Current Interpretation

Right now, the most useful takeaway is:

- Sekai’s advantage is not just “better AI”
- it is stronger use of:
  - shared runtime
  - editable contract
  - lane-specific control rigs
  - scene composition discipline
  - selective asset usage

That is the baseline we should keep building toward.
