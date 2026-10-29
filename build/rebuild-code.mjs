import { readFileSync, writeFileSync } from 'node:fs'
const path = '/Users/abdullahi/Herd/CAD/bicycle/bicycle.html'
const html = readFileSync(path, 'utf8')
const app = readFileSync('viewer/app.js', 'utf8') + '\n' + readFileSync('viewer/physics.js', 'utf8')
const start = html.indexOf('const T = THREE')
const end = html.lastIndexOf('</script>')
if (start < 0 || end < 0) throw new Error('markers not found')
writeFileSync(path, html.slice(0, start) + app + '\n' + html.slice(end))
console.log('spliced', app.length, 'chars')
