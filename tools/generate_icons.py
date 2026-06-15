from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "icons"
OUT.mkdir(exist_ok=True)

BASE = 64
SIZES = (16, 32, 48, 128)


def rect(draw, xy, fill, outline=None, width=1):
    draw.rectangle(xy, fill=fill, outline=outline, width=width)


def line(draw, xy, fill, width=1):
    draw.line(xy, fill=fill, width=width, joint="curve")


def make_base():
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    navy = "#112d63"
    navy_dark = "#06142c"
    navy_shadow = "#0a1e45"
    ink = "#071126"
    paper = "#f8fbff"
    paper_shadow = "#c9d2dd"
    paper_fold = "#e0e7ef"
    green = "#43c96a"
    green_dark = "#12391f"
    red = "#ff5a5f"

    # Pixel app tile.
    rect(draw, (8, 7, 58, 59), navy_shadow)
    rect(draw, (6, 5, 56, 57), navy, navy_dark, 2)
    rect(draw, (9, 8, 53, 54), "#173873")

    # Document shadow and paper.
    rect(draw, (18, 15, 50, 53), "#081226")
    rect(draw, (15, 12, 48, 50), ink)
    rect(draw, (17, 14, 47, 49), paper)

    # Left scroll-like hint from the reference image.
    rect(draw, (13, 18, 17, 24), paper_shadow)
    rect(draw, (15, 14, 25, 17), paper_shadow)
    rect(draw, (13, 43, 17, 49), paper_shadow)
    rect(draw, (15, 47, 25, 51), paper_shadow)

    # Folded red PDF corner.
    draw.polygon([(39, 14), (47, 22), (39, 22)], fill=red, outline=ink)
    line(draw, [(39, 14), (39, 22), (47, 22)], ink, 2)

    # Old short filename line transforming into citation brackets.
    rect(draw, (22, 20, 32, 23), "#a8b2bf", ink, 1)
    line(draw, [(34, 21), (39, 21)], ink, 3)
    draw.polygon([(39, 17), (45, 21), (39, 25)], fill=ink)

    # Citation brackets around a green title block.
    line(draw, [(22, 28), (22, 39)], ink, 4)
    line(draw, [(22, 28), (30, 28)], ink, 4)
    rect(draw, (28, 32, 38, 35), green, green_dark, 1)
    line(draw, [(44, 28), (44, 39)], ink, 4)
    line(draw, [(36, 39), (44, 39)], ink, 4)

    # Success checkmark.
    line(draw, [(33, 44), (39, 50), (49, 37)], ink, 7)
    line(draw, [(33, 44), (39, 50), (49, 37)], green, 4)

    # Small download tray, subordinate to the citation symbol.
    line(draw, [(25, 46), (25, 52), (30, 52)], ink, 3)
    line(draw, [(27, 48), (30, 51), (34, 46)], ink, 3)

    return img


def main():
    base = make_base()
    base.save(OUT / "icon-source-64.png")
    for size in SIZES:
        icon = base.resize((size, size), Image.Resampling.NEAREST)
        icon.save(OUT / f"icon-{size}.png")


if __name__ == "__main__":
    main()
