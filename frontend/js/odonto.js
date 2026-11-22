// Odontogramme 3D : arcades dentaires en SVG (vue occlusale), dents modélisées par type, relief, gencive et perspective CSS.
export const STATES = {
  saine: { l: 'Saine', c: '#12a36a', bg: '#e3f6ec' }, carie: { l: 'Cariée', c: '#d93a3a', bg: '#fdecec' }, a_extraire: { l: 'À extraire', c: '#e98a15', bg: '#fff1dc' },
  absente: { l: 'Non présente', c: '#b07a82', bg: '#f7e8ea' }, extraite: { l: 'Extraite', c: '#8a94a6', bg: '#eef1f5' }, restauree: { l: 'Restaurée', c: '#2f6fcf', bg: '#e8f1fd' }, couronne: { l: 'Couronne', c: '#c9971f', bg: '#fdf3d6' },
  implant: { l: 'Implant', c: '#5b6778', bg: '#eceff4' }, bridge: { l: 'Bridge', c: '#7c5cf0', bg: '#efe9ff' }, anomalie: { l: 'Anomalie', c: '#d6336c', bg: '#ffe3ee' } }
const POS = { 1: 'Incisive centrale', 2: 'Incisive latérale', 3: 'Canine', 4: 'Première prémolaire', 5: 'Deuxième prémolaire', 6: 'Première molaire', 7: 'Deuxième molaire', 8: 'Dent de sagesse' }
const PPOS = { 1: 'Incisive centrale de lait', 2: 'Incisive latérale de lait', 3: 'Canine de lait', 4: 'Première molaire de lait', 5: 'Deuxième molaire de lait' }
const Q = { 1: 'supérieure droite', 2: 'supérieure gauche', 3: 'inférieure gauche', 4: 'inférieure droite', 5: 'supérieure droite', 6: 'supérieure gauche', 7: 'inférieure gauche', 8: 'inférieure droite' }
export const toothName = n => `${(n > 50 ? PPOS : POS)[n % 10] || 'Dent'} ${Q[Math.floor(n / 10)] || ''}`.trim()
export const ARCH = { perm: { up: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28], low: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38] },
  prim: { up: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65], low: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75] } }

// type et dimensions (mésio-distal w, vestibulo-lingual d) de chaque dent
const kind = n => { const p = n % 10; if (n > 50) return p <= 2 ? 'inc' : p === 3 ? 'can' : 'mol'; return p <= 2 ? 'inc' : p === 3 ? 'can' : p <= 5 ? 'pre' : 'mol' }
const size = (n, upper) => { const p = n % 10
  if (n > 50) return [[0, 0], [22, 17], [19, 16], [21, 20], [25, 24], [29, 27]][p]
  if (upper) return [[0, 0], [30, 23], [24, 20], [27, 25], [25, 28], [24, 28], [36, 36], [33, 34], [29, 31]][p]
  return [[0, 0], [21, 20], [23, 21], [25, 24], [25, 26], [26, 27], [38, 34], [35, 33], [33, 31]][p] }
const rr = (w, d, r) => { const x = -w / 2, y = -d / 2; r = Math.min(r, w / 2, d / 2)
  return `M${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + d - r}Q${x + w},${y + d} ${x + w - r},${y + d}H${x + r}Q${x},${y + d} ${x},${y + d - r}V${y + r}Q${x},${y} ${x + r},${y}Z` }
const shape = (k, w, d) => k === 'inc' ? `M${-w / 2},${-d * .12}C${-w / 2},${-d * .56} ${w / 2},${-d * .56} ${w / 2},${-d * .12}C${w / 2},${d * .22} ${w * .2},${d / 2} 0,${d / 2}C${-w * .2},${d / 2} ${-w / 2},${d * .22} ${-w / 2},${-d * .12}Z`
  : k === 'can' ? `M0,${-d / 2}C${w * .46},${-d * .46} ${w / 2},${-d * .05} ${w * .42},${d * .16}C${w * .3},${d * .48} ${-w * .3},${d * .48} ${-w * .42},${d * .16}C${-w / 2},${-d * .05} ${-w * .46},${-d * .46} 0,${-d / 2}Z`
  : rr(w, d, k === 'pre' ? Math.min(w, d) * .46 : w * .3)
const grooves = (k, w, d) => k === 'mol' ? `M${-w * .3},${-d * .04}Q0,${d * .1} ${w * .3},${-d * .04}M${-w * .02},${-d * .32}Q${w * .06},0 ${-w * .02},${d * .32}`
  : k === 'pre' ? `M${-w * .26},0Q0,${d * .1} ${w * .26},0` : k === 'inc' ? `M${-w * .34},${-d * .26}Q0,${-d * .34} ${w * .34},${-d * .26}` : `M0,${-d * .3}L0,${d * .12}`
const cusps = (k, w, d) => k === 'mol' ? [[-.2, -.2], [.2, -.2], [-.2, .2], [.2, .2]] : k === 'pre' ? [[0, -.22], [0, .2]] : []

// ellipse échantillonnée -> position le long de l'arc par longueur
function arc(cx, cy, rx, ry, dir, t0) { const N = 400, pts = []; let L = 0
  for (let i = 0; i <= N; i++) { const t = t0 + (Math.PI - 2 * t0) * i / N, x = cx - rx * Math.cos(t), y = cy - dir * ry * Math.sin(t); if (i) L += Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y); pts.push({ t, x, y, L }) }
  const at = s => { let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].L < s) lo = m; else hi = m } return pts[hi] }
  return { L, at, path: pts.filter((_, i) => i % 8 === 0 || i === N).map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('') } }

const defs = `<defs>
  <radialGradient id="og-enamel" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f6efe0"/><stop offset="1" stop-color="#d8c9a8"/></radialGradient>
  <radialGradient id="og-couronne" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#fff8dc"/><stop offset=".5" stop-color="#f1cf68"/><stop offset="1" stop-color="#b3842a"/></radialGradient>
  <radialGradient id="og-implant" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#c7cfdb"/><stop offset="1" stop-color="#7a8597"/></radialGradient>
  <radialGradient id="og-anomalie" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#ffdbe9"/><stop offset="1" stop-color="#e48fb1"/></radialGradient>
  <radialGradient id="og-fill" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#b9d7ff"/><stop offset="1" stop-color="#2f6fcf"/></radialGradient>
  <radialGradient id="og-caries" cx="45%" cy="45%" r="60%"><stop offset="0" stop-color="#3a1408"/><stop offset=".6" stop-color="#7a2e1a"/><stop offset="1" stop-color="#d93a3a" stop-opacity=".35"/></radialGradient>
  <linearGradient id="og-gum" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4b9bd"/><stop offset="1" stop-color="#e99aa1"/></linearGradient>
  <filter id="og-sh" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="2.4" stdDeviation="1.8" flood-color="#3b1d12" flood-opacity=".28"/></filter>
  <filter id="og-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter></defs>`

function tooth(n, st, sel, k, w, d, x, y, rot) {
  const s = st || '', p = shape(k, w, d), base = s === 'couronne' ? 'url(#og-couronne)' : s === 'implant' ? 'url(#og-implant)' : s === 'anomalie' ? 'url(#og-anomalie)' : 'url(#og-enamel)'
  const stroke = s && s !== 'saine' ? STATES[s].c : '#c4b38b', ghost = s === 'extraite' || s === 'absente'
  let deco = ''
  if (!ghost) {
    deco += `<path d="${grooves(k, w, d)}" fill="none" stroke="${s === 'couronne' ? '#a87b12' : '#c9b78f'}" stroke-width="1.1" stroke-linecap="round" opacity=".8"/>`
    deco += cusps(k, w, d).map(([a, b]) => `<circle cx="${a * w}" cy="${b * d}" r="${Math.min(w, d) * .07}" fill="#fff" opacity=".7"/>`).join('')
    deco += `<ellipse cx="${-w * .17}" cy="${-d * .2}" rx="${w * .16}" ry="${d * .09}" fill="#fff" opacity=".6" transform="rotate(-18 ${-w * .17} ${-d * .2})"/>`
    if (s === 'carie') deco += `<ellipse cx="${w * .06}" cy="${d * .02}" rx="${Math.min(w, d) * .2}" ry="${Math.min(w, d) * .16}" fill="url(#og-caries)"/>`
    if (s === 'restauree') deco += `<path d="${rr(w * .46, d * .38, Math.min(w, d) * .14)}" fill="url(#og-fill)" stroke="#1d5bb8" stroke-width=".8"/>`
    if (s === 'implant') deco += `<circle r="${Math.min(w, d) * .17}" fill="#8a94a6" stroke="#5b6778" stroke-width="1.2"/><path d="M${-Math.min(w, d) * .1},0H${Math.min(w, d) * .1}M0,${-Math.min(w, d) * .1}V${Math.min(w, d) * .1}" stroke="#f4f6f9" stroke-width="1.6" stroke-linecap="round"/>`
    if (s === 'a_extraire') deco += `<path d="M${-w * .3},${-d * .3}L${w * .3},${d * .3}M${w * .3},${-d * .3}L${-w * .3},${d * .3}" stroke="#e98a15" stroke-width="3" stroke-linecap="round"/>`
    if (s === 'anomalie') deco += `<text y="${d * .14}" text-anchor="middle" font-size="${d * .48}" font-weight="800" fill="#b4235f">!</text>`
  }
  // dent absente : pas de couronne, seulement la gencive cicatrisée (léger creux) à l'emplacement
  // dent absente : pas de couronne. Extraite = alvéole visible ; non présente = gencive lisse
  const crown = s === 'absente' ? `<ellipse rx="${w * .34}" ry="${d * .24}" fill="#e7a3aa" opacity=".35"/><ellipse rx="${w * .2}" ry="${d * .07}" cy="${-d * .08}" fill="#fff" opacity=".3"/>`
    : ghost ? `<ellipse rx="${w * .38}" ry="${d * .3}" fill="#d97f89" opacity=".45"/><ellipse rx="${w * .26}" ry="${d * .18}" cy="${d * .04}" fill="#c96a76" opacity=".35"/><ellipse rx="${w * .2}" ry="${d * .08}" cy="${-d * .12}" fill="#fff" opacity=".35"/>`
    : `<path d="${p}" fill="${base}" stroke="${stroke}" stroke-width="${s && s !== 'saine' ? 2 : 1}"/>${deco}`
  return `<g class="otooth ${s ? 'st-' + s : 'st-none'}${sel ? ' on' : ''}" data-d7="tooth" data-id="${n}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><g class="olift">
    ${sel ? `<path d="${p}" transform="rotate(${rot.toFixed(1)}) scale(1.28)" fill="none" stroke="#1d6fd8" stroke-width="5" opacity=".55" filter="url(#og-glow)" class="oglow"/>` : ''}
    ${ghost ? '' : `<path d="${p}" transform="translate(0,5) rotate(${rot.toFixed(1)})" fill="${s === 'couronne' ? '#8a6418' : s === 'implant' ? '#5b6778' : '#bba57a'}" opacity=".9"/>`}
    <g class="otb" transform="rotate(${rot.toFixed(1)})" ${ghost ? '' : 'filter="url(#og-sh)"'}>${crown}</g></g>
    <path class="ohit" d="${p}" transform="rotate(${rot.toFixed(1)}) scale(1.3)" fill="transparent"/></g>`
}

// Renvoie le SVG des deux arcades. states : Map(fdi -> état) ; sel : Set des dents sélectionnées
export function odontoSvg({ states, sel = new Set(), dent = 'perm', flash = new Set() }) {
  const prim = dent === 'prim', VW = 760, VH = prim ? 560 : 610, cx = VW / 2
  const conf = prim ? [{ list: ARCH.prim.up, cy: 262, rx: 175, ry: 165, dir: 1, upper: true }, { list: ARCH.prim.low, cy: 300, rx: 168, ry: 158, dir: -1, upper: false }]
    : [{ list: ARCH.perm.up, cy: 284, rx: 240, ry: 212, dir: 1, upper: true }, { list: ARCH.perm.low, cy: 326, rx: 228, ry: 202, dir: -1, upper: false }]
  let gums = '', teeth = '', labels = '', bridges = ''
  for (const a of conf) {
    const t0 = .16, A = arc(cx, a.cy, a.rx, a.ry, a.dir, t0), sz = a.list.map(n => size(n, a.upper)), gap = 3, S = sz.reduce((s, [w]) => s + w, 0) + gap * (a.list.length - 1), k = A.L * .96 / S
    gums += `<path d="${A.path}" fill="none" stroke="url(#og-gum)" stroke-width="${(prim ? 46 : 56) * Math.min(1.25, k)}" stroke-linecap="round" stroke-linejoin="round" opacity=".95"/><path d="${A.path}" fill="none" stroke="#f9d3d5" stroke-width="${(prim ? 30 : 38) * Math.min(1.25, k)}" stroke-linecap="round" opacity=".55"/>`
    let s = (A.L - S * k) / 2; const centers = []
    a.list.forEach((n, i) => { const [w, d] = sz[i], pt = A.at(s + w * k / 2), rot = a.dir === 1 ? (pt.t - Math.PI / 2) * 180 / Math.PI : 180 - (pt.t - Math.PI / 2) * 180 / Math.PI
      centers.push({ n, x: pt.x, y: pt.y }); let tg = tooth(n, states.get(n), sel.has(n), kind(n), w * k, d * k, pt.x, pt.y, rot); if (flash.has(n)) tg = tg.replace('class="otooth ', 'class="otooth flash '); teeth += tg
      const vx = pt.x - cx, vy = pt.y - a.cy, vl = Math.hypot(vx, vy) || 1, off = d * k / 2 + 15
      labels += `<text class="olbl${sel.has(n) ? ' on' : ''}${['extraite', 'absente'].includes(states.get(n)) ? ' gone' : states.get(n) && states.get(n) !== 'saine' ? ' mk' : ''}" x="${(pt.x + vx / vl * off).toFixed(1)}" y="${(pt.y + vy / vl * off + 4).toFixed(1)}" text-anchor="middle" data-d7="tooth" data-id="${n}" ${states.get(n) && !['saine', 'extraite', 'absente'].includes(states.get(n)) ? `fill="${STATES[states.get(n)].c}"` : ''}>${n}</text>`
      s += w * k + gap * k })
    for (let i = 1; i < centers.length; i++) if (states.get(centers[i].n) === 'bridge' && states.get(centers[i - 1].n) === 'bridge') bridges += `<line x1="${centers[i - 1].x}" y1="${centers[i - 1].y}" x2="${centers[i].x}" y2="${centers[i].y}" stroke="#7c5cf0" stroke-width="7" stroke-linecap="round" opacity=".55"/>`
  }
  const mid = (conf[0].cy + conf[1].cy) / 2
  return `<svg class="osvg" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Schéma dentaire">${defs}
    <text class="oside" x="18" y="${mid + 5}">D</text><text class="oside" x="${VW - 18}" y="${mid + 5}" text-anchor="end">G</text>
    <text class="ojaw" x="${cx}" y="${mid - 48}" text-anchor="middle">MAXILLAIRE</text><text class="ojaw" x="${cx}" y="${mid + 58}" text-anchor="middle">MANDIBULE</text>
    <line x1="${cx - 120}" x2="${cx + 120}" y1="${mid}" y2="${mid}" stroke="#d5dce7" stroke-dasharray="4 5"/>
    <text id="ohud" class="ohud" x="${cx}" y="${mid + 5}" text-anchor="middle"></text>
    ${gums}${bridges}${teeth}${labels}</svg>`
}
