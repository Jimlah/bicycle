import * as THREE from 'three'
import { gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assemble, ASSEMBLIES } from './lib/assemble.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../bicycle.html')

const { parts, box, total, L } = await assemble()

// --- bake every part's meshes into one quantised buffer --------------------
const min = box.min.clone()
const size = box.getSize(new THREE.Vector3())
const Q = 65535

const chunks = []
let offset = 0
const push = (buf) => {
  const pad = (4 - (buf.length % 4)) % 4
  const b = pad ? Buffer.concat([buf, Buffer.alloc(pad)]) : buf
  const at = offset
  chunks.push(b)
  offset += b.length
  return at
}

const meshesMeta = []
const partsMeta = []
let triangles = 0
let vertices = 0

for (const [pi, part] of parts.entries()) {
  part.object.updateMatrixWorld(true)
  // tessellation is lazy: the coarsest tolerance that still hides the facets at this
  // body's own size, so a 3 mm bolt and a 700 mm wheel both look round
  part.object.traverse((o) => {
    if (!o.isPart || typeof o.bbox !== 'function') return
    const diag = o.bbox().getSize(new THREE.Vector3()).length()
    o.tolerance = Math.max(0.05, Math.min(0.45, diag * 0.004))
    o.angle = 0.5
  })
  const list = []
  part.object.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return
    if (o.isBrepFace || o.isBrepEdge) return
    list.push(o)
  })

  const isLink = part.id.startsWith('drivetrain.chain.')
  for (const mesh of list) {
    const g = mesh.geometry.clone()
    g.applyMatrix4(mesh.matrixWorld)
    const centre = new THREE.Vector3()
    let rz = 0
    let lmin = null
    let lsize = null
    if (isLink) {
      g.computeBoundingBox()
      const bb = g.boundingBox
      bb.getCenter(centre)
      lmin = [bb.min.x - centre.x, bb.min.y - centre.y, bb.min.z - centre.z]
      lsize = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z]
      const e = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion().setFromRotationMatrix(mesh.matrixWorld), 'XYZ')
      rz = e.z
    }
    const pos = g.attributes.position
    const nrm = g.attributes.normal
    const n = pos.count
    if (!n) continue

    const p16 = new Uint16Array(n * 3)
    const n8 = new Int8Array(n * 3)
    const v = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i)
      if (isLink) {
        v.sub(centre)
        p16[i * 3] = Math.round(((v.x - lmin[0]) / Math.max(1e-3, lsize[0])) * Q)
        p16[i * 3 + 1] = Math.round(((v.y - lmin[1]) / Math.max(1e-3, lsize[1])) * Q)
        p16[i * 3 + 2] = Math.round(((v.z - lmin[2]) / Math.max(1e-3, lsize[2])) * Q)
      } else {
        p16[i * 3] = Math.round(((v.x - min.x) / size.x) * Q)
        p16[i * 3 + 1] = Math.round(((v.y - min.y) / size.y) * Q)
        p16[i * 3 + 2] = Math.round(((v.z - min.z) / size.z) * Q)
      }
      if (nrm) {
        n8[i * 3] = Math.round(Math.max(-1, Math.min(1, nrm.getX(i))) * 127)
        n8[i * 3 + 1] = Math.round(Math.max(-1, Math.min(1, nrm.getY(i))) * 127)
        n8[i * 3 + 2] = Math.round(Math.max(-1, Math.min(1, nrm.getZ(i))) * 127)
      }
    }

    let index
    let idx32 = false
    if (g.index) {
      const arr = g.index.array
      idx32 = n > 65535
      index = idx32 ? new Uint32Array(arr) : new Uint16Array(arr)
    } else {
      idx32 = n > 65535
      index = new Uint16Array(n)
      for (let i = 0; i < n; i++) index[i] = i
      if (idx32) {
        const big = new Uint32Array(n)
        for (let i = 0; i < n; i++) big[i] = i
        index = big
      }
    }

    meshesMeta.push({
      part: pi,
      centre: isLink ? centre.toArray().map((x) => Math.round(x * 100) / 100) : null,
      lmin: isLink ? lmin.map((x) => Math.round(x * 100) / 100) : null,
      lsize: isLink ? lsize.map((x) => Math.round(x * 100) / 100) : null,
      rz: isLink ? Math.round(rz * 10000) / 10000 : 0,
      link: isLink,
      pos: push(Buffer.from(p16.buffer)),
      verts: n,
      nrm: push(Buffer.from(n8.buffer)),
      idx: push(Buffer.from(index.buffer)),
      idxCount: index.length,
      idx32,
    })
    triangles += index.length / 3
    vertices += n
    g.dispose()
  }

  partsMeta.push({
    id: part.id,
    name: part.name,
    assembly: part.assembly,
    material: part.material,
    spec: part.spec ?? {},
    mass: Math.round(part.mass * 10) / 10,
    volume: Math.round(part.volume * 10) / 10,
    explode: (part.explode ?? [0, 0, 0]).map((x) => Math.round(x)),
    meshes: meshesMeta.filter((m) => m.part === pi).length,
  })
}

const binary = Buffer.concat(chunks)
const gz = gzipSync(binary, { level: 9 })
const b64 = gz.toString('base64')

const specs = JSON.parse(readFileSync(resolve(here, 'specs.json'), 'utf8'))

// anchors the mechanism needs, taken from the model itself
const pedalAnchor = (suffix) => {
  const record = parts.find((p) => p.id.includes(suffix))
  if (!record) return [0, 0, 0]
  const b = new THREE.Box3()
  record.object.updateMatrixWorld(true)
  record.object.traverse((o) => {
    if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)) }
  })
  return b.getCenter(new THREE.Vector3()).toArray().map((v) => Math.round(v * 10) / 10)
}
const layout = {
  bb: L.bb.toArray(),
  rearHub: L.rearHub.toArray(),
  frontHub: L.frontHub.toArray(),
  uHead: L.uHead.toArray(),
  headMid: L.headBottom.clone().lerp(L.headTop, 0.5).toArray(),
  pedalDrive: pedalAnchor('pedal.drive'),
  pedalNonDrive: pedalAnchor('pedal.nondrive'),
}

const meta = {
  title: 'Trek Emonda SL · 56 cm · full build',
  subtitle: 'Every part modelled with @classcad/smlibpy-three 0.6.2 on the SMLib kernel',
  min: min.toArray(),
  size: size.toArray(),
  box: [box.min.toArray().map(Math.round), box.max.toArray().map(Math.round)],
  parts: partsMeta,
  meshes: meshesMeta,
  assemblies: ASSEMBLIES,
  totals: {
    parts: parts.length,
    triangles: Math.round(triangles),
    vertices,
    mass: Math.round(total.mass),
    volume: Math.round(total.volume),
  },
  geometry: {
    wheelbase: +(L.frontHub.x - L.rearHub.x).toFixed(1),
    stack: +(L.headTop.y - L.bb.y).toFixed(1),
    reach: +(L.headTop.x - L.bb.x).toFixed(1),
    bbDrop: 70,
    seatAngle: 73.3,
    headAngle: 73.5,
    chainstay: 410,
    frontCentre: +(L.frontHub.x - L.bb.x).toFixed(1),
    trail: 57.8,
  },
  specs,
  layout,
  binaryBytes: binary.length,
  gzipBytes: gz.length,
}

const template = readFileSync(resolve(here, 'viewer/index.html'), 'utf8')
const app = readFileSync(resolve(here, 'viewer/app.js'), 'utf8') + '\n' + readFileSync(resolve(here, 'viewer/physics.js'), 'utf8')
const threeCore = gzipSync(readFileSync(resolve(here, 'node_modules/three/build/three.core.js')), { level: 9 }).toString('base64')
const threeModule = gzipSync(readFileSync(resolve(here, 'node_modules/three/build/three.module.js')), { level: 9 }).toString('base64')
const rapier = gzipSync(readFileSync(resolve(here, 'node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs')), { level: 9 }).toString('base64')

const html = template
  .replace('/*__THREE_CORE__*/', () => threeCore)
  .replace('/*__THREE_MODULE__*/', () => threeModule)
  .replace('/*__RAPIER__*/', () => rapier)
  .replace('/*__META__*/', () => JSON.stringify(meta))
  .replace('/*__B64__*/', () => JSON.stringify(b64))
  .replace('/*__APP__*/', () => app)

writeFileSync(out, html)
console.log(`wrote ${out}`)
console.log(`parts ${parts.length}, meshes ${meshesMeta.length}, triangles ${Math.round(triangles)}, vertices ${vertices}`)
console.log(`binary ${(binary.length / 1e6).toFixed(2)} MB, gzip ${(gz.length / 1e6).toFixed(2)} MB, html ${(html.length / 1e6).toFixed(2)} MB`)
console.log(`mass ${(total.mass / 1000).toFixed(1)} kg`)
