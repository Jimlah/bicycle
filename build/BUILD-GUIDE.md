# Bicycle build: working notes

Node 26, ESM, no build step. Work in `/Users/abdullahi/Herd/CAD/bicycle/build`.

```bash
cd /Users/abdullahi/Herd/CAD/bicycle/build
node parts/<yourfile>.mjs      # your module's own self-test, prints numbers, writes /tmp/<name>.png
```

## Layout (already computed, import it)

```js
import { layout, P } from '../lib/bike.mjs'
const L = layout()
```

`L` (all `THREE.Vector3`, mm, Y up, +X forward, +Z drive side, ground y=0):

| field | meaning |
|---|---|
| `bb` | bottom bracket centre (0, 266, 0) |
| `rearHub` / `frontHub` | axle centres (-404, 336, 0) / (586, 336, 0) |
| `uSeat` / `uHead` | unit axes of the seat tube (73.5°) and steerer (73°) |
| `seatTop`, `headBottom`, `headTop`, `crown` | frame landmarks |
| `seatpostTop`, `saddleTop` | seatpost and saddle top |
| `steererTop`, `barCenter`, `stemDir` | cockpit landmarks |
| `chainringZ` (43.5), `crankZ` (47.5) | chainline and crank plane |
| `cassetteZ0`, `cassetteZ1` (22 … 64) | cassette stack on the drive side |

`P` has the numbers: `tireR 336`, `chainstay 410`, `crankLen 172.5`, `barWidth 420`, etc.

## Part record contract

Every module exports builders that return **arrays of records**:

```js
{
  id: 'wheel.rear.rim',          // unique, dot-separated
  name: 'Rear rim',              // shown in the UI
  assembly: 'wheels',            // frame | fork | wheels | drivetrain | cockpit | brakes | finishing
  material: 'alu',               // alu | steel | carbon | rubber | chrome | leather | black | paint | brass
  spec: { 'Depth': '30 mm', ... },// strings, shown in the part card
  object: meshOrGroup,           // THREE.Object3D, built in WORLD coordinates
  density: 2.7,                  // g/cm3, for the mass readout
}
```

Build in **world coordinates** (put the part where it belongs) unless the whole assembly turns
(wheels turn about Z at the axle): wheels may be built at the origin and moved with
`group.position` to the axle. Groups are allowed; `object.matrixWorld` is baked at pack time.

## Idioms that are proven to work

```js
import * as THREE from 'three'
import { v3, tube, pipe, discZ, ringZ, torusZ, latheY, band, along, centered, boxAt,
         sprocket, profile, deg } from '../lib/geo.mjs'
import { loftCircles, safeFillet } from '../lib/solid.mjs'
import { Cylinder, Cone, Ball, Torus, Box, Ellipse, Circle, Rectangle,
         Polygon, RoundedRectangle, Slot } from '@classcad/smlibpy-three'

tube(a, b, rA, rB)          // solid cylinder between two points
pipe(a, b, rOuter, rInner)  // hollow tube, ends open
latheY(points)              // solid of revolution about local +Y, points are [radius, y]
band(outer, inner)          // closed loop between two outlines, for latheY
discZ(r, t, at) ringZ(rO, rI, t, at) torusZ(R, r, at)   // axis Z, the wheels' axis
loftCircles(points, radii, { oval: [1.15, 0.85] })      // smooth solid through sections
sprocket({ teeth, pitch: 12.7, thickness, center, holes: [sketch] })
```

Rules learned the hard way:

- **Every solids constructor takes three's argument order** (`Box(w,h,d)`, `Cylinder(rTop,rBottom,h)`,
  `RoundedRectangle(w,h,radius)`: the radius is the third positional argument and is mandatory).
- `Cylinder` stands along +Y. Use `tube()`, `along()`, `centered()` rather than setting quaternions by hand.
- A `Polygon(points)` sketch lives in XY and `extrude(n)` goes along +Z. `revolve(ray, 2π)` revolves
  about the ray; `latheY` already does the local-Y case.
- **Booleans take world transforms into account**, and a result keeps the receiver's transform.
  `getCenter()` and `edges()` are in the body's **own frame**; use local coordinates when you
  query a body you just fused.
- `part.fillet(edges, r)` fails on welded tube junctions (`SM_ERR`). Use `safeFillet(part, edges, [5,4,3,2])`
  and accept the sharp union when it returns `null`; do not fight it.
- Tessellation is lazy. Set `part.tolerance = 0.3` before rendering or packing, never on every part.
- Verify with `render([...objects], { view: 'front'|'iso'|'top', size: [900,640], background: '#eef2f7' })`
  and `writeFileSync('/tmp/x.png', pic.data)`; then look at the PNG.

## Verify before you hand over

- Every body: `isValid() === true`, volume in the range you expect (a rim ~200-350 cm3,
  a chain link ~0.4 cm3, a saddle ~250 cm3).
- The whole assembly's bounding box matches the layout (e.g. a wheel: 672 x 672 x 100 mm).
- Render one PNG per assembly and look at it. State in your report what you checked.
