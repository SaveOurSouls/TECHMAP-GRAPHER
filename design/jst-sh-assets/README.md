# JST SH connector drawing assets

Clean CAD-style library artwork reconstructed from the supplied five-position
JST SH image. Arrows, dashed centerlines, the pin-number annotations and the
orientation triangle are removed from the connector body. The triangle is a
separate transparent PNG. The image is undimensioned, so these assets are not
manufacturing drawings or a substitute for a JST datasheet.

## Composable pieces

| File | Size | Contents |
| --- | ---: | --- |
| `jst_sh_start.png` | 328 x 768 px | Left housing, first contact and its rectangular end detail |
| `jst_sh_repeat.png` | 136 x 768 px | One middle contact position |
| `jst_sh_end.png` | 324 x 768 px | Last contact, its rectangular end detail and right housing |
| `jst_sh_orientation_triangle.png` | 192 x 176 px | Independent orientation marker |

For any integer `N` from 2 through 20, join the three connector pieces with
no overlap or gap:

`start + repeat * (N - 2) + end`

The repeat pitch is 136 px and the result width is `652 + 136 * (N - 2)` px.
All three connector pieces and all assembled images have a transparent RGBA
background and the same 768 px height. The first and last rectangular lower
details appear only in the fixed ends, matching the reference; middle contacts
end in a shorter U-shaped detail.

`variants/` contains every count from 2 to 20 in increments of one.
`previews/` contains white-background inspection copies and a view of the
three separated pieces. Run `generate.py` with Python and Pillow to recreate
the assets. It checks every assembled image against a directly rendered image
pixel by pixel, including the join boundaries.
