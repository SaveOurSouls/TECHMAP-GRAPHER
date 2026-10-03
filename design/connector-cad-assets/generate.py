"""Render a repeatable, CAD-style connector elevation as transparent PNGs.

The source is a cropped, undimensioned 10-contact reference image. Geometry
below is a clean visual reconstruction, not a manufacturing specification.
"""

from pathlib import Path
from PIL import Image, ImageDraw


OUT = Path(__file__).resolve().parent
HEIGHT = 292
PITCH = 50
SCALE = 3
SUPERSAMPLE = 2
FIRST_CENTER = 102
START_WIDTH = FIRST_CENTER
END_WIDTH = 96
INK = (0, 0, 0, 255)
STROKE = 2


def width_for(contacts: int) -> int:
    return START_WIDTH + PITCH * (contacts - 1) + END_WIDTH


def render(contacts: int) -> Image.Image:
    if contacts < 1:
        raise ValueError("At least one contact is required")

    width = width_for(contacts)
    factor = SCALE * SUPERSAMPLE
    image = Image.new("RGBA", (width * factor, HEIGHT * factor), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def line(points, stroke=STROKE):
        draw.line([(round(x * factor), round(y * factor)) for x, y in points],
                  fill=INK, width=round(stroke * factor), joint="curve")

    def curve(start, control, end, steps=12):
        points = []
        for i in range(steps + 1):
            t = i / steps
            x = (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * control[0] + t ** 2 * end[0]
            y = (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * control[1] + t ** 2 * end[1]
            points.append((x, y))
        line(points)

    right = width
    side = right - 48
    inner_right = right - 68
    base_right = right - 66

    # Upper shell, including two mounting ears and the rounded inner lip.
    line([(10, 18), (right - 10, 18)])
    curve((0, 28), (0, 18), (10, 18))
    line([(0, 28), (0, 59)])
    curve((0, 59), (0, 69), (10, 69))
    line([(10, 69), (38, 69)])
    curve((38, 69), (48, 69), (48, 79))
    line([(48, 79), (48, 112)])
    curve((right - 10, 18), (right, 18), (right, 28))
    line([(right, 28), (right, 59)])
    curve((right, 59), (right, 69), (right - 10, 69))
    line([(right - 10, 69), (right - 38, 69)])
    curve((right - 38, 69), (side, 69), (side, 79))
    line([(side, 79), (side, 112)])
    curve((48, 28), (48, 18), (58, 18))
    curve((side - 10, 18), (side, 18), (side, 28))
    line([(48, 28), (48, 112), (68, 112), (68, 82), (inner_right, 82),
          (inner_right, 112), (side, 112), (side, 28)])

    # Side walls and the lower retaining rail.
    line([(48, 112), (48, 222), (66, 222), (66, 252), (72, 267),
          (right - 72, 267), (base_right, 252), (base_right, 222),
          (side, 222), (side, 112)])
    line([(48, 216), (66, 216)])
    line([(base_right, 216), (side, 216)])
    line([(66, 252), (base_right, 252)])
    line([(68, 196), (inner_right, 196)])
    line([(68, 82), (68, 196), (66, 196)])
    line([(inner_right, 82), (inner_right, 196), (base_right, 196)])

    for index in range(contacts):
        center = FIRST_CENTER + index * PITCH
        for offset in (-23, -19, 19, 23):
            line([(center + offset, 82), (center + offset, 196)])
        line([(center - 19, 98), (center + 19, 98)])
        line([(center - 19, 114), (center + 19, 114)])
        line([(center - 23, 180), (center + 23, 180)])
        line([(center - 11, 196), (center - 11, 215)])
        line([(center + 11, 196), (center + 11, 215)])
        line([(center - 16, 215), (center + 16, 215)])
        line([(center - 16, 215), (center - 16, 243),
              (center + 16, 243), (center + 16, 215)])

    return image.resize((width * SCALE, HEIGHT * SCALE), Image.Resampling.LANCZOS)


def render_triangle() -> Image.Image:
    factor = SCALE * SUPERSAMPLE
    image = Image.new("RGBA", (64 * factor, 68 * factor), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.line([(9 * factor, 8 * factor), (55 * factor, 8 * factor),
               (32 * factor, 60 * factor), (9 * factor, 8 * factor)],
              fill=INK, width=STROKE * factor, joint="curve")
    return image.resize((64 * SCALE, 68 * SCALE), Image.Resampling.LANCZOS)


def assemble(start: Image.Image, repeat: Image.Image,
             end: Image.Image, contacts: int) -> Image.Image:
    pieces = [start] + [repeat] * (contacts - 1) + [end]
    assembled = Image.new("RGBA", (sum(piece.width for piece in pieces),
                                   start.height), (0, 0, 0, 0))
    x = 0
    for piece in pieces:
        assembled.paste(piece, (x, 0))
        x += piece.width
    return assembled


def main() -> None:
    ten = render(10)
    start = ten.crop((0, 0, START_WIDTH * SCALE, ten.height))
    repeat = ten.crop((START_WIDTH * SCALE, 0,
                       (START_WIDTH + PITCH) * SCALE, ten.height))
    end = ten.crop(((START_WIDTH + 9 * PITCH) * SCALE, 0,
                    ten.width, ten.height))
    parts = {"connector_start.png": start,
             "connector_repeat.png": repeat,
             "connector_end.png": end,
             "orientation_triangle.png": render_triangle()}
    for name, part in parts.items():
        part.save(OUT / name)

    gap = 24
    parts_preview = Image.new("RGBA", (start.width + repeat.width + end.width + gap * 2,
                                       start.height), "white")
    x = 0
    for part in (start, repeat, end):
        parts_preview.alpha_composite(part, (x, 0))
        x += part.width + gap
    parts_preview.convert("RGB").save(OUT / "connector_parts_preview.png")
    marker = Image.new("RGBA", parts["orientation_triangle.png"].size, "white")
    marker.alpha_composite(parts["orientation_triangle.png"])
    marker.convert("RGB").save(OUT / "orientation_triangle_preview.png")

    for contacts in (1, 2, 3, 7, 10, 15, 20, 25):
        assembled = assemble(start, repeat, end, contacts)
        direct = render(contacts)
        if assembled.tobytes() != direct.tobytes():
            raise RuntimeError(f"Segment seams do not match the {contacts}-contact drawing")
        if contacts not in (10, 15, 20, 25):
            continue
        assembled.save(OUT / f"connector_{contacts}_contacts.png")
        preview = Image.new("RGBA", assembled.size, "white")
        preview.alpha_composite(assembled)
        preview.convert("RGB").save(OUT / f"connector_{contacts}_contacts_preview.png")


if __name__ == "__main__":
    main()
