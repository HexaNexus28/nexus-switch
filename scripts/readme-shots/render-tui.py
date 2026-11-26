"""Render captured TUI frames (frames.json) to PNG screenshots and an animated GIF.
usage: python render-tui.py frames.json out_dir
Needs Pillow and the Windows fonts Cascadia Mono + Segoe UI Symbol (C:/Windows/Fonts)."""
import json, sys, pathlib
from PIL import Image, ImageDraw, ImageFont

frames_path, out_dir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)
data = json.loads(frames_path.read_text(encoding='utf-8'))

FONTS = 'C:/Windows/Fonts/'
SIZE = 17
regular = ImageFont.truetype(FONTS + 'CascadiaMono.ttf', SIZE)
bold = ImageFont.truetype(FONTS + 'CascadiaMono.ttf', SIZE)
bold.set_variation_by_name('Bold')
symbol = ImageFont.truetype(FONTS + 'seguisym.ttf', SIZE)
NOTDEF = bytes(regular.getmask('􏿽'))
_glyph_cache = {}


def has_glyph(ch):
    if ch not in _glyph_cache:
        _glyph_cache[ch] = ch.isascii() or bytes(regular.getmask(ch)) != NOTDEF
    return _glyph_cache[ch]

BG = (11, 15, 20)          # #0b0f14, the logo background
FG = (214, 221, 230)
PALETTE = {                 # xterm 16-colour slots the TUI uses, tuned for the dark bg
    1: (248, 113, 113), 2: (74, 222, 128), 3: (250, 204, 21), 4: (96, 165, 250),
    5: (232, 121, 249), 6: (34, 211, 238), 7: (214, 221, 230), 8: (100, 116, 139),
}
CELL_W = round(regular.getlength('M'))
CELL_H = round(SIZE * 1.45)
PAD_X, PAD_TOP, PAD_BOTTOM, BAR = 22, 16, 18, 34

used_rows = max(
    max((y for y, row in enumerate(f['rows']) if ''.join(c[0] for c in row).strip()), default=0)
    for f in data['frames']
) + 1
used_cols = max(
    len(''.join(c[0] for c in row).rstrip()) for f in data['frames'] for row in f['rows']
) + 2
W = PAD_X * 2 + used_cols * CELL_W
H = BAR + PAD_TOP + used_rows * CELL_H + PAD_BOTTOM


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def render(frame):
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    # window chrome: title bar + three dots
    d.rectangle([0, 0, W, BAR], fill=(20, 26, 34))
    for i, col in enumerate([(248, 113, 113), (250, 204, 21), (74, 222, 128)]):
        cx = 18 + i * 20
        d.ellipse([cx - 6, BAR // 2 - 6, cx + 6, BAR // 2 + 6], fill=col)
    d.text((W // 2, BAR // 2), 'nexus', font=regular, fill=(120, 134, 152), anchor='mm')
    for y, row in enumerate(frame['rows'][:used_rows]):
        for x, (ch, fg, bg, is_bold, is_dim) in enumerate(row[:used_cols]):
            if ch == ' ':
                continue
            color = PALETTE.get(fg, FG) if fg >= 0 else FG
            if is_dim:
                color = mix(color, BG, 0.45)
            font = bold if is_bold else regular
            if not has_glyph(ch[0]):
                font = symbol
            px = PAD_X + x * CELL_W
            py = BAR + PAD_TOP + y * CELL_H + (CELL_H - SIZE) // 2
            d.text((px, py), ch, font=font, fill=color)
    return img


images = [render(f) for f in data['frames']]
for f, img in zip(data['frames'], images):
    if f['label'] in ('providers-groq', 'models', 'models-gemini'):
        img.save(out_dir / f"{f['label']}.png", optimize=True)
images[0].save(
    out_dir / 'preview.gif', save_all=True, append_images=images[1:],
    duration=[f['hold'] for f in data['frames']], loop=0, optimize=True,
)
print(f'{W}x{H}', [p.name for p in sorted(out_dir.iterdir())])
