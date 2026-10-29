import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--allow-file-access-from-files'], protocolTimeout: 300000 })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.goto('file:///Users/abdullahi/Herd/CAD/bicycle/bicycle.html', { waitUntil: 'load' })
await page.waitForFunction('window.__READY === true', { timeout: 200000 })
await page.evaluate(() => { [...document.querySelectorAll('#dock .btn')].find(b => b.textContent === 'Dims').click() })
await new Promise(r => setTimeout(r, 1200))
const labels = await page.evaluate(() => [...document.querySelectorAll('.dim')].map(e => ({ t: e.textContent, l: e.style.left, o: e.style.opacity })))
await page.screenshot({ path: '/tmp/ui-dims.png' })
await page.evaluate(() => { [...document.querySelectorAll('#dock .btn')].find(b => b.textContent === 'Dims').click(); [...document.querySelectorAll('#dock .btn')].find(b => b.textContent === 'X-ray').click() })
await new Promise(r => setTimeout(r, 1200))
await page.screenshot({ path: '/tmp/ui-xray.png' })
console.log(JSON.stringify({ labels, errs }))
await browser.close()
