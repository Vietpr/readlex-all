"""Generate extension icons (indigo rounded square with a white R)."""
from PIL import Image, ImageDraw, ImageFont
import os, glob

OUT = os.path.join(os.path.dirname(__file__), '..', 'extension', 'icons')
os.makedirs(OUT, exist_ok=True)

def font(size):
    for pattern in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/**/*Bold*.ttf', '/usr/share/fonts/**/*.ttf']:
        for path in glob.glob(pattern, recursive=True):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()

def make(size):
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(s * 0.22)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=(79, 70, 229, 255))
    # subtle highlight
    d.rounded_rectangle([int(s*0.06), int(s*0.06), s - 1 - int(s*0.06), int(s*0.5)], radius=radius, fill=(99, 102, 241, 255))
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, outline=(67, 56, 202, 255), width=max(1, s // 64))
    f = font(int(s * 0.72))
    text = 'R'
    bbox = d.textbbox((0, 0), text, font=f)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((s - w) / 2 - bbox[0], (s - h) / 2 - bbox[1] - s * 0.02), text, font=f, fill=(255, 255, 255, 255))
    img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(OUT, f'icon{size}.png'))

for size in (16, 32, 48, 128):
    make(size)
print('icons written to', os.path.abspath(OUT))
