from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "icons"
OUT.mkdir(exist_ok=True)

BASE = 128
SIZES = (16, 32, 48, 128)


def make_base():
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    navy = "#173B73"
    navy_dark = "#071B3A"
    navy_mid = "#25528F"
    paper = "#F8FAFD"
    paper_shadow = "#D8E0EA"
    fold = "#DDE7F3"
    green = "#2FB96B"
    green_dark = "#0D5B34"

    # Clean app tile.
    draw.rounded_rectangle((10, 10, 118, 118), radius=24, fill=navy_dark)
    draw.rounded_rectangle((14, 12, 114, 112), radius=22, fill=navy)
    draw.rounded_rectangle((22, 20, 106, 104), radius=18, outline=navy_mid, width=3)

    # Paper sheet.
    draw.rounded_rectangle((34, 24, 94, 104), radius=7, fill=paper_shadow)
    draw.rounded_rectangle((30, 20, 90, 100), radius=7, fill=paper)
    draw.polygon([(72, 20), (90, 38), (72, 38)], fill=fold)
    draw.line([(72, 20), (72, 38), (90, 38)], fill=navy_dark, width=3)

    # Citation brackets, drawn as shapes instead of text for crisp small sizes.
    draw.line([(43, 47), (43, 77)], fill=navy_dark, width=8)
    draw.line([(43, 47), (58, 47)], fill=navy_dark, width=8)
    draw.line([(43, 77), (58, 77)], fill=navy_dark, width=8)
    draw.line([(78, 47), (78, 77)], fill=navy_dark, width=8)
    draw.line([(63, 47), (78, 47)], fill=navy_dark, width=8)
    draw.line([(63, 77), (78, 77)], fill=navy_dark, width=8)

    # Minimal title line inside the brackets.
    draw.rounded_rectangle((55, 59, 66, 65), radius=2, fill=navy_mid)

    # Success check.
    draw.line([(57, 88), (67, 98), (85, 78)], fill=green_dark, width=12)
    draw.line([(57, 88), (67, 98), (85, 78)], fill=green, width=7)

    return img


def main():
    base = make_base()
    base.save(OUT / "icon-source-128.png")
    for size in SIZES:
        icon = base.resize((size, size), Image.Resampling.LANCZOS)
        icon.save(OUT / f"icon-{size}.png")


if __name__ == "__main__":
    main()
