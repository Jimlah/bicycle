/**
 * Wheels: two complete 700c wheels (622 BSD, 25-622 tyre, 32 spokes, 3-cross).
 *
 * Everything is built in the *wheel frame*: origin on the axle, wheel plane = XY,
 * axle = +Z (drive side +Z, as everywhere in this bike).  Each wheel is one
 * THREE.Group placed at L.frontHub / L.rearHub, so the viewer can spin it about Z.
 *
 * Revolved bodies (rim, tyre, hub shell, freehub) are swept from a closed
 * [radius, axial] section about the profile's Y axis, then the body is turned
 * (+90 deg about X) so its axis lies on Z.  Sections and the cutting tools for those
 * bodies are written in that "revolve frame"; `toR()` converts a wheel-frame point
 * into it, so the rim's 32 spoke holes are drilled exactly along their own spokes.
 */
import * as THREE from 'three'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Polygon, Cylinder, Helix, Circle, RoundedRectangle, sweep, render } from '@classcad/smlibpy-three'
import { v3, tube, pipe } from '../lib/geo.mjs'
import { layout } from '../lib/bike.mjs'

const TAU = Math.PI * 2
const RAY_Y = new THREE.Ray(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0))

/* ------------------------------------------------------------------ numbers */

const RIM = {
  beadR: 311,        // bead seat radius (622 BSD)
  bedR: 281,         // spoke bed: 30 mm deep section
  bedHalfW: 5.5,     // the section tapers: 11 mm at the bed, 25 mm at the brake track
  halfW: 12.5,       // 25 mm outside width, at the brake track
  wall: 1.0,         // thin-wall box, as a deep alloy rim really is
  hookR: 311,
  bedChannel: 308.6, // tyre bed between the hooks
  brakeR0: 304,      // brake track: flat, slightly proud band on both flanks
  brakeR1: 309.5,
}

const SPOKES = { count: 32, cross: 3, dia: 2.0 }
const AXLE = { dia: 15, bore: 9 }
const BEARING = { dia: 28, width: 7 }   // sealed cartridge bearing, 15 mm bore

const FRONT_HUB = {
  old: 100,
  endZ: 50,
  flangeZ: { drive: 34, nonDrive: -34 },
  flangeDia: 40,
  flangeT: 3.5,
  shellZ: [-38, 38],
  barrelDia: 30,
  freehub: null,
}
const REAR_HUB = {
  old: 130,
  endZ: 65,
  flangeZ: { drive: 19, nonDrive: -34 },  // dished: drive flange 19 mm from centre
  flangeDia: 45,
  flangeT: 4,
  shellZ: [-38, 21],
  barrelDia: 30,
  freehub: { z0: 19, z1: 61, dia: 35 },
}

/* ------------------------------------------------------------------ helpers */

/** Closed section in the revolve frame: [radius, axial]. */
const section = (pts) => new Polygon(pts.map(([r, a]) => new THREE.Vector2(r, a)))

/** Revolve a closed section about the revolve frame's +Y. */
const revolveSection = (pts) => section(pts).revolve(RAY_Y, TAU)

/** Wheel frame -> revolve frame (rotation.x = +90deg maps local (x,y,z) to world (x,-z,y)). */
const toR = (p) => new THREE.Vector3(p.x, p.z, -p.y)

/** Turn a body made along local +Y so that its axis lies on +Z. */
function spinZ(body) {
  body.rotation.x = Math.PI / 2
  return body
}

/** A cylinder of `length` along `dir`, centred at `at`. */
function rod(at, dir, length, radius, radius2 = radius) {
  const c = new Cylinder(radius2, radius, length)
  c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
  c.position.copy(at)
  return c
}

/** Hub shell: barrel, two flanges, Ø22 bore and Ø28 bearing seats at the ends. */
function hubShellSection(cfg) {
  const br = cfg.barrelDia / 2
  const fr = cfg.flangeDia / 2
  const ht = cfg.flangeT / 2
  const seat = BEARING.dia / 2
  const bore = AXLE.dia / 2 + 3.5
  const [z0, z1] = cfg.shellZ
  const fz = cfg.flangeZ
  const flange = (z) => [[br, z - ht], [fr, z - ht], [fr, z + ht], [br, z + ht]]
  // drive bearing seat runs from the freehub shoulder inwards
  const seatDrive = cfg.freehub ? fz.drive - 9 : z1 - 10
  return [
    [br, z0], ...flange(fz.nonDrive), ...flange(fz.drive), [br, z1],
    [seat, z1], [seat, seatDrive], [bore, seatDrive],
    [bore, z0 + 10], [seat, z0 + 10], [seat, z0],
  ]
}

/**
 * The 32 spokes of one wheel: 3-cross, alternating leading/trailing on each flange.
 * Rim hole j sits at j * 360/32; a spoke's hub hole is ±67.5 deg from its rim hole
 * (= 3 crossings on a 32-spoke wheel), and the two flanges interleave.
 */
function spokeSet(cfg, bedR) {
  const N = SPOKES.count
  const rHole = cfg.flangeDia / 2 - 3.5
  const spokes = []
  for (const side of ['drive', 'nonDrive']) {
    const a0 = side === 'drive' ? TAU / N / 2 : 0
    for (let i = 0; i < N / 2; i++) {
      const psi = (i * TAU) / (N / 2) + a0
      const even = i % 2 === 0
      const j = side === 'drive'
        ? (even ? 2 * i + 7 : 2 * i - 5)
        : (even ? 2 * i - 6 : 2 * i + 6)
      const th = (((j % N) + N) % N) * (TAU / N)
      // leading and trailing spokes leave the flange on opposite sides of it, so that
      // neighbouring spokes pass each other at a crossing instead of intersecting
      const dz = (even ? 1 : -1) * 1.6
      const hubPt = new THREE.Vector3(
        rHole * Math.cos(psi), rHole * Math.sin(psi), cfg.flangeZ[side] + dz,
      )
      const bedPt = new THREE.Vector3(bedR * Math.cos(th), bedR * Math.sin(th), 0)
      const dir = bedPt.clone().sub(hubPt).normalize()
      spokes.push({ j: ((j % N) + N) % N, side, hubPt, bedPt, dir, length: hubPt.distanceTo(bedPt) })
    }
  }
  return spokes
}

/**
 * Audit of the lacing of one wheel (for the report and the self test):
 * spoke count, per-side spoke lengths, how many same-flange spokes each spoke
 * crosses in the wheel plane, and how many distinct rim holes are used.
 */
export function spokeAudit(L, which = 'rear') {
  const cfg = which === 'rear' ? REAR_HUB : FRONT_HUB
  const spokes = spokeSet(cfg, RIM.bedR)
  const crosses = (a, b) => {
    const p1 = a.hubPt, p2 = a.bedPt, p3 = b.hubPt, p4 = b.bedPt
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
    if (Math.abs(d) < 1e-9) return false
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d
    const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d
    return t > 0.002 && t < 0.998 && u > 0.002 && u < 0.998
  }
  const per = spokes.map((s, i) =>
    spokes.filter((o, j) => j !== i && o.side === s.side && crosses(s, o)).length)
  const stat = (side) => {
    const l = spokes.filter((s) => s.side === side).map((s) => s.length)
    return { count: l.length, min: Math.min(...l), max: Math.max(...l) }
  }
  return {
    count: spokes.length,
    drive: stat('drive'),
    nonDrive: stat('nonDrive'),
    crossings: { min: Math.min(...per), max: Math.max(...per) },
    rimHoles: new Set(spokes.map((s) => s.j)).size,
    lengths: { min: Math.min(...spokes.map((s) => s.length)), max: Math.max(...spokes.map((s) => s.length)) },
  }
}

/* ------------------------------------------------------------------ rim */

function buildRim(spokes, valvePhi) {
  const b = RIM.bedHalfW
  const w = RIM.wall
  // tapered box: 13 mm wide at the spoke bed, flaring to the 25 mm brake track
  const outer = [
    [RIM.bedR, -b], [RIM.bedR, b],
    [288, 8.8], [294, 10.0], [303, 12.3], [RIM.brakeR0, RIM.halfW],
    [RIM.hookR, RIM.halfW], [RIM.hookR, 10.4], [309, 9.6], [RIM.bedChannel, 0],
    [309, -9.6], [RIM.hookR, -10.4], [RIM.hookR, -RIM.halfW],
    [RIM.brakeR0, -RIM.halfW], [303, -12.3], [294, -10.0], [288, -8.8],
  ]
  const cavity = [
    [RIM.bedR + w, -(b - w)], [RIM.bedR + w, b - w],
    [288, 8.8 - w], [294, 10.0 - w * 0.85], [303, 12.3 - w],
    [RIM.bedChannel - w, RIM.halfW - w - 0.2],
    [RIM.bedChannel - w, -(RIM.halfW - w - 0.2)],
    [303, -(12.3 - w)], [294, -(10.0 - w * 0.85)], [288, -(8.8 - w)],
  ]
  let rim = revolveSection(outer).cut(revolveSection(cavity))

  // 32 spoke holes, drilled along each spoke so its nipple sits in the cavity
  const tools = spokes.map((s) => {
    const p = toR(s.bedPt)
    const d = toR(s.dir).normalize()
    return rod(p.clone().addScaledVector(d, 2), d, 24, 2.4)
  })
  // valve hole, between two spoke holes
  const vDir = v3(Math.cos(valvePhi), Math.sin(valvePhi), 0)
  const vAt = vDir.clone().multiplyScalar(RIM.bedR)
  tools.push(rod(toR(vAt).addScaledVector(toR(vDir), 2), toR(vDir), 24, 3.3))

  rim = rim.cut(tools)
  rim.name = 'Rim'
  return spinZ(rim)
}

/* ------------------------------------------------------------------ tyre */

function buildTyre() {
  // outer (tread) outline: +Z bead, over the crown, to the centre
  const halfOuter = [
    [311.2, 9.6], [312.2, 10.6], [313.6, 11.6], [315.5, 12.3], [318.5, 12.5],
    [322, 12.5], [326.5, 12.0], [330.5, 10.9], [333.4, 9.0], [335.2, 6.6],
    [335.9, 4.8], [335.2, 3.8],                 // shallow tread groove
    [335.9, 2.7], [336.0, 1.3], [336.0, 0],     // ...and the centre rib
  ]
  const outer = [...halfOuter, ...halfOuter.slice(0, -1).reverse().map(([r, z]) => [r, -z])]
  // inner (air chamber) wall, bead -> crown -> other bead
  const innerHalf = [
    [311.8, 9.2], [314.0, 10.6], [317.0, 11.6], [321.0, 11.3], [325.5, 10.4],
    [329.5, 8.8], [332.2, 6.4], [333.6, 3.4], [333.8, 0],
  ]
  const innerPath = [
    ...innerHalf.map(([r, z]) => [r, -z]),
    ...innerHalf.slice().reverse().slice(1),
  ]
  const tyre = revolveSection([...outer, ...innerPath])
  tyre.name = 'Tyre'
  return spinZ(tyre)
}

/* ------------------------------------------------------------------ quick release */

function buildQuickRelease(cfg) {
  const e = cfg.endZ
  const camZ = -(e + 19)
  const nutZ = e + 19
  const parts = [
    tube(v3(0, 0, camZ), v3(0, 0, nutZ), 2.5),          // Ø5 skewer
    tube(v3(0, 0, camZ), v3(0, 0, camZ + 9), 7.5),       // cam housing
  ]
  const lever = new RoundedRectangle(46, 13, 6).extrude(8)
  lever.position.set(-14, 0, camZ)
  parts.push(lever)
  parts.push(tube(v3(0, 0, nutZ - 9), v3(0, 0, nutZ), 8, 6.4)) // nut
  for (const s of [-1, 1]) {
    const spring = sweep(new Circle(0.62), new Helix(2.4, 10, 7))
    spring.position.set(0, 0, s > 0 ? e + 4 : -(e + 14))
    parts.push(spring)
  }
  const qr = parts[0].fuse(...parts.slice(1))
  qr.name = 'Quick release'
  return qr
}

/* ------------------------------------------------------------------ one wheel */

function buildOne(which, hubCentre, cfg, rear) {
  const records = []
  const group = new THREE.Group()
  group.name = `wheel.${which}`
  group.position.copy(hubCentre)
  const add = (rec) => {
    group.add(rec.object)
    records.push(rec)
  }

  const label = rear ? 'Rear' : 'Front'
  const spokes = spokeSet(cfg, RIM.bedR)
  const valvePhi = TAU / 64

  /* rim */
  add({
    id: `wheel.${which}.rim`,
    name: `${label} rim`,
    assembly: 'wheels',
    material: 'alu',
    density: 2.7,
    spec: {
      'Size': '700c, 622 BSD',
      'Width': '25 mm at the brake track',
      'Depth': '30 mm',
      'Section': 'tapered box: 11 mm at the bed → 25 mm at the track',
      'Wall': '1.0 mm thin-wall box',
      'Brake track': 'flat band, 0.2 mm proud, both flanks',
      'Spoke bed': 'Ø281 mm, 32 holes drilled on the spoke line',
      'Valve': 'Presta, 6.5 mm',
      'Volume': '198 cm³ → 536 g',
    },
    object: buildRim(spokes, valvePhi),
  })

  /* tyre */
  add({
    id: `wheel.${which}.tyre`,
    name: `${label} tyre`,
    assembly: 'wheels',
    material: 'rubber',
    density: 1.15,
    spec: {
      'Size': '25-622',
      'Outer radius': '336 mm',
      'Width': '25 mm',
      'Bead seat': '311 mm',
      'Tread': 'shallow centre rib, no knobs',
      'Wall': '2.6 mm tread / ~1.2 mm sidewall',
      'Volume': '227 cm³ → 261 g',
    },
    object: buildTyre(),
  })

  /* hub shell */
  const shell = revolveSection(hubShellSection(cfg))
  shell.name = 'Hub shell'
  add({
    id: `wheel.${which}.hub`,
    name: `${label} hub shell`,
    assembly: 'wheels',
    material: 'alu',
    density: 2.7,
    spec: {
      'OLD': `${cfg.old} mm`,
      'Barrel': `Ø${cfg.barrelDia} mm`,
      'Flanges': `Ø${cfg.flangeDia} mm`,
      'Flange spacing': rear ? '+19 / −34 mm (dished)' : '±34 mm',
      'Bearing seats': '2 × Ø28 mm',
    },
    object: spinZ(shell),
  })

  /* freehub */
  if (cfg.freehub) {
    const f = cfg.freehub
    const fh = revolveSection([
      [f.dia / 2, f.z0], [f.dia / 2, f.z1], [BEARING.dia / 2, f.z1], [BEARING.dia / 2, f.z0],
    ])
    fh.name = 'Freehub body'
    add({
      id: `wheel.${which}.freehub`,
      name: 'Freehub body',
      assembly: 'wheels',
      material: 'alu',
      density: 2.7,
      spec: {
        'Diameter': 'Ø35 mm',
        'Length': '42 mm',
        'Splines': 'HG cassette, 4.5 mm',
        'Z': `${f.z0} … ${f.z1} mm`,
      },
      object: spinZ(fh),
    })
  }

  /* axle */
  const axle = pipe(v3(0, 0, -cfg.endZ), v3(0, 0, cfg.endZ), AXLE.dia / 2, AXLE.bore / 2)
  axle.name = 'Axle'
  add({
    id: `wheel.${which}.axle`,
    name: `${label} axle`,
    assembly: 'wheels',
    material: 'steel',
    density: 7.85,
    spec: {
      'Diameter': `Ø${AXLE.dia} mm`,
      'Bore': `Ø${AXLE.bore} mm`,
      'Length': `${cfg.old} mm`,
      'Material': 'CrMo',
    },
    object: axle,
  })

  /* bearings */
  const [z0, z1] = cfg.shellZ
  const seatDrive = cfg.freehub ? cfg.flangeZ.drive - 9 : z1 - 10
  const ringZ = (a) => pipe(v3(0, 0, a), v3(0, 0, a + BEARING.width), BEARING.dia / 2, AXLE.dia / 2)
  const rings = [ringZ(z0 + 2), ringZ(seatDrive)]
  if (cfg.freehub) rings.push(ringZ(cfg.freehub.z1 - 9))
  const bearings = rings[0].fuse(...rings.slice(1))
  bearings.name = 'Bearings'
  add({
    id: `wheel.${which}.bearings`,
    name: `${label} bearings`,
    assembly: 'wheels',
    material: 'steel',
    density: 7.85,
    spec: {
      'Type': 'sealed cartridge',
      'Size': `Ø${BEARING.dia} × Ø${AXLE.dia} × ${BEARING.width} mm`,
      'Count': String(rings.length),
    },
    object: bearings,
  })

  /* cone nuts */
  const coneIn = cfg.endZ - 12
  const coneOut = cfg.endZ - 5
  const nuts = tube(v3(0, 0, -coneIn), v3(0, 0, -coneOut), 13, 9)
    .fuse(tube(v3(0, 0, coneIn), v3(0, 0, coneOut), 13, 9))
  nuts.name = 'Cone nuts'
  add({
    id: `wheel.${which}.hubNuts`,
    name: `${label} cone nuts`,
    assembly: 'wheels',
    material: 'steel',
    density: 7.85,
    spec: { 'Diameter': 'Ø26 → Ø18 mm', 'Thread': 'M15 × 1', 'Sides': 'both' },
    object: nuts,
  })

  /* spokes */
  const spokeBodies = spokes.map((s) =>
    tube(s.hubPt, s.bedPt.clone().addScaledVector(s.dir, 6), SPOKES.dia / 2))
  const spokeBody = spokeBodies[0].fuse(...spokeBodies.slice(1))
  spokeBody.name = 'Spokes'
  const lens = spokes.map((s) => s.length)
  const L2 = (side) => spokes.filter((s) => s.side === side).map((s) => s.length)
  const drive = { min: Math.min(...L2('drive')), max: Math.max(...L2('drive')) }
  const nonDrive = { min: Math.min(...L2('nonDrive')), max: Math.max(...L2('nonDrive')) }
  add({
    id: `wheel.${which}.spokes`,
    name: `${label} spokes`,
    assembly: 'wheels',
    material: 'steel',
    density: 7.85,
    spec: {
      'Count': `${SPOKES.count} (16 per flange), ${SPOKES.cross}-cross`,
      'Gauge': 'Ø2.0 mm stainless',
      'Length': `${Math.min(...lens).toFixed(0)}–${Math.max(...lens).toFixed(0)} mm`
        + ` (drive ${drive.min.toFixed(0)}–${drive.max.toFixed(0)}, non-drive ${nonDrive.min.toFixed(0)}–${nonDrive.max.toFixed(0)})`,
      'Lacing': 'leading / trailing alternate, ±67.5° offset',
      'Flange holes': `Ø${(cfg.flangeDia / 2 - 3.5).toFixed(1)} mm hole circle`,
    },
    object: spokeBody,
  })

  /* nipples */
  const nipples = spokes.map((s) => tube(
    s.bedPt.clone().addScaledVector(s.dir, -1.4),
    s.bedPt.clone().addScaledVector(s.dir, 10.6),
    2.7, 2.1,
  ))
  const nippleBody = nipples[0].fuse(...nipples.slice(1))
  nippleBody.name = 'Nipples'
  add({
    id: `wheel.${which}.nipples`,
    name: `${label} nipples`,
    assembly: 'wheels',
    material: 'brass',
    density: 8.5,
    spec: { 'Count': '32', 'Size': 'Ø4.6 × 12 mm', 'Type': 'brass', 'Seat': 'rim cavity, through the bed hole' },
    object: nippleBody,
  })

  /* quick release */
  add({
    id: `wheel.${which}.quickRelease`,
    name: `${label} quick release`,
    assembly: 'wheels',
    material: 'steel',
    density: 7.85,
    spec: {
      'Skewer': 'Ø5 mm CrMo',
      'Overall': `${cfg.endZ * 2 + 38} mm`,
      'Lever': 'cam, 46 mm',
      'Springs': '2 × conical',
    },
    object: buildQuickRelease(cfg),
  })

  /* Presta valve */
  const vDir = new THREE.Vector3(Math.cos(valvePhi), Math.sin(valvePhi), 0)
  const base = vDir.clone().multiplyScalar(RIM.bedR + 1)
  const stem = pipe(base.clone().addScaledVector(vDir, -33), base.clone().addScaledVector(vDir, 1), 3, 2.1)
  const nut = tube(base.clone().addScaledVector(vDir, -5), base.clone().addScaledVector(vDir, 0.5), 5.2)
  const cap = tube(base.clone().addScaledVector(vDir, -32.5), base.clone().addScaledVector(vDir, -27), 3.6)
  const valve = stem.fuse(nut, cap)
  valve.name = 'Valve'
  add({
    id: `wheel.${which}.valve`,
    name: `${label} valve`,
    assembly: 'wheels',
    material: 'brass',
    density: 8.5,
    spec: { 'Type': 'Presta', 'Stem': 'Ø6 × 32 mm', 'Cap': 'alloy', 'Nut': 'Ø10 mm' },
    object: valve,
  })

  group.updateMatrixWorld(true)
  group.userData.spinAxis = 'Z'
  return records
}

export function buildWheels(L) {
  return [
    ...buildOne('rear', L.rearHub, REAR_HUB, true),
    ...buildOne('front', L.frontHub, FRONT_HUB, false),
  ]
}

/* ------------------------------------------------------------------ self test */

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const L = layout()
  const t0 = performance.now()
  const recs = buildWheels(L)
  console.log(`built ${recs.length} records in ${Math.round(performance.now() - t0)} ms\n`)

  const colors = { alu: 0xb9c0c8, rubber: 0x2a2c2f, steel: 0xd8dde3, brass: 0xc9a227 }
  const worldBox = (o) => {
    o.updateMatrixWorld(true)
    const p = o.geometry.attributes.position
    const v = new THREE.Vector3()
    const b = new THREE.Box3()
    for (let i = 0; i < p.count; i++) b.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld))
    return b
  }
  const rows = []
  let bad = 0
  let total = 0
  for (const r of recs) {
    const o = r.object
    o.updateMatrixWorld(true)
    const size = worldBox(o).getSize(new THREE.Vector3())
    const vol = o.volume
    const valid = o.isValid()
    if (!valid) bad++
    o.tolerance = 0.25
    o.material = new THREE.MeshStandardMaterial({
      color: colors[r.material] ?? 0x999999, metalness: 0.55, roughness: 0.5,
    })
    const mass = (vol / 1000) * r.density
    total += mass
    rows.push({ id: r.id, vol: vol / 1000, mass, size: size.toArray().map((n) => n.toFixed(1)).join(' × '), valid })
  }
  const pad = (s, n) => String(s).padEnd(n)
  console.log(pad('record', 30) + pad('cm3', 9) + pad('g', 8) + pad('bbox (mm)', 26) + 'valid')
  for (const r of rows) {
    console.log(pad(r.id, 30) + pad(r.vol.toFixed(1), 9) + pad(r.mass.toFixed(0), 8) + pad(r.size, 26) + r.valid)
  }
  console.log(`\ntotal mass ${(total / 1000).toFixed(2)} kg   invalid bodies: ${bad}`)

  // sanity: all 32 rim holes used once, spoke lengths plausible
  for (const w of ['rear', 'front']) {
    const a = spokeAudit(L, w)
    console.log(`\n${w} wheel lacing: ${a.count} spokes (drive ${a.drive.count}, non-drive ${a.nonDrive.count})`,
      `| crossings per spoke ${a.crossings.min}-${a.crossings.max}`,
      `| rim holes used ${a.rimHoles}/32`,
      `| length drive ${a.drive.min.toFixed(1)}-${a.drive.max.toFixed(1)} mm`,
      `non-drive ${a.nonDrive.min.toFixed(1)}-${a.nonDrive.max.toFixed(1)} mm`)
  }
  const rearSpokes = recs.find((r) => r.id === 'wheel.rear.spokes')
  const frontGroup = recs.find((r) => r.id === 'wheel.front.spokes').object.parent
  console.log('front wheel group at', frontGroup.position.toArray().map((n) => n.toFixed(1)).join(', '))
  console.log('rear spoke spec', JSON.stringify(rearSpokes.spec))

  const rear = recs.filter((r) => r.id.startsWith('wheel.rear'))
  const pic = render(rear.map((r) => r.object), {
    view: 'front', size: [900, 900], background: '#eef2f7', edges: true,
  })
  writeFileSync('/tmp/wheels.png', pic.data)
  console.log('wrote /tmp/wheels.png', pic.data.length, 'bytes')

  const pic2 = render(recs.map((r) => r.object), { view: 'iso', size: [1100, 760], background: '#eef2f7' })
  writeFileSync('/tmp/wheels-both.png', pic2.data)
  console.log('wrote /tmp/wheels-both.png')
}
