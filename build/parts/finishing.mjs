/**
 * Finishing: bottle cage and bottle on the frame's down-tube bosses, the seat binder (saddle
 * clamp) bolt, bar end plugs, rear reflector and the chainstay protector.
 *
 *   node parts/finishing.mjs
 */
import * as THREE from 'three'
import {
  render, Cylinder, Cone, Ball, Torus, Box, RoundedRectangle, Rectangle, Circle, sweep,
} from '@classcad/smlibpy-three'
import { v3, tube, pipe, latheY, along, centered, boxAt, sweptTube, deg } from '../lib/geo.mjs'
import { loftCircles, safeFillet } from '../lib/solid.mjs'
import { layout, P } from '../lib/bike.mjs'
import { barEnds } from './cockpit.mjs'
import { writeFileSync } from 'node:fs'

const Z = v3(0, 0, 1)
const Y = v3(0, 1, 0)

const DENSITY = {
  alu: 2.7, steel: 7.85, chrome: 7.85, carbon: 1.55, rubber: 1.15, black: 1.4,
  paint: 1.2, red: 1.19, brass: 8.4,
}

/* ---------------------------------------------------------------- helpers -- */

function rec(id, name, material, spec, object) {
  return { id, name, assembly: 'finishing', material, spec, object, density: DENSITY[material] ?? 2.7 }
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

function tryFuse(bodies, name = '') {
  try {
    const out = bodies[0].fuse(...bodies.slice(1))
    if (!out.isValid()) throw new Error('invalid')
    out.name = name
    return out
  } catch (e) { return group(...bodies) }
}

function framed(obj, origin, ex, ey, ez) {
  const m = new THREE.Matrix4().makeBasis(ex.clone().normalize(), ey.clone().normalize(), ez.clone().normalize())
  obj.position.copy(origin)
  obj.quaternion.setFromRotationMatrix(m)
  return obj
}

/** A hollow tube swept along a path: rOut wall outside, rIn bore. */
function hollowSweep(points, rOut, rIn) {
  const path = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.2)
  try {
    const s = sweep(new Circle(rOut).cut(new Circle(rIn)), path)
    if (s && s.isValid()) return s
  } catch (e) { /* fall through */ }
  return sweptTube(points, rOut)
}

/* ------------------------------------------------------------ verification */

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

/* --------------------------------------------------------- bottle bosses --- */

/**
 * The frame's two down-tube bosses: at 28 % and 62 % along the down tube, 19 mm out along
 * the boss direction frame.mjs uses (frame.mjs: `Y.lerp((-0.5,1,0).normalize(), 0.2)`).
 */
export function bottleBosses(L) {
  const dir = v3(0, 1, 0).lerp(v3(-0.5, 1, 0).normalize(), 0.2).normalize()
  return [0.28, 0.62].map((t) => {
    const p = L.dtHead.clone().lerp(L.dtBb, t)
    return { at: p.clone().addScaledVector(dir, 27.5), base: p, dir, t }
  })
}

/* -------------------------------------------------------------- bottle ----- */

function buildBottle(L) {
  const bosses = bottleBosses(L)
  const n = bosses[0].dir.clone()                     // out of the down tube
  const alongTube = bosses[1].at.clone().sub(bosses[0].at).normalize()
  const side = new THREE.Vector3().crossVectors(alongTube, n).normalize()
  const mid = bosses[0].at.clone().lerp(bosses[1].at, 0.5)
  const spacing = bosses[0].at.distanceTo(bosses[1].at)

  // base plate: long enough to reach both bosses (the frame's bosses are 209 mm apart)
  const plateLen = spacing + 30
  const plate = new RoundedRectangle(plateLen, 28, 13).extrude(4.5)
  // RoundedRectangle is in sketch XY; put its length along the tube, its width along Z
  framed(plate, mid.clone().addScaledVector(n, 2.5), alongTube, side, n)
  // the rectangle's local x -> alongTube, local y -> side, extrusion (+z) -> n

  // 2 wire hoops around the bottle, open towards the bottom bracket
  const bottleAxis = n.clone()
  const base = mid.clone().addScaledVector(n, 5)
  const hoops = []
  for (const h of [26, 152]) {
    const c = base.clone().addScaledVector(bottleAxis, h)
    const pts = []
    const a0 = deg(-150)
    const a1 = deg(150)
    for (let i = 0; i <= 16; i++) {
      const a = a0 + ((a1 - a0) * i) / 16
      pts.push(c.clone()
        .addScaledVector(alongTube, Math.sin(a) * 44)
        .addScaledVector(side, Math.cos(a) * 44))
    }
    hoops.push(sweptTube(pts, 2.6))
  }
  // 2 spines from the plate out to the top of the bottle
  for (const s of [-1, 1]) {
    hoops.push(sweptTube([
      mid.clone().addScaledVector(side, s * 17).addScaledVector(n, 4),
      mid.clone().addScaledVector(side, s * 33).addScaledVector(n, 18),
      mid.clone().addScaledVector(side, s * 40).addScaledVector(n, 90),
      mid.clone().addScaledVector(side, s * 40).addScaledVector(n, 160),
      mid.clone().addScaledVector(side, s * 30).addScaledVector(n, 186),
    ], 2))
  }
  // hook over the top of the bottle
  const hookPts = []
  for (let i = 0; i <= 10; i++) {
    const a = deg(-40) + (deg(80) * i) / 10
    hookPts.push(base.clone().addScaledVector(bottleAxis, 182)
      .addScaledVector(alongTube, Math.sin(a) * 41)
      .addScaledVector(side, Math.cos(a) * 41))
  }
  hoops.push(sweptTube(hookPts, 2.2))

  const cage = tryFuse([plate, ...hoops], 'Bottle cage')

  // the bottle: 750 ml, Ø74 x 210, with cap and nozzle
  const bottleH = 200
  const body = latheY([
    [0, 0], [30, 0], [35, 4], [37, 12], [37, 168], [36, 178],
    [31, 186], [26, 192], [23, 196], [23, 200], [0, 200],
  ])
  along(body, base.clone().addScaledVector(bottleAxis, 4), base.clone().addScaledVector(bottleAxis, 4 + bottleH))
  const cap = latheY([
    [0, 0], [20, 0], [20, 5], [21, 7], [21, 16], [18, 19], [0, 19],
  ])
  along(cap, base.clone().addScaledVector(bottleAxis, 4 + bottleH), base.clone().addScaledVector(bottleAxis, 4 + bottleH + 19))
  const nozzle = latheY([[0, 0], [8, 0], [7, 4], [5, 9], [5, 13], [0, 13]])
  along(nozzle, base.clone().addScaledVector(bottleAxis, 4 + bottleH + 17), base.clone().addScaledVector(bottleAxis, 4 + bottleH + 30))

  // 2 x M5 bolts into the bosses
  const bolts = []
  for (const b of bosses) {
    // head on the plate's outer face, shank down into the boss
    bolts.push(tube(b.at.clone().addScaledVector(n, 11), b.at.clone().addScaledVector(n, 5.5), 4.7, 4.3))
    bolts.push(tube(b.at.clone().addScaledVector(n, 5.5), b.at.clone().addScaledVector(n, -18), 2.5))
  }

  return {
    cage, bottle: group(body, cap, nozzle), bolts: group(...bolts),
    info: { spacing, plateLen, base, n, alongTube, side, mid },
  }
}

/* ---------------------------------------------------------- seat binder ---- */

function buildSeatBinder(L) {
  const S = L.uSeat.clone()
  const collar = L.seatTop.clone().addScaledVector(S, -9)   // the frame's seat collar
  // a bolt across the collar, along Z, with a barrel nut on the non-drive side
  const a = collar.clone().add(v3(0, 0, -30))
  const b = collar.clone().add(v3(0, 0, 30))
  return group(
    tube(a, b, 2.5),                                   // M5 through bolt
    tube(a, a.clone().add(v3(0, 0, 4)), 4.6, 4.2),     // head
    tube(b.clone().add(v3(0, 0, -6)), b, 5.4, 2.5),    // barrel nut
    tube(b.clone().add(v3(0, 0, -1.6)), b.clone().add(v3(0, 0, -1.2)), 6, 2.5), // washer
  )
}

/* --------------------------------------------------------------- bar ends -- */

function buildBarEnds(L) {
  const plugs = []
  for (const e of barEnds(L)) {
    const inner = e.point.clone().addScaledVector(e.dir, -20)
    const p = pipe(inner, e.point.clone().addScaledVector(e.dir, -0.5), 11.6, 8.4)
    const flange = pipe(e.point.clone().addScaledVector(e.dir, -1.4), e.point.clone().addScaledVector(e.dir, 1.2), 11.9, 9)
    plugs.push(p, flange)
  }
  return group(...plugs)
}

/* ------------------------------------------------------------ reflector ---- */

function buildReflector(L) {
  const S = L.uSeat.clone()
  const at = L.seatpostTop.clone().addScaledVector(S, -52)
  // the reflector faces back at the seatpost: a 40 x 25 plate on a bracket
  const plate = new RoundedRectangle(40, 25, 6).extrude(5)
  framed(plate, at.clone().add(v3(-17, 0, 0)), Z, Y, v3(-1, 0, 0))
  const bracket = new Box(9, 16, 30)
  bracket.position.copy(at).add(v3(-10, 0, 0))
  const clamp = pipe(at.clone().add(v3(0, 11, 0)), at.clone().add(v3(0, -11, 0)), 14.6, 13.5)
  return group(plate, bracket, clamp)
}

/* ---------------------------------------------------- chainstay protector --- */

function buildChainstayProtector(L) {
  // the drive side chainstay, as frame.mjs builds it
  const csBb = L.bb.clone().add(v3(6, -2, 0))
  const csDrop = L.rearHub.clone().add(v3(4, 0, 0))
  const path = [
    csBb.clone().add(v3(2, 0, 20)),
    v3(-90, 285, 41),
    v3(-200, 300, 55),
    v3(-300, 320, 65),
    csDrop.clone().add(v3(-6, 0, 63)),
  ]
  // 180 mm along the path from the bottom bracket end
  const cut = []
  let run = 0
  cut.push(path[0].clone())
  for (let i = 1; i < path.length; i++) {
    const seg = path[i].distanceTo(path[i - 1])
    if (run + seg >= 180) {
      cut.push(path[i - 1].clone().lerp(path[i], (180 - run) / seg))
      break
    }
    run += seg
    cut.push(path[i].clone())
  }
  const sleeve = hollowSweep(cut, 16.2, 14.4)
  // a tie-wrapped end lip at both ends
  const lips = [cut[0], cut[cut.length - 1]].map((p, i) => {
    const d = i === 0
      ? cut[1].clone().sub(cut[0]).normalize()
      : cut[cut.length - 1].clone().sub(cut[cut.length - 2]).normalize()
    return pipe(p.clone().addScaledVector(d, -2), p.clone().addScaledVector(d, 4), 17, 14.2)
  })
  return group(sleeve, ...lips)
}

/* ---------------------------------------------------------------- builder -- */

export function buildFinishing(L = layout()) {
  const records = []
  const b = buildBottle(L)
  records.push(rec('finishing.bottle.cage', 'Bottle cage', 'alu', {
    Wire: 'Ø4', Bosses: '2 x M5, 209 mm apart (frame)', Plate: `${b.info.plateLen.toFixed(0)} mm`,
  }, setTol(b.cage)))
  records.push(rec('finishing.bottle.cage.bolts', 'Cage bolts', 'steel', {
    Size: '2 x M5 x 20', Head: 'socket cap',
  }, setTol(b.bolts)))
  records.push(rec('finishing.bottle', 'Bottle 750 ml', 'paint', {
    Size: 'Ø74 x 210 mm', Volume: '750 ml', Cap: 'push-pull',
  }, setTol(b.bottle)))

  records.push(rec('finishing.saddleclamp', 'Saddle clamp binder bolt', 'steel', {
    Bolt: 'M5 x 55', Nut: 'barrel', Washer: 'Ø12',
  }, setTol(buildSeatBinder(L))))

  records.push(rec('finishing.barends', 'Bar end plugs', 'rubber', {
    Size: '2 x Ø23.8 x 20 mm', Fit: 'friction',
  }, setTol(buildBarEnds(L))))

  records.push(rec('finishing.reflector', 'Rear reflector', 'red', {
    Size: '40 x 25 mm', Mount: 'seatpost clamp',
  }, setTol(buildReflector(L))))

  records.push(rec('finishing.chainstayprotector', 'Chainstay protector', 'rubber', {
    Length: '180 mm', Wall: '1.5 mm', Side: 'drive',
  }, setTol(buildChainstayProtector(L))))

  return records
}

/* -------------------------------------------------------------- self test -- */

export function checkFinishing(L = layout()) {
  const records = buildFinishing(L)
  const rows = verify(records)
  printTable(rows)
  const by = (id) => rows.find((r) => r.id === id)

  const cage = by('finishing.bottle.cage').bb
  console.log(`\ncage: bbox ${cage.min.toArray().map((n) => n.toFixed(0))} .. ` +
    `${cage.max.toArray().map((n) => n.toFixed(0))}`)
  const bottle = by('finishing.bottle').bb
  console.log(`bottle: ${bottle.getSize(new THREE.Vector3()).toArray().map((n) => n.toFixed(0)).join(' x ')}`,
    ` top at y=${bottle.max.y.toFixed(0)} (top tube underside near x=${bottle.max.x.toFixed(0)}:` +
    ` ${topTubeUnder(L, bottle.max.x).toFixed(0)})`)

  // bottle boss spacing, and how far the cage stands off the down tube
  const bosses = bottleBosses(L)
  console.log(`bosses: ${bosses.map((b) => `(${b.at.toArray().map((n) => n.toFixed(0)).join(',')})`).join(' ')}` +
    `  spacing ${bosses[0].at.distanceTo(bosses[1].at).toFixed(0)} mm`)

  // the bar plugs must sit inside the bar's ends
  const ends = barEnds(L)
  console.log(`bar ends: ${ends.map((e) => `(${e.point.toArray().map((n) => n.toFixed(0)).join(',')})`).join(' ')}`)

  // reflector on the post
  const refl = by('finishing.reflector').bb.getCenter(new THREE.Vector3())
  console.log(`reflector centre ${refl.toArray().map((n) => n.toFixed(0)).join(',')};` +
    ` seatpost top ${L.seatpostTop.toArray().map((n) => n.toFixed(0)).join(',')}`)

  setTol(records.map((r) => r.object), 0.25)
  const objs = records.map((r) => r.object)
  writeFileSync('/tmp/finishing.png', render(objs, {
    view: { azimuth: deg(160), elevation: deg(18) }, size: [1300, 820], background: '#eef2f7',
  }).data)
  // close-up of the cage and bottle from the drive side
  writeFileSync('/tmp/finishing-cage.png', render([records[0].object, records[1].object, records[2].object], {
    view: { azimuth: deg(115), elevation: deg(12) }, size: [900, 800], background: '#eef2f7',
  }).data)
  writeFileSync('/tmp/finishing-detail.png', render([
    records[3].object, records[4].object, records[5].object, records[6].object,
  ], { view: { azimuth: deg(150), elevation: deg(12) }, size: [1000, 800], background: '#eef2f7' }).data)
  console.log('\nwrote /tmp/finishing.png, /tmp/finishing-cage.png, /tmp/finishing-detail.png')
  return { records, rows }
}

/** y of the top tube's underside above a given x (for the bottle clearance check). */
function topTubeUnder(L, x) {
  const r = 15
  const dx = L.ttHead.x - L.ttSeat.x
  const t = Math.min(1, Math.max(0, (L.ttHead.x - x) / dx))
  return L.ttHead.y + (L.ttSeat.y - L.ttHead.y) * t - r
}

if (import.meta.url === `file://${process.argv[1]}`) checkFinishing()
