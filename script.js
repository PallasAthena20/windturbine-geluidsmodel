// ============================================================
// Windturbine Geluidsmodel — richtingsafhankelijke propagatie
// ============================================================

// ---------- Theme toggle ----------
(function () {
  const t = document.querySelector('[data-theme-toggle]'), r = document.documentElement;
  let d = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  r.setAttribute('data-theme', d);
  t && t.addEventListener('click', () => {
    d = d === 'dark' ? 'light' : 'dark';
    r.setAttribute('data-theme', d);
    t.setAttribute('aria-label', 'Switch to ' + (d === 'dark' ? 'light' : 'dark') + ' mode');
    t.innerHTML = d === 'dark'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    render();
  });
})();

// ---------- Acoustic reference data ----------
// Octave-band source spectrum (Vestas V90, 80m hub height), normalized to 106 dB(A) total.
// Source: Torrance Wind Farm Extension, Technical Appendix 7.1.
const OCTAVE_BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
const LWA_REF = [90.5, 95.7, 98.1, 99.5, 99.7, 98.5, 94.9, 81.1]; // dB(A), per band
// A-weighting corrections at octave-band centre frequencies (IEC 61672-1), LWA = LW + A_CORR
const A_CORR = [-26.2, -16.1, -8.6, -3.2, 0, 1.2, 1.0, -1.1];

function logSum(dbArray) {
  const sum = dbArray.reduce((acc, db) => acc + Math.pow(10, db / 10), 0);
  return 10 * Math.log10(sum);
}

function computeOffset() {
  const lwBands = LWA_REF.map((lwa, i) => lwa - A_CORR[i]); // unweighted per band
  const totalUnweighted = logSum(lwBands);
  const totalLWA = logSum(LWA_REF);
  return { lwBands, totalUnweighted, totalLWA, offset: totalUnweighted - totalLWA };
}

// ---------- Propagation model ----------
const ADIV_120 = 20 * Math.log10(120) + 11; // ISO 9613-2 style geometric divergence at 120m ref

function mDamped(x) {
  // Fit to Evans & Cooper (2012) dB(A) directional attenuation slopes (m_downwind=18.5, m_cross=23.2, m_upwind=25.3),
  // angular term damped 0.4x for the unweighted / low-frequency-dominated output (see methodology §2).
  return 23.2 - 0.52 * x * x - 1.36 * x;
}

function xFromAngle(bearingDeg, downwindBearingDeg) {
  let delta = bearingDeg - downwindBearingDeg;
  delta = ((delta + 180) % 360 + 360) % 360 - 180; // normalize to (-180,180]
  return Math.cos(delta * Math.PI / 180);
}

const SCENARIO_FACTORS = {
  best:   { shear: 0,  wake: 0, am: 0 },
  middel: { shear: 5,  wake: 2, am: 1 },
  worst:  { shear: 12, wake: 5, am: 3 },
};
const CURTAILMENT_FACTORS = { middel: 1, worst: 2 };

function wakeAtDistance(d, base) {
  const fade = Math.max(0, 1 - Math.max(0, d - 1000) / 1000);
  return base * Math.min(1, fade);
}

function addonAt(d, state) {
  const f = SCENARIO_FACTORS[state.scenario];
  const shear = state.daynight === 'nacht' ? f.shear : 0;
  const wake = wakeAtDistance(d, f.wake);
  const am = f.am;
  const curt = (state.curtailment && state.scenario !== 'best') ? (CURTAILMENT_FACTORS[state.scenario] || 0) : 0;
  return { shear, wake, am, curt, total: shear + wake + am + curt };
}

function lpAt(d, x, lwInput, state) {
  const lpRef120 = lwInput - ADIV_120;
  const base = lpRef120 - mDamped(x) * Math.log10(d / 120);
  return base + addonAt(d, state).total;
}

// ---------- App state ----------
const state = { lwa: 106.0, windBearing: 0, daynight: 'dag', scenario: 'best', curtailment: false };
const DISTANCES = [500, 700, 800, 900, 1000, 2000];
const DIR_LABELS = { N: 'het noorden', NE: 'het noordoosten', E: 'het oosten', SE: 'het zuidoosten', S: 'het zuiden', SW: 'het zuidwesten', W: 'het westen', NW: 'het noordwesten' };
const OPPOSITE_LABEL = { N: 'zuiden', NE: 'zuidwesten', E: 'westen', SE: 'noordwesten', S: 'noorden', SW: 'noordoosten', W: 'oosten', NW: 'zuidoosten' };

// ---------- DOM refs ----------
const lwaInput = document.getElementById('lwa-input');
const lwaReadout = document.getElementById('lwa-readout');
const outLwa = document.getElementById('out-lwa');
const outOffset = document.getElementById('out-offset');
const outLw = document.getElementById('out-lw');
const octaveTableBody = document.querySelector('#octave-table tbody');
const offsetFormula = document.getElementById('offset-formula');
const windLabel = document.getElementById('wind-label');
const arrowGroup = document.getElementById('arrow-group');
const daynightToggle = document.getElementById('daynight-toggle');
const curtailmentRow = document.getElementById('curtailment-row');
const curtailmentCheck = document.getElementById('curtailment-check');
const scenarioList = document.getElementById('scenario-list');
const factorRows = document.getElementById('factor-rows');
const mapSvg = document.getElementById('map-svg');
const legendBar = document.getElementById('legend-bar');
const legendTicks = document.getElementById('legend-ticks');
const dataTableBody = document.getElementById('data-table-body');
const miniScenario = document.getElementById('mini-scenario');
const miniSub = document.getElementById('mini-sub');

// ---------- Static: octave table ----------
(function fillOctaveTable() {
  const { lwBands } = computeOffset();
  octaveTableBody.innerHTML = OCTAVE_BANDS.map((f, i) =>
    `<tr><td>${f}</td><td>${LWA_REF[i].toFixed(1)}</td><td>${A_CORR[i] >= 0 ? '+' : ''}${A_CORR[i].toFixed(1)}</td><td>${lwBands[i].toFixed(1)}</td></tr>`
  ).join('');
})();

// ---------- Compass wiring ----------
document.querySelectorAll('.compass-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.compass-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');
    state.windBearing = parseFloat(btn.dataset.bearing);
    state.windDir = btn.dataset.dir;
    render();
  });
});
document.querySelector('.compass-btn[data-dir="N"]').setAttribute('aria-pressed', 'true');
state.windDir = 'N';

// ---------- Day/night toggle ----------
daynightToggle.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    daynightToggle.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');
    state.daynight = btn.dataset.val;
    render();
  });
});

// ---------- Scenario cards ----------
scenarioList.querySelectorAll('.scenario-card').forEach(card => {
  card.addEventListener('click', () => {
    scenarioList.querySelectorAll('.scenario-card').forEach(c => c.setAttribute('aria-pressed', 'false'));
    card.setAttribute('aria-pressed', 'true');
    state.scenario = card.dataset.scenario;
    render();
  });
});

// ---------- Curtailment checkbox ----------
curtailmentCheck.addEventListener('change', () => { state.curtailment = curtailmentCheck.checked; render(); });

// ---------- Bronvermogen slider ----------
lwaInput.addEventListener('input', () => { state.lwa = parseFloat(lwaInput.value); render(); });

// ---------- Color scale ----------
const COLOR_STOPS = [
  { t: 0.0, c: [47, 125, 107] },   // teal-green, quiet
  { t: 0.25, c: [127, 174, 78] },  // yellow-green
  { t: 0.5, c: [212, 178, 63] },   // gold
  { t: 0.7, c: [217, 134, 59] },   // orange
  { t: 0.85, c: [193, 82, 63] },   // deep orange-red
  { t: 1.0, c: [156, 47, 58] },    // deep red, loud
];
const DOMAIN_MIN = 30, DOMAIN_MAX = 80;

function colorForDb(db) {
  const t = Math.max(0, Math.min(1, (db - DOMAIN_MIN) / (DOMAIN_MAX - DOMAIN_MIN)));
  let s0 = COLOR_STOPS[0], s1 = COLOR_STOPS[COLOR_STOPS.length - 1];
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    if (t >= COLOR_STOPS[i].t && t <= COLOR_STOPS[i + 1].t) { s0 = COLOR_STOPS[i]; s1 = COLOR_STOPS[i + 1]; break; }
  }
  const span = (s1.t - s0.t) || 1;
  const lt = (t - s0.t) / span;
  const c = s0.c.map((v, i) => Math.round(v + (s1.c[i] - v) * lt));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

(function buildLegend() {
  legendBar.style.background = `linear-gradient(to right, ${COLOR_STOPS.map(s => colorForDb(DOMAIN_MIN + s.t * (DOMAIN_MAX - DOMAIN_MIN))).join(',')})`;
  const ticks = [30, 40, 50, 60, 70, 80];
  legendTicks.innerHTML = ticks.map(v => `<span>${v}</span>`).join('');
})();

// ---------- SVG map geometry ----------
const CX = 310, CY = 310;
const MAX_RADIUS_PX = 268; // for 2000m ring
const PX_PER_M = MAX_RADIUS_PX / 2000;

function polar(cx, cy, r, bearingDeg) {
  const rad = bearingDeg * Math.PI / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function arcPath(cx, cy, r, a1, a2) {
  const p1 = polar(cx, cy, r, a1), p2 = polar(cx, cy, r, a2);
  const largeArc = (a2 - a1) > 180 ? 1 : 0;
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
}

const SEGMENTS = 36; // 10-degree resolution

function renderMap(lwInput) {
  const downwindBearing = (state.windBearing + 180) % 360;
  let svg = '';

  // background guide circle
  svg += `<circle cx="${CX}" cy="${CY}" r="${MAX_RADIUS_PX + 14}" fill="none" stroke="var(--color-border)" stroke-width="1" stroke-dasharray="2 4" />`;

  // rings (drawn far-to-near so near rings render on top)
  const ringThickness = 11;
  [...DISTANCES].reverse().forEach(d => {
    const r = d * PX_PER_M;
    for (let i = 0; i < SEGMENTS; i++) {
      const a1 = (i / SEGMENTS) * 360, a2 = ((i + 1) / SEGMENTS) * 360;
      const mid = (a1 + a2) / 2;
      const x = xFromAngle(mid, downwindBearing);
      const db = lpAt(d, x, lwInput, state);
      const path = arcPath(CX, CY, r, a1, a2);
      svg += `<path d="${path}" fill="none" stroke="${colorForDb(db)}" stroke-width="${ringThickness}" stroke-linecap="butt" />`;
    }
  });

  // distance labels (placed along bearing 200 to avoid legend/compass clutter)
  const labelBearing = 205;
  DISTANCES.forEach(d => {
    const r = d * PX_PER_M;
    const p = polar(CX, CY, r, labelBearing);
    svg += `<g>
      <rect x="${(p.x - 22).toFixed(1)}" y="${(p.y - 9).toFixed(1)}" width="44" height="16" rx="4" fill="var(--color-surface)" opacity="0.88" />
      <text x="${p.x.toFixed(1)}" y="${(p.y + 3).toFixed(1)}" text-anchor="middle" font-family="var(--font-mono)" font-size="10.5" fill="var(--color-text-muted)">${d} m</text>
    </g>`;
  });

  // compass letters (fixed map orientation, N up)
  const compassR = MAX_RADIUS_PX + 30;
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([label, bear]) => {
    const p = polar(CX, CY, compassR, bear);
    svg += `<text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" text-anchor="middle" font-family="var(--font-mono)" font-size="13" font-weight="700" fill="var(--color-text-faint)">${label}</text>`;
  });

  // wind arrow: tail at upwind side, head at downwind side, drawn just outside the outermost ring
  const arrowR1 = MAX_RADIUS_PX + 44, arrowR2 = 40;
  const tail = polar(CX, CY, arrowR1, state.windBearing);
  const headBase = polar(CX, CY, arrowR2 + 22, downwindBearing);
  const headTip = polar(CX, CY, arrowR2, downwindBearing);
  svg += `<line x1="${tail.x.toFixed(1)}" y1="${tail.y.toFixed(1)}" x2="${headBase.x.toFixed(1)}" y2="${headBase.y.toFixed(1)}" stroke="var(--color-primary)" stroke-width="2.5" stroke-dasharray="1 7" stroke-linecap="round" opacity="0.7" />`;
  // arrowhead
  const angle = Math.atan2(headTip.x - headBase.x, -(headTip.y - headBase.y));
  const wing = 9;
  const l = { x: headTip.x - wing * Math.sin(angle + 0.45), y: headTip.y + wing * Math.cos(angle + 0.45) };
  const rr = { x: headTip.x - wing * Math.sin(angle - 0.45), y: headTip.y + wing * Math.cos(angle - 0.45) };
  svg += `<path d="M ${headTip.x.toFixed(1)} ${headTip.y.toFixed(1)} L ${l.x.toFixed(1)} ${l.y.toFixed(1)} L ${rr.x.toFixed(1)} ${rr.y.toFixed(1)} Z" fill="var(--color-primary)" opacity="0.85" />`;
  svg += `<text x="${tail.x.toFixed(1)}" y="${(tail.y + (tail.y > CY ? 16 : -10)).toFixed(1)}" text-anchor="middle" font-family="var(--font-mono)" font-size="10.5" font-weight="600" fill="var(--color-primary)">wind</text>`;

  // turbine icon at center
  svg += `<g transform="translate(${CX},${CY})">
    <line x1="0" y1="0" x2="0" y2="22" stroke="var(--color-text)" stroke-width="3" stroke-linecap="round" />
    <circle cx="0" cy="0" r="2.6" fill="var(--color-text)" />
    <path d="M0 0 L0 -18 C7 -18 9 -12 9 -9 C9 -5 4 0 0 0 Z" fill="var(--color-text)" opacity="0.9" />
    <path d="M0 0 L15.6 9 C13 15 6 16 3 14 C0 12 -1 6 0 0 Z" fill="var(--color-text)" opacity="0.65" />
    <path d="M0 0 L-15.6 9 C-13 15 -6 16 -3 14 C0 12 1 6 0 0 Z" fill="var(--color-text)" opacity="0.4" />
  </g>`;

  mapSvg.innerHTML = svg;
}

// ---------- Rendering ----------
function render() {
  lwaReadout.textContent = state.lwa.toFixed(1);
  outLwa.textContent = state.lwa.toFixed(1) + ' dB(A)';

  const { offset, totalUnweighted, totalLWA } = computeOffset();
  outOffset.textContent = (offset >= 0 ? '+' : '') + offset.toFixed(1) + ' dB';
  const lwInput = state.lwa + offset;
  outLw.textContent = lwInput.toFixed(1) + ' dB';

  offsetFormula.innerHTML =
    `Offset = L<sub>W,ongewogen</sub>(referentie) − L<sub>WA</sub>(referentie)<br>` +
    `Offset = ${totalUnweighted.toFixed(2)} dB − ${totalLWA.toFixed(2)} dB(A) = ${offset >= 0 ? '+' : ''}${offset.toFixed(2)} dB<br><br>` +
    `L<sub>W,ongewogen</sub>(ingevoerd) = ${state.lwa.toFixed(1)} dB(A) + ${offset.toFixed(2)} dB = <strong>${lwInput.toFixed(1)} dB</strong>`;

  // wind label + arrow rotation
  const downwindBearing = (state.windBearing + 180) % 360;
  windLabel.textContent = `Wind uit ${DIR_LABELS[state.windDir]} (${state.windDir}) → geluid draagt naar het ${OPPOSITE_LABEL[state.windDir]}`;
  arrowGroup.setAttribute('transform', `rotate(${downwindBearing} 100 100)`);

  // curtailment enable/disable
  if (state.scenario === 'best') {
    curtailmentRow.classList.add('disabled');
    curtailmentCheck.checked = false;
    state.curtailment = false;
  } else {
    curtailmentRow.classList.remove('disabled');
  }

  // factor breakdown
  const f = addonAt(500, state); // representative near-field (<=1000m) breakdown; wake fade shown separately
  const wakeNote = SCENARIO_FACTORS[state.scenario].wake;
  factorRows.innerHTML = `
    <div class="factor-row"><span class="f-label">Windschering / inversie (alleen nacht)</span><span class="f-val">${state.daynight === 'nacht' ? '+' + SCENARIO_FACTORS[state.scenario].shear : '0'} dB</span></div>
    <div class="factor-row"><span class="f-label">Toren-/gondelzog (≤1000 m, dooft uit tot 2000 m)</span><span class="f-val">+${wakeNote} dB</span></div>
    <div class="factor-row"><span class="f-label">Amplitudemodulatie (AM/OAM)</span><span class="f-val">+${SCENARIO_FACTORS[state.scenario].am} dB</span></div>
    <div class="factor-row"><span class="f-label">Curtailment/stall-afregeling ${state.curtailment && state.scenario !== 'best' ? '(actief)' : '(niet actief)'}</span><span class="f-val">+${f.curt} dB</span></div>
    <div class="factor-row total"><span class="f-label">Totaal op 500 m</span><span class="f-val">+${f.total.toFixed(1)} dB</span></div>
  `;

  // mini readout
  const scenarioLabels = { best: 'Best case', middel: 'Middenscenario', worst: 'Worst case' };
  miniScenario.textContent = scenarioLabels[state.scenario];
  miniSub.textContent = `${state.daynight === 'dag' ? 'Dag' : 'Nacht'} · Wind uit ${state.windDir}${state.curtailment && state.scenario !== 'best' ? ' · curtailment actief' : ''}`;

  // data table
  dataTableBody.innerHTML = DISTANCES.map(d => {
    const down = lpAt(d, 1, lwInput, state);
    const cross = lpAt(d, 0, lwInput, state);
    const up = lpAt(d, -1, lwInput, state);
    return `<tr><td>${d} m</td><td class="downwind">${down.toFixed(1)}</td><td>${cross.toFixed(1)}</td><td class="upwind">${up.toFixed(1)}</td></tr>`;
  }).join('');

  renderMap(lwInput);
}

render();
