# JST SH connector drawing assets

Clean CAD-style library artwork reconstructed from the supplied five-position
JST SH image. Arrows, dashed centerlines, the pin-number annotations and the
orientation triangle are removed from the connector body. The triangle is a
separate transparent PNG. The image is undimensioned, so these assets are not
manufacturing drawings or a substitute for a JST datasheet.

## Composable pieces

| File | Size | Contents |
| --- | ---: | --- |
| `jst_sh_start.png` | 260 x 768 px | Left housing and the left half of the first contact |
| `jst_sh_repeat.png` | 136 x 768 px | One pitch, from one contact center to the next |
| `jst_sh_end.png` | 256 x 768 px | Right half of the last contact and right housing |
| `jst_sh_terminal_box.png` | 96 x 768 px | Reusable end detail, placed twice |
| `jst_sh_orientation_triangle.png` | 192 x 176 px | Independent orientation marker |

For any integer `N` from 2 through 20, join the three body pieces with no
overlap or gap:

`start + repeat * (N - 1) + end`

Place the terminal-box PNG over the assembled body twice, with its top at
`y = 0`: first at `x = 212 px`, then at `x = 212 + 136 * (N - 1) px`.
These placements complete the unique rectangular details at the first and
last contacts without putting a full repeated contact in either fixed end.
The orientation triangle can be placed independently. The ready-made PNGs in
`variants/` already include both terminal boxes and omit the triangle.

The repeat pitch is 136 px and the result width is `516 + 136 * (N - 1)` px.
All three body pieces, the terminal-box overlay and the assembled images have
a transparent RGBA background and the same 768 px height.

`variants/` contains every count from 2 to 20 in increments of one.
`previews/` contains white-background inspection copies and a view of the
three separated pieces. Run `generate.py` with Python and Pillow to recreate
the assets. It checks the three-piece body against a directly rendered body
pixel by pixel for every count, including the join boundaries, and checks
that rectangular details appear only at the two ends.
