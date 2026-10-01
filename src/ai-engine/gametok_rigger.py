# SPDX-License-Identifier: MIT
"""
GameTok Master Skeleton Auto-Rigger Module for Blender.
Enables Hermes to rig any character mesh to the UE5/Mixamo Master Skeleton
via the official Blender MCP server.
"""

import os
import sys
def get_default_skeleton():
    candidate_paths = [
        os.environ.get("SKELETON_PATH"),
        os.path.abspath(os.path.join(os.getcwd(), "storage/skeletons/ue5_master_skeleton.fbx")),
        "/app/storage/skeletons/ue5_master_skeleton.fbx",
        "/Users/abiolalimitless/gameidea/gametok-backend/storage/skeletons/ue5_master_skeleton.fbx",
    ]
    for p in candidate_paths:
        if p and os.path.exists(p):
            return os.path.abspath(p)
    return candidate_paths[1]

DEFAULT_SKELETON = get_default_skeleton()

def rig_character(mesh_path: str, output_path: str, skeleton_path: str = None) -> dict:
    """
    Binds an unrigged 3D character mesh to the UE5/Mixamo Master Skeleton
    using Blender's automatic bone heat weighting, and exports a rigged GLB
    compatible with the 2,457 animation library.
    """
    import bpy
    import mathutils

    if not skeleton_path:
        skeleton_path = DEFAULT_SKELETON

    mesh_path = os.path.abspath(mesh_path)
    output_path = os.path.abspath(output_path)
    skeleton_path = os.path.abspath(skeleton_path)

    if not os.path.exists(mesh_path):
        raise FileNotFoundError(f"Input mesh not found: {mesh_path}")
    if not os.path.exists(skeleton_path):
        raise FileNotFoundError(f"Skeleton file not found: {skeleton_path}")

    # 1. Reset Scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # 2. Import Mesh
    ext = os.path.splitext(mesh_path)[1].lower()
    if ext in ['.glb', '.gltf']:
        bpy.ops.import_scene.gltf(filepath=mesh_path)
    elif ext == '.obj':
        try:
            bpy.ops.wm.obj_import(filepath=mesh_path)
        except Exception:
            bpy.ops.import_scene.obj(filepath=mesh_path)
    elif ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=mesh_path)
    else:
        raise ValueError(f"Unsupported format: {ext}")

    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not mesh_objects:
        raise RuntimeError("No mesh objects found in input file.")

    # 3. Calculate Mesh Bounding Box
    min_x = min_y = min_z = float('inf')
    max_x = max_y = max_z = float('-inf')

    for obj in mesh_objects:
        matrix = obj.matrix_world
        for corner in obj.bound_box:
            wc = matrix @ mathutils.Vector(corner)
            min_x = min(min_x, wc.x)
            max_x = max(max_x, wc.x)
            min_y = min(min_y, wc.y)
            max_y = max(max_y, wc.y)
            min_z = min(min_z, wc.z)
            max_z = max(max_z, wc.z)

    char_h = max_z - min_z
    char_w = max_x - min_x
    center_x = (min_x + max_x) / 2.0
    center_y = (min_y + max_y) / 2.0

    # 4. Import Master Armature
    if skeleton_path.lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=skeleton_path)
    else:
        bpy.ops.import_scene.gltf(filepath=skeleton_path)

    armatures = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    if not armatures:
        raise RuntimeError("No armature found in skeleton file.")

    armature = armatures[0]
    armature.name = "UE5_Master_Armature"

    # 5. Measure & Scale Armature
    arm_min_z = float('inf')
    arm_max_z = float('-inf')
    for b in armature.data.bones:
        arm_min_z = min(arm_min_z, b.head_local.z, b.tail_local.z)
        arm_max_z = max(arm_max_z, b.head_local.z, b.tail_local.z)

    arm_h = max(0.1, arm_max_z - arm_min_z)
    scale_factor = char_h / arm_h if arm_h > 0 else 1.0

    armature.scale = (scale_factor, scale_factor, scale_factor)
    armature.location = (center_x, center_y, min_z - (arm_min_z * scale_factor))

    # Apply Armature Transforms
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # 6. Bind Mesh to Armature (ARMATURE_AUTO)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in mesh_objects:
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')

    # 7. Export Rigged GLB
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format='GLB',
        export_skins=True,
        export_all_influences=True,
        export_morph=True,
        export_materials='EXPORT',
        export_yup=True
    )

    size_kb = os.path.getsize(output_path) / 1024.0

    return {
        "status": "ok",
        "output_path": output_path,
        "character_height": round(char_h, 3),
        "character_width": round(char_w, 3),
        "file_size_kb": round(size_kb, 1),
        "meshes_bound": len(mesh_objects)
    }
