# GameTok AI Asset Stack

This backend now follows the OpenGame-style split between asset planning and
model routing. The generator should not hardcode one visual model forever; it
routes each modality through environment configuration.

## Recommended Hosted Model Stack

```bash
HF_TOKEN=hf_...

# Base visual assets: backgrounds, sprites, props, items, tileset cores
HF_IMAGE_ENABLED=true
HF_IMAGE_MODEL=Qwen/Qwen-Image
HF_IMAGE_PROVIDER=auto

# Semantic sprite frame edits: idle, move, hit, pulse
HF_IMAGE_EDIT_ENABLED=true
HF_IMAGE_EDIT_MODEL=Qwen/Qwen-Image-Edit-2511
HF_IMAGE_EDIT_PROVIDER=auto
```

## Fast Experiment Stack

```bash
HF_IMAGE_MODEL=black-forest-labs/FLUX.1-Krea-dev
HF_IMAGE_EDIT_MODEL=black-forest-labs/FLUX.1-Kontext-dev
```

## Fallbacks

- If `HF_TOKEN` is missing, base image generation falls back to NVIDIA
  `FLUX.1-schnell`.
- If image editing is unavailable, animation frames fall back to local Sharp
  transforms so game generation still completes.
- Background removal remains local IMG.LY first, then hosted/local fallbacks.

## Why This Shape

OpenGame's asset quality comes from a production pipeline, not one magic prompt:

- model router by modality
- structured asset requests
- transparent sprites
- animation frame manifest
- asset pack consumed by Phaser
- HUD and gameplay geometry rendered in code

This file documents the model side of that split.
