import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--allow-file-access-from-files'], protocolTimeout: 400000 })
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000 })
const errs = []
page.on('pageerror', e => errs.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
await page.goto('file:///Users/abdullahi/Herd/CAD/bicycle/bicycle.html', { waitUntil: 'load' })
await page.waitForFunction('window.__READY === true', { timeout: 200000 })
await new Promise(r => setTimeout(r, 1200))
// default iso
await page.screenshot({ path: '/tmp/final-iso.png' })
// side view
await page.evaluate(() => { const b = [...document.querySelectorAll('[data-view]')].find(x => x.dataset.view === 'side'); b.click() })
await new Promise(r => setTimeout(r, 900))
await page.screenshot({ path: '/tmp/final-side.png' })
// explode
await page.evaluate(() => { const i = document.getElementById('explode'); i.value = 55; i.dispatchEvent(new Event('input')) })
await new Promise(r => setTimeout(r, 900))
await page.screenshot({ path: '/tmp/final-explode.png' })
// select a part and open the spec sheet
const sel = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#partlist .row')]
  const row = rows.find(r => r.textContent.includes('Drop handlebar'))
  if (row) row.click()
  return !!row
})
await new Promise(r => setTimeout(r, 900))
await page.screenshot({ path: '/tmp/final-select.png' })
await page.evaluate(() => { document.getElementById('specBtn').click() })
await new Promise(r => setTimeout(r, 600))
await page.screenshot({ path: '/tmp/final-spec.png' })
const specRows = await page.evaluate(() => document.querySelectorAll('#sheetBody table tr').length)
console.log(JSON.stringify({ selected: sel, specRows, errs: errs.slice(0, 6) }))
await browser.close()
