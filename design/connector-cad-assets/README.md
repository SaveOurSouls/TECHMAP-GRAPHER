# Connector CAD-style assets

These transparent RGBA PNGs are a clean reconstruction of the supplied
10-contact image. They omit reference arrows, dashed centerlines and cropped
dimension marks. No physical dimensions or tolerances can be inferred from
the supplied image; these are visual library assets, not production drawings.

| Segment | Size | Contents |
| --- | ---: | --- |
| `connector_start.png` | 306 x 876 px | Fixed left end and left half of first contact |
| `connector_repeat.png` | 150 x 876 px | One contact pitch, from one contact center to the next |
| `connector_end.png` | 288 x 876 px | Right half of last contact and fixed right end |
| `orientation_triangle.png` | 192 x 204 px | Independent placement marker |

Place the PNGs edge-to-edge without overlap or spacing:

`start + repeat * (N - 1) + end`, for any integer `N >= 1`.

The triangle is not included in the three connector segments or in the
assembled examples. Overlay it separately wherever needed. The
`connector_parts_preview.png` file displays the three pieces with gaps, so
their cut edges are visible; it is not an assembly asset.

The PNGs `connector_10_contacts.png`, `connector_15_contacts.png`,
`connector_20_contacts.png`, and `connector_25_contacts.png` are assembled
examples. All images use the same 876 px height and transparent background.
Matching `_preview.png` files have a white background for inspection.
The repeat pitch is 150 px. The total width is `594 + 150 * (N - 1)` px.

Run `generate.py` with Python and Pillow to regenerate the PNGs. It
checks that segment assembly is pixel-identical to each directly rendered
example, including the join boundaries.
