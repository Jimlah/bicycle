# Émonda 56 · a bicycle, every part, in one HTML

`index.html` is the deliverable: a single file, no network, no server. It contains the whole
model (5.2 MB of packed B-rep tessellation), three.js, the Rapier physics kernel, the parts
panel, the explode view and the spec sheet.

It is served from GitHub Pages at <https://jimlah.github.io/>. The same file is kept locally as
`bicycle.html`.

Open it in a browser and drag to orbit. `SPEC` shows the geometry and the sources every number
came from. `RIDE` starts the physics: W pedals, S back-pedals, A/D steer, Space brakes, R resets,
`ASSIST` turns the rider's balance off so the bike falls over and lands on its own colliders.

## What is in the model

111 parts, 375k triangles, 11.0 kg modelled mass, 111 convex colliders.

| assembly | parts | what |
|---|---|---|
| Frame | 1 | welded steel body: hollow butted tubes, BB shell, dropouts, bridges, bottle bosses, cable stops, mech hanger, seat collar |
| Fork | 9 | steerer, crown, two raked blades, dropouts, crown race, lower headset cup and bearing |
| Wheels | 21 | rims (hollow 25 mm section, 622 BSD), 25-622 tyres, hubs, axles with Ø9 bore, cartridge bearings, 32 three-cross spokes per wheel with nipples, Presta valves, quick releases, freehub |
| Drivetrain | 46 | BSA 68 bottom bracket, 172.5 mm hollow-forged cranks, 50/34 chainrings with real teeth, chainring bolts, platform pedals, 11-32 cassette on its carrier and spacers, 116-link chain on its own path, rear derailleur with parallelogram, cage and two 11 t jockeys, front derailleur, STI levers |
| Cockpit | 15 | one-sweep 420 mm drop bar, 100 mm stem with faceplate and bolts, upper headset, spacers, top cap, Ø27.2 seatpost with 2-bolt clamp, 272 x 143 saddle over rails |
| Brakes | 12 | two dual-pivot rim calipers with pads, springs and hardware, housing and inner cables, levers |
| Finishing | 7 | bottle cage and 750 ml bottle, seat binder, bar end plugs, reflector, chainstay protector |

Dimensions come from a real bike, not from taste: a 56 cm Trek Émonda SL rim-brake frameset
(wheelbase 983, stack 577, reach 387, 73.3/73.5 degrees, 410 chainstay, 40 mm rake, 57.8 mm trail),
Shimano 105 R7000 groupset, DT Swiss PR 1600 class rim, 25-622 tyres. `build/specs.json` holds
every value with its source URL, and the spec sheet in the page lists them.

## How it is built

`build/` is the generator. Everything is modelled with `@classcad/smlibpy-three` 0.6.2, whose
parts are exact B-reps and three.js meshes at once.

```
build/lib/bike.mjs        the layout: every axle, angle and tube axis, solved from the spec
build/lib/geo.mjs         tubes, laths, sprockets, swept tubes, placements
build/lib/solid.mjs       lofts, fillet fallbacks
build/parts/frame.mjs     the frame
build/parts/fork.mjs      the fork            build/parts/wheels.mjs    both wheels
build/parts/drivetrain.mjs                   build/parts/cockpit.mjs
build/parts/brakes.mjs    build/parts/finishing.mjs
build/lib/assemble.mjs    the part registry, masses, explode vectors, envelope checks
build/pack.mjs            quantise, gzip, inline everything, write bicycle.html
build/viewer/app.js       the viewer (orbit, parts, explode, spec, dimensions, PNG)
build/viewer/physics.js   the ride (Rapier body, colliders, wheels, chain, steering)
build/verify.mjs, test-ride.mjs, final-check.mjs   headless Chrome checks
```

Regenerate:

```bash
cd build
node pack.mjs            # ~6 min: builds every part, tessellates, packs the page
node rebuild-code.mjs    # fast: splices viewer code into the packed page, keeps the data
node test-ride.mjs       # rides the bike in headless Chrome and prints speed/brake/steer
node final-check.mjs     # screenshots: iso, side, explode, selection, spec sheet
```

`pack.mjs` prints the part count, triangle count and packed size. Every part module also runs on
its own (`node parts/wheels.mjs`) and renders a PNG for inspection.

## Physics

The bike is one rigid body that carries a convex-hull collider per part, each with the mass the
B-rep volume gives it, so it weighs 11.0 kg and falls under gravity onto its tyres. The wheels,
cranks, pedals, steering and chain are articulated on top of that body: the wheels turn by the
distance travelled, the cranks by cadence, the pedals stay level, the front end turns about the
head tube axis, and the chain's 116 links run along the path the drivetrain modelled, at the
speed the chainring asks for. Braking scrubs both wheels; with `ASSIST` off nothing holds the
bike up and it topples.

## Known simplifications

Tube joints are mitered unions without blend fillets: the kernel refuses to round a welded
junction, and a sharp seam reads as a weld at this scale. Bearing balls, thread forms, cable
inner strands and gear tooth involutes are simplified. Hollow or foam parts (saddle padding,
cable housing) carry an effective density so the mass readout matches the real part. The frame
is drawn as a welded steel frame though the donor bike is carbon; masses follow the geometry, not
a catalogue.
