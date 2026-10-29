import { layout, P } from './lib/bike.mjs'
const L = layout()
const stack = L.headTop.y - L.bb.y, reach = L.headTop.x - L.bb.x
const wb = L.frontHub.x - L.rearHub.x, fc = L.frontHub.x - L.bb.x
const trail = (P.tireR*Math.cos(P.headAngle*Math.PI/180) - P.forkRake)/Math.sin(P.headAngle*Math.PI/180)
console.log({ stack: stack.toFixed(1), reach: reach.toFixed(1), wheelbase: wb.toFixed(1), frontCentre: fc.toFixed(1), trail: trail.toFixed(1) })
console.log('targets: stack 577, reach 387, wb 983, fc 583, trail 58')
