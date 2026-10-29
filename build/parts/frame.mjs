import * as THREE from 'three'
import { Cylinder, Box, Ball, RoundedRectangle, Rectangle } from '@classcad/smlibpy-three'
import { v3, tube, deg, latheY, band } from '../lib/geo.mjs'
import { loftCircles } from '../lib/solid.mjs'

const Y = v3(0, 1, 0)

/** A cylinder between a and b, hollow, with `keep` mm of solid at each end. */
function boredTube(a, b, rOuter, wall, keep = 34) {
  const outer = tube(a, b, rOuter)
  const dir = b.clone().sub(a).normalize()
  const inner = tube(a.clone().addScaledVector(dir, keep), b.clone().addScaledVector(dir, -keep), rOuter - wall)
  return outer.cut(inner)
}

/** The outward radial direction of `hint` at a point on a tube axis. */
function radialAt(a, b, t, hint) {
  const axis = b.clone().sub(a).normalize()
  const p = a.clone().lerp(b, t)
  const h = hint.clone()
  const radial = h.sub(axis.clone().multiplyScalar(h.dot(axis)))
  if (radial.lengthSq() < 1e-6) radial.copy(v3(0, 0, 1))
  return { p, radial: radial.normalize() }
}

/** A chamfered collar around a tube axis, from a to b: a lug or a sleeve. */
function collar(a, b, rTube, rOut, chamfer = 2.5) {
  const len = a.distanceTo(b)
  const outer = [[rTube, 0], [rOut, chamfer], [rOut, len - chamfer], [rTube, len]]
  const s = latheY(band(outer, [[rTube, 0], [rTube, len]]))
  s.position.copy(a)
  s.quaternion.setFromUnitVectors(Y, b.clone().sub(a).normalize())
  return s
}

/**
 * The frame: front triangle, rear triangle, BB shell, dropouts, bridges and
 * braze-ons, as one welded steel body. Tubes are hollow; the ends that run into
 * another tube stay solid so the union is watertight.
 */
export function buildFrame(L, { onStep = null } = {}) {
  const st = L.uSeat
  const ht = L.uHead
  const htLen = L.headTop.distanceTo(L.headBottom) + 8

  const headTube = new Cylinder(22, 22, htLen)
  headTube.quaternion.setFromUnitVectors(Y, ht)
  headTube.position.copy(L.headBottom).addScaledVector(ht, htLen / 2 - 4)

  const ttA = L.ttSeat.clone().addScaledVector(st, -26)
  const ttB = L.ttHead.clone().addScaledVector(ht, 16)
  const topTube = boredTube(ttA, ttB, 15.4, 0.95)

  const dtA = L.dtHead.clone().addScaledVector(ht, 6)
  const dtB = L.dtBb.clone().add(v3(6, 8, 0))
  const downTube = boredTube(dtA, dtB, 18.6, 1.05)

  const seatTube = boredTube(L.bb.clone().add(v3(0, -6, 0)), L.seatTop.clone().addScaledVector(st, 6), 15.9, 1.15, 26)

  const bbShell = new Cylinder(18.9, 18.9, 68)
  bbShell.rotation.x = Math.PI / 2
  bbShell.position.copy(L.bb)

  const csPaths = [1, -1].map((s) => [
    L.csBb.clone().add(v3(2, 2, s * 16)),
    v3(-100, 268, s * 40),
    v3(-210, 296, s * 55),
    v3(-312, 318, s * 65),
    L.csDrop.clone().add(v3(-6, 0, s * 66)),
  ])
  const chainstays = csPaths.map((p) => {
    const outer = loftCircles(p, [12.5, 11.5, 10.5, 9.5, 8], { oval: [1.2, 0.82] })
    const inner = loftCircles([p[1], p[2], p[3]], [10.2, 9.2, 8.0], { oval: [1.2, 0.82] })
    return outer.cut(inner)
  })

  const ssPaths = [1, -1].map((s) => {
    const a = L.ssCluster.clone().add(v3(2, -3, s * 12))
    const b = L.ssDrop.clone().add(v3(-2, 3, s * 58))
    const mid = a.clone().lerp(b, 0.5).add(v3(-3, 9, s * 11))
    return [a, mid, b]
  })
  const seatstays = ssPaths.map((p) => {
    const outer = loftCircles(p, [8.4, 7.2, 6])
    const inner = loftCircles([p[0].clone().lerp(p[1], 0.2), p[1], p[2].clone().lerp(p[1], 0.15)], [6.6, 5.6, 4.7])
    return outer.cut(inner)
  })

  const dropouts = [1, -1].map((s) => {
    const plate = new RoundedRectangle(48, 32, 12).extrude(6)
    plate.position.copy(L.rearHub).add(v3(-14, 0, s * 68 - 3))
    const slot = new Rectangle(24, 10.6, { fillet: 5 }).extrude(10)
    slot.position.copy(L.rearHub).add(v3(-20, 0, s * 68 - 5))
    return plate.cut(slot)
  })

  const ssMid = ssPaths[0][1]
  // the bridge sits where the stays clear the 336 mm tyre, so a rim caliper can hang from it
  const seatBridge = new Cylinder(5, 5, 58)
  seatBridge.rotation.x = Math.PI / 2
  seatBridge.position.set(-205, 657, 0)

  const csMid = csPaths[0][2]
  const chainBridge = new Cylinder(7.2, 7.2, 2 * Math.abs(csMid.z) + 2)
  chainBridge.rotation.x = Math.PI / 2
  chainBridge.position.set(csMid.x, csMid.y, 0)

  const step = (label, part) => { if (onStep) onStep(label, part) ; return part }
  let frame = headTube
  for (const [label, b] of [['topTube', topTube], ['downTube', downTube], ['seatTube', seatTube], ['bbShell', bbShell],
    ['cs1', chainstays[0]], ['cs2', chainstays[1]], ['ss1', seatstays[0]], ['ss2', seatstays[1]],
    ['do1', dropouts[0]], ['do2', dropouts[1]], ['seatBridge', seatBridge], ['chainBridge', chainBridge]]) {
    frame = step(label, frame.fuse(b))
  }

  const additions = []
  additions.push(collar(L.seatTop.clone().addScaledVector(st, -20), L.seatTop.clone().addScaledVector(st, 2), 15.6, 18.8))

  const binder = new Cylinder(3.2, 3.2, 42)
  binder.rotation.x = Math.PI / 2
  binder.position.copy(L.seatTop).addScaledVector(st, -13)
  additions.push(binder)

  for (const t of [0.3, 0.63]) {
    const { p, radial } = radialAt(dtA, dtB, t, v3(-0.3, 1, 0))
    const bossAt = p.clone().addScaledVector(radial, 18.2)
    const b = new Cylinder(4.6, 4.6, 11)
    b.quaternion.setFromUnitVectors(Y, radial)
    b.position.copy(bossAt)
    const dome = new Ball(4.6)
    dome.position.copy(bossAt).addScaledVector(radial, 5)
    additions.push(b, dome)
  }

  const stop1At = radialAt(dtA, dtB, 0.14, v3(0, 1, 0))
  const stop1 = new Box(9, 14, 8)
  stop1.quaternion.setFromUnitVectors(Y, stop1At.radial)
  stop1.position.copy(stop1At.p).addScaledVector(stop1At.radial, 19.5)
  additions.push(stop1)

  const stop2At = radialAt(ttA, ttB, 0.2, v3(0, 1, 0))
  const stop2 = new Box(8, 12, 7)
  stop2.quaternion.setFromUnitVectors(Y, stop2At.radial)
  stop2.position.copy(stop2At.p).addScaledVector(stop2At.radial, 16.5)
  additions.push(stop2)

  const hanger = new Box(9, 36, 6)
  hanger.position.copy(L.rearHub).add(v3(-2, -24, 62))
  hanger.rotation.z = deg(-10)
  additions.push(hanger)

  const hangerBolt = new Cylinder(5.2, 5.2, 7)
  hangerBolt.rotation.x = Math.PI / 2
  hangerBolt.position.copy(L.rearHub).add(v3(-4, -34, 65))
  additions.push(hangerBolt)

  for (const [i, a] of additions.entries()) frame = step('add' + i, frame.fuse(a))

  const seatBore = new Cylinder(13.6, 13.6, 400)
  seatBore.quaternion.setFromUnitVectors(Y, st)
  seatBore.position.copy(L.seatTop).addScaledVector(st, 80)

  const headBore = new Cylinder(20.3, 20.3, 260)
  headBore.quaternion.setFromUnitVectors(Y, ht)
  headBore.position.copy(L.headTop).addScaledVector(ht, -80)

  const bbBore = new Cylinder(15.1, 15.1, 90)
  bbBore.rotation.x = Math.PI / 2
  bbBore.position.copy(L.bb)

  const slot = new Box(4, 30, 60)
  slot.quaternion.setFromUnitVectors(Y, st)
  slot.position.copy(L.seatTop).addScaledVector(st, -11)

  frame = frame.cut(seatBore, headBore, bbBore, slot)
  frame.name = 'Frame'
  return { frame }
}
