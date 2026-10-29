// Screenshots for the README: the page as a reader first sees it.
import puppeteer from 'puppeteer-core'
const out = '/Users/abdullahi/Herd/CAD/bicycle/docs/previews'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--allow-file-access-from-files'],
  protocolTimeout: 400000,
})
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 })
await page.goto('file:///Users/abdullahi/Herd/CAD/bicycle/index.html', { waitUntil: 'load' })
await page.waitForFunction('window.__READY === true', { timeout: 240000 })
await new Promise((r) => setTimeout(r, 1500))
await page.screenshot({ path: `${out}/hero.png` })

await page.evaluate(() => [...document.querySelectorAll('[data-view]')].find((b) => b.dataset.view === 'side').click())
await new Promise((r) => setTimeout(r, 1400))
await page.screenshot({ path: `${out}/side.png` })

await page.evaluate(() => {
  const i = document.getElementById('explode')
  i.value = 60
  i.dispatchEvent(new Event('input'))
})
await new Promise((r) => setTimeout(r, 1400))
await page.screenshot({ path: `${out}/exploded.png` })

await page.evaluate(() => {
  const i = document.getElementById('explode')
  i.value = 0
  i.dispatchEvent(new Event('input'))
  ;[...document.querySelectorAll('#dock .btn')].find((b) => b.textContent === 'Ride').click()
})
await new Promise((r) => setTimeout(r, 1200))
await page.evaluate(() => {
  window.__RIDE.keys.add('KeyW')
  window.__stepN(360)
})
await new Promise((r) => setTimeout(r, 1600))
await page.screenshot({ path: `${out}/ride.png` })

await page.evaluate(() => document.getElementById('specBtn').click())
await new Promise((r) => setTimeout(r, 900))
await page.screenshot({ path: `${out}/specs.png` })
await browser.close()
console.log('previews written')
