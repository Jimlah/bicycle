import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'], protocolTimeout: 400000 })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })
const errs = []
page.on('pageerror', e => errs.push(e.message))
const t0 = Date.now()
await page.goto('https://jimlah.github.io/bicycle/', { waitUntil: 'load', timeout: 120000 })
await page.waitForFunction('window.__READY === true', { timeout: 180000 })
const info = await page.evaluate(() => ({
  parts: window.__BIKE.META.parts.length,
  tris: window.__BIKE.META.totals.triangles,
  mass: (window.__BIKE.META.totals.mass / 1000).toFixed(2),
  ride: !!window.__RIDE,
}))
await page.screenshot({ path: '/tmp/live.png' })
console.log(JSON.stringify({ ...info, seconds: ((Date.now() - t0) / 1000).toFixed(1), errors: errs }))
await browser.close()
