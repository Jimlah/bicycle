/**
 * Fork: steerer, crown, two blades, dropouts and the lower half of the headset.
 *
 * Built in world coordinates, mm, from the layout's steering axis (L.uHead, +X forward),
 * its forward normal (L.nHead) and L.crown, which the layout puts at the head tube's
 * lower face = the crown race seat.  `t` below is mm along +uHead measured from L.crown,
 * `n` is mm along +nHead (forward of the steering axis).  The axle sits at
 * t = -371, n = +40, so the rake is the layout's own figure.
 *
 * Vertical stack along the steering axis (t):
 *   -371  front axle / dropout eye
 *    -28  crown bottom (blades grow from here)
 *  -9.5  crown top / crown race seat   -9.5..-3  crown race
 *     -3  lower bearing                  -3..3.5  Ø36.2 × Ø30.2 × 6.5
 *   -4.5  lower cup (flange against the head tube)   6.5  cup top, inside the 40.6 bore
 *      0  head tube's lower face (= L.crown, per the layout)
 *    196  top of the steerer (L.steererTop)
 */
import * as THREE from 'three'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Ellipse, Cylinder, RoundedRectangle, Box, loft, render } from '@classcad/smlibpy-three'
import { v3, pipe, along, latheY, deg } from '../lib/geo.mjs'
import { layout } from '../lib/bike.mjs'

const Y = v3(0, 1, 0)

/* ------------------------------------------------------------------ helpers */

/**
 * Lofted solid through elliptical sections centred on a path.  `sx` is the half-width
 * across the bike (+Z, the section's local x) and `sy` the half-depth in the wheel plane.
 */
function loftOvals(pts, sx, sy) {
  const sections = pts.map((p, i) => {
    const prev = pts[Math.max(i - 1, 0)]
    const next = pts[Math.min(i + 1, pts.length - 1)]
    const t = new THREE.Vector3().subVectors(next, prev).normalize()
    let x = new THREE.Vector3().crossVectors(t, Y)
    if (x.lengthSq() < 1e-9) x.set(0, 0, 1)
    x.normalize()
    const y = new THREE.Vector3().crossVectors(t, x).normalize()
    const s = new Ellipse(sx[i], sy[i])
    s.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, t))
    s.position.copy(p)
    s.updateMatrixWorld(true)
    return s
  })
  return loft(sections)
}

/** A revolved ring, [radius, height] from 0, laid along the steering axis from ta to tb. */
function ringAlong(L, profile, ta, tb) {
  const a = L.crown.clone().addScaledVector(L.uHead, ta)
  const b = L.crown.clone().addScaledVector(L.uHead, tb)
  return along(latheY(profile), a, b)
}

/* ------------------------------------------------------------------ fork */

export function buildFork(L) {
  const uH = L.uHead
  const nH = L.nHead
  const C = L.crown
  const hub = L.frontHub
  /** point t mm up the steering axis, n mm forward of it, z mm to the side */
  const P = (t, n = 0, z = 0) => C.clone().addScaledVector(uH, t).addScaledVector(nH, n).add(v3(0, 0, z))

  const records = []
  const add = (rec) => { records.push(rec); return rec.object }

  /* ---- steerer: 1-1/8", 2 mm wall, with the Ø30 crown race seat ---- */
  const steererTopT = L.steererTop.clone().sub(C).dot(uH)
  const steerer = pipe(P(-10), P(steererTopT + 2), 14.3, 12.3)
  const seat = pipe(P(-11), P(-3), 15, 12.3)
  const steererBody = steerer.fuse(seat)
  add({
    id: 'fork.steerer',
    name: 'Fork steerer',
    assembly: 'fork',
    material: 'alu',
    density: 2.7,
    spec: {
      'Size': '1-1/8" (28.6 mm)',
      'Wall': '2 mm (24.6 mm bore)',
      'Length': `${(steererTopT + 12).toFixed(0)} mm`,
      'Crown race seat': 'Ø30 mm',
      'Top': 'cut at the stem clamp, t = 196',
    },
    object: steererBody,
  })

  /* ---- crown: Ø29 at the race seat, flaring to 55 x 30 over the blade roots ---- */
  const crownPts = [P(-9.5), P(-14), P(-20), P(-26), P(-30)]
  let crown = loftOvals(crownPts, [16.5, 22, 27.5, 27, 23], [16.5, 16.5, 17, 15.5, 12.5])

  // rim-brake caliper: a recessed Ø8 bolt hole through the crown, Ø14 counterbore at the front
  const bolt = new Cylinder(4, 4, 46)
  bolt.quaternion.setFromUnitVectors(Y, nH)
  bolt.position.copy(P(-19))
  const recess = new Cylinder(7, 7, 14)
  recess.quaternion.setFromUnitVectors(Y, nH)
  recess.position.copy(P(-19, 10))
  crown = crown.cut(bolt, recess)
  add({
    id: 'fork.crown',
    name: 'Fork crown',
    assembly: 'fork',
    material: 'carbon',
    density: 1.6,
    spec: {
      'Width': '55 mm (Ø33 at the race seat)',
      'Depth': '34 mm',
      'Height': '20.5 mm',
      'Rake': '40 mm (layout)',
      'Brake mount': 'Ø8 bolt hole, Ø14 × 5 recess',
      'Headset': 'IS41 lower, Ø40.6 bore',
    },
    object: crown,
  })

  /* ---- blades: 22 x 14 oval at the crown, 12 x 8 at the dropout, raked forward ---- */
  // the blade's tip ends inside the solid shoulder of the dropout plate: past the eye
  // would put its end cap in the axle slot, short of it would leave a gap
  const tipDir = hub.clone().sub(P(-300, 31)).normalize()
  const tip = hub.clone().addScaledVector(tipDir, -9)
  const bladePts = [P(-22), P(-70, 2), P(-145, 9), P(-225, 19), P(-300, 31), tip]
  const bladeZ = [19, 23, 29, 36, 43, 50]
  const bladeSections = bladePts.map((p, i) => v3(p.x, p.y, bladeZ[i]))
  const radii = [11, 10, 8.8, 7.6, 6.4, 6.0]
  for (const side of [1, -1]) {
    const pts = bladeSections.map((p) => v3(p.x, p.y, p.z * side))
    const blade = loftOvals(
      pts,
      radii.map((r) => r * 0.637),   // 22 deep x 14 wide at the crown, 12 x 7.6 at the eye
      radii,
    )
    add({
      id: `fork.blade.${side > 0 ? 'right' : 'left'}`,
      name: `Fork blade (${side > 0 ? 'right' : 'left'})`,
      assembly: 'fork',
      material: 'carbon',
      density: 1.6,
      spec: {
        'Section at crown': '22 × 14 mm oval',
        'Section at dropout': '12 × 7.6 mm oval',
        'Rake': '40 mm',
        'Spacing': '±50 mm at the eye',
        'Blade length': `${pts[0].distanceTo(pts[5]).toFixed(0)} mm`,
      },
      object: blade,
    })
  }

  /* ---- dropouts: 6 mm plate, 9 mm axle slot opening down and forward ---- */
  const slotDir = v3(Math.sin(deg(35)), -Math.cos(deg(35)), 0)
  for (const side of [1, -1]) {
    const zc = side > 0 ? 53 : -53            // middle of the 6 mm plate
    const plate = new RoundedRectangle(46, 30, 12).extrude(6)
    plate.position.set(hub.x, hub.y, side > 0 ? 50 : -56)
    const eye = new Cylinder(4.5, 4.5, 20)
    eye.rotation.x = Math.PI / 2
    eye.position.set(hub.x, hub.y, zc)
    const slot = new Box(9, 44, 14)
    slot.rotation.z = deg(35)
    slot.position.set(hub.x, hub.y, zc).addScaledVector(slotDir, 24)
    const dropout = plate.cut(eye, slot)
    add({
      id: `fork.dropout.${side > 0 ? 'right' : 'left'}`,
      name: `Fork dropout (${side > 0 ? 'right' : 'left'})`,
      assembly: 'fork',
      material: 'alu',
      density: 2.7,
      spec: {
        'Plate': '46 × 30 × 6 mm',
        'Axle slot': '9 mm, semi-vertical',
        'Spacing': '100 mm OLD',
        'Eye': 'at L.frontHub',
      },
      object: dropout,
    })
  }

  /* ---- headset: crown race, lower bearing, lower cup ---- */
  const crownRace = ringAlong(L, [
    [18.5, 0], [18.5, 1.4], [16.0, 6.5], [15.05, 6.5], [15.05, 0],
  ], -9.5, -3)
  add({
    id: 'fork.crownRace',
    name: 'Crown race',
    assembly: 'fork',
    material: 'steel',
    density: 7.85,
    spec: { 'Bore': 'Ø30.1 mm (press on the seat)', 'Outside': 'Ø37 → Ø32 mm', 'Height': '6.5 mm' },
    object: crownRace,
  })

  const bearing = ringAlong(L, [
    [18.1, 0], [18.1, 6.5], [15.1, 6.5], [15.1, 0],
  ], -3, 3.5)
  add({
    id: 'fork.headsetBearing',
    name: 'Headset lower bearing',
    assembly: 'fork',
    material: 'steel',
    density: 7.85,
    spec: { 'Size': 'Ø36.2 × Ø30.2 × 6.5 mm', 'Type': 'sealed cartridge, 45/45°', 'Seat': 'lower cup' },
    object: bearing,
  })

  const cup = ringAlong(L, [
    [22.25, 0], [22.25, 2.5], [20.2, 2.5], [20.2, 11], [18.2, 11], [18.2, 0],
  ], -4.5, 6.5)
  add({
    id: 'fork.headsetCup',
    name: 'Headset lower cup',
    assembly: 'fork',
    material: 'alu',
    density: 2.7,
    spec: {
      'Press': 'Ø40.4 mm into the Ø40.6 head tube bore',
      'Bore': 'Ø36.4 mm',
      'Flange': 'Ø44.5 × 2.5 mm',
      'Reach into the head tube': '6.5 mm',
    },
    object: cup,
  })

  return records
}

/* ------------------------------------------------------------------ self test */

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const L = layout()
  const t0 = performance.now()
  const recs = buildFork(L)
  console.log(`built ${recs.length} records in ${Math.round(performance.now() - t0)} ms\n`)

  const worldBox = (o) => {
    o.updateMatrixWorld(true)
    const g = o.geometry
    const p = g.attributes.position
    const v = new THREE.Vector3()
    const b = new THREE.Box3()
    for (let i = 0; i < p.count; i++) b.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld))
    return b
  }

  const colors = { alu: 0xb9c0c8, carbon: 0x3a3d42, steel: 0xd8dde3 }
  const pad = (s, n) => String(s).padEnd(n)
  console.log(pad('record', 28) + pad('cm3', 9) + pad('g', 8) + pad('bbox (mm)', 30) + 'valid')
  let bad = 0
  let mass = 0
  for (const r of recs) {
    const o = r.object
    o.tolerance = 0.25
    o.material = new THREE.MeshStandardMaterial({ color: colors[r.material] ?? 0x888888, metalness: 0.55, roughness: 0.5 })
    const box = worldBox(o)
    const size = box.getSize(new THREE.Vector3())
    const vol = o.volume
    const valid = o.isValid()
    if (!valid) bad++
    mass += (vol / 1000) * r.density
    console.log(
      pad(r.id, 28) + pad((vol / 1000).toFixed(1), 9) + pad(((vol / 1000) * r.density).toFixed(0), 8) +
      pad(size.toArray().map((n) => n.toFixed(1)).join(' × '), 30) + valid,
    )
  }
  console.log(`\ntotal mass ${(mass / 1000).toFixed(2)} kg   invalid bodies: ${bad}`)

  // geometry checks against the layout
  const hub = L.frontHub
  const dOut = recs.filter((r) => r.id.startsWith('fork.dropout'))
  for (const r of dOut) {
    const b = worldBox(r.object)
    console.log(r.id, 'eye at hub?', b.getCenter(new THREE.Vector3()).distanceTo(hub).toFixed(1), 'mm from axle')
  }
  const st = recs.find((r) => r.id === 'fork.steerer')
  const sb = worldBox(st.object)
  console.log('steerer top', sb.max.y.toFixed(1), 'vs L.steererTop y', L.steererTop.y.toFixed(1))
  console.log('crown top y', worldBox(recs.find((r) => r.id === 'fork.crown').object).max.y.toFixed(1), 'headBottom y', L.headBottom.y.toFixed(1))

  const all = recs.map((r) => r.object)
  writeFileSync('/tmp/fork.png', render(all, { view: 'iso', size: [760, 950], background: '#eef2f7', edges: true }).data)
  console.log('wrote /tmp/fork.png')
  writeFileSync('/tmp/fork-front.png', render(all, { view: 'front', size: [700, 950], background: '#eef2f7' }).data)
  writeFileSync('/tmp/fork-crown.png', render(all, {
    view: { azimuth: 0.8, elevation: 0.35 }, size: [800, 700], background: '#eef2f7',
    lookAt: L.crown.clone().addScaledVector(L.uHead, -20), zoom: 4,
  }).data)
  console.log('wrote /tmp/fork-front.png /tmp/fork-crown.png')
}
