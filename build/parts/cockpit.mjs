/**
 * Cockpit: drop handlebar, stem, headset, spacers, top cap, seatpost and saddle.
 *
 * Everything is built in world coordinates (mm, Y up, +X forward, +Z drive side) off the
 * shared layout, so the module follows lib/bike.mjs when a dimension there changes.
 *
 *   node parts/cockpit.mjs      # builds, checks, prints a table, writes /tmp/cockpit.png
 */
import * as THREE from 'three'
import {
  render, Cylinder, Cone, Ball, Torus, Box, RoundedRectangle, Rectangle, Circle, Ellipse, Polygon,
  loft, sweep,
} from '@classcad/smlibpy-three'
import { v3, tube, pipe, latheY, along, centered, boxAt, sweptTube, discZ, deg } from '../lib/geo.mjs'
import { loftCircles, safeFillet } from '../lib/solid.mjs'
import { layout, P } from '../lib/bike.mjs'
import { writeFileSync } from 'node:fs'

const Z = v3(0, 0, 1)
const Y = v3(0, 1, 0)

const DENSITY = {
  alu: 2.7, steel: 7.85, chrome: 7.85, carbon: 1.55, rubber: 1.15,
  leather: 0.9, black: 1.4, paint: 1.2, brass: 8.4,
}

/* ------------------------------------------------------------------ records */

function rec(id, name, material, spec, object) {
  return {
    id, name, assembly: 'cockpit', material, spec, object,
    density: DENSITY[material] ?? 2.7,
  }
}

function partsOf(o) {
  const out = []
  if (!o) return out
  if (Array.isArray(o)) { for (const x of o) out.push(...partsOf(x)); return out }
  o.traverse((c) => { if (c.isPart) out.push(c) })
  return out
}

function setTol(o, t = 0.25) {
  for (const p of partsOf(o)) p.tolerance = t
  return o
}

/** Put an object into the frame (origin, ex, ey, ez) given in world coordinates. */
function framed(obj, origin, ex, ey, ez) {
  const m = new THREE.Matrix4().makeBasis(
    ex.clone().normalize(), ey.clone().normalize(), ez.clone().normalize(),
  )
  obj.position.copy(origin)
  obj.quaternion.setFromRotationMatrix(m)
  return obj
}

function group(...objs) {
  const g = new THREE.Group()
  for (const o of objs) if (o) g.add(o)
  return g
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
      } catch (e) {
        valid = false
      }
    }
    const bb = new THREE.Box3().setFromObject(r.object)
    const size = bb.getSize(new THREE.Vector3())
    rows.push({
      id: r.id, parts: parts.length, valid, volume, mass: (volume / 1000) * r.density,
      size, bb,
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
    console.log(
      r.id.padEnd(w) +
      String(r.parts).padStart(6) +
      (r.valid ? '  yes' : '  NO!').padStart(5) +
      (r.volume / 1000).toFixed(1).padStart(10) +
      r.mass.toFixed(0).padStart(9) + '   ' +
      r.size.toArray().map((n) => n.toFixed(0)).join(' x '),
    )
  }
  const bad = rows.filter((r) => !r.valid)
  console.log(`\n${rows.length} records, ${rows.reduce((a, r) => a + r.parts, 0)} bodies, ` +
    `${bad.length} invalid${bad.length ? ': ' + bad.map((b) => b.id).join(', ') : ''}`)
  return bad
}

/* ------------------------------------------------------------------ bar ---- */

/**
 * The bar's right half as [dx, dy, dz] off the clamp centre: dz outward along the bar,
 * dx forward, dy up. It is mirrored in Z for the left half, so the bar is one symmetric
 * swept solid: tops → hook (radius 45) → drop run.
 */
function barHalfPath() {
  const R = 45 // hook radius
  const cy = -45 // hook centre height (the forward-most point sits at dy = cy)
  const cx = 80 - R // hook centre, so the reach is exactly 80
  const arc = (a, dz) => [cx + R * Math.cos(deg(a)), cy + R * Math.sin(deg(a)), dz]
  return [
    [0, 0, 0],          // centre of the clamp
    [0, 0, 60],         // end of the 31.8 clamp section
    [1.2, -0.4, 105],   // the STI levers clamp here (barCentre +/-105)
    [7, -0.9, 133],
    [24, -1.8, 155],
    arc(70, 172),
    arc(55, 180),
    arc(35, 187),
    arc(15, 191),
    arc(0, 194),        // forward-most: reach 80
    arc(-18, 197),
    [70.3, -81.9, 200], // straight drop run, angled 18 deg back from vertical
    [62.7, -104.9, 205],
    [55.2, -128, 210],  // bar end: drop 128, half width 210
  ]
}

/** Where the bar ends are and which way they point: bar end plugs and tape need this. */
export function barEnds(L = layout()) {
  const half = barHalfPath()
  const C = L.barCenter
  const last = half[half.length - 1]
  const prev = half[half.length - 2]
  const dirR = v3(last[0] - prev[0], last[1] - prev[1], last[2] - prev[2]).normalize()
  return [
    { point: v3(last[0], last[1], last[2]).add(C), dir: dirR },
    { point: v3(last[0], last[1], -last[2]).add(C), dir: v3(dirR.x, dirR.y, -dirR.z) },
  ]
}

/**
 * The bar: one swept solid from bar end to bar end. The 31.8 clamp is a smooth thickening of
 * the same sweep (a scale law along the path), not a sleeve, so the tube never breaks.
 */
function buildBar(L) {
  const C = L.barCenter
  const half = barHalfPath()
  const left = half.slice(1).map(([x, y, z]) => [x, y, -z]).reverse()
  const pts = [...left, ...half].map(([x, y, z]) => v3(x, y, z).add(C))
  const path = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2)
  // the 120 mm clamp sits between t = 0.465 and 0.535; tanh shoulders keep it smooth
  const w = 0.012
  const clampScale = (t) => {
    const rise = 0.5 * (1 + Math.tanh((t - 0.4645) / w))
    const fall = 0.5 * (1 + Math.tanh((0.5355 - t) / w))
    return 1 + (15.9 / 11.9 - 1) * rise * fall
  }
  const bar = sweep(new Circle(11.9), path, { scale: clampScale })
  bar.name = 'Handlebar'
  return bar
}

/* ------------------------------------------------------------------ stem --- */

function buildStem(L) {
  const H = L.uHead.clone()
  const S = L.steererTop
  const C = L.barCenter
  const at = (d) => S.clone().addScaledVector(H, d)
  const nH = L.nHead.clone()            // forward of the steering axis
  const back = nH.clone().negate()

  const clMid = at(17)                  // centre of the 34 mm steerer clamp
  const clamp = pipe(at(0), at(34), 21, 14.3)   // OD 42 over the 28.6 steerer

  // extension: lofts from inside the clamp out to the bar clamp
  const u = C.clone().sub(clMid)
  const extLen = u.length()
  u.normalize()
  const extEnd = C.clone().addScaledVector(u, -17)
  const extPts = [0, 0.34, 0.68, 1].map((t) => clMid.clone().lerp(extEnd, t))
  const ext = loftCircles(extPts, [15.8, 16.6, 17.6, 18.4], { oval: [1.2, 0.92] })

  // bar clamp: 46 OD collar round the 31.8 bar
  const collar = pipe(C.clone().addScaledVector(Z, -22), C.clone().addScaledVector(Z, 22), 23, 16.05)

  let stem = clamp.fuse(ext, collar)

  // bores, the faceplate opening and the steerer slot, all cut after the fuse
  const steerBore = new Cylinder(14.3, 14.3, 260)
  steerBore.quaternion.setFromUnitVectors(Y, H)
  steerBore.position.copy(clMid)

  const barBore = new Cylinder(15.95, 15.95, 80)
  barBore.rotation.x = Math.PI / 2
  barBore.position.copy(C)

  // open the collar where the faceplate closes it again
  const front = boxAt([80, 90, 64], C.clone().add(v3(59.6, 0, 0)))
  const slot = new Box(1.8, 46, 24)
  framed(slot, clMid.clone().addScaledVector(back, 19.5), nH, H, Z)

  stem = stem.cut(steerBore, barBore, front, slot)

  // 4-bolt faceplate in front of the bar
  const plate = new RoundedRectangle(50, 42, 12).extrude(8)
  plate.rotation.y = Math.PI / 2            // +Z of the sketch -> +X
  plate.position.set(C.x + 19.6, C.y, C.z)  // spans x = C.x+19.6 .. C.x+27.6
  const holes = []
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const h = new Cylinder(2.9, 2.9, 20)
      h.rotation.z = Math.PI / 2
      h.position.set(C.x + 24, C.y + sy * 13.5, C.z + sz * 17.5)
      holes.push(h)
    }
  }
  let faceplate = plate.cut(...holes)
  if (!faceplate.isValid()) faceplate = plate

  // bolts
  const bolts = []
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const y = C.y + sy * 13.5
      const z = C.z + sz * 17.5
      const shank = tube(v3(C.x + 8, y, z), v3(C.x + 30.5, y, z), 2.5)
      const head = tube(v3(C.x + 27.5, y, z), v3(C.x + 33, y, z), 4.75, 4.4)
      const socket = tube(v3(C.x + 32.9, y, z), v3(C.x + 33.7, y, z), 2.6, 2.6)
      bolts.push(shank, head, socket)
    }
  }
  // 2 steerer clamp bolts through the ears at the back
  for (const s of [-1, 1]) {
    const p = clMid.clone().addScaledVector(back, 19).addScaledVector(H, s * 7.5)
    const a = p.clone().addScaledVector(Z, -30)
    const b = p.clone().addScaledVector(Z, 30)
    bolts.push(tube(a, b, 2.5), tube(p.clone().addScaledVector(Z, 26), b, 4.75, 4.4))
  }

  return { stem, faceplate, bolts: group(...bolts) }
}

/* --------------------------------------------------------------- headset --- */

function buildHeadset(L) {
  const H = L.uHead.clone()
  const T = L.headTop
  const at = (d) => T.clone().addScaledVector(H, d)
  const mk = (a, b, rO, rI) => pipe(at(a), at(b), rO, rI)

  const cup = mk(-14, 0.5, 17, 14.6)          // Ø34 press fit in the Ø34 head tube
  const bearing = mk(0.5, 7, 20.5, 15)        // Ø41 x 6.5
  // compression ring: a split cone that centres the steerer in the bearing
  const cone = latheY([[15.4, 0], [17.6, 0], [17.6, 1.1], [15.6, 3.2], [15.4, 3.2]])
  along(cone, at(7), at(10.2))

  const spacers = []
  let d = 10.2
  for (const h of [5.5, 5.5, 4.8]) {
    spacers.push(mk(d, d + h, 17.2, 14.5))
    d += h
  }

  // top cap on top of the stem clamp: steererTop + the clamp's 34 mm height
  const capBase = L.steererTop.clone().addScaledVector(H, 34.4)
  const cap = latheY([[0, 0], [17, 0], [17, 3.6], [13.5, 5.4], [0, 5.4]])
  along(cap, capBase, capBase.clone().addScaledVector(H, 5.4))
  const capBolt = group(
    // the head sits on the cap, the shank goes down into the steerer's star nut
    tube(capBase.clone().addScaledVector(H, 5.2), capBase.clone().addScaledVector(H, 10.6), 5, 4.4),
    tube(capBase.clone().addScaledVector(H, 1.4), capBase.clone().addScaledVector(H, 5.4), 3, 3),
  )
  return { cup, bearing, cone, spacers, cap, capBolt }
}

/* -------------------------------------------------------------- seatpost --- */


function saddleOutline(xc, length, hw) {
  // Catmull-Rom halving of the plan width along the length (nose at +x)
  const ctrl = [
    [0.00, 20], [0.10, 23], [0.26, 33], [0.44, 52], [0.60, 66],
    [0.72, 71.5], [0.84, 68], [0.92, 60], [1.00, 26],
  ].map(([u, w]) => new THREE.Vector3(u, w, 0))
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5)
  const N = 30
  const halfWidth = (u) => {
    const p = curve.getPoint(Math.min(0.999, Math.max(0.001, u)))
    return Math.max(6, p.y)
  }
  const nose = xc + length / 2 - hw.nose   // centre of the nose cap
  const tail = xc - length / 2 + hw.tail
  const pts = []
  // nose cap: semicircle from -z to +z through +x
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI
    pts.push([nose + hw.nose * Math.cos(a), hw.nose * Math.sin(a)])
  }
  const span = nose - tail
  for (let i = 1; i < N; i++) {
    const u = i / N
    pts.push([nose - u * span, halfWidth(u)])
  }
  // tail cap
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI / 2 + (i / 8) * Math.PI
    pts.push([tail + hw.tail * Math.cos(a), hw.tail * Math.sin(a)])
  }
  for (let i = N - 1; i >= 1; i--) {
    const u = i / N
    pts.push([nose - u * span, -halfWidth(u)])
  }
  return pts
}

const SADDLE = {
  len: 272, halfWidth: 71.5,
  pad: 8, cover: 1.2,
}

/** the saddle's vertical layout: the top at L.saddleTop, the rails 32 mm under it */
function saddleStack(L) {
  const topY = L.saddleTop.y
  return { topY, railY: topY - 32 }
}

/* 1-D Catmull-Rom sampler over [u, value] pairs */
function sampler(pairs) {
  const c = new THREE.CatmullRomCurve3(
    pairs.map(([u, v]) => new THREE.Vector3(u, v, 0)), false, 'catmullrom', 0.5,
  )
  return (u) => c.getPoint(Math.min(0.999, Math.max(0.001, u))).y
}

const halfWidthAt = sampler([[0, 20], [0.10, 23], [0.26, 33], [0.44, 52], [0.60, 66],
  [0.72, 71.5], [0.84, 68], [0.92, 60], [1, 52]])
// how far the top surface sits below L.saddleTop: a dipped nose, a mid saddle at the top,
// and a tail that rises back up to it
const topDropAt = sampler([[0, 8], [0.18, 5], [0.38, 1.5], [0.55, 0], [0.80, 0.6], [0.92, 3.5], [1, 0]])
const shellDepthAt = sampler([[0, 6], [0.16, 7], [0.34, 10], [0.52, 14], [0.72, 20], [0.88, 24], [1, 24]])

/**
 * A saddle body from nose to tail: sections are rounded rectangles in the YZ plane, lofted
 * along X. `layer` picks the padding (top 8 mm) or the shell (the dish under it).
 */
function saddleLayer(xc, layer, N = 26) {
  const topY = saddleStack(layoutCache).topY
  const sections = []
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const x = xc + SADDLE.len / 2 - SADDLE.len * u
    const hw = halfWidthAt(u)
    const top = topY - topDropAt(u)
    let h, yc, w, r
    if (layer === 'cover') {
      h = SADDLE.cover
      yc = top - h / 2
      w = hw * 2 - 2.5
      r = Math.min(0.55, h / 2 - 0.05)
    } else if (layer === 'pad') {
      h = SADDLE.pad - SADDLE.cover
      yc = top - SADDLE.cover - h / 2
      w = hw * 2 - 2.5
      r = Math.min(2.9, h / 2 - 0.2)
    } else {
      const depth = shellDepthAt(u)
      h = depth
      yc = top - SADDLE.pad - depth / 2
      w = hw * 2
      r = Math.min(4, depth / 2 - 0.2, hw - 0.5)
    }
    const sk = new RoundedRectangle(h, w, Math.max(0.6, r))
    sk.applyMatrix4(new THREE.Matrix4().makeBasis(Y, Z, v3(1, 0, 0)))
    sk.position.set(x, yc, 0)
    sk.updateMatrixWorld(true)
    sections.push(sk)
  }
  return sections
}

let layoutCache = null

function buildSaddle(L) {
  layoutCache = L
  const { topY, railY } = saddleStack(L)
  const xc = L.seatpostTop.x + 6

  // pressure-relief channel down the middle: through the cover and padding, into the shell
  const chan = new RoundedRectangle(100, 24, 12).extrude(120)
  chan.rotation.x = -Math.PI / 2
  chan.position.set(xc - 18, topY - 15, 0)

  const pad = loft(saddleLayer(xc, 'pad')).cut(chan)
  const cover = loft(saddleLayer(xc, 'cover')).cut(chan)
  const shell = loft(saddleLayer(xc, 'shell')).cut(chan)

  // rails: out of the shell at the nose, down to the clamp, back up into the tail
  const clampX = L.seatpostTop.x
  const rails = []
  for (const s of [-1, 1]) {
    rails.push(sweptTube([
      v3(xc + 104, topY - 17, s * 22),
      v3(xc + 58, topY - 24, s * 22),
      v3(clampX + 34, railY, s * 22),
      v3(clampX - 34, railY, s * 22),
      v3(xc - 66, topY - 26, s * 22),
      v3(xc - 100, topY - 22, s * 22),
    ], 3.5))
  }
  return { shell, padding: pad, cover, rails: group(...rails), railY, topY, xc }
}

function buildSeatpost(L) {
  const S = L.uSeat.clone()
  const top = L.seatpostTop
  const bottom = L.seatTop.clone().addScaledVector(S, -160)   // 350 mm post, 190 mm showing
  const post = pipe(bottom, top, 13.6, 11.6)

  const { railY } = saddleStack(L)
  const bx = top.x
  const yHeadBot = top.y + 2
  const yHeadTop = railY - 3.5

  // lower clamp body: a block with the rail grooves in its top face
  const lower = new Box(58, yHeadTop - yHeadBot, 56)
  lower.position.set(bx, (yHeadTop + yHeadBot) / 2, 0)
  const grooves = [-1, 1].map((s) => {
    const g = new Cylinder(3.7, 3.7, 70)
    g.rotation.z = Math.PI / 2
    g.position.set(bx, railY, s * 22)
    return g
  })
  const boltHoles = [-1, 1].map((s) => {
    const h = new Cylinder(3.0, 3.0, 90)
    h.position.set(bx + s * 25, yHeadTop + 10, 0)
    return h
  })
  const head = lower.cut(...grooves, ...boltHoles)

  // upper cradle presses the rails down onto the head
  const cradle = new Box(58, 3.2, 56)
  cradle.position.set(bx, railY + 3.5 + 1.6, 0)
  const cGrooves = [-1, 1].map((s) => {
    const g = new Cylinder(3.7, 3.7, 70)
    g.rotation.z = Math.PI / 2
    g.position.set(bx, railY, s * 22)
    return g
  })
  const cHoles = [-1, 1].map((s) => {
    const h = new Cylinder(3.0, 3.0, 40)
    h.position.set(bx + s * 25, railY + 5, 0)
    return h
  })
  const upper = cradle.cut(...cGrooves, ...cHoles)

  // mast: the post's top into the clamp body
  const mast = pipe(top.clone().addScaledVector(S, -6), top.clone().addScaledVector(S, 10), 15.4, 5)

  const bolts = []
  for (const s of [-1, 1]) {
    const x = bx + s * 25
    bolts.push(
      tube(v3(x, yHeadBot - 6, 0), v3(x, railY + 6, 0), 2.6),
      tube(v3(x, yHeadBot - 9.5, 0), v3(x, yHeadBot - 5.5, 0), 5, 4.6),
    )
  }
  return { post, mast, head, cradle: upper, bolts: group(...bolts) }
}

/* ---------------------------------------------------------------- builder -- */

export function buildCockpit(L = layout()) {
  const records = []
  const bar = buildBar(L)
  records.push(rec('cockpit.bar', 'Drop handlebar', 'carbon', {
    Width: `${P.barWidth} mm`, Clamp: '31.8 mm', Reach: '80 mm', Drop: '128 mm', Grip: '23.8 mm',
  }, setTol(bar)))

  const stem = buildStem(L)
  records.push(rec('cockpit.stem', 'Stem', 'alu', {
    Length: `${P.stemLen} mm`, Rise: `+${P.stemAngle} deg`, Clamp: '31.8 mm', Steerer: '28.6 mm',
  }, setTol(stem.stem)))
  records.push(rec('cockpit.stem.faceplate', 'Stem faceplate', 'alu', {
    Bolts: '4 x M5', Size: '54 x 46 mm',
  }, setTol(stem.faceplate)))
  records.push(rec('cockpit.stem.bolts', 'Stem bolts', 'steel', {
    Faceplate: '4 x M5 x 28', Steerer: '2 x M5 x 30',
  }, setTol(stem.bolts)))

  const hs = buildHeadset(L)
  records.push(rec('cockpit.headset.cup', 'Headset upper cup', 'alu', {
    Size: 'Ø34 mm', Fit: 'press fit',
  }, setTol(hs.cup)))
  records.push(rec('cockpit.headset.bearing', 'Headset upper bearing', 'steel', {
    Size: 'Ø41 x 6.5 mm', Type: 'cartridge',
  }, setTol(hs.bearing)))
  records.push(rec('cockpit.headset.ring', 'Compression ring', 'alu', {
    Size: 'Ø30 mm', Type: 'split cone',
  }, setTol(hs.cone)))
  records.push(rec('cockpit.spacers', 'Headset spacers', 'alu', {
    Stack: '15.8 mm', Count: '3', Size: 'Ø34.4 x 28.9',
  }, setTol(group(...hs.spacers))))
  records.push(rec('cockpit.topcap', 'Top cap and bolt', 'alu', {
    Size: 'Ø34 mm', Bolt: 'M6',
  }, setTol(group(hs.cap, hs.capBolt))))

  const sp = buildSeatpost(L)
  records.push(rec('cockpit.seatpost', 'Seatpost', 'carbon', {
    Size: 'Ø27.2 x 350 mm', Exposed: '190 mm',
  }, setTol(sp.post)))
  records.push(rec('cockpit.seatpost.clamp', 'Seatpost clamp head', 'alu', {
    Bolts: '2 x M6', Type: '2-bolt micro adjust',
  }, setTol(group(sp.mast, sp.head, sp.cradle, sp.bolts))))

  const sd = buildSaddle(L)
  records.push(rec('cockpit.saddle.shell', 'Saddle shell', 'carbon', {
    Size: '272 x 143 mm', Channel: '100 x 24 mm', Profile: 'nose dip 8 mm, tail kick 7 mm',
  }, setTol(sd.shell)))
  records.push(rec('cockpit.saddle.padding', 'Saddle padding', 'rubber', {
    Thickness: `${SADDLE.pad} mm`, Edge: 'rounded, r3.4',
  }, setTol(sd.padding)))
  records.push(rec('cockpit.saddle.cover', 'Saddle cover', 'leather', {
    Thickness: `${SADDLE.cover} mm`, Top: `y = ${L.saddleTop.y.toFixed(1)}`,
  }, setTol(sd.cover)))
  records.push(rec('cockpit.saddle.rails', 'Saddle rails', 'steel', {
    Size: '2 x Ø7 mm', Spacing: '44 mm',
  }, setTol(sd.rails)))

  return records
}

/* -------------------------------------------------------------- self test -- */

export function checkCockpit(L = layout()) {
  const records = buildCockpit(L)
  const rows = verify(records)
  printTable(rows)
  const by = (id) => rows.find((r) => r.id === id)

  // targeted checks
  const barRow = by('cockpit.bar')
  const bar = records.find((r) => r.id === 'cockpit.bar').object
  const bb = new THREE.Box3().setFromObject(bar)
  const size = bb.getSize(new THREE.Vector3())
  console.log('\nbar bbox        ', size.toArray().map((n) => n.toFixed(1)).join(' x '),
    '(width 420, reach/drop measured off the clamp)')
  console.log('bar z extent    ', bb.min.z.toFixed(1), '..', bb.max.z.toFixed(1))
  console.log('bar clamp       ', L.barCenter.toArray().map((n) => n.toFixed(1)).join(', '))
  console.log('bar drop ends y ', bb.min.y.toFixed(1), 'vs barCentre-128 =', (L.barCenter.y - 128).toFixed(1))

  const saddle = records.filter((r) => r.id.startsWith('cockpit.saddle')).map((r) => r.object)
  const sb = new THREE.Box3()
  for (const o of saddle) sb.expandByObject(o)
  console.log('saddle bbox     ', sb.getSize(new THREE.Vector3()).toArray().map((n) => n.toFixed(1)).join(' x '),
    ' top y =', sb.max.y.toFixed(2), ' target', L.saddleTop.y.toFixed(2))

  const post = records.find((r) => r.id === 'cockpit.seatpost').object
  const pb = new THREE.Box3().setFromObject(post)
  console.log('seatpost        ', (pb.max.y - pb.min.y).toFixed(0), 'mm of bbox height; 350 mm along the seat axis,',
    'the top', L.seatpostTop.distanceTo(L.seatTop).toFixed(0), 'mm above the seat tube')

  // the bar must be there where the STI levers clamp it: barCentre +/- 105, bar surface present
  const inside = (obj, p) => {
    obj.updateMatrixWorld(true)
    const q = p.clone().applyMatrix4(obj.matrixWorld.clone().invert())
    return obj.contains(q)
  }
  for (const s of [-1, 1]) {
    const onAxis = L.barCenter.clone().add(v3(1.2, -0.4, s * 105))
    const skin = L.barCenter.clone().add(v3(1.2, -0.4 + 11.5, s * 105))
    console.log(`lever clamp z=${s * 105}: centre inside ${inside(bar, onAxis)}, 11.5 mm up inside ${inside(bar, skin)}`)
  }

  setTol(records.map((r) => r.object), 0.25)
  const objs = records.map((r) => r.object)
  writeFileSync('/tmp/cockpit.png', render(objs, {
    view: { azimuth: deg(38), elevation: deg(20) }, size: [1300, 820], background: '#eef2f7',
  }).data)
  // a close-up of the bar and stem for the record
  writeFileSync('/tmp/cockpit-front.png', render([
    records[0].object, records[1].object, records[2].object, records[3].object,
    records[4].object, records[5].object, records[6].object, records[7].object, records[8].object,
  ], {
    view: { azimuth: deg(28), elevation: deg(14) }, size: [1100, 760], background: '#eef2f7',
  }).data)
  // details: the headset stack from the left, and the clamp / rails from below
  writeFileSync('/tmp/cockpit-detail.png', render([
    records[4].object, records[5].object, records[6].object, records[7].object, records[8].object,
    records[1].object,
  ], { view: 'left', size: [900, 700], background: '#eef2f7' }).data)
  writeFileSync('/tmp/cockpit-saddle.png', render([
    records[10].object, records[11].object, records[12].object, records[13].object, records[14].object,
  ], {
    view: { azimuth: deg(150), elevation: deg(-18) }, size: [1000, 700], background: '#eef2f7',
  }).data)
  console.log('\nwrote /tmp/cockpit.png, /tmp/cockpit-front.png, /tmp/cockpit-detail.png, /tmp/cockpit-saddle.png')
  return { records, rows }
}

if (import.meta.url === `file://${process.argv[1]}`) checkCockpit()
