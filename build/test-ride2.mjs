import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--allow-file-access-from-files'], protocolTimeout: 400000 })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.goto('file:///Users/abdullahi/Herd/CAD/bicycle/bicycle.html', { waitUntil: 'load' })
await page.waitForFunction('window.__READY === true', { timeout: 200000 })
await page.evaluate(() => { [...document.querySelectorAll('#dock .btn')].find(x => x.textContent === 'Ride').click() })
await new Promise(r => setTimeout(r, 700))
// pedal 3 s of simulation, in synchronous steps so the software renderer does not slow time
await page.evaluate(() => { window.__RIDE.keys.add('KeyW'); window.__stepN(360); })
await new Promise(r => setTimeout(r, 900))
await page.screenshot({ path: '/tmp/ride-a.png' })
const s = await page.evaluate(() => ({ kmh: +(window.__RIDE.speed * 3.6).toFixed(1), rpm: Math.round(window.__RIDE.pedalSpeed * 60 / 6.283), chain: window.__CHAIN.loop.length, crank: +window.__RIDE.crankAng.toFixed(2) }))
console.log('riding', JSON.stringify(s))
// assist off: it should fall over and land on the ground with its own colliders
await page.evaluate(() => { [...document.querySelectorAll('#dock .btn')].find(x => x.textContent === 'Assist').click(); window.__RIDE.keys.delete('KeyW'); window.__stepN(360) })
await new Promise(r => setTimeout(r, 900))
const f = await page.evaluate(() => { const b = window.__RIDE.bike; const r = b.rotation(); return { y: +b.translation().y.toFixed(1), q: [r.x, r.y, r.z, r.w].map(v => +v.toFixed(2)) } })
console.log('assist off', JSON.stringify(f))
await page.screenshot({ path: '/tmp/ride-fall.png' })
console.log('errors', errs.slice(0, 4))
await browser.close()
