"""Cut out the user-provided 50-frame GIF without redrawing or moving its pixels.

Asset-build dependencies only: Pillow, numpy, opencv-python-headless 4.12.0.88.
"""
from argparse import ArgumentParser
from hashlib import sha256
from pathlib import Path
import json
import sys

parser = ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--opencv-root', type=Path)
parser.add_argument('--review-dir', type=Path)
parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'src/ui/assets')
args = parser.parse_args()
if args.opencv_root:
    sys.path.insert(0, str(args.opencv_root.resolve()))
import cv2
import numpy as np
from PIL import Image, GifImagePlugin

SOURCE_SHA = '9dd8c95e110adce7918ad06deaa118ccd33186982a4d077bd4d0b2045af13711'
if sha256(args.source.read_bytes()).hexdigest() != SOURCE_SHA:
    raise ValueError('Foreground seeds are specific to the supplied GIF; source hash differs')
source = Image.open(args.source)
if source.format != 'GIF' or source.size != (320, 426) or source.n_frames != 50:
    raise ValueError('Expected the supplied 320x426 / 50-frame GIF')
loop = source.info.get('loop', 0)
cv2.setNumThreads(1)
fin_seeds = {31: (70,225), 32: (84,239), 34: (160,181), 35: (194,193),
             37: (254,242), 45: (64,226), 46: (84,239)}
frames, durations = [], []
for index in range(source.n_frames):
    source.seek(index)
    durations.append(source.info.get('duration', 100))
    rgb = np.array(source.convert('RGB'))
    r, g, b = [rgb[:, :, channel].astype(float) for channel in range(3)]
    mask = np.full(r.shape, cv2.GC_PR_FGD, np.uint8)
    mask[:30] = mask[400:] = cv2.GC_BGD
    mask[(g > r * 1.12) & (g > b * 1.10)] = cv2.GC_BGD
    hair = (b > r * 1.3) & (b > g * 1.14) & (b < 170) & (g < 120)
    hair[:70] = False
    mask[hair] = cv2.GC_FGD
    mask[:230, :8] = mask[:230, -8:] = cv2.GC_BGD
    if index in fin_seeds:
        cv2.circle(mask, fin_seeds[index], 3, cv2.GC_FGD, -1)
    cv2.setRNGSeed(1729 + index)
    cv2.grabCut(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), mask, None,
                np.zeros((1, 65)), np.zeros((1, 65)), 8, cv2.GC_INIT_WITH_MASK)
    alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    # Recover pale details enclosed by the silhouette, without filling green gaps.
    closed = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    exterior = closed.copy()
    cv2.floodFill(exterior, np.zeros((428, 322), np.uint8), (0, 0), 255)
    holes = (exterior == 0) & (closed == 0)
    pale = (np.max(rgb, axis=2).astype(float) - np.min(rgb, axis=2).astype(float) < 90) & (np.min(rgb, axis=2) > 140)
    alpha[holes & pale] = 255
    frame = Image.fromarray(np.dstack([rgb, alpha]))
    if frame.getchannel('A').getbbox() is None:
        raise ValueError(f'Empty foreground frame {index}')
    frames.append(frame)
    print(f'Cut out {index + 1}/50', flush=True)

# One crop for every frame preserves all original relative positions and bounce.
boxes = [frame.getchannel('A').getbbox() for frame in frames]
crop = (max(0, min(box[0] for box in boxes) - 4), max(0, min(box[1] for box in boxes) - 4),
        min(320, max(box[2] for box in boxes) + 4), min(426, max(box[3] for box in boxes) + 4))
frames = [frame.crop(crop) for frame in frames]
args.output.mkdir(parents=True, exist_ok=True)
frames[15].save(args.output / 'whale-pot-still.png', optimize=True)
width, height = frames[0].size
atlas = Image.new('RGB', (width * 10, height * 5))
for index, frame in enumerate(frames):
    colors = np.array(frame.convert('RGB'))
    colors[np.array(frame.getchannel('A')) == 0] = 0
    atlas.paste(Image.fromarray(colors), (width * (index % 10), height * (index // 10)))
palette = atlas.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
indexed = []
for frame in frames:
    encoded = frame.convert('RGB').quantize(palette=palette, dither=Image.Dither.NONE)
    encoded.paste(255, mask=frame.getchannel('A').point(lambda value: 255 if value == 0 else 0))
    indexed.append(encoded)

target = args.output / 'whale-pot-dance.gif'
# Write full original frames explicitly: identical holds must keep their own timing.
with target.open('wb') as stream:
    header, _ = GifImagePlugin.getheader(indexed[0], info={'loop': loop, 'transparency': 255, 'background': 255, 'optimize': False})
    stream.write(b''.join(header))
    for frame, duration in zip(indexed, durations):
        stream.write(b''.join(GifImagePlugin.getdata(frame, duration=duration, transparency=255, disposal=2)))
    stream.write(b';')
encoded = Image.open(target)
decoded_durations, hashes = [], set()
for index in range(encoded.n_frames):
    encoded.seek(index)
    decoded_durations.append(encoded.info.get('duration', 0))
    decoded = encoded.convert('RGBA')
    if decoded.getchannel('A').getextrema() != (0, 255):
        raise ValueError(f'Missing alpha in encoded frame {index}')
    hashes.add(sha256(decoded.tobytes()).hexdigest())
if encoded.n_frames != 50 or decoded_durations != durations:
    raise ValueError('Encoded GIF did not preserve frame count/timing')
report = {'sourceSha256': SOURCE_SHA, 'frames': encoded.n_frames, 'distinctFrames': len(hashes),
          'size': [width, height], 'crop': crop, 'durationsMs': durations,
          'loop': loop, 'totalMs': sum(durations), 'opencv': cv2.__version__}
if args.review_dir:
    args.review_dir.mkdir(parents=True, exist_ok=True)
    for index, frame in enumerate(frames):
        frame.save(args.review_dir / f'cutout-{index:02}.png')
    (args.review_dir / 'verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    for theme, color in [('light', '#f8f9fc'), ('dark', '#191d25')]:
        review = Image.new('RGB', (160 * 10, 200 * 5), color)
        for index, frame in enumerate(frames):
            tile = Image.new('RGBA', frame.size, color)
            tile.alpha_composite(frame)
            tile.thumbnail((160, 200), Image.Resampling.LANCZOS)
            review.paste(tile.convert('RGB'), ((index % 10) * 160, (index // 10) * 200))
        review.save(args.review_dir / f'all-frames-{theme}.jpg')
print(json.dumps(report), flush=True)
