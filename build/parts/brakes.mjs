/**
 * Brakes: two dual-pivot rim calipers (front on the fork crown, rear on the seatstay bridge),
 * their pads and hardware, and the bowden cable runs from the STI levers.
 *
 * The calipers are placed by solving where a pad lands on the rim's brake track: the track is
 * a circle of `TRACK_R` about the axle in the wheel plane, the pads sit at z = +/-PAD_Z, and
 * the reach (pivot to pad) is the arm length. So the caliper follows the layout if the frame
 * or the fork moves, as long as its mount point does.
 *
 *   node parts/brakes.mjs
 */
import * as THREE from 'three'
import {
  render, Cylinder, Cone, Ball, Torus, Box, RoundedRectangle, Rectangle, Circle, sweep,
} from '@classcad/smlibpy-three'
import { v3, tube, pipe, latheY, along, centered, boxAt, sweptTube, deg } from '../lib/geo.mjs'
import { loftCircles, safeFillet } from '../lib/solid.mjs'
import { layout, P } from '../lib/bike.mjs'
import { writeFileSync } from 'node:fs'

const Z = v3(0, 0, 1)
const Y = v3(0, 1, 0)

const DENSITY = {
  alu: 2.7, steel: 7.85, chrome: 7.85, carbon: 1.55, rubber: 1.15, black: 1.4, brass: 8.4,
}

/* ---------------------------------------------------------------- helpers -- */

function rec(id, name, material, spec, object) {
  return { id, name, assembly: 'brakes', material, spec, object, density: DENSITY[material] ?? 2.7 }
}

function partsOf(o) {
  const out = []
  if (!o) return out
  if (Array.isArray(o)) { for (const x of o) out.push(...partsOf(x)); return out }
  o.traverse((c) => { if (c.isPart) out.push(c) })
  return out
}

function setTol(o, t = 0.25) { for (const p of partsOf(o)) p.tolerance = t; return o }

function group(...objs) {
  const g = new THREE.Group()
  for (const o of objs) if (o) g.add(o)
  return g
}

/** Fuse a list of bodies, or keep them as a group when the boolean refuses. */
function tryFuse(bodies, name = '') {
  let out = bodies[0]
  try {
    out = bodies[0].fuse(...bodies.slice(1))
    if (!out.isValid()) throw new Error('invalid')
  } catch (e) {
    return group(...bodies)
  }
  out.name = name
  return out
}

function framed(obj, origin, ex, ey, ez) {
  const m = new THREE.Matrix4().makeBasis(
    ex.clone().normalize(), ey.clone().normalize(), ez.clone().normalize(),
  )
  obj.position.copy(origin)
  obj.quaternion.setFromRotationMatrix(m)
  return obj
}

/* ------------------------------------------------------------- verification */

function verify(records) {
  const rows = []
  for (const r of records) {
    const parts = partsOf(r.object)
    let volume = 0
    let valid = parts.length > 0
    for (const p of parts) {
      try {
        volume += p.volume
        if (!p.isValid()) valid = false
      } catch (e) { valid = false }
    }
    const bb = new THREE.Box3().setFromObject(r.object)
    rows.push({
      id: r.id, parts: parts.length, valid, volume, mass: (volume / 1000) * r.density,
      size: bb.getSize(new THREE.Vector3()), bb,
    })
  }
  return rows
}

function printTable(rows) {
  const w = Math.max(...rows.map((r) => r.id.length)) + 2
  const head = `${'record'.padEnd(w)}${'body'.padStart(6)}${'ok'.padStart(5)}${'vol cm3'.padStart(10)}` +
    `${'mass g'.padStart(9)}   bbox (mm)`
  console.log(head)
  console.log('-'.repeat(head.length + 26))
  for (const r of rows) {
    console.log(r.id.padEnd(w) + String(r.parts).padStart(6) + (r.valid ? '  yes' : '  NO!').padStart(5) +
      (r.volume / 1000).toFixed(1).padStart(10) + r.mass.toFixed(0).padStart(9) + '   ' +
      r.size.toArray().map((n) => n.toFixed(0)).join(' x '))
  }
  const bad = rows.filter((r) => !r.valid)
  console.log(`\n${rows.length} records, ${rows.reduce((a, r) => a + r.parts, 0)} bodies, ` +
    `${bad.length} invalid${bad.length ? ': ' + bad.map((b) => b.id).join(', ') : ''}`)
  return bad
}

/* ---------------------------------------------------------------- caliper -- */

export const TRACK_R = 320      // rim brake track radius (a 622 rim, track just under the tyre)
export const PAD_Z = 13.6       // the rim's side faces
const TYRE_HALF = 12.5
const PAD_W = 40                // pad length along the rim
const PAD_H = 11                // pad height
const PAD_T = 4                 // pad thickness

/**
 * Solve the caliper pose: a pad centre on the brake track exactly `reach` from the pivot.
 * Returns the frame (ex = bolt axis, ey = towards the pads, ez = lateral) and the pad point.
 */
function caliperPose({ mount, boltDir, axle, reach = 60, preferBearing = 90 }) {
  const R = TRACK_R
  const ex = boltDir.clone().normalize()
  const d = mount.distanceTo(axle)
  const u = axle.clone().sub(mount).divideScalar(d)      // pivot -> axle
  const a = (d * d + reach * reach - R * R) / (2 * d)
  const h2 = reach * reach - a * a
  const h = Math.sqrt(Math.max(0, h2))
  const foot = mount.clone().addScaledVector(u, a)
  const perp = v3(-u.y, u.x, 0)                          // in the bike plane
  const options = [1, -1].map((s) => foot.clone().addScaledVector(perp, s * h))
  const bearing = (p) => (Math.atan2(p.y - axle.y, p.x - axle.x) * 180) / Math.PI
  options.sort((A, B) => Math.abs(bearing(A) - preferBearing) - Math.abs(bearing(B) - preferBearing))
  const padPoint = options[0]

  const r = padPoint.clone().sub(mount)
  const px = r.dot(ex)
  const ry = r.clone().addScaledVector(ex, -px)
  const py = ry.length()
  const ey = ry.clone().normalize()
  let ez = new THREE.Vector3().crossVectors(ex, ey).normalize()
  if (ez.z < 0) ez.negate()
  return { ex, ey, ez, px, py, reach, padPoint, bearing: bearing(padPoint) }
}

function buildCaliper({ mount, boltDir, axle, reach = 60, side = 1, preferBearing = 90, name }) {
  const pose = caliperPose({ mount, boltDir, axle, reach, preferBearing })
  const { ex, ey, ez, px, py } = pose
  const W = (x, y, z) => mount.clone().addScaledVector(ex, x).addScaledVector(ey, y).addScaledVector(ez, z)
  const armLift = Math.min(1, py / 60)     // shorter arms for a shorter reach

  // --- arms: from beside the pivot, arching out to the pad holders --------------------
  const arms = []
  for (const s of [-1, 1]) {
    const path = [
      W(-4, -10 * armLift, s * 12),
      W(px * 0.08, py * 0.14, s * 17),
      W(px * 0.40, py * 0.50, s * 18.5),
      W(px * 0.74, py * 0.78, s * 17.5),
      W(px * 0.94, py * 0.94, s * 15),
      W(px, py, s * 14.2),
    ]
    // a flat, slightly tapered arm: 8 mm thick on Z, ~18 mm deep in the caliper's plane
    let arm = null
    try {
      arm = loftCircles(path, [6.5, 8.5, 9.5, 9.5, 9, 8], { oval: [0.45, 1.0] })
    } catch (e) { arm = null }
    arms.push(arm ?? sweptTube(path, 4.6))
  }

  // --- pivot boss + the two pad holders ----------------------------------------------
  const boss = tube(W(-12, 0, 0), W(16, 0, 0), 7)
  const holders = []
  const pads = []
  for (const s of [-1, 1]) {
    // holder: a shoe that carries the pad, opened towards the rim
    const shoe = new Box(30, 15, 7)
    framed(shoe, W(px, py, s * (PAD_Z + PAD_T + 3.5)), ex, ey, ez)
    // a small arm between the arm end and the shoe
    const link = tube(W(px, py, s * 14.2), W(px, py, s * (PAD_Z + PAD_T + 2)), 4)
    holders.push(shoe, link)
    const pad = new Box(PAD_W, PAD_H, PAD_T)
    framed(pad, W(px, py, s * (PAD_Z + PAD_T / 2)), ex, ey, ez)
    pads.push(pad)
  }

  // --- yoke across the arm roots, with the cable stop and the quick release ----------
  const yoke = tube(W(0, -9 * armLift, -15), W(0, -9 * armLift, 15), 4.6)
  const yokeMid = new Box(9, 11, 20)
  framed(yokeMid, W(0, -9 * armLift, 0), ex, ey, ez)
  const stopAt = W(0, -9 * armLift - 12, 0)
  const stop = tube(W(0, -9 * armLift - 6, 0), stopAt, 4.4, 3.9)  // housing stop
  // quick release: a small cam lever beside the stop
  const cam = new Box(16, 5, 7)
  framed(cam, W(2, -9 * armLift - 16, 11), ex, ey, ez)
  const camPivot = tube(W(1, -9 * armLift - 16, 4), W(1, -9 * armLift - 16, 17), 2.2)

  const body = tryFuse([...arms, boss, ...holders.slice(0, 2), yoke, yokeMid, stop, cam, camPivot], name)

  // --- centre bolt through the crown / bridge ----------------------------------------
  const bolt = group(
    tube(W(8, 0, 0), W(-50, 0, 0), 3),                 // M6 through the mount
    tube(W(-50, 0, 0), W(-56, 0, 0), 5.5, 5.1),        // recessed nut behind the mount
    tube(W(8, 0, 0), W(12, 0, 0), 5.5, 5.1),           // bolt head
  )

  // --- springs and tension screws ----------------------------------------------------
  const springs = []
  for (const s of [-1, 1]) {
    springs.push(tube(W(-10, 7, s * 18), W(1, 7, s * 18), 3.1, 2.6))   // return spring
    springs.push(tube(W(1, 7, s * 18), W(9, 7, s * 18), 1.4))           // tension screw
    springs.push(tube(W(9, 7, s * 18), W(12, 7, s * 18), 2.6, 2.4))
  }
  // anchor bolt on one arm, where the inner cable is clamped
  const anchorAt = W(px * 0.34, py * 0.40, side * 18)
  const anchor = tube(anchorAt.clone().addScaledVector(ez, side * -3),
    anchorAt.clone().addScaledVector(ez, side * 8), 2.6)

  return { pose, body, pads: group(...pads), W, bolt: group(bolt, ...springs, anchor),
    stopAt, anchorAt }
}

/* ------------------------------------------------------------------ levers -- */

function buildLever(L, s) {
  const barPt = L.barCenter.clone().add(v3(1.2, -0.4, s * 105))
  const collar = pipe(barPt.clone().addScaledVector(Z, -11), barPt.clone().addScaledVector(Z, 11), 17, 16.1)
  const hoodPts = [
    barPt.clone().add(v3(6, 3, 0)),
    barPt.clone().add(v3(34, 2, 0)),
    barPt.clone().add(v3(62, -8, 0)),
    barPt.clone().add(v3(82, -26, 0)),
    barPt.clone().add(v3(88, -46, 0)),
  ]
  const hood = loftCircles(hoodPts, [13, 14.5, 14, 12, 8.5], { oval: [0.92, 1.12] })
  // brake lever blade: a flat curved paddle hanging from the hood, swept back for the fingers
  const bladePts = [
    barPt.clone().add(v3(84, -40, 0)),
    barPt.clone().add(v3(93, -70, 0)),
    barPt.clone().add(v3(89, -104, 0)),
    barPt.clone().add(v3(78, -132, 0)),
    barPt.clone().add(v3(70, -146, 0)),
  ]
  let blade = null
  try {
    blade = loftCircles(bladePts, [7.5, 9, 9, 8.5, 7], { oval: [1.05, 0.5] })
  } catch (e) { blade = null }
  blade = blade ?? sweptTube(bladePts, 4.2)
  const body = tryFuse([collar, hood], 'lever')
  return { body: group(body, blade), barPt, exit: barPt.clone().add(v3(56, -6, 0)) }
}

/* ------------------------------------------------------------------ cables -- */

/** Bowden housing: a Ø5 tube with a real Ø1.6 bore swept along the control points. */
function housingTube(points, rOut = 2.5, rIn = 0.8) {
  const ring = new Circle(rOut).cut(new Circle(rIn))
  const path = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.2)
  try {
    const h = sweep(ring, path)
    if (h && h.isValid()) return h
  } catch (e) { /* fall through to a solid run */ }
  return sweptTube(points, rOut)
}

function cableRun(points, label) {
  const housing = housingTube(points)
  const inner = sweptTube(points, 0.8)
  const a = points[0]
  const b = points[points.length - 1]
  const ferrules = group(
    tube(a, a.clone().lerp(b, 0.012), 4.2, 0.9),
    tube(b.clone().lerp(a, 0.012), b, 4.2, 0.9),
  )
  const ends = group(
    tube(b.clone().lerp(a, 0.03), b.clone().lerp(a, 0.045), 2.6, 0.9),
  )
  return { housing: group(housing, ferrules), inner: group(inner, ends), points }
}

/* ---------------------------------------------------------------- builder -- */

export function buildBrakes(L = layout()) {
  const records = []
  const frontHub = L.frontHub
  const rearHub = L.rearHub

  // front caliper: centre bolt through the fork crown, pivots just in front of it
  const frontMount = L.crown.clone().addScaledVector(L.nHead, 28)
  const front = buildCaliper({
    mount: frontMount, boltDir: L.nHead, axle: frontHub, reach: 60, preferBearing: 90,
    side: 1, name: 'Front caliper',
  })

  // rear caliper: centre bolt through the seatstay bridge (frame.mjs puts it at -268, 604, 0)
  const REAR_BRIDGE = v3(-205, 657, 0)
  const rearMount = REAR_BRIDGE.clone()
  const rear = buildCaliper({
    mount: rearMount, boltDir: v3(1, 0, 0), axle: rearHub, reach: 60, preferBearing: 90,
    side: -1, name: 'Rear caliper',
  })

  records.push(rec('brake.front.caliper', 'Front brake caliper', 'alu', {
    Type: 'dual pivot', Reach: '60 mm', Arms: '2', Track: `r${TRACK_R} mm`,
  }, setTol(front.body)))
  records.push(rec('brake.front.pads', 'Front brake pads', 'rubber', {
    Size: `${PAD_W} x ${PAD_H} x ${PAD_T} mm`, Pair: '2', Track: `r${TRACK_R} mm`,
  }, setTol(front.pads)))
  records.push(rec('brake.front.hardware', 'Front caliper hardware', 'steel', {
    Bolt: 'M6 x 55', Springs: '2 return springs + 2 tension screws', Anchor: 'M5',
  }, setTol(front.bolt)))

  records.push(rec('brake.rear.caliper', 'Rear brake caliper', 'alu', {
    Type: 'dual pivot', Reach: '60 mm', Arms: '2', Track: `r${TRACK_R} mm`,
  }, setTol(rear.body)))
  records.push(rec('brake.rear.pads', 'Rear brake pads', 'rubber', {
    Size: `${PAD_W} x ${PAD_H} x ${PAD_T} mm`, Pair: '2',
  }, setTol(rear.pads)))
  records.push(rec('brake.rear.hardware', 'Rear caliper hardware', 'steel', {
    Bolt: 'M6 x 55', Springs: '2 return springs + 2 tension screws', Anchor: 'M5',
  }, setTol(rear.bolt)))

  // levers (right = front brake, left = rear, the usual road set-up)
  const leverR = buildLever(L, 1)
  const leverL = buildLever(L, -1)
  records.push(rec('brake.lever.front', 'Right STI lever', 'alu', {
    Type: 'STI, front brake', Clamp: '31.8 mm', Blade: '145 mm',
  }, setTol(leverR.body)))
  records.push(rec('brake.lever.rear', 'Left STI lever', 'alu', {
    Type: 'STI, rear brake', Clamp: '31.8 mm', Blade: '145 mm',
  }, setTol(leverL.body)))

  // front run: bar -> in front of the head tube -> down the steerer side -> crown caliper
  const C = L.barCenter
  const frontStop = front.stopAt
  // the run leaves the hood's front, drops in front of the bar and the head tube and
  // reaches the caliper's cable stop just above the crown
  const frontPts = [
    leverR.exit.clone(),
    v3(C.x + 74, C.y - 18, 90),
    v3(C.x + 70, C.y - 58, 52),
    v3(C.x + 44, C.y - 92, 30),
    v3(C.x + 6, C.y - 122, 20),
    v3(frontMount.x + 10, frontMount.y + 46, 10),
    v3(frontMount.x + 6, frontMount.y + 26, 5),
    frontStop.clone(),
  ]
  const frontCable = cableRun(frontPts, 'front')
  records.push(rec('brake.front.cable', 'Front brake housing', 'black', {
    Length: `${polyLen(frontPts).toFixed(0)} mm`, Size: 'Ø5 / Ø1.6', Ends: '2 ferrules',
  }, setTol(frontCable.housing)))
  records.push(rec('brake.front.inner', 'Front brake inner cable', 'steel', {
    Size: 'Ø1.6 mm', Anchor: 'at the yoke',
  }, setTol(frontCable.inner)))

  // rear run: bar -> top tube -> seatstay -> seatstay bridge
  const ttA = L.ttHead.clone()
  const ttB = L.ttSeat.clone()
  const lerp = (a, b, t, dz, dy = 0) => a.clone().lerp(b, t).add(v3(0, dy, dz))
  const rearPts = [
    leverL.exit.clone(),
    v3(C.x + 52, C.y - 4, -92),      // under the bar tape, back along the tops
    v3(C.x + 10, C.y - 10, -58),
    v3(C.x - 48, C.y - 20, -28),
    v3(C.x - 96, C.y - 34, -18),
    lerp(ttA, ttB, 0.06, -12, 16),
    lerp(ttA, ttB, 0.34, -12, 15),
    lerp(ttA, ttB, 0.66, -11, 14),
    lerp(ttA, ttB, 0.97, -10, 12),
    v3(-190, 700, -10),
    v3(-240, 650, -8),
    v3(rearMount.x - 6, rearMount.y - 26, -5),
    rearStopApproach(rear),
    rear.stopAt.clone(),
  ]
  const rearCable = cableRun(rearPts, 'rear')
  records.push(rec('brake.rear.cable', 'Rear brake housing', 'black', {
    Length: `${polyLen(rearPts).toFixed(0)} mm`, Size: 'Ø5 / Ø1.6', Ends: '2 ferrules',
  }, setTol(rearCable.housing)))
  records.push(rec('brake.rear.inner', 'Rear brake inner cable', 'steel', {
    Size: 'Ø1.6 mm', Anchor: 'at the yoke',
  }, setTol(rearCable.inner)))

  return records
}

function rearStopApproach(rear) {
  // the rear caliper's cable stop faces away from the pads; come at it from behind and below
  const p = rear.stopAt
  return p.clone().add(v3(-14, -14, 0))
}

function polyLen(pts) {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += pts[i].distanceTo(pts[i - 1])
  return d
}

/* -------------------------------------------------------------- self test -- */

export function checkBrakes(L = layout()) {
  const records = buildBrakes(L)
  const rows = verify(records)
  printTable(rows)

  const by = (id) => rows.find((r) => r.id === id)
  for (const [tag, hub, mount] of [
    ['front', L.frontHub, L.crown.clone().addScaledVector(L.nHead, 28)],
    ['rear', L.rearHub, v3(-268, 604, 0)],
  ]) {
    const padRow = by(`brake.${tag}.pads`)
    const bb = padRow.bb
    const c = bb.getCenter(new THREE.Vector3())
    const r = Math.hypot(c.x - hub.x, c.y - hub.y)
    console.log(`${tag} pads: centre (${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)})` +
      `  radius ${r.toFixed(1)} (track ${TRACK_R})  z span ${bb.min.z.toFixed(1)}..${bb.max.z.toFixed(1)}` +
      `  pivot ${mount.distanceTo(hub).toFixed(0)} mm from the axle`)
    console.log(`  tyre clearance: pad inner face z ${Math.min(Math.abs(bb.min.z), Math.abs(bb.max.z)).toFixed(1)}` +
      ` vs tyre half width ${TYRE_HALF} (pads are 4 mm thick, so the inner face is ${PAD_Z})`)
  }

  setTol(records.map((r) => r.object), 0.25)

  // brake-track guide so the picture shows what the pads are meant to touch
  const guideRim = new Torus(TRACK_R, 11)
  guideRim.position.copy(L.frontHub)
  const guideTyre = new Torus(323.5, 12.5)
  guideTyre.position.copy(L.frontHub)
  const guideRimR = guideRim.clone()
  guideRimR.position.copy(L.rearHub)
  const guideTyreR = guideTyre.clone()
  guideTyreR.position.copy(L.rearHub)

  const frontCaliper = records.filter((r) => r.id.startsWith('brake.front.')).map((r) => r.object)
  const lookAt = L.crown.clone().lerp(L.frontHub, 0.18)
  writeFileSync('/tmp/brakes.png', render([...frontCaliper, guideRim, guideTyre], {
    view: 'front', size: [1000, 900], background: '#eef2f7', lookAt, zoom: 3.1,
    markers: [
      { position: L.crown, label: 'crown', color: '#d00' },
      { position: by('brake.front.pads').bb.getCenter(new THREE.Vector3()), label: 'pads', color: '#08f' },
    ],
  }).data)
  writeFileSync('/tmp/brakes-iso.png', render([...frontCaliper, guideRim, guideTyre], {
    view: { azimuth: deg(52), elevation: deg(16) }, size: [1100, 800], background: '#eef2f7',
    lookAt, zoom: 2.6,
  }).data)
  writeFileSync('/tmp/brakes-all.png', render([
    ...records.map((r) => r.object), guideRim, guideTyre, guideRimR, guideTyreR,
  ], {
    view: { azimuth: deg(150), elevation: deg(16) }, size: [1300, 800], background: '#eef2f7',
  }).data)
  console.log('\nwrote /tmp/brakes.png, /tmp/brakes-iso.png, /tmp/brakes-all.png ' +
    '(the ring/torus are brake-track guides, not records)')
  return { records, rows }
}

if (import.meta.url === `file://${process.argv[1]}`) checkBrakes()
