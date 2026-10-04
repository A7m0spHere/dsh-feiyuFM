"""Assemble the generated 32-pose sheet; requires Pillow only at asset build time."""
from pathlib import Path
from hashlib import sha256
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/art/whale-motion-v2.png'
OUTPUT = ROOT / 'src/ui/assets'
# Measured transparent row gaps in the selected generated sheet (1254 square).
# The image tool returned 6 + 6 + 7 + 6 + 7 poses rather than the requested 6x6.
ROW_EDGES = [0, 253, 486, 722, 957, 1254]
ROW_COLUMNS = [6, 6, 7, 6, 7]
COUNT = sum(ROW_COLUMNS)
sheet = Image.open(SOURCE).convert('RGBA')
if sheet.getchannel('A').getextrema()[0] != 0:
    raise ValueError('Sprite sheet must have a transparent background')
width, height = sheet.size
if sheet.size != (1254, 1254):
    raise ValueError('Crop coordinates require the selected 1254x1254 generated sheet')
frames = []
for row, columns in enumerate(ROW_COLUMNS):
    for col in range(columns):
        cell = sheet.crop((col * width // columns, ROW_EDGES[row],
                           (col + 1) * width // columns, ROW_EDGES[row + 1]))
        # Register generated poses by visible bounds, keeping feet on one baseline.
        bounds = cell.getchannel('A').point(lambda alpha: 255 if alpha >= 128 else 0).getbbox()
        if bounds is None:
            raise ValueError(f'Empty generated pose {len(frames) + 1}')
        crop = cell.crop(bounds)
        scale = min(240 / crop.width, 294 / crop.height)
        crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.Resampling.LANCZOS)
        canvas = Image.new('RGBA', (256, 320))
        canvas.alpha_composite(crop, ((256 - crop.width) // 2, 308 - crop.height))
        frames.append(canvas)

OUTPUT.mkdir(parents=True, exist_ok=True)
frames[0].save(OUTPUT / 'whale-loop-still-v2.png', optimize=True)
# One palette for all frames prevents color flicker. Index 255 is GIF transparency.
atlas = Image.new('RGB', (256 * COUNT, 320))
for index, frame in enumerate(frames):
    atlas.paste(frame.convert('RGB'), (256 * index, 0))
palette = atlas.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
indexed = []
for frame in frames:
    image = frame.convert('RGB').quantize(palette=palette, dither=Image.Dither.NONE)
    image.paste(255, mask=frame.getchannel('A').point(lambda alpha: 255 if alpha < 128 else 0))
    image.info['transparency'] = 255
    indexed.append(image)
durations = [600] + [70] * (COUNT - 2) + [250]
indexed[0].save(OUTPUT / 'whale-listening-loop-v2.gif', save_all=True,
                append_images=indexed[1:],
                duration=durations, loop=0, transparency=255, disposal=2, optimize=False)
gif = Image.open(OUTPUT / 'whale-listening-loop-v2.gif')
hashes = set()
for index in range(gif.n_frames):
    gif.seek(index)
    hashes.add(sha256(gif.convert('RGBA').tobytes()).hexdigest())
if gif.n_frames < COUNT or len(hashes) < COUNT:
    raise ValueError(f'Expected {COUNT} distinct frames, got {gif.n_frames} frames / {len(hashes)} distinct')
gif.seek(0)
print(f'{gif.n_frames} frames / {len(hashes)} distinct, {sum(durations)} ms loop, {gif.size}, transparent index {gif.info["transparency"]}')
