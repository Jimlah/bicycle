import * as THREE from 'three'
import { layout, P } from './bike.mjs'
import { buildFrame } from '../parts/frame.mjs'

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))

const optional = async (rel, fn) => {
  const path = resolve(here, '..', 'parts', rel)
  if (!existsSync(path)) return null
  const mod = await import(path)
  if (typeof mod[fn] !== 'function') throw new Error(`${rel} does not export ${fn}`)
  return mod[fn]
}

export const ASSEMBLIES = [
  { id: 'frame', name: 'Frame' },
  { id: 'fork', name: 'Fork' },
  { id: 'wheels', name: 'Wheels' },
  { id: 'drivetrain', name: 'Drivetrain' },
  { id: 'cockpit', name: 'Cockpit' },
  { id: 'brakes', name: 'Brakes' },
  { id: 'finishing', name: 'Finishing kit' },
]

export const DENSITY = { steel: 7.85, alu: 2.7, carbon: 1.6, rubber: 1.15, leather: 0.9, chrome: 7.85, black: 1.4, paint: 7.85, brass: 8.5 }

const EXPLODE_DIR = {
  frame: [0, 0, 0],
  fork: [0.45, 0.12, 0],
  wheels: [0.12, 0, 1],
  drivetrain: [0, 0.02, 1],
  cockpit: [0.06, 1, 0],
  brakes: [0.7, 0.25, 0.15],
  finishing: [0.25, 0.55, 0.9],
}

/** Bounding box from the kernel bodies' own boxes, so nothing is tessellated yet. */
const bboxOf = (obj) => {
  const box = new THREE.Box3()
  obj.updateMatrixWorld(true)
  obj.traverse((o) => {
    if (!o.isMesh) return
    if (typeof o.bbox === 'function' && !o.isBrepFace && !o.isBrepEdge) {
      box.union(o.bbox().clone().applyMatrix4(o.matrixWorld))
    } else if (o.geometry) {
      o.geometry.computeBoundingBox()
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld))
    }
  })
  return box
}

/** Every part of the bike as one list of records, with masses and explode vectors. */
export async function assemble() {
  const L = layout()
  const parts = []

  const { frame } = buildFrame(L)
  parts.push({
    id: 'frame', name: 'Frame', assembly: 'frame', material: 'paint', object: frame, density: 1.6,
    spec: {
      'Tubes': 'Hollow steel, butted', 'Head tube': '44 mm x 170 mm', 'BB shell': 'BSA 68 mm',
      'Seat tube': `${P.seatTubeLen} mm c-t, 73.3 deg`, 'Rear dropouts': '130 mm, 9 mm slot',
    },
  })

  const fork = await optional('fork.mjs', 'buildFork')
  const wheels = await optional('wheels.mjs', 'buildWheels')
  const drivetrain = await optional('drivetrain.mjs', 'buildDrivetrain')
  const cockpit = await optional('cockpit.mjs', 'buildCockpit')
  const brakes = await optional('brakes.mjs', 'buildBrakes')
  const finishing = await optional('finishing.mjs', 'buildFinishing')

  for (const [fn, label] of [[fork, 'fork'], [wheels, 'wheels'], [drivetrain, 'drivetrain'], [cockpit, 'cockpit'], [brakes, 'brakes'], [finishing, 'finishing']]) {
    if (!fn) {
      console.warn(`assemble: no builder for ${label}`)
      continue
    }
    const records = fn(L)
    for (const r of records) {
      if (!r.density) r.density = DENSITY[r.material] ?? 2.7
      parts.push(r)
    }
  }

  // sanity: every part draws something and stays inside the bike
  const envelope = new THREE.Box3(new THREE.Vector3(-800, -30, -320), new THREE.Vector3(960, 1250, 320))
  for (const part of parts) {
    part.object.updateMatrixWorld(true)
    const box = bboxOf(part.object)
    if (!isFinite(box.min.x) || box.isEmpty()) throw new Error(`part ${part.id}: empty bounding box`)
    if (!envelope.containsBox(box)) {
      const pad = 1
      const inside = box.min.x >= envelope.min.x - pad && box.max.x <= envelope.max.x + pad &&
        box.min.y >= envelope.min.y - pad && box.max.y <= envelope.max.y + pad &&
        box.min.z >= envelope.min.z - pad && box.max.z <= envelope.max.z + pad
      if (!inside) console.warn(`part ${part.id}: outside the bike envelope`, box.min.toArray().map(Math.round), box.max.toArray().map(Math.round))
    }
    part.box = box
    part.center = box.getCenter(new THREE.Vector3())
  }

  // hollow or foam parts are solid bodies here: give them an effective density so the
  // mass readout matches the real thing instead of a solid lump
  const EFFECTIVE = [
    ['padding', 0.12], ['housing', 0.28], ['saddle.shell', 0.55], ['tape', 0.4],
  ]
  for (const part of parts) {
    const hit = EFFECTIVE.find(([k]) => part.id.includes(k))
    if (hit) part.density = hit[1]
  }

  // mass: sum the kernel volume of every body in the part
  for (const part of parts) {
    let cm3 = 0
    part.object.traverse((o) => {
      if (o.isPart && o.massProperties) {
        try { cm3 += o.massProperties().volume / 1000 } catch { /* not a body */ }
      }
    })
    part.volume = cm3
    part.mass = cm3 * part.density
  }

  // explode: out along the assembly's own direction, fanned from the assembly centre
  for (const a of ASSEMBLIES) {
    const group = parts.filter((p) => p.assembly === a.id)
    if (!group.length) continue
    const centre = new THREE.Vector3()
    for (const p of group) centre.add(p.center)
    centre.divideScalar(group.length)
    const dir = new THREE.Vector3(...(EXPLODE_DIR[a.id] ?? [0, 1, 0])).normalize()
    for (const p of group) {
      const out = p.center.clone().sub(centre)
      if (out.lengthSq() < 1) out.copy(dir)
      out.normalize()
      p.explode = out.multiplyScalar(210).addScaledVector(dir, 320).toArray()
    }
  }

  const box = new THREE.Box3()
  for (const p of parts) box.union(p.box)
  const total = { parts: parts.length, volume: parts.reduce((s, p) => s + p.volume, 0), mass: parts.reduce((s, p) => s + p.mass, 0) }
  return { L, parts, box, total }
}
