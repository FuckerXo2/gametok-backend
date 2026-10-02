---
name: blender
description: Use when inspecting, editing, rigging, or generating 3D assets in Blender via the official Blender Lab MCP server.
---

# Blender through MCP & GameTok 3D Pipeline

This package connects Hermes to Blender via the official Blender Lab MCP server (port 9876).
It enables programmatic 3D scene inspection, procedural geometry, character auto-rigging to the UE5/Mixamo Master Skeleton, and GLB export for GameTok native games.

## Before working

1. Confirm Blender 5.1+ is running with the official MCP add-on listening on loopback port 9876.
2. Call `get_objects_summary` to verify bridge connectivity.

## Scene workflow

- `execute_blender_code`: Executes Python in the connected Blender instance with full `bpy` access.
- Assign JSON-serializable output to `result` for readback.
- Make small changes, serialize calls, and verify the resulting mesh state.

## GameTok Character Auto-Rigging to UE5 Master Skeleton

When rigging raw character meshes (e.g. `scorpion.glb`, `hal_jordan_green_lantern.glb`, or imported OBJ/GLB characters):
1. The `gametok_rigger` Python module is pre-installed in Blender's module search path.
2. Use `execute_blender_code` to call `gametok_rigger.rig_character()`:
```python
import gametok_rigger

result = gametok_rigger.rig_character(
    mesh_path="storage/characters/scorpion.glb",
    output_path="storage/models3d/rigged/scorpion_rigged.glb"
)
```
3. The rigger automatically:
   - Resets the scene to a clean slate.
   - Imports the mesh and centers/scales it.
   - Imports the UE5 Master Skeleton (`storage/skeletons/ue5_master_skeleton.glb`).
   - Parents the mesh to the armature with Automatic Weights (bone heat weighting).
   - Exports the rigged `.glb` model ready for animation playback in the mobile game engine.

## GameTok Core Animation Library

Rigged characters are 100% compatible with the GameTok 2,457 Mixamo MoCap library.
For humanoid gameplay, spawn the model with `engine.spawnModel(url, x, y, z)` and play/blend animations with `engine.playAnimation(entityId, animUrl, options)`:

- **Idle (Relaxed):** `https://pub-b7694276c8f54290854b276638a93b62.r2.dev/animations/core/idle.glb`
- **Fight Idle (Stance):** `https://pub-b7694276c8f54290854b276638a93b62.r2.dev/animations/core/fight_idle.glb`
- **Walk:** `https://pub-b7694276c8f54290854b276638a93b62.r2.dev/animations/core/walk.glb`
- **Run / Sprint:** `https://pub-b7694276c8f54290854b276638a93b62.r2.dev/animations/core/run.glb`
- **Combo Punch:** `https://pub-b7694276c8f54290854b276638a93b62.r2.dev/animations/core/punch.glb`
- **Cross Punch:** `https://pub-b7694276c8f54290854b276638a93b62.r2.dev/animations/core/cross_punch.glb`
- **Kick:** `https://pub-b7694276c8f54290854b276638a93b62.r2.dev/animations/core/kick.glb`
- **Block:** `https://pub-b7694276c8f54290854b276638a93b62.r2.dev/animations/core/block.glb`
- **Hit Reaction:** `https://pub-b7694276c8f54290854b276638a93b62.r2.dev/animations/core/hit.glb`
- **Death / Defeat:** `https://pub-b7694276c8f54290854b276638a93b62.r2.dev/animations/core/death.glb`

Pre-rigged models are also directly available at:
- **Scorpion (Rigged):** `https://pub-b7694276c8f54290854b276638a93b62.r2.dev/characters/scorpion_rigged.glb`
- **Hal Jordan (Rigged):** `https://pub-b7694276c8f54290854b276638a93b62.r2.dev/characters/hal_jordan_green_lantern_rigged.glb`
