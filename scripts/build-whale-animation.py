"""Assemble the generated six-pose sheet; requires Pillow only at asset build time."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/art/whale-motion-v1.png'
OUTPUT = ROOT / 'src/ui/assets'
sheet = Image.open(SOURCE).convert('RGBA')
width, height = sheet.size
frames = []
for index in range(6):
    col, row = index % 3, index // 3
    cell = sheet.crop((col * width // 3, row * height // 2,
                       (col + 1) * width // 3, (row + 1) * height // 2))
    # Register generated poses by their visible bounds, keeping feet on one baseline.
    bounds = cell.getchannel('A').point(lambda alpha: 255 if alpha >= 128 else 0).getbbox()
    crop = cell.crop(bounds)
    crop.thumbnail((240, 294), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (256, 320))
    canvas.alpha_composite(crop, ((256 - crop.width) // 2, 308 - crop.height))
    frames.append(canvas)

OUTPUT.mkdir(parents=True, exist_ok=True)
frames[0].save(OUTPUT / 'whale-loop-still.png', optimize=True)
# One palette for all frames prevents color flicker. Index 255 is GIF transparency.
atlas = Image.new('RGB', (256 * 6, 320))
for index, frame in enumerate(frames):
    atlas.paste(frame.convert('RGB'), (256 * index, 0))
palette = atlas.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
indexed = []
for frame in frames:
    image = frame.convert('RGB').quantize(palette=palette, dither=Image.Dither.NONE)
    image.paste(255, mask=frame.getchannel('A').point(lambda alpha: 255 if alpha < 128 else 0))
    image.info['transparency'] = 255
    indexed.append(image)
sequence = [0, 1, 2, 1, 0, 3, 4, 5, 4, 3]
durations = [1600, 80, 120, 80, 500, 220, 400, 220, 180, 220]
indexed[0].save(OUTPUT / 'whale-listening-loop.gif', save_all=True,
                append_images=[indexed[index] for index in sequence[1:]],
                duration=durations, loop=0, transparency=255, disposal=2, optimize=False)
gif = Image.open(OUTPUT / 'whale-listening-loop.gif')
print(f'{gif.n_frames} frames, {sum(durations)} ms loop, {gif.size}, transparent index {gif.info["transparency"]}')
