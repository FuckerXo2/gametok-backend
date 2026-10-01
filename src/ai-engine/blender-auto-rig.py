"""
Blender Headless Auto-Rigger for GameTok
Binds any unrigged T-pose/A-pose 3D mesh (.glb / .obj) to the UE5 Master Skeleton
and exports a lightweight, rigged .glb ready for Three.js and the 2,457 MoCap library.

Usage (Headless):
    blender -b -P blender-auto-rig.py -- <input_mesh_path> <output_rigged_path> [skeleton_path]
"""

import sys
import os
import math

def run_auto_rig():
    try:
        import bpy
        import mathutils
    except ImportError:
        print("❌ Error: This script must be run inside Blender: blender -b -P blender-auto-rig.py -- ...")
        sys.exit(1)

    # 1. Parse Command Line Arguments
    args = sys.argv
    if "--" not in args:
        print("❌ Usage: blender -b -P blender-auto-rig.py -- <input_mesh> <output_rigged> [skeleton_fbx]")
        sys.exit(1)

    custom_args = args[args.index("--") + 1:]
    if len(custom_args) < 2:
        print("❌ Error: Missing input or output path.")
        sys.exit(1)

    input_path = os.path.abspath(custom_args[0])
    output_path = os.path.abspath(custom_args[1])
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    default_skeleton = os.path.abspath(os.path.join(script_dir, '../../storage/skeletons/ue5_master_skeleton.glb'))
    skeleton_path = os.path.abspath(custom_args[2]) if len(custom_args) > 2 else default_skeleton

    print(f"\n🦾 [Blender Auto-Rigger] Starting headless pipeline...")
    print(f"   📥 Input Mesh:     {input_path}")
    print(f"   🦴 Master Rig:     {skeleton_path}")
    print(f"   📤 Output Rigged:  {output_path}")

    if not os.path.exists(input_path):
        print(f"❌ Error: Input mesh not found: {input_path}")
        sys.exit(1)
    if not os.path.exists(skeleton_path):
        print(f"❌ Error: Skeleton file not found: {skeleton_path}")
        sys.exit(1)

    # 2. Reset Scene to clean slate
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # 3. Import Character Mesh
    ext = os.path.splitext(input_path)[1].lower()
    if ext in ['.glb', '.gltf']:
        bpy.ops.import_scene.gltf(filepath=input_path)
    elif ext == '.obj':
        try:
            bpy.ops.wm.obj_import(filepath=input_path)
        except Exception:
            bpy.ops.import_scene.obj(filepath=input_path)
    elif ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=input_path)
    else:
        print(f"❌ Unsupported format: {ext}")
        sys.exit(1)

    # Collect meshes
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not mesh_objects:
        print("❌ Error: No mesh objects found in input file.")
        sys.exit(1)

    print(f"   📦 Found {len(mesh_objects)} mesh objects in character.")

    # Calculate overall mesh bounding box in world space
    min_x = min_y = min_z = float('inf')
    max_x = max_y = max_z = float('-inf')

    for obj in mesh_objects:
        matrix = obj.matrix_world
        for corner in obj.bound_box:
            world_corner = matrix @ mathutils.Vector(corner)
            min_x = min(min_x, world_corner.x)
            max_x = max(max_x, world_corner.x)
            min_y = min(min_y, world_corner.y)
            max_y = max(max_y, world_corner.y)
            min_z = min(min_z, world_corner.z)
            max_z = max(max_z, world_corner.z)

    char_h = max_z - min_z
    char_w = max_x - min_x
    char_center_x = (min_x + max_x) / 2.0
    char_center_y = (min_y + max_y) / 2.0
    print(f"   📏 Character Height: {char_h:.2f}m, Width: {char_w:.2f}m, Base Z: {min_z:.2f}m")

    # 4. Import Master Armature
    if skeleton_path.lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=skeleton_path)
    else:
        bpy.ops.import_scene.gltf(filepath=skeleton_path)

    armatures = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    if not armatures:
        print("❌ Error: No armature found after importing skeleton.")
        sys.exit(1)

    armature = armatures[0]
    armature.name = "UE5_Master_Armature"

    # Measure Armature height (Head / highest bone vs root / lowest bone)
    arm_min_z = float('inf')
    arm_max_z = float('-inf')
    for b in armature.data.bones:
        arm_min_z = min(arm_min_z, b.head_local.z, b.tail_local.z)
        arm_max_z = max(arm_max_z, b.head_local.z, b.tail_local.z)

    arm_h = max(0.1, arm_max_z - arm_min_z)
    print(f"   🦴 Armature Native Height: {arm_h:.2f}m")

    # 5. Align & Scale Armature to Character
    scale_factor = char_h / arm_h if arm_h > 0 else 1.0
    armature.scale = (scale_factor, scale_factor, scale_factor)
    armature.location = (char_center_x, char_center_y, min_z - (arm_min_z * scale_factor))

    # Apply Armature Transforms so scale is clean 1.0
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # 6. Bind Mesh to Armature with Automatic Bone Weights
    print("   ⚡ Binding meshes to skeleton (Automatic Heat Weights)...")
    bpy.ops.object.select_all(action='DESELECT')

    for obj in mesh_objects:
        obj.select_set(True)
        # Ensure normals and scales are applied
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # Select armature as active
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature

    # Execute Automatic Bone Heat Weighting
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    print("   ✅ Skinning calculation complete!")

    # 7. Export Rigged Character as GLB
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    print(f"   💾 Exporting rigged GLB to: {output_path}...")

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format='GLB',
        export_skins=True,
        export_all_influences=True,
        export_morph=True,
        export_materials='EXPORT',
        export_yup=True
    )

    out_size_kb = os.path.getsize(output_path) / 1024.0
    print(f"   🎉 SUCCESS! Exported rigged character ({out_size_kb:.1f} KB)")
    print(f"   🚀 Ready for Three.js with full UE5 animation library compatibility!\n")

if __name__ == '__main__':
    run_auto_rig()
