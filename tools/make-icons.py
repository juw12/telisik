"""Draw the PNG icons. Run with any Python that has Pillow: python tools/make-icons.py"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = r"C:\Windows\Fonts\georgiab.ttf"
INK = "#16181d"
PAPER = "#fbfbf8"
ACCENT = "#ff7a66"
MASTER = 1024


def draw_master() -> Image.Image:
    """Full-bleed square so the same picture works as a maskable icon (art stays in the middle 80%)."""
    image = Image.new("RGB", (MASTER, MASTER), INK)
    draw = ImageDraw.Draw(image)
    letter_font = ImageFont.truetype(FONT, 620)
    note_font = ImageFont.truetype(FONT, 230)
    draw.text((MASTER * 0.455, MASTER * 0.52), "S", font=letter_font, fill=PAPER, anchor="mm")
    draw.text((MASTER * 0.725, MASTER * 0.335), "1", font=note_font, fill=ACCENT, anchor="mm")
    return image


def main() -> None:
    master = draw_master()
    for size in (32, 192, 512):
        target = ROOT / "icons" / f"icon-{size}.png"
        master.resize((size, size), Image.LANCZOS).save(target, optimize=True)
        print(f"wrote {target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
