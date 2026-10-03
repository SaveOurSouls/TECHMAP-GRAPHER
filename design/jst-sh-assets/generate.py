"""Render composable JST SH-style connector drawings as transparent PNGs.

The geometry follows the supplied five-position image. It is intended for a
graphics library and does not define physical dimensions or tolerances.
"""

from pathlib import Path

from PIL import Image, ImageDraw


OUT = Path(__file__).resolve().parent
VARIANTS = OUT / "variants"
PREVIEWS = OUT / "previews"
PITCH = 34
HEIGHT = 192
SCALE = 4
SUPERSAMPLE = 2
FIRST_CENTER = 65
START_WIDTH = 82
END_WIDTH = 81
STROKE = 1.5
INK = (0, 0, 0, 255)


def width_for(contacts: int) -> int:
    if not 2 <= contacts <= 20:
        raise ValueError("JST SH artwork supports 2 to 20 contacts")
    return START_WIDTH + PITCH * (contacts - 2) + END_WIDTH


def render(contacts: int) -> Image.Image:
    width = width_for(contacts)
    factor = SCALE * SUPERSAMPLE
    image = Image.new("RGBA", (width * factor, HEIGHT * factor), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def line(points, stroke=STROKE):
        draw.line([(round(x * factor), round(y * factor)) for x, y in points],
                  fill=INK, width=round(stroke * factor), joint="curve")

    def curve(start, control, end, steps=10):
        points = []
        for step in range(steps + 1):
            t = step / steps
            points.append(((1 - t) ** 2 * start[0]
                           + 2 * (1 - t) * t * control[0] + t ** 2 * end[0],
                           (1 - t) ** 2 * start[1]
                           + 2 * (1 - t) * t * control[1] + t ** 2 * end[1]))
        line(points)

    right = width
    inner_right = right - 47

    # Outer latch ears and the raised central housing.
    line([(7, 17), (right - 7, 17)])
    curve((0, 24), (0, 17), (7, 17))
    line([(0, 24), (0, 44)])
    curve((0, 44), (0, 50), (7, 50))
    line([(7, 50), (25, 50)])
    curve((25, 50), (33, 50), (33, 58))
    curve((right - 7, 17), (right, 17), (right, 24))
    line([(right, 24), (right, 44)])
    curve((right, 44), (right, 50), (right - 7, 50))
    line([(right - 7, 50), (right - 25, 50)])
    curve((right - 25, 50), (right - 33, 50), (right - 33, 58))
    curve((33, 24), (33, 17), (40, 17))
    curve((right - 40, 17), (right - 33, 17), (right - 33, 24))
    line([(33, 24), (33, 81), (43, 81)])
    line([(right - 33, 24), (right - 33, 81), (right - 43, 81)])

    # Side walls and a continuous lower rail.
    line([(33, 81), (33, 155), (43, 155), (43, 174),
          (48, 183), (right - 48, 183), (right - 43, 174),
          (right - 43, 155), (right - 33, 155), (right - 33, 81)])
    line([(33, 151), (43, 151)])
    line([(right - 43, 151), (right - 33, 151)])
    line([(43, 173), (right - 43, 173)])
    line([(43, 81), (43, 138)])
    line([(right - 43, 81), (right - 43, 138)])

    # A shared cavity frame with one divider at each pitch boundary.
    line([(47, 60), (inner_right, 60)])
    for boundary in range(contacts + 1):
        x = 48 + boundary * PITCH
        line([(x - 2, 60), (x - 2, 138)])
        line([(x + 2, 60), (x + 2, 138)])
        line([(x - 3, 60), (x + 3, 60)])

    for index in range(contacts):
        center = FIRST_CENTER + index * PITCH
        for y in (69, 81, 123):
            line([(center - 15, y), (center + 15, y)])
        line([(center - 15, 138), (center - 12, 138),
              (center - 9, 142), (center - 9, 150),
              (center + 9, 150), (center + 9, 142),
              (center + 12, 138), (center + 15, 138)])
        if index in (0, contacts - 1):
            # The rectangular details occur only at the two ends in the source.
            line([(center - 10, 150), (center - 10, 166),
                  (center + 10, 166), (center + 10, 150)])

    return image.resize((width * SCALE, HEIGHT * SCALE), Image.Resampling.LANCZOS)


def render_triangle() -> Image.Image:
    factor = SCALE * SUPERSAMPLE
    image = Image.new("RGBA", (48 * factor, 44 * factor), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.line([(6 * factor, 6 * factor), (42 * factor, 6 * factor),
               (24 * factor, 38 * factor), (6 * factor, 6 * factor)],
              fill=INK, width=round(STROKE * factor), joint="curve")
    return image.resize((48 * SCALE, 44 * SCALE), Image.Resampling.LANCZOS)


def assemble(start: Image.Image, repeat: Image.Image,
             end: Image.Image, contacts: int) -> Image.Image:
    pieces = [start] + [repeat] * (contacts - 2) + [end]
    image = Image.new("RGBA", (sum(piece.width for piece in pieces),
                               start.height), (0, 0, 0, 0))
    x = 0
    for piece in pieces:
        image.paste(piece, (x, 0))
        x += piece.width
    return image


def on_white(image: Image.Image) -> Image.Image:
    preview = Image.new("RGBA", image.size, "white")
    preview.alpha_composite(image)
    return preview.convert("RGB")


def main() -> None:
    VARIANTS.mkdir(exist_ok=True)
    PREVIEWS.mkdir(exist_ok=True)
    reference = render(5)
    start = reference.crop((0, 0, START_WIDTH * SCALE, reference.height))
    repeat = reference.crop((START_WIDTH * SCALE, 0,
                             (START_WIDTH + PITCH) * SCALE, reference.height))
    end = reference.crop(((START_WIDTH + 3 * PITCH) * SCALE, 0,
                          reference.width, reference.height))
    marker = render_triangle()
    for name, image in (("jst_sh_start.png", start),
                        ("jst_sh_repeat.png", repeat),
                        ("jst_sh_end.png", end),
                        ("jst_sh_orientation_triangle.png", marker)):
        image.save(OUT / name)

    gap = 24
    parts = Image.new("RGBA", (start.width + repeat.width + end.width + gap * 2,
                               start.height), "white")
    x = 0
    for image in (start, repeat, end):
        parts.alpha_composite(image, (x, 0))
        x += image.width + gap
    parts.convert("RGB").save(PREVIEWS / "jst_sh_parts_preview.png")
    on_white(marker).save(PREVIEWS / "jst_sh_orientation_triangle_preview.png")

    for contacts in range(2, 21):
        image = assemble(start, repeat, end, contacts)
        if image.tobytes() != render(contacts).tobytes():
            raise RuntimeError(f"Segment assembly differs for {contacts} contacts")
        for index in range(contacts):
            x = (FIRST_CENTER + index * PITCH - 10) * SCALE
            has_end_box = image.getpixel((x, 158 * SCALE))[3] > 200
            if has_end_box != (index in (0, contacts - 1)):
                raise RuntimeError(f"Incorrect end detail at contact {index + 1} of {contacts}")
        image.save(VARIANTS / f"jst_sh_{contacts:02d}_contacts.png")
        on_white(image).save(PREVIEWS / f"jst_sh_{contacts:02d}_contacts_preview.png")


if __name__ == "__main__":
    main()
