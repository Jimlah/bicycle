import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--allow-file-access-from-files', '--host-resolver-rules=MAP * 0.0.0.0'], protocolTimeout: 300000 })
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 800 })
const reqs = []
page.on('request', r => { if (!r.url().startsWith('file://') && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) reqs.push(r.url()) })
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.goto('file:///Users/abdullahi/Herd/CAD/bicycle/bicycle.html', { waitUntil: 'load' })
await page.waitForFunction('window.__READY === true', { timeout: 200000 })
const t = await page.evaluate(() => ({
  parts: window.__BIKE.META.parts.length,
  tris: window.__BIKE.META.totals.triangles,
  meshes: window.__BIKE.root.children.length,
  colliders: window.__RIDE.colliders || 'not yet built',
}))
console.log(JSON.stringify({ ...t, network: reqs.length, errors: errs.length }))
await browser.close()
