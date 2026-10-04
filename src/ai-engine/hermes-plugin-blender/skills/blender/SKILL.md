---
name: blender
description: Use when inspecting, generating, modifying, or exporting 3D props, vehicles, cars, and environmental geometry in Blender via the official Blender Lab MCP server.
---

# Blender through MCP & GameTok 3D Asset Pipeline

This package connects Hermes to Blender via the official Blender Lab MCP server (port 9876).
It enables programmatic 3D scene inspection, procedural mesh generation, vehicle/car modeling, prop optimization, and GLB export for GameTok native games.

## Before working

1. Confirm Blender 5.1+ is running with the official MCP add-on listening on loopback port 9876.
2. Call `get_objects_summary` to verify bridge connectivity.

## Scene workflow

- `execute_blender_code`: Executes Python in the connected Blender instance with full `bpy` access.
- Assign JSON-serializable output to `result` for readback.
- Make small changes, serialize calls, and verify the resulting mesh state.

## 3D Props, Vehicles & Environmental Assets

Use Blender for modeling and optimizing non-skeletal game assets:

### 1. Vehicles & Cars
- Procedural chassis, wheels, spoilers, and collision hulls.
- Separate wheel objects (`Wheel_FL`, `Wheel_FR`, `Wheel_RL`, `Wheel_RR`) with origin points centered on axles for dynamic runtime rotation.
- Low-draw-call material assignments (metallic car paint, tinted glass, tire rubber).

### 2. Gameplay Props & Collectibles
- Crates, barrels, power-up crystals, portals, jump pads, and traps.
- UV unwrapping and procedural PBR material baking (Diffuse, Roughness, Metallic, Normal).
- Clean pivot point placement at base or center for simple placement in the game engine.

### 3. Environmental Set Pieces & Track Geometry
- Race track segments, neon arena arches, floating islands, and barricades.
- Modular snap-together dimensions (e.g. 10m grid units).
- Decimate and optimize high-poly meshes to mobile performance budgets (< 5,000 polygons for standard props, < 15,000 for hero vehicles).

## Clean GLB Export Workflow

Export game-ready `.glb` assets using `bpy.ops.export_scene.gltf`:
```python
import bpy

bpy.ops.export_scene.gltf(
    filepath="storage/props/custom_asset.glb",
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_yup=True
)
result = {"status": "success", "filepath": "storage/props/custom_asset.glb"}
```
