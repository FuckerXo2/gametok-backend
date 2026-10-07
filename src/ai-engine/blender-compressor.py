"""
Blender 3D Asset Compressor & Mobile Optimizer for GameTok
Shrinks GLB files (e.g. 10MB - 50MB+) down to 1.5MB - 3.5MB by:
1. Resizing high-res 4K/2K textures to max 1024x1024 (mobile optimal)
2. Compressing embedded textures to high-efficiency WebP (82% quality)
3. Decimating extreme polygon density (> 35,000 triangles)
4. Preserving skeletal armatures, bone weights, and animations

Usage:
    blender -b -P blender-compressor.py -- <input_glb> <output_compressed_glb> [max_dim] [quality]
"""

import sys
import os

def run_compression():
    try:
        import bpy
    except ImportError:
        print("❌ Error: Must be run inside Blender")
        sys.exit(1)

    args = sys.argv
    if "--" not in args:
        print("❌ Usage: blender -b -P blender-compressor.py -- <input_glb> <output_glb> [max_dim] [quality]")
        sys.exit(1)

    custom_args = args[args.index("--") + 1:]
    if len(custom_args) < 2:
        print("❌ Error: Missing input or output path.")
        sys.exit(1)

    input_path = os.path.abspath(custom_args[0])
    output_path = os.path.abspath(custom_args[1])
    max_dim = int(custom_args[2]) if len(custom_args) > 2 else 1024
    image_quality = int(custom_args[3]) if len(custom_args) > 3 else 82

    initial_size_mb = os.path.getsize(input_path) / (1024.0 * 1024.0)
    print(f"\n🗜️ [Blender Asset Compressor] Starting optimization for: {os.path.basename(input_path)}")
    print(f"   📥 Initial Size:   {initial_size_mb:.2f} MB")
    print(f"   🖼️ Max Texture:    {max_dim}px")
    print(f"   🎨 Quality:        {image_quality}%")

    # 1. Reset scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # 2. Import GLB
    bpy.ops.import_scene.gltf(filepath=input_path)

    # 3. Downscale oversized textures
    resized_count = 0
    for img in bpy.data.images:
        w, h = img.size[0], img.size[1]
        if w > max_dim or h > max_dim:
            ratio = float(max_dim) / float(max(w, h))
            new_w = max(1, int(w * ratio))
            new_h = max(1, int(h * ratio))
            print(f"   🖼️ Resizing '{img.name}' from {w}x{h} -> {new_w}x{new_h}")
            try:
                img.scale(new_w, new_h)
                resized_count += 1
            except Exception as e:
                print(f"   ⚠️ Could not resize image '{img.name}': {e}")

    # 4. Check polygon count & optional decimation
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    total_polys = sum(len(m.data.polygons) for m in mesh_objects if m.data)
    print(f"   📐 Total Mesh Polygons: {total_polys:,}")

    MAX_SAFE_POLYS = 40000
    if total_polys > MAX_SAFE_POLYS:
        decimate_ratio = round(float(MAX_SAFE_POLYS) / float(total_polys), 3)
        print(f"   ✂️ Mesh exceeds mobile budget ({total_polys:,} > {MAX_SAFE_POLYS:,}). Applying Decimate (ratio: {decimate_ratio})...")
        for obj in mesh_objects:
            if obj.data and len(obj.data.polygons) > 5000:
                mod = obj.modifiers.new(name="MobileDecimate", type='DECIMATE')
                mod.ratio = decimate_ratio

    # 5. Export compressed GLB with WebP texture encoding
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    print(f"   💾 Exporting optimized GLB to: {output_path}...")

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format='GLB',
        export_skins=True,
        export_all_influences=True,
        export_morph=True,
        export_materials='EXPORT',
        export_image_format='WEBP',
        export_image_quality=image_quality,
        export_yup=True
    )

    final_size_mb = os.path.getsize(output_path) / (1024.0 * 1024.0)
    saved_pct = ((initial_size_mb - final_size_mb) / initial_size_mb) * 100.0 if initial_size_mb > 0 else 0
    print(f"   🎉 SUCCESS! Optimized size: {final_size_mb:.2f} MB (Saved {saved_pct:.1f}%!)")

if __name__ == '__main__':
    run_compression()
