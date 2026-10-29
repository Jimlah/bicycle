// ---------------------------------------------------------------------------
// Ride: the bike is one rigid body carrying a collider per part, so it has real
// mass, real collisions and can fall over. The wheels, cranks, pedals and the
// steering are articulated on top of that body, and the chain follows the links
// the drivetrain modeled.
// ---------------------------------------------------------------------------

const V3 = (x, y, z) => ({ x, y, z })

// ---- the chain's own path, recovered from the links the drivetrain modeled --
const chain = (() => {
  if (!linkMeshes.length) return null
  // the drivetrain wrote the links into the parts in path order, so the pack order is the path
  const loop = linkMeshes.map((m) => ({ p: m.position.clone(), rz: m.rotation.z, mesh: m }))
  const n = loop.length
  const seg = []
  let total = 0
  for (let i = 0; i < n; i++) {
    const a = loop[i].p
    const b = loop[(i + 1) % n].p
    const len = a.distanceTo(b)
    seg.push({ a, b, len, start: total, ang: Math.atan2(b.y - a.y, b.x - a.x) })
    total += len
  }
  for (let i = 0; i < n; i++) {
    loop[i].mesh.userData.chainU = seg[i].start
    loop[i].mesh.userData.chainRz0 = loop[i].rz
    loop[i].mesh.userData.chainAng0 = seg[i].ang
  }
  const at = (u) => {
    const t = ((u % total) + total) % total
    let lo = 0, hi = n - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (seg[mid].start <= t) lo = mid; else hi = mid - 1 }
    const s = seg[lo]
    const f = s.len ? (t - s.start) / s.len : 0
    return { x: s.a.x + (s.b.x - s.a.x) * f, y: s.a.y + (s.b.y - s.a.y) * f, z: s.a.z + (s.b.z - s.a.z) * f, ang: s.ang }
  }
  // the loop runs whichever way the nearest-neighbour walk happened to go
  let top = 0
  for (let i = 1; i < n; i++) if (loop[i].p.y > loop[top].p.y) top = i
  const sign = seg[top].ang > 0 ? -1 : 1
  return { loop, total, at, sign, pitch: total / n }
})()

// ---- which articulation each part belongs to -------------------------------
const ART = new Map()
for (const rec of META.parts) {
  const id = rec.id
  let a = 'body'
  if (id.startsWith('wheel.front')) a = 'wheelFront'
  else if (id.startsWith('wheel.rear')) a = 'wheelRear'
  else if (id.startsWith('drivetrain.chain.')) a = 'body'
  else if (id.startsWith('drivetrain.crank') || id.startsWith('drivetrain.chainring') || id === 'drivetrain.bb.spindle') a = 'crank'
  else if (id.startsWith('drivetrain.pedal.drive')) a = 'pedalDrive'
  else if (id.startsWith('drivetrain.pedal.nondrive')) a = 'pedalNon'
  else if (id.startsWith('drivetrain.sti') || id.startsWith('fork') || id.startsWith('cockpit') ||
    id.startsWith('brake.front') || id.startsWith('brake.lever')) a = 'steer'
  ART.set(id, a)
}

const RIDE = {
  on: false, world: null, bike: null, ready: false,
  crankAng: 0, pedalSpeed: 0, steer: 0, brake: 0, assist: true,
  speed: 0, dist: 0, acc: 0, keys: new Set(), colliders: 0, mass: 0,
}

const L = META.layout
const BB = new T.Vector3(...L.bb)
const REAR = new T.Vector3(...L.rearHub)
const FRONT = new T.Vector3(...L.frontHub)
const HEAD = new T.Vector3(...L.headMid)
const HEAD_AXIS = new T.Vector3(...L.uHead).normalize()
const PEDAL_R = new T.Vector3(...L.pedalDrive)
const PEDAL_L = new T.Vector3(...L.pedalNonDrive)

/** One collider per part, with the part's own mass. */
function addColliders(world, body) {
  let count = 0
  for (const rec of META.parts) {
    const entry = byId.get(rec.id)
    if (!entry) continue
    const pts = []
    entry.group.traverse((o) => {
      if (!o.isMesh || !o.geometry) return
      const a = o.geometry.attributes.position
      if (!a) return
      const step = Math.max(1, Math.floor(a.count / 900))
      for (let i = 0; i < a.count; i += step) pts.push(a.getX(i), a.getY(i), a.getZ(i))
    })
    if (pts.length < 12) continue
    let desc = null
    try { desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts)) } catch { desc = null }
    if (!desc) {
      const b = new T.Box3().setFromObject(entry.group)
      const s = b.getSize(new T.Vector3())
      const c = b.getCenter(new T.Vector3())
      desc = RAPIER.ColliderDesc.cuboid(Math.max(0.5, s.x / 2), Math.max(0.5, s.y / 2), Math.max(0.5, s.z / 2))
        .setTranslation(c.x, c.y, c.z)
    }
    desc.setMass(Math.max(0.002, (rec.mass || 10) / 1000))
    desc.setFriction(0.85)
    desc.setRestitution(0.02)
    world.createCollider(desc, body)
    count++
  }
  return count
}

function initRide() {
  if (RIDE.ready) return
  const world = new RAPIER.World(V3(0, -9810, 0))
  world.timestep = 1 / 120
  RIDE.world = world

  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(RAPIER.ColliderDesc.cuboid(60000, 2, 60000).setTranslation(0, -2, 0).setFriction(0.95), ground)

  const bike = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0.04).setAngularDamping(0.2))
  RIDE.bike = bike
  RIDE.colliders = addColliders(world, bike)
  RIDE.mass = bike.mass()
  RIDE.ready = true
}

function resetRide() {
  if (!RIDE.ready) return
  RIDE.bike.setTranslation(V3(0, 0, 0), true)
  RIDE.bike.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
  RIDE.bike.setLinvel(V3(0, 0, 0), true)
  RIDE.bike.setAngvel(V3(0, 0, 0), true)
  RIDE.speed = 0
  RIDE.dist = 0
  RIDE.crankAng = 0
  RIDE.pedalSpeed = 0
  RIDE.steer = 0
  RIDE.brake = 0
}

const WHEEL_RADIUS = 336

function preStep(dt) {
  const bike = RIDE.bike

  // the rider pedals, or coasts
  const fwd = RIDE.keys.has('KeyW') || RIDE.keys.has('ArrowUp')
  const back = RIDE.keys.has('KeyS') || RIDE.keys.has('ArrowDown')
  const cadence = fwd ? 11 : back ? -4 : 0
  RIDE.pedalSpeed += (cadence - RIDE.pedalSpeed) * Math.min(1, dt * (fwd || back ? 1.5 : 3.0))
  RIDE.crankAng += RIDE.pedalSpeed * dt

  // the wheel turns, the tyre grips, the bike goes: speed follows cadence
  const want = RIDE.pedalSpeed * 0.72 * (1 - RIDE.brake * 0.97) // m/s
  const k = Math.min(1, dt * (RIDE.brake > 0.05 ? 5.0 : 1.4))
  RIDE.speed += (want - RIDE.speed) * k
  RIDE.dist += RIDE.speed * dt * 1000

  const v = bike.linvel()
  bike.setLinvel(V3(RIDE.speed * 1000, v.y, v.z * 0.9), true)

  // balance: a rider's hips hold the bike up and level, nothing else does
  if (RIDE.assist) {
    const r = bike.rotation()
    const q = new T.Quaternion(r.x, r.y, r.z, r.w)
    const up = new T.Vector3(0, 1, 0).applyQuaternion(q)
    const fwd = new T.Vector3(1, 0, 0).applyQuaternion(q)
    const lean = Math.atan2(up.z, up.y)
    const pitch = Math.atan2(fwd.y, Math.hypot(fwd.x, fwd.z))
    const av = bike.angvel()
    bike.setAngvel(V3(av.x * 0.8 - lean * 3.2, av.y * 0.9, av.z * 0.8 - pitch * 3.2), true)
    // and it settles on its tyres rather than sinking
    const t = bike.translation()
    const vy = bike.linvel().y
    if (t.y < 0) bike.setTranslation(V3(t.x, 0, t.z), true)
    bike.setLinvel(V3(RIDE.speed * 1000, Math.min(0, vy) * 0.5, bike.linvel().z * 0.85), true)
  }

  // steering, about the head tube axis
  let steerTarget = 0
  if (RIDE.keys.has('KeyA') || RIDE.keys.has('ArrowLeft')) steerTarget += 0.34
  if (RIDE.keys.has('KeyD') || RIDE.keys.has('ArrowRight')) steerTarget -= 0.34
  RIDE.steer += (steerTarget - RIDE.steer) * Math.min(1, dt * 7)
}

// ---- graphics: the body's transform plus the articulated parts -------------
const m4 = () => new T.Matrix4()
const rotAbout = (axisPoint, axis, angle, out = m4()) => {
  const q = new T.Quaternion().setFromAxisAngle(axis, angle)
  return out.compose(axisPoint, q, new T.Vector3(1, 1, 1))
    .multiply(new T.Matrix4().makeTranslation(-axisPoint.x, -axisPoint.y, -axisPoint.z))
}
const ZAXIS = new T.Vector3(0, 0, 1)

const scratch = {
  body: m4(), steer: m4(), spinFront: m4(), spinRear: m4(), crank: m4(),
  pedalR: m4(), pedalL: m4(), out: m4(),
}

function syncRide() {
  const bike = RIDE.bike
  const t = bike.translation()
  const r = bike.rotation()
  scratch.body.compose(new T.Vector3(t.x, t.y, t.z), new T.Quaternion(r.x, r.y, r.z, r.w), new T.Vector3(1, 1, 1))

  rotAbout(HEAD, HEAD_AXIS, RIDE.steer, scratch.steer)
  rotAbout(FRONT, ZAXIS, -RIDE.dist / WHEEL_RADIUS, scratch.spinFront)
  rotAbout(REAR, ZAXIS, -RIDE.dist / WHEEL_RADIUS, scratch.spinRear)
  rotAbout(BB, ZAXIS, -RIDE.crankAng, scratch.crank)

  // the pedal bodies orbit the bottom bracket but stay level under the foot
  const orbit = (p, out) => {
    const q = new T.Quaternion().setFromAxisAngle(ZAXIS, -RIDE.crankAng)
    const moved = p.clone().sub(BB).applyQuaternion(q).add(BB)
    return out.makeTranslation(moved.x - p.x, moved.y - p.y, moved.z - p.z)
  }
  orbit(PEDAL_R, scratch.pedalR)
  orbit(PEDAL_L, scratch.pedalL)

  for (const [id, entry] of byId) {
    const art = ART.get(id) || 'body'
    const m = scratch.out.copy(scratch.body)
    if (art === 'steer') m.multiply(scratch.steer)
    else if (art === 'wheelFront') m.multiply(scratch.steer).multiply(scratch.spinFront)
    else if (art === 'wheelRear') m.multiply(scratch.spinRear)
    else if (art === 'crank') m.multiply(scratch.crank)
    else if (art === 'pedalDrive') m.multiply(scratch.pedalR)
    else if (art === 'pedalNon') m.multiply(scratch.pedalL)
    entry.group.matrixAutoUpdate = false
    entry.group.matrix.copy(m)
    entry.group.matrixWorldNeedsUpdate = true
  }

  // the chain moves with the bike, and its links run along their own path
  const shift = chain ? chain.sign * RIDE.crankAng * 101.6 : 0
  for (const { mesh } of chain?.loop ?? []) {
    const p = chain.at(mesh.userData.chainU + shift)
    mesh.position.set(p.x, p.y, p.z)
    mesh.rotation.z = p.ang + (mesh.userData.chainRz0 - mesh.userData.chainAng0)
  }
}

function stepRide(dt) {
  if (!RIDE.on) return
  // keep the studio lights and the shadow camera on the bike as it travels
  const bt = RIDE.bike?.translation()
  if (bt) {
    key.position.set(bt.x + 1200, 1900, 1400)
    key.target.position.set(bt.x, 0, 0)
    key.target.updateMatrixWorld()
    ground.position.set(bt.x, -0.5, 0)
  }
  if (!RIDE.ready) initRide()
  RIDE.acc += Math.min(dt, 0.05)
  let steps = 0
  while (RIDE.acc >= RIDE.world.timestep && steps < 8) {
    preStep(RIDE.world.timestep)
    RIDE.world.step()
    RIDE.acc -= RIDE.world.timestep
    steps++
  }
  syncRide()
  followCamera(dt)
  if (hudSpeed) hudSpeed.textContent = (RIDE.speed * 3.6).toFixed(1)
  if (hudCad) hudCad.textContent = String(Math.round((RIDE.pedalSpeed * 60) / (2 * Math.PI)))
}

function followCamera(dt) {
  const t = RIDE.bike.translation()
  const target = new T.Vector3(t.x, 470, t.z)
  cam.target.lerp(target, Math.min(1, dt * 4))
  cam.targetT.copy(cam.target)
  cam.azT = -Math.PI / 2 + 0.42 + RIDE.steer * 0.35
  cam.elT = 0.13
  cam.radiusT = 4200
}

// ---- controls ---------------------------------------------------------------
addEventListener('keydown', (e) => {
  if (!RIDE.on) return
  RIDE.keys.add(e.code)
  if (e.code === 'Space') { RIDE.brake = Math.min(1, RIDE.brake + 0.34); e.preventDefault() }
  if (e.code === 'KeyR') resetRide()
})
addEventListener('keyup', (e) => {
  RIDE.keys.delete(e.code)
  if (e.code === 'Space') RIDE.brake = 0
})

// ---- UI ---------------------------------------------------------------------
const dock = document.getElementById('dock')
const rideBtn = document.createElement('button')
rideBtn.className = 'btn'
rideBtn.textContent = 'Ride'
const assistBtn = document.createElement('button')
assistBtn.className = 'btn on'
assistBtn.textContent = 'Assist'
const resetBtn = document.createElement('button')
resetBtn.className = 'btn'
resetBtn.textContent = 'Reset'
dock.append(rideBtn, assistBtn, resetBtn)

let hudSpeed = null
let hudCad = null
const hud = document.createElement('div')
hud.id = 'hud'
hud.innerHTML = `<div><b id="hudSpeed">0.0</b><i>km/h</i></div><div><b id="hudCad">0</b><i>rpm</i></div>
  <div class="keys"><span>W</span>pedal <span>S</span>back <span>A</span><span>D</span>steer <span>Space</span>brake <span>R</span>reset</div>`
document.body.append(hud)
hudSpeed = document.getElementById('hudSpeed')
hudCad = document.getElementById('hudCad')

const hint = document.createElement('div')
hint.id = 'hint'
hint.textContent = 'Ride mode · W pedal · A/D steer · Space brake · R reset'
document.body.append(hint)

rideBtn.onclick = () => {
  RIDE.on = !RIDE.on
  rideBtn.classList.toggle('on', RIDE.on)
  hud.classList.toggle('on', RIDE.on)
  hint.classList.toggle('on', RIDE.on)
  if (RIDE.on) setTimeout(() => hint.classList.remove('on'), 6000)
  if (RIDE.on) {
    if (state.selected) select(null)
    state.explode = 0
    if (explodeInput) explodeInput.value = 0
    for (const [, p] of byId) p.group.position.set(0, 0, 0)
    initRide()
    resetRide()
    RIDE.keys.clear()
  } else {
    for (const [, p] of byId) {
      p.group.matrixAutoUpdate = true
      p.group.position.set(0, 0, 0)
      p.group.quaternion.identity()
      p.group.updateMatrixWorld(true)
    }
    cam.azT = 0.58; cam.elT = 0.24; cam.radiusT = sphere.radius * 2.55
    cam.targetT.copy(centre).add(new T.Vector3(0, 40, 0))
  }
}
assistBtn.onclick = () => {
  RIDE.assist = !RIDE.assist
  assistBtn.classList.toggle('on', RIDE.assist)
}
resetBtn.onclick = () => resetRide()

window.__RIDE = RIDE
window.__CHAIN = chain
window.__stepN = (n) => { for (let i = 0; i < n; i++) { preStep(1 / 120); RIDE.world.step() } }
