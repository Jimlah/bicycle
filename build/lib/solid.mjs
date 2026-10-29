import * as THREE from 'three'
import { Circle, Ellipse, Cylinder, Box, Part, loft, fillet } from '@classcad/smlibpy-three'
import { v3, tube, discZ, deg } from './geo.mjs'

/** Circle sections normal to a polyline, lofted into one body. */
export function loftCircles(points, radii, { oval = null, up = v3(0, 1, 0) } = {}) {
  const pts = points.map((p) => (p.isVector3 ? p : v3(...p)))
  const sections = pts.map((p, i) => {
    const next = pts[Math.min(i + 1, pts.length - 1)]
    const prev = pts[Math.max(i - 1, 0)]
    const t = new THREE.Vector3().subVectors(next, prev).normalize()
    let x = new THREE.Vector3().crossVectors(t, up)
    if (x.lengthSq() < 1e-6) x = new THREE.Vector3().crossVectors(t, v3(0, 0, 1))
    x.normalize()
    const y = new THREE.Vector3().crossVectors(t, x).normalize()
    const s = oval
      ? new Ellipse(radii[i] * oval[0], radii[i] * oval[1])
      : new Circle(radii[i])
    // the sketch's local x/y become x/y in the section's frame
    const m = new THREE.Matrix4().makeBasis(x, y, t)
    s.applyMatrix4(m)
    s.position.copy(p)
    s.updateMatrixWorld(true)
    return s
  })
  return loft(sections)
}

/** Fillet with a cascade of radii; returns [part, radiusUsed]. */
export function safeFillet(part, edges, radii = [5, 4, 3, 2, 1.2]) {
  let last = null
  for (const r of radii) {
    try {
      return [part.fillet(edges, r), r]
    } catch (e) {
      last = e
    }
  }
  return [part, null]
}

/** Fillet only the edges within `reach` of one of `points`. */
export function filletAt(part, points, { radii = [5, 4, 3, 2], reach = 55 } = {}) {
  const pts = points.map((p) => (p.isVector3 ? p : v3(...p)))
  part.updateMatrixWorld(true)
  const edges = part.edges().concave().filter((e) => {
    const c = e.getWorldPosition(new THREE.Vector3())
    return pts.some((p) => c.distanceTo(p) < reach)
  })
  if (!edges.length) return [part, null]
  return safeFillet(part, edges, radii)
}

/** Union many bodies, then fillet the concave seams near the given junctions. */
export function welded(bodies, junctions, opts) {
  const [first, ...rest] = bodies
  let part = first.fuse(...rest)
  return filletAt(part, junctions, opts)
}
