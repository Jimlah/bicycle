import * as THREE from 'three'
import {
  Polygon, Circle, Rectangle, RoundedRectangle, RegularPolygon,
  Cylinder, Cone, Box, Ball, Torus, Part, Sketch,
  revolve, extrude, sweep, Polyline, Segment, CenterArc, Spline, Wire, makeFace,
} from '@classcad/smlibpy-three'

export const Y = new THREE.Vector3(0, 1, 0)
export const Z = new THREE.Vector3(0, 0, 1)
export const deg = (d) => (d * Math.PI) / 180

export const v3 = (x, y, z = 0) => new THREE.Vector3(x, y, z)
export const v2 = (x, y) => new THREE.Vector2(x, y)

/** A closed profile sketch in the XY plane from [x, y] pairs. */
export function profile(points) {
  return new Polygon(points.map(([x, y]) => v2(x, y)))
}

/** The band between an outer and an inner outline, as one closed loop of points. */
export function band(outer, inner) {
  return [...outer, ...inner.slice().reverse()]
}

/**
 * Solid of revolution about a local Y axis. Points are [radius, y].
 * The result occupies y in [0, maxY] of its own frame.
 */
export function latheY(points) {
  const s = Array.isArray(points) ? profile(points) : points
  return s.revolve(new THREE.Ray(v3(0, 0, 0), Y), Math.PI * 2)
}

/** Hollow tube wall along local Y, from 0 to length. */
export function tubeWallY(length, rOuter, rInner, { chamfer = 0.6 } = {}) {
  const o = [[rOuter, 0]]
  if (chamfer) o.push([rOuter, chamfer])
  o.push([rOuter, length - chamfer], [rOuter, length])
  const inner = [[rInner, 0], [rInner, length]]
  return latheY(band(o, inner))
}

/** Place an object built along +Y from 0..len so it runs from a to b. */
export function along(obj, a, b) {
  const A = a.isVector3 ? a : v3(...a)
  const B = b.isVector3 ? b : v3(...b)
  const d = new THREE.Vector3().subVectors(B, A)
  obj.position.copy(A)
  obj.quaternion.setFromUnitVectors(Y, d.clone().normalize())
  return obj
}

/** Center an object built about its own origin on the line from a to b. */
export function centered(obj, a, b) {
  const A = a.isVector3 ? a : v3(...a)
  const B = b.isVector3 ? b : v3(...b)
  const d = new THREE.Vector3().subVectors(B, A)
  obj.position.copy(A).addScaledVector(d, 0.5)
  obj.quaternion.setFromUnitVectors(Y, d.clone().normalize())
  return obj
}

/** Cylinder standing between two points. */
export function tube(a, b, r1, r2 = r1) {
  const A = a.isVector3 ? a : v3(...a)
  const B = b.isVector3 ? b : v3(...b)
  const len = A.distanceTo(B)
  return centered(new Cylinder(r2, r1, len), A, B)
}

/** Hollow tube between two points, ends open (annular faces). */
export function pipe(a, b, rOuter, rInner) {
  const A = a.isVector3 ? a : v3(...a)
  const B = b.isVector3 ? b : v3(...b)
  const len = A.distanceTo(B)
  return along(tubeWallY(len, rOuter, rInner, { chamfer: 0 }), A, B)
}

/** Disc whose axis is Z (wheels, flanges), centered on `at`. */
export function discZ(radius, thickness, at = v3(0, 0, 0)) {
  const d = new Cylinder(radius, radius, thickness)
  d.rotation.x = Math.PI / 2
  d.position.copy(at)
  return d
}

/** Hollow ring whose axis is Z. */
export function ringZ(rOuter, rInner, thickness, at = v3(0, 0, 0)) {
  const o = latheY(band([[rInner, 0], [rOuter, 0]], [[rInner, thickness], [rOuter, thickness]]))
  o.rotation.x = Math.PI / 2
  o.position.copy(at)
  return o
}

/** Torus with its axis on Z. */
export function torusZ(radius, tubeRadius, at = v3(0, 0, 0)) {
  const t = new Torus(radius, tubeRadius)
  t.position.copy(at)
  return t
}

/** A box centered on `at`, optionally turned. */
export function boxAt(size, at, rot = [0, 0, 0]) {
  const [w, h, d] = size
  const b = new Box(w, h, d)
  b.position.copy(at)
  b.rotation.set(...rot)
  return b
}

/**
 * Chainring / sprocket: teeth on the pitch circle, extruded on Z and centered.
 * `pitch` is the chain pitch (12.7 for 1/2 inch).
 */
export function sprocket({ teeth, pitch = 12.7, thickness = 2, center = v3(0, 0, 0), holes = [] }) {
  const R = pitch / (2 * Math.sin(Math.PI / teeth))
  const rTip = R + 0.34 * pitch
  const rRoot = R - 0.36 * pitch
  const step = (Math.PI * 2) / teeth
  const pts = []
  const at = (r, a) => pts.push([r * Math.cos(a), r * Math.sin(a)])
  for (let i = 0; i < teeth; i++) {
    const a = i * step
    const gullet = step * 0.5
    at(rRoot, a - gullet * 0.62)
    at(rTip * 0.995, a - step * 0.155)
    at(rTip, a - step * 0.06)
    at(rTip, a + step * 0.06)
    at(rTip * 0.995, a + step * 0.155)
    at(rRoot, a + gullet * 0.62)
    at(rRoot, a + step * 0.5 - 0.02)
  }
  let s = profile(pts)
  for (const h of holes) {
    s = s.cut(h)
  }
  const p = s.extrude(thickness)
  p.position.copy(center).add(v3(0, 0, -thickness / 2))
  return p
}

/** Round-capped slot outline, centered, long axis on X. */
export function slot(W, H) {
  return new Rectangle(W, H, { fillet: Math.min(W, H) / 2 })
}

/** Wire through points, optionally closed. */
export function wire(points, closed = false) {
  const pts = points.map((p) => (p.isVector3 ? p : v3(...p)))
  if (closed) pts.push(pts[0].clone())
  return new Wire(pts.map((p, i) => {
    if (i === 0) return null
    return new Segment([pts[i - 1], p])
  }).filter(Boolean))
}

/** Sweep a circular section along a path of points, fillet-smoothed. */
export function sweptTube(points, radius, { closed = false, fillet = 0 } = {}) {
  const pts = points.map((p) => (p.isVector3 ? p : v3(...p)))
  const path = closed ? new THREE.CatmullRomCurve3(pts, true) : new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2)
  const s = new Circle(radius)
  return sweep(s, path)
}

/** Rounded plate: extruded 2D outline on Z, centered. */
export function plate(shape, thickness) {
  const p = shape.extrude(thickness)
  p.position.z = -thickness / 2
  return p
}

export function hexBolt(headAcross, length, at, dir = v3(0, 0, 1)) {
  const head = centered(new Cone(headAcross * 0.58, headAcross * 0.58, headAcross * 0.35), v3(0, 0, 0), dir)
  head.position.copy(at).addScaledVector(dir, headAcross * 0.18)
  return head
}

/** Mass in grams from a body's volume and a density in g/cm3. */
export function massG(body, density) {
  const vol = body.massProperties().volume
  return (vol / 1000) * density
}
