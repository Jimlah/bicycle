/**
 * Drivetrain: bottom bracket, crankset, chainrings, pedals, 11-speed cassette, chain,
 * rear derailleur, front derailleur, STI levers.
 *
 * World coordinates, mm, Y up, +X forward, +Z drive side. Everything is modelled in world
 * coordinates at the real place it belongs.
 *
 * The chain path is solved, not drawn: the five tangents (ring, 19 t cog, both jockeys) are
 * found as true tangent lines and the lower jockey's distance is solved so that the closed
 * path is exactly 116 x 12.7 mm. `node parts/drivetrain.mjs` prints the numbers and writes
 * /tmp/drivetrain.png and /tmp/chain.png.
 */
import * as THREE from 'three'
import {
  Cylinder, Box, Ball, Ellipse, Circle, Polygon, RoundedRectangle, RegularPolygon,
  Rectangle, Torus, loft, render,
} from '@classcad/smlibpy-three'
import {
  v3, tube, pipe, discZ, ringZ, torusZ, latheY, band, along, centered, boxAt,
  sprocket, profile, deg,
} from '../lib/geo.mjs'
import { safeFillet } from '../lib/solid.mjs'
import { layout, P } from '../lib/bike.mjs'
import { writeFileSync } from 'node:fs'

// ---------------------------------------------------------------------------------------------
// dimensions (mm)
// ---------------------------------------------------------------------------------------------
export const D = {
  // bottom bracket
  shellW: 68,            // frame's BB shell, z -34 .. +34
  cupZ: 34,              // shell's outboard face
  cupHexR: 21.6,         // octagonal spanner flange, across corners 43.2
  cupHexLen: 2.8,
  cupBodyZ: 38.6,        // round housing ends here
  bearingRO: 18.5, bearingRI: 12.1, bearingLen: 7,
  spindleR: 12, spindleBore: 8.5, spindleLen: 86,
  // crankset
  crankLen: 172.5, armZ: 47.5, armT: 13,
  bossR: 15,             // spindle boss Ø30
  spindleBoreR: 12.15,   // Ø24.3 crank bore
  pedalEyeR: 9, pedalHoleR: 4.5,
  bcd: 110, boltR: 55, boltHoleR: 5.1,
  // chainrings
  ring1Z: 43.5, ring1T: 2.0, ring2Z: 37.5, ring2T: 1.5,
  // pedals
  pedalL: 90, pedalW: 62, pedalT: 16,
  // cassette
  cogZ0: 22, cogPitch: 3.9, cogT: 1.7, spacerT: 2.2,
  cogTeeth: [32, 28, 24, 21, 19, 17, 15, 14, 13, 12, 11],
  // chain
  pitch: 12.7, links: 116,
  plateT: 0.9, rollerRO: 3.875, rollerRI: 1.55, pinR: 1.55, rollerHalf: 1.09,
  innerPlateZ: 1.54, outerPlateZ: 2.44,
  // derailleurs
  jockeyTeeth: 11, jockeyT: 4,
  fdClampR: 15.9,
  // cockpit
  barR: 15.9, leverZ: 105,
}

const R_PITCH = (t) => D.pitch / (2 * Math.sin(Math.PI / t))

// ---------------------------------------------------------------------------------------------
// small builders
// ---------------------------------------------------------------------------------------------

/** Cylinder on the Z axis, centred on zc. */
function cylZ(r, len, x, y, zc, r2 = r) {
  const c = new Cylinder(r2, r, len)
  c.rotation.x = Math.PI / 2
  c.position.set(x, y, zc)
  return c
}

/** Solid annulus on the Z axis from z0 to z1 (a lathe, so no boolean needed). */
function ringAtZ(rO, rI, z0, z1, x = 0, y = 0) {
  const o = latheY(band([[rO, z0], [rO, z1]], [[rI, z0], [rI, z1]]))
  o.rotation.x = Math.PI / 2
  o.position.set(x, y, 0)
  return o
}

/** Extruded sketch, centred on (x, y, zc) along Z. */
function prismZ(shape, len, x, y, zc) {
  const p = shape.extrude(len)
  p.position.set(x, y, zc - len / 2)
  return p
}

/** Rounded-rectangle outline as a polygon, for lofts. */
function rrectPts(w, h, r) {
  const pts = []
  const hw = w / 2 - r, hh = h / 2 - r
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (i / 8) * (Math.PI / 2)
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  corner(hw, hh, 0)
  corner(-hw, hh, Math.PI / 2)
  corner(-hw, -hh, Math.PI)
  corner(hw, -hh, (3 * Math.PI) / 2)
  return pts
}

/** A tapered, slightly pinched oval (a forged crank-arm section). */
function ovalPts(rx, ry, pinch = 0.18, n = 40) {
  const out = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const c = Math.cos(a), s = Math.sin(a)
    const k = 1 - pinch * Math.abs(c) ** 1.8
    out.push([rx * c * k, ry * s * k])
  }
  return out
}

/**
 * Loft sections along a path. `sizes[i]` is [width, thickness] in the section's own frame
 * (width along x of the frame, thickness along y). `up` fixes the frame: x = t x up.
 */
function loftAlong(points, sizes, { up = v3(0, 0, 1), pinch = 0.18, kind = 'ellipse' } = {}) {
  const pts = points.map((p) => (p.isVector3 ? p : v3(...p)))
  const shapes = pts.map((p, i) => {
    const next = pts[Math.min(i + 1, pts.length - 1)]
    const prev = pts[Math.max(i - 1, 0)]
    const t = new THREE.Vector3().subVectors(next, prev).normalize()
    let x = new THREE.Vector3().crossVectors(t, up)
    if (x.lengthSq() < 1e-8) x = new THREE.Vector3().crossVectors(t, v3(1, 0, 0))
    x.normalize()
    const y = new THREE.Vector3().crossVectors(t, x).normalize()
    const [w, h] = sizes[i]
    const s = kind === 'rect' ? profile(rrectPts(w, h, Math.min(w, h) * 0.28))
      : kind === 'ellipse' ? new Ellipse(w / 2, h / 2)
        : profile(ovalPts(w / 2, h / 2, pinch))
    s.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, t))
    s.position.copy(p)
    s.updateMatrixWorld(true)
    return s
  })
  return loft(shapes)
}

/** Ribbon outline through points, half-widths given per point. Rounded ends. */
function ribbon(pts, half, { caps = true } = {}) {
  const P3 = pts.map((p) => (p.isVector3 ? p.clone() : v3(...p)))
  const left = [], right = [], norms = []
  for (let i = 0; i < P3.length; i++) {
    const prev = P3[Math.max(0, i - 1)], next = P3[Math.min(P3.length - 1, i + 1)]
    const t = new THREE.Vector3().subVectors(next, prev).normalize()
    const n = new THREE.Vector3().crossVectors(t, v3(0, 0, 1)).normalize()
    norms.push(n)
    left.push(P3[i].clone().addScaledVector(n, half[i]))
    right.push(P3[i].clone().addScaledVector(n, -half[i]))
  }
  const out = [...left]
  if (caps) {
    const n = norms[norms.length - 1]
    const t = new THREE.Vector3().subVectors(P3[P3.length - 1], P3[P3.length - 2]).normalize()
    const w = half[half.length - 1]
    for (let k = 1; k < 6; k++) {
      const a = (k / 6) * Math.PI
      const p = P3[P3.length - 1].clone()
        .addScaledVector(n, w * Math.cos(a)).addScaledVector(t, w * Math.sin(a))
      out.push(p)
    }
  }
  out.push(...right.slice().reverse())
  if (caps) {
    const n = norms[0]
    const t = new THREE.Vector3().subVectors(P3[0], P3[1]).normalize()
    const w = half[0]
    for (let k = 1; k < 6; k++) {
      const a = (k / 6) * Math.PI
      const p = P3[0].clone()
        .addScaledVector(n, -w * Math.cos(a)).addScaledVector(t, w * Math.sin(a))
      out.push(p)
    }
  }
  return out
}

/** Annular sector outline around (cx, cy) in XY. */
function sectorPts(cx, cy, r0, r1, a0, a1, n = 18) {
  const out = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push([cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)])
  }
  for (let i = n; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push([cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)])
  }
  return out
}

const hexBoltZ = (headR, headLen, shankR, shankLen, x, y, zFace, dir = 1) => {
  const head = prismZ(new RegularPolygon(headR, 6), headLen, x, y, zFace + dir * headLen / 2)
  const shank = cylZ(shankR, shankLen, x, y, zFace - dir * (shankLen / 2 - 0.2))
  return head.fuse(shank)
}

// ---------------------------------------------------------------------------------------------
// chain path  (solved: tangent lines + arcs, all pulleys wrapped the same way round)
// ---------------------------------------------------------------------------------------------

const V2 = (x, y) => new THREE.Vector2(x, y)

function extTangents(a, ra, b, rb) {
  const d = b.clone().sub(a), Dd = d.length(), dh = d.clone().divideScalar(Dd)
  const out = []
  for (const kind of [1, -1]) {          // kind +1: both wrapped the same way, -1: crossed
    const c = (ra - kind * rb) / Dd
    if (Math.abs(c) > 1) continue
    const h = Math.sqrt(Math.max(0, 1 - c * c))
    const perp = new THREE.Vector2(-dh.y, dh.x)
    for (const sg of [1, -1]) {
      const n = dh.clone().multiplyScalar(c).addScaledVector(perp, sg * h)
      const pa = a.clone().addScaledVector(n, ra)
      const pb = b.clone().addScaledVector(n, kind * rb)
      const t = pb.clone().sub(pa)
      out.push({ n, pa, pb, kind, len: t.length(), t: t.clone().normalize() })
    }
  }
  return out
}

const angOf = (p, c) => Math.atan2(p.y - c.y, p.x - c.x)
const velAt = (th, s) => new THREE.Vector2(-Math.sin(th) * s, Math.cos(th) * s)

/**
 * The chain's closed path. Returns the pulleys, the ordered segments (lines and arcs, each
 * with its z at both ends) and the exact 3D length. The jockey positions are the ones the
 * chain actually uses - the rear derailleur is built around them.
 */
export function solveChainPath(L, { jockey1, cageDir, upperZ, ringZ }) {
  const ring = { c: V2(L.bb.x, L.bb.y), r: R_PITCH(50), z: ringZ, name: 'ring' }
  const cog = { c: V2(L.rearHub.x, L.rearHub.y), r: R_PITCH(19), z: upperZ, name: 'cog19' }
  const j1 = { c: jockey1.clone ? jockey1.clone() : V2(jockey1.x, jockey1.y), r: R_PITCH(D.jockeyTeeth), z: upperZ, name: 'jockey.upper' }
  const pul = (dist) => ({
    c: j1.c.clone().addScaledVector(cageDir, dist), r: j1.r, z: upperZ, name: 'jockey.lower',
  })

  const build = (j2) => {
    const P = [ring, cog, j1, j2]
    const opts = P.map((p, i) => extTangents(p.c, p.r, P[(i + 1) % 4].c, P[(i + 1) % 4].r))
    const found = []
    const idx = [0, 0, 0, 0]
    const walk = (si) => {
      if (si === 4) {
        const sel = idx.map((k, i) => opts[i][k])
        const dep = [], arr = []
        for (let i = 0; i < 4; i++) {
          dep[i] = { th: angOf(sel[i].pa, P[i].c), t: sel[i].t }
          arr[i] = { th: angOf(sel[(i + 3) % 4].pb, P[i].c), t: sel[(i + 3) % 4].t }
        }
        const senses = [], wraps = []
        for (let i = 0; i < 4; i++) {
          const s = velAt(dep[i].th, 1).distanceTo(dep[i].t) < velAt(dep[i].th, -1).distanceTo(dep[i].t) ? 1 : -1
          senses.push(s)
          if (velAt(arr[i].th, s).distanceTo(arr[i].t) > 1e-6) return
          let w = s > 0 ? dep[i].th - arr[i].th : arr[i].th - dep[i].th
          while (w < -1e-9) w += 2 * Math.PI
          while (w > 2 * Math.PI) w -= 2 * Math.PI
          wraps.push(w)
        }
        found.push({ P, sel, senses, wraps, dep, arr })
        return
      }
      for (let k = 0; k < opts[si].length; k++) { idx[si] = k; walk(si + 1) }
    }
    walk(0)
    // the physical path: ring and cog wrapped forward, the guide pulley backwards, the
    // tension pulley forward again - one continuous run without the chain crossing itself
    return found.find((f) => f.senses[0] === 1 && f.senses[1] === 1 && f.senses[2] === -1 && f.senses[3] === 1) || null
  }

  const length3 = (j2, path) => {
    let sum = 0
    for (let i = 0; i < 4; i++) {
      const a = path.sel[i]
      const dz = path.P[(i + 1) % 4].z - path.P[i].z
      sum += Math.hypot(a.len, dz)
      sum += path.wraps[i] * path.P[i].r
    }
    return sum
  }

  const target = D.links * D.pitch
  let lo = 20, hi = 260, best = null
  for (let it = 0; it < 70; it++) {
    const mid = (lo + hi) / 2
    const p = build(pul(mid))
    if (!p) { hi = mid; continue }
    const len = length3(null, p)
    best = { dist: mid, p, len }
    if (len < target) lo = mid; else hi = mid
  }
  const dist = (lo + hi) / 2
  const p = build(pul(dist))
  const j2 = pul(dist)

  // ordered segments, starting where the chain leaves the ring at the top
  const segs = []
  const zOf = [ring.z, cog.z, j1.z, j2.z]
  for (let i = 0; i < 4; i++) {
    const a = path0(i)
    segs.push({
      type: 'line', z0: zOf[i], z1: zOf[(i + 1) % 4],
      p0: a.pa, p1: a.pb,
    })
    const j = (i + 1) % 4
    const arrTh = p.arr[j].th
    const depTh = p.dep[j].th
    const s = p.senses[j]
    let w = s > 0 ? depTh - arrTh : arrTh - depTh
    while (w < 0) w += 2 * Math.PI
    segs.push({
      type: 'arc', c: p.P[j].c, r: p.P[j].r, a0: arrTh, dir: s,
      wrap: w, z0: zOf[j], z1: zOf[j],
    })
  }
  function path0(i) { return p.sel[i] }

  // closed polyline, sampled
  const samples = []
  let acc = 0
  const push = (x, y, z) => {
    if (samples.length) {
      const q = samples[samples.length - 1]
      acc += Math.hypot(x - q.x, y - q.y, z - q.z)
    }
    samples.push({ x, y, z, s: acc })
  }
  for (const sg of segs) {
    if (sg.type === 'line') {
      const n = Math.max(2, Math.ceil(sg.p0.distanceTo(sg.p1)))
      for (let k = 0; k <= n; k++) {
        const f = k / n
        push(
          sg.p0.x + (sg.p1.x - sg.p0.x) * f,
          sg.p0.y + (sg.p1.y - sg.p0.y) * f,
          sg.z0 + (sg.z1 - sg.z0) * f,
        )
      }
    } else {
      const n = Math.max(3, Math.ceil((sg.wrap * sg.r) / 1.2))
      for (let k = 0; k <= n; k++) {
        const f = k / n
        const a = sg.a0 + sg.dir * sg.wrap * f
        push(sg.c.x + sg.r * Math.cos(a), sg.c.y + sg.r * Math.sin(a), sg.z0)
      }
    }
  }
  // close the loop
  const first = samples[0], last = samples[samples.length - 1]
  acc += Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z)
  samples.push({ x: first.x, y: first.y, z: first.z, s: acc })

  return {
    pulleys: { ring, cog, upper: j1, lower: j2 },
    segs, samples, length: acc, pitch: acc / D.links,
    wrapsDeg: p.wraps.map((w) => (w * 180) / Math.PI),
    senses: p.senses,
    jockeyUpper: j1.c, jockeyLower: j2.c,
    cageDist: dist,
  }
}

// ---------------------------------------------------------------------------------------------
// bottom bracket
// ---------------------------------------------------------------------------------------------

function buildBottomBracket(L) {
  const bx = L.bb.x, by = L.bb.y
  const recs = []
  const side = (s) => {
    const zf = s * D.cupZ                    // shell's outer face
    const housing = cylZ(21, 4.6, bx, by, s * (D.cupZ + 2.3))
    const hex = prismZ(new RegularPolygon(D.cupHexR, 8), D.cupHexLen, bx, by, s * (D.cupZ + 4.6 + D.cupHexLen / 2))
    const spigot = cylZ(17.4, 6.2, bx, by, s * (D.cupZ - 3.1))
    let cup = housing.fuse(hex, spigot)
    // bearing seat (Ø37) and clearance for the spindle
    const seat = cylZ(D.bearingRO + 0.1, 8.4, bx, by, s * (D.cupZ + 4.0))
    const bore = cylZ(12.2, 6.5, bx, by, s * (D.cupZ - 3.5))
    cup = cup.cut(seat, bore)
    // eight spanner notches around the flange's face
    const notches = []
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      notches.push(cylZ(2.1, 3.0, bx + 19.6 * Math.cos(a), by + 19.6 * Math.sin(a), s * (D.cupZ + 4.6 + D.cupHexLen + 0.4)))
    }
    cup = cup.cut(...notches)
    const bearing = ringAtZ(D.bearingRO, D.bearingRI, ...(s > 0 ? [D.cupZ + 0.25, D.cupZ + 0.25 + D.bearingLen] : [-D.cupZ - 0.25 - D.bearingLen, -D.cupZ - 0.25]), bx, by)
    return { cup, bearing }
  }
  const d = side(1), n = side(-1)
  recs.push({
    id: 'drivetrain.bb.cup.drive', name: 'BB cup, drive side', assembly: 'drivetrain', material: 'alu',
    density: 2.7, object: d.cup,
    spec: { Type: 'Threaded, outboard bearing', Thread: 'Ø34.8 × 24 tpi', Width: '68 mm shell', 'Spanner': '8-notch flange Ø43' },
  })
  recs.push({
    id: 'drivetrain.bb.cup.nondrive', name: 'BB cup, non-drive side', assembly: 'drivetrain', material: 'alu',
    density: 2.7, object: n.cup,
    spec: { Type: 'Threaded, outboard bearing', Thread: 'Ø34.8 × 24 tpi', Width: '68 mm shell' },
  })
  const bearings = new THREE.Group()
  bearings.add(d.bearing, n.bearing)
  recs.push({
    id: 'drivetrain.bb.bearings', name: 'BB bearings', assembly: 'drivetrain', material: 'steel',
    density: 7.85, object: bearings,
    spec: { Size: 'Ø37 × Ø24.2 × 7', Type: 'Sealed cartridge', Count: '2' },
  })
  const spindle = ringAtZ(D.spindleR, D.spindleBore, -D.spindleLen / 2, D.spindleLen / 2, bx, by)
  recs.push({
    id: 'drivetrain.bb.spindle', name: 'Hollowtech spindle', assembly: 'drivetrain', material: 'steel',
    density: 7.85, object: spindle,
    spec: { Diameter: 'Ø24 hollow', Length: '86 mm', Bore: 'Ø17' },
  })
  return recs
}

// ---------------------------------------------------------------------------------------------
// crankset + chainrings
// ---------------------------------------------------------------------------------------------

function buildCrankset(L) {
  const bx = L.bb.x, by = L.bb.y
  const crankA = deg(-22)                       // drive arm: forward and a little down
  const dirD = v3(Math.cos(crankA), Math.sin(crankA), 0)
  const pedalD = v3(bx + dirD.x * D.crankLen, by + dirD.y * D.crankLen, L.crankZ)
  const pedalN = v3(bx - dirD.x * D.crankLen, by - dirD.y * D.crankLen, -L.crankZ)

  const armBody = (armDir, z, withSpider) => {
    const base = v3(bx, by, z)
    const at = (d) => base.clone().addScaledVector(armDir, d)
    // tapered, ovalised forged section: 30x13 at the boss, 22x14 through the spider,
    // 16x11 at the pedal eye
    const path = [6, 26, 55, 85, 115, 145, 166].map(at)
    const sizes = [[30, 13], [24, 14], [21, 13.5], [19.5, 13], [18, 12], [17, 11.5], [16, 11]]
    let arm = loftAlong(path, sizes, { up: v3(0, 0, 1) })
    const boss = cylZ(D.bossR, D.armT, bx, by, z)
    const eye = cylZ(9.5, D.armT + 1, at(D.crankLen).x, at(D.crankLen).y, z)
    let body = arm.fuse(boss, eye)
    // hollow-forged dish milled into the inboard face
    const inb = z > 0 ? -1 : 1
    const dish = new Ball(10)
    dish.scale.set(5.6, 0.74, 0.2)
    dish.rotation.z = Math.atan2(armDir.y, armDir.x)
    dish.position.set(base.x + armDir.x * 86, base.y + armDir.y * 86, z + inb * 5.4)
    body = body.cut(dish)
    // round the boss-to-arm transition
    body.updateMatrixWorld(true)
    const seam = body.edges().concave().filter((e) => {
      const c = e.getWorldPosition(new THREE.Vector3())
      return c.distanceTo(base) < 34 && Math.abs(c.z - z) < 9
    })
    if (seam.length) {
      const [f] = safeFillet(body, seam, [3, 2.4, 2, 1.5])
      if (f && f.isValid()) body = f
    }
    if (withSpider) {
      const spokes = []
      for (let k = 0; k < 4; k++) {
        const a = crankA + Math.PI / 4 + (k * Math.PI) / 2
        const p = (r, dz) => v3(bx + r * Math.cos(a), by + r * Math.sin(a), z + dz)
        spokes.push(loftAlong([p(18, 0.6), p(36, -1.2), p(50, -3.2), p(58, -4.0)],
          [[28, 10], [24, 8], [22, 7], [21, 6.5]], { up: v3(0, 0, 1), pinch: 0.15 }))
      }
      body = body.fuse(...spokes)
    }
    // spindle bore + pedal thread
    body = body.cut(
      cylZ(D.spindleBoreR, 30, bx, by, z),
      cylZ(D.pedalHoleR, 30, at(D.crankLen).x, at(D.crankLen).y, z),
    )
    return body
  }

  const drive = armBody(dirD, L.crankZ, true)
  const nonDrive = armBody(dirD.clone().negate(), -L.crankZ, false)
  drive.tolerance = 0.12
  nonDrive.tolerance = 0.12

  // bolt holes through the spider's ends
  const boltHoles = []
  for (let k = 0; k < 4; k++) {
    const a = crankA + Math.PI / 4 + (k * Math.PI) / 2
    boltHoles.push(cylZ(D.boltHoleR, 20, bx + D.boltR * Math.cos(a), by + D.boltR * Math.sin(a), L.crankZ - 2))
  }
  const driveHoles = drive.cut(...boltHoles)

  return {
    drive: driveHoles, nonDrive, pedalD, pedalN, crankA,
    records: [
      {
        id: 'drivetrain.crank.drive', name: 'Crank arm, drive side', assembly: 'drivetrain', material: 'alu',
        density: 2.7, object: driveHoles,
        spec: {
          Length: '172.5 mm', 'Chainline': `${L.chainringZ} mm`, Spider: '4-arm, 110 mm BCD',
          Section: 'Hollow-forged tapered oval', Boss: 'Ø34 spindle boss',
        },
      },
      {
        id: 'drivetrain.crank.nondrive', name: 'Crank arm, non-drive side', assembly: 'drivetrain', material: 'alu',
        density: 2.7, object: nonDrive,
        spec: { Length: '172.5 mm', Section: 'Hollow-forged tapered oval', Boss: 'Ø34 spindle boss' },
      },
    ],
  }
}

function buildChainrings(L) {
  const bx = L.bb.x, by = L.bb.y
  const crankA = deg(-22)
  const holes = []
  const slots = []
  for (let k = 0; k < 4; k++) {
    const a = crankA + Math.PI / 4 + (k * Math.PI) / 2
    const h = new Circle(D.boltHoleR)
    h.position.set(D.boltR * Math.cos(a), D.boltR * Math.sin(a), 0)
    holes.push(h)
    // lightening slot between two bolts, kept clear of the tooth roots
    const r = new RoundedRectangle(38, 16, 7)
    r.position.set(72 * Math.cos(a + Math.PI / 4), 72 * Math.sin(a + Math.PI / 4), 0)
    r.rotation.z = a + Math.PI / 4
    slots.push(r)
  }
  const r50 = sprocket({ teeth: 50, thickness: D.ring1T, center: v3(bx, by, L.chainringZ), holes: [...holes, ...slots] })

  // spider-shaped inner carrier: a hub with four arms out to the bolt circle
  const carrierZ = L.chainringZ - D.ring1T / 2 - 1.25
  const carrier = []
  const hub = cylZ(32, 2.5, bx, by, carrierZ)
  carrier.push(hub)
  for (let k = 0; k < 4; k++) {
    const a = crankA + Math.PI / 4 + (k * Math.PI) / 2
    const arm = prismZ(new RoundedRectangle(46, 26, 11), 2.5,
      bx + 44 * Math.cos(a), by + 44 * Math.sin(a), carrierZ)
    arm.rotation.z = a
    carrier.push(arm)
  }
  let c50 = carrier[0].fuse(...carrier.slice(1)).fuse(r50)

  // the 34 t ring, 6 mm inboard
  const holes2 = []
  for (let k = 0; k < 4; k++) {
    const a = crankA + Math.PI / 4 + (k * Math.PI) / 2
    const h = new Circle(D.boltHoleR)
    h.position.set(D.boltR * Math.cos(a), D.boltR * Math.sin(a), 0)
    holes2.push(h)
  }
  const r34 = sprocket({ teeth: 34, thickness: D.ring2T, center: v3(bx, by, D.ring2Z), holes: holes2 })

  // four chainring bolts: Ø14 head outboard, Ø8 shank, Ø14 nut inboard
  const bolts = new THREE.Group()
  for (let k = 0; k < 4; k++) {
    const a = crankA + Math.PI / 4 + (k * Math.PI) / 2
    const x = bx + D.boltR * Math.cos(a), y = by + D.boltR * Math.sin(a)
    bolts.add(prismZ(new RegularPolygon(7, 6), 2.6, x, y, L.chainringZ + D.ring1T / 2 + 1.3))
    bolts.add(cylZ(4, 8.2, x, y, L.chainringZ - 3.9))
    bolts.add(prismZ(new RegularPolygon(7, 6), 2.4, x, y, D.ring2Z - D.ring2T / 2 - 1.2))
  }
  c50.tolerance = 0.25
  r34.tolerance = 0.25
  return [
    {
      id: 'drivetrain.chainring.50', name: 'Chainring 50 t', assembly: 'drivetrain', material: 'alu',
      density: 2.7, object: c50,
      spec: { Teeth: '50', BCD: '110 mm, 4-arm', Thickness: '2.0 mm', Chainline: `${L.chainringZ} mm`, Pitch: '1/2 in' },
    },
    {
      id: 'drivetrain.chainring.34', name: 'Chainring 34 t', assembly: 'drivetrain', material: 'alu',
      density: 2.7, object: r34,
      spec: { Teeth: '34', BCD: '110 mm, 4-arm', Thickness: '1.5 mm', Offset: '6 mm inboard of the 50 t' },
    },
    {
      id: 'drivetrain.chainring.bolts', name: 'Chainring bolts', assembly: 'drivetrain', material: 'steel',
      density: 7.85, object: bolts,
      spec: { Count: '4 sets', Type: 'Ø8 shank, Ø14 hex head and nut' },
    },
  ]
}

// ---------------------------------------------------------------------------------------------
// pedals
// ---------------------------------------------------------------------------------------------

function buildPedals(L) {
  const crankA = deg(-22)
  const dir = v3(Math.cos(crankA), Math.sin(crankA), 0)
  const recs = []
  for (const s of [1, -1]) {
    const armEnd = v3(L.bb.x + s * dir.x * D.crankLen, L.bb.y + s * dir.y * D.crankLen, 0)
    const grp = new THREE.Group()
    grp.position.set(armEnd.x, armEnd.y, 0)
    grp.rotation.z = s > 0 ? crankA : crankA + Math.PI
    const zc = s * (L.crankZ + D.armT / 2 + 1.5 + D.pedalW / 2)   // body centre, along the axle

    // platform: 90 fore-aft (X) x 62 across (Z) x 16 thick (Y), corners rounded
    let body = new RoundedRectangle(D.pedalL, D.pedalW, 7).extrude(D.pedalT)
    body.rotation.x = -Math.PI / 2
    body.position.set(0, -D.pedalT / 2, zc)
    body.updateMatrixWorld(true)
    // axle bore, then the cage outline: three through windows leaving a rim and two cross bars
    const bore = cylZ(6.3, 70, 0, 0, zc)
    const windows = []
    for (const wx of [-26, 0, 26]) {
      const w = new RoundedRectangle(19, 42, 5).extrude(D.pedalT + 6)
      w.rotation.x = -Math.PI / 2
      w.position.set(wx, 0, zc)
      windows.push(w)
    }
    body = body.cut(bore, ...windows)
    body.tolerance = 0.25

    // steel axle: threaded stub in the crank eye, Ø12 shaft, bearing boss, dust cap
    const stub = cylZ(4.4, 11, 0, 0, s * (L.crankZ + 1.5))
    const shaft = cylZ(6, 58, 0, 0, s * (L.crankZ + 34))
    const boss = cylZ(13, 12, 0, 0, s * (L.crankZ + 21))
    const cap = cylZ(9, 2.5, 0, 0, s * (Math.abs(zc) + D.pedalW / 2 - 1))
    const axle = stub.fuse(shaft, boss)

    // 8 traction pins per side
    const pins = []
    for (const px of [-37, -13, 13, 37]) {
      for (const pz of [-25, 25]) {
        for (const py of [-1, 1]) {
          const pin = new Cylinder(1.5, 1.5, 4.5)
          pin.position.set(px, py * (D.pedalT / 2 + 1.1), zc + pz)
          pins.push(pin)
        }
      }
    }
    // reflector on the outboard end
    const refl = new Box(26, 9, 3)
    refl.position.set(0, 0, zc + s * (D.pedalW / 2 + 1.2))

    grp.add(body, axle, cap, refl, ...pins)
    recs.push({
      id: `drivetrain.pedal.${s > 0 ? 'drive' : 'nondrive'}`,
      name: `Platform pedal, ${s > 0 ? 'drive' : 'non-drive'} side`,
      assembly: 'drivetrain', material: 'alu', density: 2.7, object: grp,
      spec: {
        Platform: '90 × 62 × 16 mm', Pins: '8 per side', Axle: 'Steel Ø12', Reflector: 'Yes',
        'Body centre': `z ${zc.toFixed(1)} mm`, Angle: 'Aligned with the crank arm',
      },
    })
  }
  return recs
}

// ---------------------------------------------------------------------------------------------
// cassette
// ---------------------------------------------------------------------------------------------

function buildCassette(L) {
  const cx = L.rearHub.x, cy = L.rearHub.y
  const recs = []
  const zOf = (i) => D.cogZ0 + i * D.cogPitch + D.cogT / 2
  const big = [0, 1, 2]
  D.cogTeeth.forEach((t, i) => {
    const zc = zOf(i)
    const holes = []
    if (big.includes(i)) {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.3
        const r = 0.56 * R_PITCH(t)
        const h = new Circle(4.2)
        h.position.set(r * Math.cos(a), r * Math.sin(a), 0)
        holes.push(h)
      }
    }
    const cog = sprocket({ teeth: t, thickness: D.cogT, center: v3(cx, cy, zc), holes })
    cog.tolerance = 0.25
    recs.push({
      id: `drivetrain.cassette.cog.${t}t`, name: `Cassette cog ${t} t`, assembly: 'drivetrain', material: 'steel',
      density: 7.85, object: cog,
      spec: { Teeth: `${t}`, Thickness: '1.7 mm', Pitch: '1/2 in', 'Spacing': '3.9 mm', Position: `z ${zc.toFixed(1)} mm` },
    })
  })

  // spacers in each gap
  const sp = new THREE.Group()
  for (let i = 0; i < D.cogTeeth.length - 1; i++) {
    const z0 = D.cogZ0 + i * D.cogPitch + D.cogT
    sp.add(ringAtZ(23, 17, z0, z0 + (D.cogPitch - D.cogT), cx, cy))
  }
  recs.push({
    id: 'drivetrain.cassette.spacers', name: 'Cassette spacers', assembly: 'drivetrain', material: 'alu',
    density: 2.7, object: sp, spec: { Count: '10', Thickness: '2.2 mm' },
  })

  // the three biggest cogs ride on a 4-arm aluminium carrier
  const carrier = []
  carrier.push(ringAtZ(24, 15, D.cogZ0, D.cogZ0 + 2.6, cx, cy))
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4
    const arm = prismZ(new RoundedRectangle(48, 22, 9), 2.6, cx + 38 * Math.cos(a), cy + 38 * Math.sin(a), D.cogZ0 + 1.3)
    arm.rotation.z = a
    carrier.push(arm)
  }
  const car = carrier[0].fuse(...carrier.slice(1))
  recs.push({
    id: 'drivetrain.cassette.carrier', name: 'Cassette spider carrier', assembly: 'drivetrain', material: 'alu',
    density: 2.7, object: car, spec: { Arms: '4', Carries: '32 / 28 / 24 t', Width: '2.6 mm' },
  })

  // lockring over the 11 t
  const zl = zOf(D.cogTeeth.length - 1) + D.cogT / 2
  const lock = prismZ(new RegularPolygon(20, 12), 2.8, cx, cy, zl + 1.4)
  const lockRing = lock.cut(cylZ(15.5, 6, cx, cy, zl + 1.4))
  recs.push({
    id: 'drivetrain.cassette.lockring', name: 'Cassette lockring', assembly: 'drivetrain', material: 'steel',
    density: 7.85, object: lockRing, spec: { Type: '12-notch lockring', Diameter: 'Ø40', Position: `z ${(zl + 1.4).toFixed(1)} mm` },
  })
  return recs
}

// ---------------------------------------------------------------------------------------------
// chain
// ---------------------------------------------------------------------------------------------

function chainLinkShapes() {
  const halfPitch = D.pitch / 2
  const plate = (t, holes) => {
    const n = 16
    const hAt = (x) => 3.85 + 1.0 * Math.abs(x / halfPitch) ** 2.5
    // top edge, end arc, bottom edge, start arc
    const out = []
    for (let i = 0; i <= n; i++) {
      const x = -halfPitch + (2 * halfPitch * i) / n
      out.push([x, hAt(x)])
    }
    for (let i = 1; i < 10; i++) {
      const a = Math.PI / 2 - (i / 10) * Math.PI
      out.push([halfPitch + 4.85 * Math.cos(a), 4.85 * Math.sin(a)])
    }
    for (let i = n - 1; i >= 0; i--) {
      const x = -halfPitch + (2 * halfPitch * i) / n
      out.push([x, -hAt(x)])
    }
    for (let i = 1; i < 10; i++) {
      const a = -Math.PI / 2 - (i / 10) * Math.PI
      out.push([-halfPitch + 4.85 * Math.cos(a), 4.85 * Math.sin(a)])
    }
    let s = profile(out)
    for (const h of holes) s = s.cut(h)
    return s
  }
  const pinHole = () => {
    const h = new Circle(D.pinR + 0.05)
    h.position.set(halfPitch, 0, 0)
    return h
  }
  const holeFar = () => {
    const h = new Circle(D.pinR + 0.05)
    h.position.set(-halfPitch, 0, 0)
    return h
  }
  return { plate, pinHole, holeFar }
}

/** Outer link: two 1 mm plates on the outside plus two pins. */
function outerLinkBody() {
  const { plate, pinHole, holeFar } = chainLinkShapes()
  const z = D.outerPlateZ
  const a = prismZ(plate(1, [pinHole(), holeFar()]), D.plateT, 0, 0, z)
  const b = prismZ(plate(1, [pinHole(), holeFar()]), D.plateT, 0, 0, -z)
  const p1 = cylZ(D.pinR, 2 * z + D.plateT, D.pitch / 2, 0, 0)
  const p2 = cylZ(D.pinR, 2 * z + D.plateT, -D.pitch / 2, 0, 0)
  return a.fuse(b, p1, p2)
}

/** Inner link: two inner plates plus two rollers. */
function innerLinkBody() {
  const { plate, pinHole, holeFar } = chainLinkShapes()
  const z = D.innerPlateZ
  const a = prismZ(plate(1, [pinHole(), holeFar()]), D.plateT, 0, 0, z)
  const b = prismZ(plate(1, [pinHole(), holeFar()]), D.plateT, 0, 0, -z)
  const r1 = ringAtZ(D.rollerRO, D.rollerRI, -D.rollerHalf, D.rollerHalf, D.pitch / 2, 0)
  const r2 = ringAtZ(D.rollerRO, D.rollerRI, -D.rollerHalf, D.rollerHalf, -D.pitch / 2, 0)
  return a.fuse(b, r1, r2)
}

function buildChain(L, path) {
  const outer = outerLinkBody()
  const inner = innerLinkBody()
  outer.tolerance = 0.25
  inner.tolerance = 0.25

  // sample the closed path at any arc length
  const S = path.samples
  const total = path.length
  const at = (s) => {
    let t = s % total
    if (t < 0) t += total
    let lo = 0, hi = S.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (S[mid].s <= t) lo = mid; else hi = mid
    }
    const a = S[lo], b = S[hi]
    const f = b.s === a.s ? 0 : (t - a.s) / (b.s - a.s)
    return new THREE.Vector3(
      a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f,
    )
  }
  const tangentAt = (s) => {
    const d = 1.2
    return at(s + d).sub(at(s - d)).normalize()
  }

  const zAxis = v3(0, 0, 1)
  const mats = []
  for (let i = 0; i < D.links; i++) {
    const sMid = (i + 0.5) * path.pitch
    const p = at(sMid)
    const xA = tangentAt(sMid)
    // frame from the tangent and the chain's own up (world Z), so the plates never twist
    const zA = zAxis.clone().addScaledVector(xA, -zAxis.dot(xA)).normalize()
    const yA = new THREE.Vector3().crossVectors(zA, xA).normalize()
    const m = new THREE.Matrix4().makeBasis(xA, yA, zA)
    m.setPosition(p)
    mats.push(m)
  }
  path.linkCentres = mats.map((m) => new THREE.Vector3().setFromMatrixPosition(m))
  path.linkTangents = mats.map((m) => new THREE.Vector3().setFromMatrixColumn(m, 0))
  const outerMats = mats.filter((_, i) => i % 2 === 0)
  const innerMats = mats.filter((_, i) => i % 2 === 1)
  const outerClones = outer.at(outerMats)
  const innerClones = inner.at(innerMats)

  // one record per 12 links, so the chain reads as a chain but does not flood the part list
  const per = 12
  const recs = []
  let oi = 0, ii = 0
  for (let start = 0; start < D.links; start += per) {
    const g = new THREE.Group()
    for (let k = start; k < Math.min(start + per, D.links); k++) {
      if (k % 2 === 0) g.add(outerClones[oi++]); else g.add(innerClones[ii++])
    }
    recs.push({
      id: `drivetrain.chain.${String(start / per + 1).padStart(2, '0')}`, name: `Chain links ${start + 1}-${Math.min(start + per, D.links)}`,
      assembly: 'drivetrain', material: 'steel', density: 7.85, object: g,
      spec: {
        Pitch: '1/2 in × 11/128 in', Links: `${per} of ${D.links}`, Type: 'Hollow pin, bushingless',
        'Inner width': '2.18 mm',
      },
    })
  }
  return { recs, total: path.length, pitch: path.pitch }
}

// ---------------------------------------------------------------------------------------------
// rear derailleur
// ---------------------------------------------------------------------------------------------

function buildRearDerailleur(L, path) {
  const up = path.jockeyUpper, low = path.jockeyLower
  const jz = path.pulleys.upper.z
  const rj = R_PITCH(D.jockeyTeeth)
  const cx = L.rearHub.x, cy = L.rearHub.y
  const hangerZ = 67                       // the frame's hanger face (z 61..67)
  const hb = v3(cx - 6, cy - 22, hangerZ)  // hanger bolt axis: (-410, 314)

  // ---- parallelogram, in a plane parallel to the cage
  const cagePivot = v3(up.x + 8, up.y + 16, jz)        // (-388, 284, 38.45)
  const Pc = v3(cagePivot.x + 3, cagePivot.y + 3, 0)   // centre of the two P pivots
  const BcRef = v3(cx - 4, cy - 32, 0)                 // centre of the two B pivots
  const dir = Pc.clone().sub(BcRef).setZ(0).normalize()
  const Bc = BcRef.clone()
  const perp = v3(-dir.y, dir.x, 0)
  const sep = 9
  const pz = jz + 7.5, bz = jz + 7.5
  const B0 = Bc.clone().addScaledVector(perp, sep); B0.z = bz
  const B1 = Bc.clone().addScaledVector(perp, -sep); B1.z = bz
  const P0 = Pc.clone().addScaledVector(perp, sep); P0.z = pz
  const P1 = Pc.clone().addScaledVector(perp, -sep); P1.z = pz

  // two parallel links, each a plate between one B pin and one P pin
  const linkBar = (a, b, w = 9, t = 5) => {
    const d = new THREE.Vector3().subVectors(b, a)
    const L2 = d.length()
    const box = new RoundedRectangle(L2 + w * 0.8, w, w * 0.36).extrude(t)
    box.rotation.z = Math.atan2(d.y, d.x)
    box.position.copy(a).add(b).multiplyScalar(0.5).add(v3(0, 0, -t / 2))
    return box
  }
  const linkOuter = linkBar(B0, P0), linkInner = linkBar(B1, P1)
  const pivots = [B0, B1, P0, P1].map((p) => cylZ(2.4, 14, p.x, p.y, p.z))

  // ---- B-knuckle: casting from the hanger bolt inboard/down to the B pivots
  const bNeck = loftAlong(
    [v3(hb.x + 1, hb.y + 1, hangerZ + 2), v3(hb.x + 3, hb.y - 8, hangerZ - 8),
      v3(Bc.x + 2, Bc.y - 1, bz + 2), v3(Bc.x, Bc.y, bz)],
    [[19, 16], [18, 15], [17, 14], [17, 14]], { up: v3(0, 0, 1) },
  )
  const bPlate = prismZ(new RoundedRectangle(21, 23, 8), 10, hb.x + 1, hb.y + 1, hangerZ + 5.5)
  let bknuckle = bPlate.fuse(bNeck)
  // hanger bolt (Ø10 through the plate) + its hex head
  bknuckle = bknuckle.cut(cylZ(5.2, 26, hb.x, hb.y, hangerZ + 5))
  bknuckle = bknuckle.fuse(hexBoltZ(8, 5, 5, 16, hb.x, hb.y, hangerZ + 11, 1))

  // ---- P-knuckle: carries the P pivots and the cage pivot bolt
  const pknuckle = prismZ(new RoundedRectangle(19, 17, 7), 9, cagePivot.x - 1, cagePivot.y + 7, jz + 2)
  const cBoltHole = cylZ(4.2, 22, cagePivot.x, cagePivot.y, jz)
  const pKn = pknuckle.cut(cBoltHole)

  // ---- cage: two plates carrying both jockeys
  const cageOutline = ribbon(
    [v3(cagePivot.x, cagePivot.y, 0), v3(up.x, up.y, 0), v3(low.x, low.y, 0), v3(low.x - 7, low.y - 13, 0)],
    [11, 13, 14, 11],
  )
  const outerPlateZ = jz + 5.2, innerPlateZ = jz - 5.2
  const cageOuter = prismZ(profile(cageOutline), 1.5, 0, 0, outerPlateZ)
  const cageInner = prismZ(profile(cageOutline), 1.5, 0, 0, innerPlateZ)
  // window in each plate so the chain and the wheels show through
  const winOuter = cageOuter.cut(
    ringAtZ(rj + 1.5, rj - 2.5, outerPlateZ - 0.75, outerPlateZ + 0.75, up.x, up.y),
    ringAtZ(rj + 1.5, rj - 2.5, outerPlateZ - 0.75, outerPlateZ + 0.75, low.x, low.y),
  )
  const winInner = cageInner.cut(
    ringAtZ(rj + 1.5, rj - 2.5, innerPlateZ - 0.75, innerPlateZ + 0.75, up.x, up.y),
    ringAtZ(rj + 1.5, rj - 2.5, innerPlateZ - 0.75, innerPlateZ + 0.75, low.x, low.y),
  )
  const cageBolts = [
    cylZ(3.0, 13, cagePivot.x, cagePivot.y, jz),
    cylZ(3.0, 13, up.x, up.y, jz),
    cylZ(3.0, 13, low.x, low.y, jz),
  ]
  const cage = winOuter.fuse(winInner, ...cageBolts)

  // ---- 11 t jockey wheels
  const jockey = (c) => {
    const w = sprocket({ teeth: D.jockeyTeeth, thickness: 2.2, center: v3(c.x, c.y, jz) })
    const boss = cylZ(7, 7, c.x, c.y, jz)
    const bore = cylZ(3.2, 14, c.x, c.y, jz)
    const b = w.fuse(boss).cut(bore)
    b.tolerance = 0.25
    return b
  }
  const jU = jockey(up), jL = jockey(low)

  // ---- spring round the cage pivot, cable anchor on the B-knuckle
  const spring = new THREE.Group()
  for (let i = 0; i < 6; i++) {
    spring.add(torusZ(6.5, 1.1, v3(cagePivot.x, cagePivot.y, jz + 9 + i * 1.9)))
  }
  const anchor = new THREE.Group()
  const aTab = prismZ(new RoundedRectangle(12, 16, 4), 5, hb.x - 12, hb.y + 2, hangerZ - 4)
  const aBolt = cylZ(2.6, 14, hb.x - 12, hb.y + 9, hangerZ - 4)
  anchor.add(aTab, aBolt)
  const c0 = v3(hb.x - 12, hb.y + 9, hangerZ - 4)
  anchor.add(along(new Cylinder(1.6, 1.6, 55),
    c0, c0.clone().add(v3(52, 14, -10).normalize().multiplyScalar(55))))

  bknuckle.tolerance = 0.25
  pKn.tolerance = 0.25
  cage.tolerance = 0.25
  return {
    records: [
      {
        id: 'drivetrain.rd.body', name: 'Rear derailleur body', assembly: 'drivetrain', material: 'alu',
        density: 2.7, object: bknuckle.fuse(pKn),
        spec: {
          Type: '11-speed, medium cage', 'B-knuckle': 'Bolted to the frame hanger',
          Parallelogram: `2 links, 4 pivot pins, ${B0.distanceTo(P0).toFixed(0)} mm`,
          'Cage pivot': `(${cagePivot.x.toFixed(1)}, ${cagePivot.y.toFixed(1)}, ${jz.toFixed(2)})`,
        },
      },
      {
        id: 'drivetrain.rd.cage', name: 'Rear derailleur cage', assembly: 'drivetrain', material: 'alu',
        density: 2.7, object: cage,
        spec: {
          Plates: '2 × 1.5 mm', Length: `${cagePivot.distanceTo(low).toFixed(0)} mm`,
          'Guide pulley': `(${up.x.toFixed(1)}, ${up.y.toFixed(1)}, ${jz.toFixed(2)})`,
          'Tension pulley': `(${low.x.toFixed(1)}, ${low.y.toFixed(1)}, ${jz.toFixed(2)})`,
        },
      },
      {
        id: 'drivetrain.rd.jockey.upper', name: 'Guide pulley 11 t', assembly: 'drivetrain', material: 'plastic',
        density: 1.15, object: jU,
        spec: { Teeth: '11', Thickness: '2.2 mm', Position: `(${up.x.toFixed(1)}, ${up.y.toFixed(1)}, ${jz.toFixed(2)})` },
      },
      {
        id: 'drivetrain.rd.jockey.lower', name: 'Tension pulley 11 t', assembly: 'drivetrain', material: 'plastic',
        density: 1.15, object: jL,
        spec: { Teeth: '11', Thickness: '2.2 mm', Position: `(${low.x.toFixed(1)}, ${low.y.toFixed(1)}, ${jz.toFixed(2)})` },
      },
      {
        id: 'drivetrain.rd.spring', name: 'Derailleur spring', assembly: 'drivetrain', material: 'steel',
        density: 7.85, object: spring, spec: { Coils: '6', Wire: 'Ø2.2' },
      },
      {
        id: 'drivetrain.rd.cable', name: 'Derailleur cable anchor', assembly: 'drivetrain', material: 'steel',
        density: 7.85, object: anchor, spec: { Anchor: 'Ø5 bolt on the B-knuckle', Cable: 'Ø1.6' },
      },
    ],
  }
}

// ---------------------------------------------------------------------------------------------
// front derailleur
// ---------------------------------------------------------------------------------------------

function buildFrontDerailleur(L) {
  const u = L.uSeat.clone()
  const bx = L.bb.x, by = L.bb.y
  const clampAt = v3(bx, by, 0).addScaledVector(u, 132)
  // clamp band round the seat tube (Ø31.8)
  const bandA = clampAt.clone().addScaledVector(u, -7)
  const bandB = clampAt.clone().addScaledVector(u, 7)
  const band = pipe(bandA, bandB, D.fdClampR + 2.6, D.fdClampR + 0.15)
  const clampBolt = tube(clampAt.clone().add(v3(6, 0, 13)), clampAt.clone().add(v3(6, 0, -13)), 2.4)
  // the lug the parallelogram hangs from
  const lug = prismZ(new RoundedRectangle(20, 26, 8), 14, clampAt.x + 8, clampAt.y - 4, 10)
  const bandBody = band.fuse(clampBolt, lug)

  // cage straddling the 50 t ring near the top of its travel
  const rr = R_PITCH(50)
  const a0 = deg(42), a1 = deg(86)
  const cageR0 = rr - 6, cageR1 = rr + 14
  const outer = prismZ(profile(sectorPts(bx, by, cageR0, cageR1, a0, a1, 40)), 1.4, 0, 0, L.chainringZ + 3.4)
  const inner = prismZ(profile(sectorPts(bx, by, cageR0, cageR1, a0, a1, 40)), 1.4, 0, 0, L.chainringZ - 3.4)
  const bridge = prismZ(profile(sectorPts(bx, by, cageR1 - 3, cageR1 + 4, a0 + 0.25, a1 - 0.25, 30)), 7.0, 0, 0, L.chainringZ)

  // parallelogram: two links from the clamp lug to the cage's top, four pivot pins
  const midA = (a0 + a1) / 2
  const perp = v3(-Math.sin(midA), Math.cos(midA), 0)
  const mid = v3(bx + (cageR1 - 1) * Math.cos(midA), by + (cageR1 - 1) * Math.sin(midA), L.chainringZ)
  const hub = v3(clampAt.x + 13, clampAt.y - 5, 11)
  const B0 = hub.clone().addScaledVector(perp, 7), B1 = hub.clone().addScaledVector(perp, -7)
  const P0 = mid.clone().addScaledVector(perp, 7), P1 = mid.clone().addScaledVector(perp, -7)
  const links = [loftAlong([B0, P0], [[10, 5], [10, 5]], { kind: 'rect', up: v3(0, 0, 1) }),
    loftAlong([B1, P1], [[10, 5], [10, 5]], { kind: 'rect', up: v3(0, 0, 1) })]
  const pins = [B0, B1, P0, P1].map((p) => cylZ(2.2, 15, p.x, p.y, p.z))
  const cage = outer.fuse(inner, bridge, ...links, ...pins)

  // cable anchor on the outer link
  const anchor = new THREE.Group()
  const aTab = prismZ(new RoundedRectangle(14, 9, 3), 4, hub.x + 14, hub.y + 6, 18)
  const aBolt = cylZ(2.4, 12, hub.x + 14, hub.y + 12, 18)
  anchor.add(aTab, aBolt)
  const c0 = v3(hub.x + 14, hub.y + 12, 18)
  anchor.add(along(new Cylinder(1.4, 1.4, 70), c0, c0.clone().addScaledVector(L.uSeat, 70)))

  bandBody.tolerance = 0.25
  cage.tolerance = 0.25
  return [
    {
      id: 'drivetrain.fd.band', name: 'Front derailleur clamp', assembly: 'drivetrain', material: 'alu',
      density: 2.7, object: bandBody,
      spec: { Clamp: 'Ø31.8 seat tube', Type: 'Band-on', Cable: 'Bottom pull', Parallelogram: '2 links, 4 pivot pins' },
    },
    {
      id: 'drivetrain.fd.cage', name: 'Front derailleur cage', assembly: 'drivetrain', material: 'steel',
      density: 7.85, object: cage,
      spec: {
        Rings: '50 / 34 t', Plates: '2 × 1.4 mm', Straddles: '50 t at top of travel',
        'Cage radius': `${cageR0.toFixed(1)}-${cageR1.toFixed(1)} mm`,
      },
    },
    {
      id: 'drivetrain.fd.cable', name: 'Front derailleur cable anchor', assembly: 'drivetrain', material: 'steel',
      density: 7.85, object: anchor, spec: { Anchor: 'Ø5 bolt', Cable: 'Ø1.4' },
    },
  ]
}

// ---------------------------------------------------------------------------------------------
// STI levers
// ---------------------------------------------------------------------------------------------

function buildShifters(L) {
  const bc = L.barCenter
  const recs = []
  for (const s of [1, -1]) {
    const z = bc.z + s * D.leverZ
    const grp = new THREE.Group()

    // clamp band round the Ø31.8 bar
    const band = ringAtZ(D.barR + 1.9, D.barR + 0.2, z - 8, z + 8, bc.x, bc.y)
    const bandBolt = cylZ(2.2, 12, bc.x + 14.8, bc.y + 8.5, z)
    grp.add(band, bandBolt)

    // hood: an ergonomic body rising off the bar and reaching forward
    const p0 = v3(bc.x + 2, bc.y + 12, z)
    const p1 = v3(bc.x + 26, bc.y + 24, z)
    const p2 = v3(bc.x + 56, bc.y + 26, z)
    const p3 = v3(bc.x + 82, bc.y + 20, z)
    const p4 = v3(bc.x + 92, bc.y + 12, z)
    const hood = loftAlong([p0, p1, p2, p3, p4],
      [[30, 34], [35, 36], [35, 34], [30, 29], [21, 20]],
      { up: v3(0, 0, 1), pinch: 0.06 })
    grp.add(hood)

    // brake lever blade: curls down and forward from the hood's nose
    const b0 = v3(bc.x + 30, bc.y + 6, z)
    const b1 = v3(bc.x + 62, bc.y - 24, z)
    const b2 = v3(bc.x + 78, bc.y - 62, z)
    const b3 = v3(bc.x + 74, bc.y - 96, z)
    const b4 = v3(bc.x + 62, bc.y - 116, z)
    const blade = loftAlong([b0, b1, b2, b3, b4],
      [[24, 17], [23, 15], [21, 13], [18, 11], [13, 9]],
      { up: v3(0, 0, 1), pinch: 0.05 })
    grp.add(blade)

    // shift paddle, inboard and behind the brake lever
    const s0 = v3(bc.x + 34, bc.y + 4, z - s * 15)
    const s1 = v3(bc.x + 34, bc.y - 34, z - s * 18)
    const s2 = v3(bc.x + 30, bc.y - 60, z - s * 19)
    const paddle = loftAlong([s0, s1, s2], [[14, 9], [13, 8], [10, 6]], { up: v3(0, 0, 1), pinch: 0.05 })
    grp.add(paddle)

    // cable ports under the hood
    const port1 = cylZ(3.4, 12, bc.x + 40, bc.y + 2, z - s * 14)
    const port2 = cylZ(2.8, 12, bc.x + 58, bc.y + 6, z - s * 12)
    grp.add(port1, port2)

    recs.push({
      id: `drivetrain.sti.${s > 0 ? 'drive' : 'nondrive'}`, name: `STI lever, ${s > 0 ? 'drive' : 'non-drive'} side`,
      assembly: 'drivetrain', material: 'black', density: 1.2, object: grp,
      spec: {
        Type: '11-speed mechanical, hydraulic-ready hood', Clamp: 'Ø31.8 bar',
        Position: `z ${z.toFixed(0)} mm (${(z - bc.z).toFixed(0)} from the stem)`,
        Controls: 'Brake lever, shift paddle, 2 cable ports',
      },
    })
  }
  return recs
}

// ---------------------------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------------------------

export function buildDrivetrain(L) {
  const path = solveChainPath(L, {
    jockey1: V2(L.rearHub.x + 8, L.rearHub.y - 68),
    cageDir: V2(-0.30, -0.954).normalize(),
    upperZ: D.cogZ0 + 4 * D.cogPitch + D.cogT / 2,     // the 19 t cog's plane
    ringZ: L.chainringZ,
  })
  const chain = buildChain(L, path)
  const recs = [
    ...buildBottomBracket(L),
    ...buildCrankset(L).records,
    ...buildChainrings(L),
    ...buildPedals(L),
    ...buildCassette(L),
    ...buildFrontDerailleur(L),
    ...buildRearDerailleur(L, path).records,
    ...chain.recs,
    ...buildShifters(L),
  ]
  buildDrivetrain.path = path
  buildDrivetrain.chain = chain
  return recs
}

// ---------------------------------------------------------------------------------------------
// self-test: build, check every body, print a table, render
// ---------------------------------------------------------------------------------------------

function bodiesOf(obj) {
  const out = []
  obj.traverse((o) => { if (o.isBody) out.push(o) })
  return out
}

function worldBox(obj) {
  // from the tessellation: a body's own bbox() is in its (possibly rotated) local frame, and
  // rotating that box would report an axis-aligned box that is too big
  obj.updateMatrixWorld(true)
  const bs = bodiesOf(obj)
  if (!bs.length) return new THREE.Box3().setFromObject(obj, true)
  const box = new THREE.Box3()
  for (const b of bs) box.union(new THREE.Box3().setFromObject(b, true))
  return box
}

export function checkDrivetrain(recs) {
  const rows = []
  let allValid = true
  for (const r of recs) {
    const bs = bodiesOf(r.object)
    let vol = 0, valid = true
    for (const b of bs) {
      vol += b.volume / 1000
      if (!b.isValid()) valid = false
      if (b.volume / 1000 > 4) b.tolerance = 0.25
    }
    if (!valid) allValid = false
    const size = worldBox(r.object).getSize(new THREE.Vector3())
    rows.push({
      id: r.id, bodies: bs.length, valid, vol, mass: vol * r.density,
      size: [size.x, size.y, size.z],
    })
  }
  return { rows, allValid }
}

function table(rows) {
  const pad = (s, n) => String(s).padEnd(n)
  const num = (v, n, d = 1) => v.toFixed(d).padStart(n)
  const L = []
  L.push(pad('record', 34) + pad('body', 5) + pad('ok', 4) + '   vol cm3' + '  mass g' + '   size x / y / z (mm)')
  L.push('-'.repeat(100))
  for (const r of rows) {
    L.push(
      pad(r.id, 34) + pad(r.bodies, 5) + pad(r.valid ? 'yes' : 'NO', 4) +
      num(r.vol, 10, 2) + num(r.mass, 9, 0) +
      '   ' + r.size.map((v) => v.toFixed(1)).join(' / '),
    )
  }
  const vol = rows.reduce((s, r) => s + r.vol, 0)
  const mass = rows.reduce((s, r) => s + r.mass, 0)
  L.push('-'.repeat(100))
  L.push(pad('TOTAL', 34) + pad(rows.reduce((s, r) => s + r.bodies, 0), 5) +
    pad(rows.every((r) => r.valid) ? 'yes' : 'NO', 4) + num(vol, 10, 2) + num(mass, 9, 0))
  return L.join('\n')
}

async function main() {
  const t0 = Date.now()
  const L = layout()
  const recs = buildDrivetrain(L)
  const path = buildDrivetrain.path
  const tBuild = Date.now() - t0

  const { rows, allValid } = checkDrivetrain(recs)
  console.log(table(rows))
  console.log('')
  console.log(`records ${recs.length}, bodies ${rows.reduce((s, r) => s + r.bodies, 0)}, all valid: ${allValid}, build ${tBuild} ms`)
  console.log('')
  console.log('CHAIN PATH')
  console.log(`  pulleys: ring R${path.pulleys.ring.r.toFixed(2)} at (${path.pulleys.ring.c.x.toFixed(1)}, ${path.pulleys.ring.c.y.toFixed(1)}) z=${path.pulleys.ring.z}`)
  console.log(`           19 t cog R${path.pulleys.cog.r.toFixed(2)} at (${path.pulleys.cog.c.x.toFixed(1)}, ${path.pulleys.cog.c.y.toFixed(1)}) z=${path.pulleys.cog.z.toFixed(2)}`)
  console.log(`  jockey upper (${path.jockeyUpper.x.toFixed(3)}, ${path.jockeyUpper.y.toFixed(3)}, ${path.pulleys.upper.z.toFixed(2)})  wrap ${path.wrapsDeg[2].toFixed(1)} deg`)
  console.log(`  jockey lower (${path.jockeyLower.x.toFixed(3)}, ${path.jockeyLower.y.toFixed(3)}, ${path.pulleys.lower.z.toFixed(2)})  wrap ${path.wrapsDeg[3].toFixed(1)} deg`)
  console.log(`  wraps: ring ${path.wrapsDeg[0].toFixed(1)}, cog ${path.wrapsDeg[1].toFixed(1)}, upper ${path.wrapsDeg[2].toFixed(1)}, lower ${path.wrapsDeg[3].toFixed(1)} deg`)
  console.log(`  length ${path.length.toFixed(2)} mm = ${(path.length / D.pitch).toFixed(3)} pitches, link pitch ${path.pitch.toFixed(4)} mm`)
  console.log('')

  // ---- verification: chain links on the ring's pitch circle, pitch continuity, cassette
  const ringC = new THREE.Vector2(path.pulleys.ring.c.x, path.pulleys.ring.c.y)
  const R1 = path.pulleys.ring.r
  let onRing = 0, maxRadial = 0
  for (const c of path.linkCentres) {
    const r = Math.hypot(c.x - ringC.x, c.y - ringC.y)
    if (Math.abs(r - R1) < 1.5) { onRing++; maxRadial = Math.max(maxRadial, Math.abs(r - R1)) }
  }
  let maxPitch = 0
  for (let i = 0; i < path.linkCentres.length; i++) {
    const a = path.linkCentres[i], b = path.linkCentres[(i + 1) % path.linkCentres.length]
    maxPitch = Math.max(maxPitch, Math.abs(a.distanceTo(b) - D.pitch))
  }
  // the actual scene objects, not just the matrices: prove every link clone sits on the path
  const linkObjs = buildDrivetrain.chain.recs.flatMap((r) => r.object.children)
  const linkPos = linkObjs.map((o) => {
    o.updateMatrixWorld(true)
    // the geometry's centre, not the object's origin: the fused link body keeps its first
    // plate's local frame, so the origin is offset across the chain while the plates are not
    return new THREE.Box3().setFromObject(o, true).getCenter(new THREE.Vector3())
  })
  let maxDev = 0
  for (let i = 0; i < linkPos.length; i++) {
    maxDev = Math.max(maxDev, linkPos[i].distanceTo(path.linkCentres[i % path.linkCentres.length]))
  }
  console.log('CHECKS')
  console.log(`  ${linkPos.length} chain link bodies in the scene, max deviation of their centres from the solved path ${maxDev.toFixed(3)} mm`)
  console.log(`  links ${path.linkCentres.length}, links on the 50 t pitch circle ${onRing}, max radial error ${maxRadial.toFixed(3)} mm`)
  console.log(`  max link-centre spacing error ${maxPitch.toFixed(3)} mm (pitch ${D.pitch})`)
  console.log(`  ring pitch radius ${R1.toFixed(2)} = sprocket() R for 50 t = ${(D.pitch / (2 * Math.sin(Math.PI / 50))).toFixed(2)}`)
  const cogs = recs.filter((r) => r.id.startsWith('drivetrain.cassette.cog'))
  const zs = D.cogTeeth.map((t, i) => D.cogZ0 + i * D.cogPitch + D.cogT / 2)
  const gaps = zs.slice(1).map((z, i) => z - zs[i])
  console.log(`  cassette: ${cogs.length} cogs, all centred on (${L.rearHub.x}, ${L.rearHub.y}), z ${zs[0].toFixed(1)}..${zs[zs.length - 1].toFixed(1)}, spacing ${gaps.map((g) => g.toFixed(2)).join('/')} mm`)
  console.log(`  jockey wheels at z ${path.pulleys.upper.z.toFixed(2)} = the 19 t cog's plane (${zs[4].toFixed(2)})`)

  // drive-side view of the whole drivetrain
  const driveline = recs.filter((r) => !r.id.startsWith('drivetrain.sti'))
  const objs = driveline.map((r) => r.object)
  const pic = render(objs, {
    view: 'front', size: [1300, 900], background: '#eef2f7', zoom: 1.06,
    lookAt: new THREE.Vector3(-150, 268, 30),
  })
  writeFileSync('/tmp/drivetrain.png', pic.data)
  console.log('wrote /tmp/drivetrain.png', pic.data.length, 'bytes')

  // close-up of the chain over the 50 t ring
  const chain = recs.filter((r) => r.id.startsWith('drivetrain.chain'))
  const close = [recs.find((r) => r.id === 'drivetrain.chainring.50').object,
    recs.find((r) => r.id === 'drivetrain.chainring.34').object,
    recs.find((r) => r.id === 'drivetrain.crank.drive').object,
    ...chain.map((r) => r.object)]
  const pic2 = render(close, {
    view: 'front', size: [1200, 1000], background: '#eef2f7', zoom: 1.6,
    lookAt: new THREE.Vector3(0, 305, 43),
  })
  writeFileSync('/tmp/chain.png', pic2.data)
  console.log('wrote /tmp/chain.png', pic2.data.length, 'bytes')

  // extra checks (not required, but cheap)
  const shifterPic = render(recs.filter((r) => r.id.startsWith('drivetrain.sti')).map((r) => r.object), {
    view: 'iso', size: [800, 600], background: '#eef2f7',
  })
  writeFileSync('/tmp/shifters.png', shifterPic.data)
  const rdPic = render([
    recs.find((r) => r.id === 'drivetrain.rd.body').object,
    recs.find((r) => r.id === 'drivetrain.rd.cage').object,
    recs.find((r) => r.id === 'drivetrain.rd.jockey.upper').object,
    recs.find((r) => r.id === 'drivetrain.rd.jockey.lower').object,
    ...recs.filter((r) => r.id.startsWith('drivetrain.cassette.cog')).map((r) => r.object),
  ], { view: 'front', size: [900, 800], background: '#eef2f7', zoom: 1.1 })
  writeFileSync('/tmp/rd.png', rdPic.data)
  console.log('wrote /tmp/shifters.png and /tmp/rd.png')

  // bottom bracket, cranks, pedals, front derailleur - the parts the wide view hides
  const bbIds = ['drivetrain.bb.cup.drive', 'drivetrain.bb.cup.nondrive', 'drivetrain.bb.bearings',
    'drivetrain.bb.spindle', 'drivetrain.crank.drive', 'drivetrain.crank.nondrive',
    'drivetrain.pedal.drive', 'drivetrain.pedal.nondrive']
  writeFileSync('/tmp/bb.png', render(bbIds.map((id) => recs.find((r) => r.id === id).object),
    { view: 'iso', size: [1000, 700], background: '#eef2f7' }).data)
  writeFileSync('/tmp/fd.png', render([
    recs.find((r) => r.id === 'drivetrain.fd.band').object,
    recs.find((r) => r.id === 'drivetrain.fd.cage').object,
    recs.find((r) => r.id === 'drivetrain.chainring.50').object,
  ], { view: 'iso', size: [900, 800], background: '#eef2f7', zoom: 1.1 }).data)
  console.log('wrote /tmp/bb.png and /tmp/fd.png')

  // the same drivetrain at assembled-bike scale, to judge the silhouette
  writeFileSync('/tmp/drivetrain-small.png', render(objs, {
    view: 'front', size: [520, 380], background: '#eef2f7', zoom: 1.06,
    lookAt: new THREE.Vector3(-150, 268, 30),
  }).data)

  // triangle budget and the assembly's overall size
  let tris = 0
  const allBox = new THREE.Box3()
  for (const r of recs) {
    for (const b of bodiesOf(r.object)) {
      const g = b.geometry
      if (g && g.attributes.position) tris += g.attributes.position.count / 3
    }
    allBox.union(worldBox(r.object))
  }
  const sz = allBox.getSize(new THREE.Vector3())
  console.log(`triangles ${Math.round(tris)}  overall ${sz.x.toFixed(0)} x ${sz.y.toFixed(0)} x ${sz.z.toFixed(0)} mm`)
  console.log(`total ${Date.now() - t0} ms`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
