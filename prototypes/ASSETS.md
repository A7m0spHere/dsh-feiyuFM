# FishFM UI prototype assets

These three transparent PNGs are images previously generated for this FishFM project with Codex ImageGen. They are copied into this prototype from the local generated-image outputs so the preview remains self-contained; no third-party whale artwork is included.

| Prototype file | Source output | Use |
|---|---|---|
| `assets/whale-idle.png` | `exec-92d3fe0f-e92d-4cee-9061-fe306fabfb2a.png` | Rest / paused pose |
| `assets/whale-listening.png` | `exec-2dc4fe6d-b57d-4c5a-bf74-7c22c77c9c1f.png` | Listening pose |
| `assets/whale-dj.png` | `exec-fbd1d4cf-a644-4c8d-8e02-95cbd1dcda4d.png` | Track-selection / DJ pose |

The page animates between these poses based on its demo playback state and uses a small CSS-only idle motion. It does not call the balance widget, DSH, or a music provider.
