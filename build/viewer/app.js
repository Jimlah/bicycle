const T = THREE
const canvas = document.getElementById('stage')
const tip = document.getElementById('tip')
const partlist = document.getElementById('partlist')
const dimlayer = document.getElementById('dimlayer')

// ---------------------------------------------------------------- geometry
const bin = await (async () => {
  const raw = atob(B64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
})()

const [minX, minY, minZ] = META.min
const [sx, sy, sz] = META.size

function readVec16(byteOffset, count, lmin = null, lsize = null) {
  const q = new Uint16Array(bin.buffer, byteOffset, count * 3)
  const out = new Float32Array(count * 3)
  const mx = lmin ? lmin[0] : minX, my = lmin ? lmin[1] : minY, mz = lmin ? lmin[2] : minZ
  const ax = lsize ? lsize[0] : sx, ay = lsize ? lsize[1] : sy, az = lsize ? lsize[2] : sz
  for (let i = 0; i < count; i++) {
    out[i * 3] = mx + (q[i * 3] / 65535) * ax
    out[i * 3 + 1] = my + (q[i * 3 + 1] / 65535) * ay
    out[i * 3 + 2] = mz + (q[i * 3 + 2] / 65535) * az
  }
  return out
}

function readNrm(byteOffset, count) {
  const q = new Int8Array(bin.buffer, byteOffset, count * 3)
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count * 3; i++) out[i] = q[i] / 127
  return out
}

// ---------------------------------------------------------------- materials
const MATS = {
  paint: { color: 0x30506f, metalness: 0.55, roughness: 0.24, clearcoat: 0.85, clearcoatRoughness: 0.12 },
  carbon: { color: 0x15181c, metalness: 0.35, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 },
  alu: { color: 0x9aa1a9, metalness: 1, roughness: 0.34 },
  chrome: { color: 0xd7dce1, metalness: 1, roughness: 0.1 },
  steel: { color: 0x848a92, metalness: 1, roughness: 0.38 },
  plastic: { color: 0x1b1d20, metalness: 0.1, roughness: 0.55 },
  rim: { color: 0x3c4147, metalness: 0.92, roughness: 0.3 },
  black: { color: 0x15171a, metalness: 0.55, roughness: 0.42 },
  rubber: { color: 0x0d0e10, metalness: 0.05, roughness: 0.92 },
  leather: { color: 0x141416, metalness: 0.08, roughness: 0.62 },
  brass: { color: 0xc9a227, metalness: 1, roughness: 0.28 },
  red: { color: 0x8c1c26, metalness: 0.2, roughness: 0.35 },
  white: { color: 0xd9d6cf, metalness: 0.1, roughness: 0.5 },
}

const material = (name, id = '') => {
  if (id.endsWith('.rim')) name = 'rim'
  const p = MATS[name] ?? MATS.alu
  const m = p.clearcoat !== undefined ? new T.MeshPhysicalMaterial(p) : new T.MeshStandardMaterial(p)
  m.envMapIntensity = 1.05
  return m
}

// ---------------------------------------------------------------- scene
const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = T.PCFShadowMap
renderer.toneMapping = T.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.18
renderer.outputColorSpace = T.SRGBColorSpace

const scene = new T.Scene()
scene.background = new T.Color(0x08090b)
scene.fog = new T.Fog(0x08090b, 3200, 8600)

const camera = new T.PerspectiveCamera(36, innerWidth / innerHeight, 2, 30000)

// studio environment for the metals
const pmrem = new T.PMREMGenerator(renderer)
pmrem.compileEquirectangularShader()
const env = new T.Scene()
{
  const room = new T.Mesh(
    new T.BoxGeometry(40, 22, 40),
    new T.MeshBasicMaterial({ color: 0x0b0e12, side: T.BackSide }),
  )
  env.add(room)
  const panel = (w, h, x, y, z, ry, intensity, color = 0xffffff) => {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({
      side: T.DoubleSide, color: new T.Color(color).multiplyScalar(intensity),
    }))
    m.position.set(x, y, z)
    m.rotation.y = ry
    env.add(m)
  }
  panel(16, 9, 0, 10, 0, 0, 3.1)
  panel(8, 14, -14, 3, 4, Math.PI / 2.2, 2.6)
  panel(8, 14, 14, 4, -4, -Math.PI / 2.2, 2.2)
  panel(20, 6, 0, -6, 12, -0.5, 1.4, 0x9fc4ff)
  panel(20, 6, 0, -6, -12, 0.5, 1.1, 0xffd9b8)
}
const envRT = pmrem.fromScene(env, 0.03)
scene.environment = envRT.texture

// lights
const hemi = new T.HemisphereLight(0xbcd0ea, 0x0a0c0f, 0.95)
scene.add(hemi)

const key = new T.DirectionalLight(0xfff2e2, 3.4)
key.position.set(1200, 1900, 1400)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.camera.near = 200
key.shadow.camera.far = 7000
key.shadow.camera.left = -2200
key.shadow.camera.right = 2200
key.shadow.camera.top = 2200
key.shadow.camera.bottom = -2200
key.shadow.bias = -0.0008
key.shadow.normalBias = 1.2
scene.add(key)
scene.add(key.target)

const fill = new T.DirectionalLight(0x9fc0ff, 1.3)
fill.position.set(-1500, 900, -1100)
scene.add(fill)

const rim = new T.DirectionalLight(0xffd3a8, 1.4)
rim.position.set(-400, 700, 1800)
scene.add(rim)

// ground
const ground = new T.Mesh(
  new T.CircleGeometry(6000, 64),
  new T.MeshStandardMaterial({ color: 0x0b0e12, roughness: 0.96, metalness: 0 }),
)
ground.rotation.x = -Math.PI / 2
ground.position.y = -0.5
ground.receiveShadow = true
scene.add(ground)

// ---------------------------------------------------------------- build parts
const root = new T.Group()
scene.add(root)

const byId = new Map()
const linkMeshes = []
for (const rec of META.parts) {
  const group = new T.Group()
  group.name = rec.id
  group.userData.rec = rec
  group.userData.explode = new T.Vector3(...rec.explode)
  const mat = material(rec.material, rec.id)
  group.userData.material = mat
  byId.set(rec.id, { rec, group, mat, visible: true })

  for (const mdef of META.meshes.filter((m) => m.part === META.parts.indexOf(rec))) {
    const g = new T.BufferGeometry()
    g.setAttribute('position', new T.BufferAttribute(readVec16(mdef.pos, mdef.verts, mdef.lmin, mdef.lsize), 3))
    g.setAttribute('normal', new T.BufferAttribute(readNrm(mdef.nrm, mdef.verts), 3))
    const index = mdef.idx32
      ? new T.BufferAttribute(new Uint32Array(bin.buffer, mdef.idx, mdef.idxCount), 1)
      : new T.BufferAttribute(new Uint16Array(bin.buffer, mdef.idx, mdef.idxCount), 1)
    g.setIndex(index)
    g.computeBoundingSphere()
    const mesh = new T.Mesh(g, mat)
    if (mdef.link) {
      mesh.position.fromArray(mdef.centre)
      mesh.rotation.z = mdef.rz
      mesh.userData.link = true
      mesh.userData.rz0 = mdef.rz
      linkMeshes.push(mesh)
    }
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.part = rec.id
    group.add(mesh)
  }
  root.add(group)
}

const box = new T.Box3(new T.Vector3(...META.box[0]), new T.Vector3(...META.box[1]))
const centre = box.getCenter(new T.Vector3())
const sphere = box.getBoundingSphere(new T.Sphere())

// ---------------------------------------------------------------- controls
const cam = {
  az: 0.58, el: 0.24, radius: sphere.radius * 3.1,
  target: centre.clone().add(new T.Vector3(0, 40, 0)),
  azT: 0.58, elT: 0.24, radiusT: sphere.radius * 2.55, targetT: centre.clone().add(new T.Vector3(0, 40, 0)),
}
const MAXR = sphere.radius * 7
const MINR = sphere.radius * 0.75

const pointers = new Map()
let mode = null
let last = { x: 0, y: 0 }

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  mode = e.button === 2 || e.shiftKey ? 'pan' : 'rotate'
  last = { x: e.clientX, y: e.clientY }
})
canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  const dx = e.clientX - last.x
  const dy = e.clientY - last.y
  if (mode && pointers.size === 1) {
    if (mode === 'rotate') {
      cam.azT -= dx * 0.0062
      cam.elT = Math.max(-0.06, Math.min(1.45, cam.elT + dy * 0.0052))
    } else {
      panCamera(dx, dy)
    }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    if (last.pinch) cam.radiusT = clamp(cam.radiusT * (last.pinch / dist), MINR, MAXR)
    last.pinch = dist
  }
  last = { x: e.clientX, y: e.clientY }
  hover(e.clientX, e.clientY)
})
const endPointer = (e) => {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) last.pinch = null
  if (pointers.size === 0) mode = null
}
canvas.addEventListener('pointerup', endPointer)
canvas.addEventListener('pointercancel', endPointer)
canvas.addEventListener('pointerleave', () => { tip.style.opacity = 0 })
canvas.addEventListener('contextmenu', (e) => e.preventDefault())
canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  cam.radiusT = clamp(cam.radiusT * Math.exp(e.deltaY * 0.0011), MINR, MAXR)
}, { passive: false })

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function panCamera(dx, dy) {
  const pan = new T.Vector3()
  const right = new T.Vector3().setFromMatrixColumn(camera.matrix, 0)
  const up = new T.Vector3().setFromMatrixColumn(camera.matrix, 1)
  const k = (cam.radiusT * 0.0016)
  pan.addScaledVector(right, -dx * k).addScaledVector(up, dy * k)
  cam.targetT.add(pan)
}

// ---------------------------------------------------------------- interaction state
const state = { explode: 0, spin: false, xray: false, wire: false, dims: false, selected: null, isolated: null, hidden: new Set() }
const raycaster = new T.Raycaster()
const ndc = new T.Vector2()

function pick(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  const hits = raycaster.intersectObject(root, true)
  for (const h of hits) {
    const id = h.object.userData.part
    if (id && !state.hidden.has(id)) return id
  }
  return null
}

let hoverId = null
function hover(x, y) {
  const id = pick(x, y)
  if (id !== hoverId) {
    hoverId = id
    applyHighlight()
    canvas.style.cursor = id ? 'pointer' : 'grab'
  }
  if (id) {
    const rec = byId.get(id).rec
    tip.textContent = rec.name
    tip.style.left = `${x}px`
    tip.style.top = `${y}px`
    tip.style.opacity = 1
  } else {
    tip.style.opacity = 0
  }
}

function applyHighlight() {
  for (const [id, p] of byId) {
    const sel = state.selected === id
    const hov = hoverId === id
    if (p.rec.material === 'paint' || p.rec.material === 'carbon') {
      p.mat.emissive.setHex(sel ? 0x2a1408 : hov ? 0x101820 : 0x000000)
    } else {
      p.mat.emissive.setHex(sel ? 0x3a2410 : hov ? 0x161d26 : 0x000000)
    }
    p.mat.emissiveIntensity = sel ? 1.0 : hov ? 0.7 : 0
  }
}

// selection
let down = null
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() } })
canvas.addEventListener('pointerup', (e) => {
  if (!down) return
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
  if (moved < 4 && performance.now() - down.t < 600) {
    const id = pick(e.clientX, e.clientY)
    select(id)
  }
  down = null
})

function select(id) {
  state.selected = id
  const card = document.getElementById('card')
  if (!id) { card.classList.remove('on'); applyHighlight(); renderList(); return }
  const rec = byId.get(id).rec
  document.getElementById('cardKick').textContent = META.assemblies.find((a) => a.id === rec.assembly)?.name ?? rec.assembly
  document.getElementById('cardName').textContent = rec.name
  document.getElementById('cardMass').textContent = `${rec.mass.toFixed(0)} g · ${rec.volume.toFixed(0)} cm³${rec.meshes > 1 ? ` · ${rec.meshes} bodies` : ''}`
  const dl = document.getElementById('cardSpec')
  dl.innerHTML = ''
  for (const [k, v] of Object.entries(rec.spec ?? {})) {
    const dt = document.createElement('dt'); dt.textContent = k
    const dd = document.createElement('dd'); dd.textContent = String(v)
    dl.append(dt, dd)
  }
  card.classList.add('on')
  applyHighlight()
  renderList()
}

document.getElementById('isoBtn').onclick = () => {
  state.isolated = state.isolated === state.selected ? null : state.selected
  applyVisibility()
  document.getElementById('isoBtn').classList.toggle('on', !!state.isolated)
}
document.getElementById('hideBtn').onclick = () => {
  if (!state.selected) return
  state.hidden.add(state.selected)
  select(null)
  applyVisibility()
}

// ---------------------------------------------------------------- parts list
const assemblyOrder = META.assemblies
function renderList() {
  partlist.innerHTML = ''
  for (const a of assemblyOrder) {
    const items = META.parts.filter((p) => p.assembly === a.id)
    if (!items.length) continue
    const g = document.createElement('div')
    g.className = 'group'
    const h = document.createElement('h3')
    h.innerHTML = `${a.name} <em>${items.length}</em>`
    h.onclick = () => {
      const anyVisible = items.some((p) => !state.hidden.has(p.id))
      for (const p of items) anyVisible ? state.hidden.add(p.id) : state.hidden.delete(p.id)
      applyVisibility(); renderList()
    }
    g.append(h)
    for (const p of items) {
      const row = document.createElement('div')
      row.className = 'row' + (state.selected === p.id ? ' sel' : '') + (state.hidden.has(p.id) ? ' off' : '')
      const dot = document.createElement('span')
      dot.className = 'dot'
      dot.style.background = `#${(MATS[p.material]?.color ?? 0x888888).toString(16).padStart(6, '0')}`
      const nm = document.createElement('span')
      nm.className = 'nm'
      nm.textContent = p.name
      const ms = document.createElement('span')
      ms.className = 'ms'
      ms.textContent = `${p.mass.toFixed(0)}g`
      row.append(dot, nm, ms)
      row.onclick = () => {
        if (state.hidden.has(p.id)) state.hidden.delete(p.id)
        select(state.selected === p.id ? null : p.id)
        applyVisibility()
        renderList()
        focusPart(p.id)
      }
      row.ondblclick = (e) => { e.preventDefault(); toggleVisible(p.id); renderList() }
      g.append(row)
    }
    partlist.append(g)
  }
}

function toggleVisible(id) {
  if (state.hidden.has(id)) state.hidden.delete(id)
  else state.hidden.add(id)
  const p = byId.get(id)
  if (p) p.visible = !state.hidden.has(id)
  applyVisibility()
}

function applyVisibility() {
  for (const [id, p] of byId) {
    const hidden = state.hidden.has(id) || (state.isolated && state.isolated !== id)
    p.group.visible = !hidden && p.visible
  }
}

function focusPart(id) {
  const p = byId.get(id)
  if (!p) return
  const b = new T.Box3().setFromObject(p.group)
  const c = b.getCenter(new T.Vector3())
  cam.targetT.copy(c)
  cam.radiusT = clamp(b.getBoundingSphere(new T.Sphere()).radius * 3.4, MINR, MAXR)
  cam.azT = cam.az
  cam.elT = cam.el
}

// ---------------------------------------------------------------- dock
const explodeInput = document.getElementById('explode')
explodeInput.oninput = () => {
  state.explode = explodeInput.value / 100
  for (const [, p] of byId) {
    p.group.position.copy(p.group.userData.explode).multiplyScalar(state.explode)
  }
}

const chips = {
  spin: document.getElementById('spinBtn'),
  xray: document.getElementById('xrayBtn'),
  wire: document.getElementById('wireBtn'),
  dims: document.getElementById('dimBtn'),
}
chips.spin.onclick = () => { state.spin = !state.spin; chips.spin.classList.toggle('on', state.spin) }
chips.xray.onclick = () => {
  state.xray = !state.xray
  chips.xray.classList.toggle('on', state.xray)
  for (const [, p] of byId) {
    p.mat.transparent = state.xray
    p.mat.opacity = state.xray ? 0.24 : 1
    p.mat.depthWrite = !state.xray
    p.mat.needsUpdate = true
  }
}
chips.wire.onclick = () => {
  state.wire = !state.wire
  chips.wire.classList.toggle('on', state.wire)
  for (const [, p] of byId) p.mat.wireframe = state.wire
}
chips.dims.onclick = () => {
  state.dims = !state.dims
  chips.dims.classList.toggle('on', state.dims)
  dimlayer.style.display = state.dims ? 'block' : 'none'
}

document.querySelectorAll('[data-view]').forEach((b) => {
  b.onclick = () => {
    const v = b.dataset.view
    if (v === 'iso') { cam.azT = 0.58; cam.elT = 0.24; cam.radiusT = sphere.radius * 3.05; cam.targetT.copy(centre).add(new T.Vector3(0, 40, 0)) }
    if (v === 'side') { cam.azT = 0; cam.elT = 0.02; cam.radiusT = sphere.radius * 2.9; cam.targetT.copy(centre).add(new T.Vector3(0, 20, 0)) }
    if (v === 'front') { cam.azT = Math.PI / 2; cam.elT = 0.04; cam.radiusT = sphere.radius * 2.5; cam.targetT.copy(centre).add(new T.Vector3(0, 20, 0)) }
    if (v === 'top') { cam.azT = 0.0001; cam.elT = 1.44; cam.radiusT = sphere.radius * 2.6; cam.targetT.copy(centre) }
  }
})

document.getElementById('shotBtn').onclick = () => {
  renderer.render(scene, camera)
  const a = document.createElement('a')
  a.download = 'emonda-56.png'
  a.href = renderer.domElement.toDataURL('image/png')
  a.click()
}

// ---------------------------------------------------------------- dimensions
const dimDefs = [
  { a: new T.Vector3(-404, 8, 0), b: new T.Vector3(579, 8, 0), label: `wheelbase ${META.geometry.wheelbase} mm`, off: [0, -60, 0] },
  { a: new T.Vector3(0, 266, 0), b: new T.Vector3(387, 861, 0), label: `stack ${META.geometry.stack} mm`, off: [-30, 0, 0] },
  { a: new T.Vector3(0, 266, 0), b: new T.Vector3(387, 266, 0), label: `reach ${META.geometry.reach} mm`, off: [0, -46, 0] },
]
const dimLines = new T.Group()
dimLines.visible = false
scene.add(dimLines)
const dimLabels = []
for (const d of dimDefs) {
  const g = new T.BufferGeometry().setFromPoints([d.a, d.b])
  dimLines.add(new T.Line(g, new T.LineBasicMaterial({ color: 0x8b97a4, transparent: true, opacity: 0.75 })))
  const el = document.createElement('div')
  el.className = 'dim'
  el.textContent = d.label
  dimlayer.append(el)
  dimLabels.push({ el, d })
}
dimlayer.style.display = 'none'

function updateDims() {
  if (!state.dims) return
  for (const { el, d } of dimLabels) {
    const mid = d.a.clone().lerp(d.b, 0.5).add(new T.Vector3(...d.off))
    const p = mid.clone().project(camera)
    el.style.left = `${(p.x * 0.5 + 0.5) * innerWidth}px`
    el.style.top = `${(-p.y * 0.5 + 0.5) * innerHeight}px`
    el.style.opacity = p.z > 1 ? 0 : 0.95
  }
}

// ---------------------------------------------------------------- spec sheet
document.getElementById('specBtn').onclick = () => { buildSheet(); document.getElementById('modal').classList.add('on') }
document.getElementById('close').onclick = () => document.getElementById('modal').classList.remove('on')
document.getElementById('modal').onclick = (e) => { if (e.target.id === 'modal') e.currentTarget.classList.remove('on') }

function buildSheet() {
  const s = META.specs
  const g = META.geometry
  const rows = (obj) => Object.entries(obj).map(([k, v]) => `<tr><td>${pretty(k)}</td><td class="n">${v}</td></tr>`).join('')
  const sources = (s.sources ?? []).slice(0, 30).map((x) =>
    `<tr><td>${pretty(x.claim ?? '')}<div style="color:#6b7480;font-size:11px">${x.note ?? ''}</div></td>
     <td class="n">${String(x.value ?? '')}</td></tr>`).join('')
  const derived = (s.derived ?? []).map((d) => `<tr><td>${pretty(d.name ?? d.what ?? '')}<div style="color:#6b7480;font-size:11px">${d.formula ?? ''}</div></td><td class="n">${d.value ?? ''}</td></tr>`).join('')
  document.getElementById('sheetBody').innerHTML = `
    <h2>Trek Émonda SL · 56 cm</h2>
    <p class="sub">Rim-brake generation, H2 fit. Frame numbers from Trek's 56 cm geometry chart, cross-checked against Bike Insights.
    The model closes on wheelbase 983, stack 577, reach 387, trail 57.8; the chart's 40 mm rake leaves the front centre at 579 instead of 583.</p>
    <h3>Frame geometry</h3>
    <table><tr><th>Dimension</th><th style="text-align:right">Value</th></tr>
      <tr><td>Wheelbase</td><td class="n">${g.wheelbase} mm</td></tr>
      <tr><td>Stack / reach</td><td class="n">${g.stack} / ${g.reach} mm</td></tr>
      <tr><td>Seat / head angle</td><td class="n">73.3° / 73.5°</td></tr>
      <tr><td>Chainstay / front centre</td><td class="n">${g.chainstay} / ${g.frontCentre} mm</td></tr>
      <tr><td>BB drop / trail</td><td class="n">${g.bbDrop} mm / ${g.trail} mm</td></tr>
    </table>
    <h3>Wheels and drivetrain</h3>
    <table>${rows(Object.fromEntries(Object.entries(s.wheels ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(' / ') : v])))}
      ${rows(Object.fromEntries(Object.entries(s.drivetrain ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(' / ') : v])))}
      ${rows(Object.fromEntries(Object.entries(s.cockpit ?? {}).map(([k, v]) => [k, v])))}
    </table>
    <h3>The build</h3>
    <table><tr><th>Assembly</th><th style="text-align:right">Parts</th><th style="text-align:right">Mass</th></tr>
    ${META.assemblies.map((a) => {
      const ps = META.parts.filter((p) => p.assembly === a.id)
      const m = ps.reduce((t, p) => t + p.mass, 0) / 1000
      return `<tr><td>${a.name}</td><td class="n">${ps.length}</td><td class="n">${m.toFixed(2)} kg</td></tr>`
    }).join('')}
    <tr><td><b>Total, modelled</b></td><td class="n"><b>${META.totals.parts}</b></td><td class="n"><b>${(META.totals.mass / 1000).toFixed(2)} kg</b></td></tr>
    </table>
    <p class="sub" style="margin-top:10px">Masses are computed from each body's exact B-rep volume and the material density, so they are
    the solid model's mass, not a catalogue weight: paint, grease, cable housing interior and tolerances are not modelled.</p>
    ${derived ? `<h3>Derived values</h3><table>${derived}</table>` : ''}
    <h3>Sources</h3><table>${sources}</table>
    <p class="sub">Geometry built with @classcad/smlibpy-three 0.6.2 on the SMLib kernel; ${META.totals.triangles.toLocaleString()} triangles,
    ${META.totals.parts} parts, ${(META.binaryBytes / 1e6).toFixed(1)} MB of geometry packed into this page.</p>
  `
}
const pretty = (k) => String(k).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

// ---------------------------------------------------------------- stats
document.getElementById('stats').innerHTML = `
  <div class="stat"><b>${META.totals.parts}</b><i>parts</i></div>
  <div class="stat"><b>${(META.totals.mass / 1000).toFixed(2)}<span style="font-size:11px"> kg</span></b><i>modelled mass</i></div>
  <div class="stat"><b>${(META.totals.triangles / 1000).toFixed(0)}k</b><i>triangles</i></div>`
document.getElementById('sub').textContent = META.subtitle

// ---------------------------------------------------------------- loop
let t0 = performance.now()
function frame(now) {
  const dt = Math.min(0.05, (now - t0) / 1000)
  t0 = now
  if (state.spin) cam.azT += dt * 0.22

  cam.az += (cam.azT - cam.az) * 0.14
  cam.el += (cam.elT - cam.el) * 0.14
  cam.radius += (cam.radiusT - cam.radius) * 0.12
  cam.target.lerp(cam.targetT, 0.14)

  const ce = Math.cos(cam.el)
  camera.position.set(
    cam.target.x + cam.radius * Math.sin(cam.az) * ce,
    cam.target.y + cam.radius * Math.sin(cam.el),
    cam.target.z + cam.radius * Math.cos(cam.az) * ce,
  )
  camera.lookAt(cam.target)

  if (typeof stepRide === 'function') stepRide(dt)
  dimLines.visible = state.dims
  updateDims()
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

renderList()
applyVisibility()
select(null)
requestAnimationFrame(frame)
setTimeout(() => document.getElementById('loading').classList.add('done'), 220)
window.__BIKE = { META, state, byId, select, camera, cam, scene, renderer, root, THREE: T, linkMeshes, material, box,
  view: (az, el, r, target) => { cam.azT = cam.az = az; cam.elT = cam.el = el; cam.radiusT = cam.radius = r; if (target) { cam.targetT.copy(target); cam.target.copy(target) } } }
window.__READY = true

