import * as THREE from 'three'
import { deg, v3 } from './geo.mjs'

/**
 * A 56 cm modern road bike, all lengths in millimetres, Y up, +X forward,
 * +Z drive side. Wheels turn about Z, the ground plane is y = 0.
 */
export const P = {
  tireR: 336,          // 25-622: bead seat 311 + 25 section
  axleY: 336,
  bbDrop: 70,
  chainstay: 410,
  wheelbase: 983,
  seatAngle: 73.3,
  headAngle: 73.5,
  seatTubeLen: 533,    // centre of BB to top of seat tube, along the tube
  headTubeLen: 170,
  forkA2C: 371,
  forkRake: 40,        // published rake at this wheelbase; the chart says 40
  topTube: 560,        // effective, horizontal
  stemLen: 100,
  stemAngle: 6,
  barWidth: 420,
  crankLen: 172.5,
  bbShellWidth: 68,
  rearOld: 130,
  frontOld: 100,
}

const cos = (d) => Math.cos(deg(d))
const sin = (d) => Math.sin(deg(d))

export function layout() {
  const bb = v3(0, P.axleY - P.bbDrop, 0)
  const rearHub = v3(-Math.sqrt(P.chainstay ** 2 - P.bbDrop ** 2), P.axleY, 0)
  const frontHub = v3(rearHub.x + P.wheelbase, P.axleY, 0)

  const uSeat = v3(-cos(P.seatAngle), sin(P.seatAngle), 0)
  const uHead = v3(-cos(P.headAngle), sin(P.headAngle), 0)
  const nHead = v3(sin(P.headAngle), cos(P.headAngle), 0) // forward of the steering axis

  const seatTop = bb.clone().addScaledVector(uSeat, P.seatTubeLen)
  const crown = frontHub.clone()
    .addScaledVector(nHead, -P.forkRake)
    .addScaledVector(uHead, P.forkA2C)
  // the head tube's lower face is the crown race seat: the published stack closes
  // only when the 170 mm head tube starts at the crown (Trek's chart)
  const headBottom = crown.clone()
  const headTop = headBottom.clone().addScaledVector(uHead, P.headTubeLen)

  // seat cluster sits just under the seat tube's top
  const seatCluster = bb.clone().addScaledVector(uSeat, P.seatTubeLen - 22)
  // top tube meets the head tube just under its top
  const headCluster = headTop.clone().addScaledVector(uHead, -20)

  const ttSeat = seatCluster.clone()
  const ttHead = headCluster.clone()
  const dtHead = headBottom.clone().addScaledVector(uHead, 16)
  const dtBb = bb.clone()

  // fork: crown splits to two blades that rake forward to the dropouts
  const forkBladeTop = crown.clone().addScaledVector(uHead, 6)
  const forkDropout = frontHub.clone()

  // rear triangle: chainstays bow out and up, seatstays drop to the same dropout
  const csBb = bb.clone().add(v3(6, -2, 0))
  const csDrop = rearHub.clone().add(v3(4, 0, 0))
  const ssCluster = seatCluster.clone().addScaledVector(uSeat, 6)
  const ssDrop = rearHub.clone().add(v3(8, 3, 0))

  // saddle: seatpost top, 190 mm of post showing
  const seatpostTop = seatTop.clone().addScaledVector(uSeat, 190)
  const saddleTop = seatpostTop.clone().addScaledVector(uSeat, 62)
  // stem: from the top of the steerer, 100 mm forward and a little up
  const steererTop = headTop.clone().addScaledVector(uHead, 26)
  const stemDir = v3(cos(P.stemAngle), sin(P.stemAngle), 0)
  const barCenter = steererTop.clone().addScaledVector(stemDir, P.stemLen)
  const chainline = 43.5
  const chainringZ = chainline
  const crankZ = chainline + 4

  return {
    bb, rearHub, frontHub, uSeat, uHead, nHead, seatTop, crown, headBottom, headTop,
    seatCluster, headCluster, ttSeat, ttHead, dtHead, dtBb,
    forkBladeTop, forkDropout, csBb, csDrop, ssCluster, ssDrop,
    seatpostTop, saddleTop, steererTop, barCenter, stemDir, chainringZ, crankZ,
    cassetteZ0: 22, cassetteZ1: 22 + 42,
  }
}

/** Chain path round the chainring, the cassette and both jockey wheels. */
export function chainPath(L) {
  const ringR = 101.3 // 50 t, pitch 12.7
  const cogR = 39.6   // 19 t mid cassette
  const jockeyR = 21.4
  return { ringR, cogR, jockeyR }
}
