// Genera las easings de resorte de app/globals.css (--ease-snappy/smooth/bouncy).
//
//   node scripts/gen-springs.mjs
//
// Pega la salida en el bloque @theme inline de app/globals.css. No editar esos
// numeros a mano: el tiempo de asentamiento esta horneado en cada curva, asi que
// una duracion que no venga de aca hace que el resorte se lea mal.
//
// Compila osciladores armónicos amortiguados a easings CSS linear().
// Misma idea que liquid-gooey: el spring se resuelve una vez, offline, y el runtime
// solo interpola una curva estática que el compositor puede correr en GPU.
//
// Se parametriza por (zeta, duracion) porque eso es lo perceptualmente controlable,
// y se deriva stiffness/damping, no al reves.

const SETTLE = 0.005 // |x| bajo 0.5% y que se quede ahi = asentado

function displacement(w0, z) {
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z)
    return (t) => Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t))
  }
  if (z === 1) return (t) => Math.exp(-w0 * t) * (1 + w0 * t)
  const r = w0 * Math.sqrt(z * z - 1)
  return (t) => Math.exp(-z * w0 * t) * (Math.cosh(r * t) + ((z * w0) / r) * Math.sinh(r * t))
}

function settleTime(x) {
  for (let t = 0; t <= 8; t += 0.001) {
    if (Math.abs(x(t)) >= SETTLE) continue
    let stays = true
    for (let u = t; u <= Math.min(t + 0.4, 8); u += 0.004) {
      if (Math.abs(x(u)) >= SETTLE) { stays = false; break }
    }
    if (stays) return t
  }
  return 8
}

// biseccion sobre w0 para que el tiempo de asentamiento caiga en la duracion pedida
function solve(zeta, durationMs) {
  const target = durationMs / 1000
  let lo = 1, hi = 400
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (settleTime(displacement(mid, zeta)) > target) lo = mid
    else hi = mid
  }
  const w0 = (lo + hi) / 2
  return { w0, zeta, stiffness: w0 * w0, damping: 2 * zeta * w0, x: displacement(w0, zeta) }
}

function toLinear(x, settle, steps) {
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const p = 1 - x((i / steps) * settle)
    pts.push(i === 0 ? '0' : i === steps ? '1' : String(Math.round(p * 1000) / 1000))
  }
  return `linear(${pts.join(', ')})`
}

const presets = [
  ['snappy', 1.0,  320, 'hover, focus, cambios de estado'],
  ['smooth', 1.08, 440, 'entrada/salida de overlays'],
  ['bouncy', 0.55, 560, 'indicadores que viajan'],
]

for (const [name, zeta, ms, use] of presets) {
  const s = solve(zeta, ms)
  const settle = settleTime(s.x)
  let min = 0
  for (let t = 0; t <= settle; t += 0.001) min = Math.min(min, s.x(t))
  console.log(`/* ${name} — ${use}`)
  console.log(`   zeta ${zeta}, w0 ${s.w0.toFixed(1)} rad/s  =>  stiffness ${s.stiffness.toFixed(0)}, damping ${s.damping.toFixed(1)}, mass 1`)
  console.log(`   asentado a ${Math.round(settle * 1000)}ms, overshoot ${(-min * 100).toFixed(1)}% */`)
  console.log(`  --duration-${name}: ${Math.round(settle * 1000)}ms;`)
  console.log(`  --ease-${name}: ${toLinear(s.x, settle, 20)};\n`)
}
