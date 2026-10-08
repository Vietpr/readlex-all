"""Generate the extension and web-app icons (marker-yellow rounded square with an ink R)."""
from PIL import Image, ImageDraw, ImageFont
import os, glob

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'extension', 'icons')
WEB_OUT = os.path.join(ROOT, 'web', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)
os.makedirs(WEB_OUT, exist_ok=True)

def font(size):
    for pattern in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/**/*Bold*.ttf', '/usr/share/fonts/**/*.ttf']:
        for path in glob.glob(pattern, recursive=True):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()

def make(size, path):
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(s * 0.22)
    # the darker lower edge is the same "pressable" edge the primary buttons have
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=(227, 194, 43, 255))
    d.rounded_rectangle([0, 0, s - 1, s - 1 - int(s * 0.06)], radius=radius, fill=(255, 228, 92, 255))
    f = font(int(s * 0.72))
    text = 'R'
    bbox = d.textbbox((0, 0), text, font=f)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((s - w) / 2 - bbox[0], (s - h) / 2 - bbox[1] - s * 0.03), text, font=f, fill=(23, 32, 43, 255))
    img = img.resize((size, size), Image.LANCZOS)
    img.save(path)

for size in (16, 32, 48, 128):
    make(size, os.path.join(OUT, f'icon{size}.png'))
for size in (192, 512):
    make(size, os.path.join(WEB_OUT, f'icon-{size}.png'))
print('icons written to', os.path.abspath(OUT), 'and', os.path.abspath(WEB_OUT))
