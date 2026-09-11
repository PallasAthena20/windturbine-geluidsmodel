// ============================================================
// Windturbine Geluidsmodel — NL-kaart, meerdere turbines,
// 3 geluidscategorieën (hoorbaar / laagfrequent / infrasoon)
// ============================================================

// ---------- Theme toggle ----------
let currentTheme = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
(function () {
  const t = document.querySelector('[data-theme-toggle]'), r = document.documentElement;
  r.setAttribute('data-theme', currentTheme);
  t && t.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    r.setAttribute('data-theme', currentTheme);
    t.setAttribute('aria-label', 'Switch to ' + (currentTheme === 'dark' ? 'light' : 'dark') + ' mode');
    t.innerHTML = currentTheme === 'dark'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    applyMapTileTheme();
    render();
  });
})();

// ---------- Acoustic reference data ----------
// Octave-band unweighted source spectrum (Vestas V90, 80 m hub height), base total ≈106 dB(A).
// 63–8000 Hz: Torrance Wind Farm Extension, Technical Appendix 7.1 (unweighted = LWA_ref − A_CORR).
// 8/16/31.5 Hz: extrapolated at +3 dB per octave going down from 63 Hz, per RSG (2016)
// "Massachusetts Study on Wind Turbine Acoustics" (tethys.pnnl.gov), which reports wind-turbine
// sound levels rising ~3 dB/octave with decreasing frequency down to ≈4 Hz.
const OCTAVE_BANDS = [8, 16, 31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000];
const LW_UNWEIGHTED_BASE = [125.7, 122.7, 119.7, 116.7, 111.8, 106.7, 102.7, 99.7, 97.3, 93.9, 82.2];
// A-weighting corrections at octave-band centre frequencies (IEC 61672-1)
const A_CORR = [-77.8, -56.7, -39.4, -26.2, -16.1, -8.6, -3.2, 0, 1.2, 1.0, -1.1];
// G-weighting corrections (ISO 7196), only defined/used for the infrasound bands (≤16 Hz)
const G_CORR = { 8: -4.0, 16: 7.7 };

function logSum(dbArray) {
  const sum = dbArray.reduce((acc, db) => acc + Math.pow(10, db / 10), 0);
  return 10 * Math.log10(sum);
}

const BAND_INDEX = Object.fromEntries(OCTAVE_BANDS.map((f, i) => [f, i]));
const LWA_BASE_PER_BAND = LW_UNWEIGHTED_BASE.map((lw, i) => lw + A_CORR[i]);
const BASE_LWA_TOTAL = logSum(LWA_BASE_PER_BAND); // ≈106.0 dB(A), matches the published reference spectrum

// Band groupings per sound category — per Positionpaper Geluidpropagatie Windturbines
const CATEGORY_BANDS = {
  hoorbaar: [250, 500, 1000, 2000, 4000, 8000],       // ~200 Hz–20 kHz
  laagfrequent: [31.5, 63, 125],                       // 20–200 Hz
  infrasoon: [8, 16],                                  // <20 Hz
};

function computeCategoryLw(lwaInput) {
  const delta = lwaInput - BASE_LWA_TOTAL;
  const lwUnweighted = LW_UNWEIGHTED_BASE.map(v => v + delta);
  const lwa = lwUnweighted.map((v, i) => v + A_CORR[i]);
  const hoorbaar = logSum(CATEGORY_BANDS.hoorbaar.map(f => lwa[BAND_INDEX[f]]));
  const laagfrequent = logSum(CATEGORY_BANDS.laagfrequent.map(f => lwUnweighted[BAND_INDEX[f]]));
  const infrasoon = logSum(CATEGORY_BANDS.infrasoon.map(f => lwUnweighted[BAND_INDEX[f]] + G_CORR[f]));
  return { hoorbaar, laagfrequent, infrasoon, lwUnweighted, lwa, delta };
}

// ---------- Directional propagation model ----------
const ADIV_120 = 20 * Math.log10(120) + 11; // ISO 9613-2 style geometric divergence at 120 m ref

// Hoorbaar: full Evans & Cooper (2012) dB(A) fit — strongest asymmetry (downwind 18.5 / cross 23.2 / upwind 25.3)
function mHoorbaar(x) { return 23.2 - 3.4 * x - 1.3 * x * x; }
// Laagfrequent: same fit damped ×0.4 — moderate asymmetry (existing model default, unchanged)
function mLaagfrequent(x) { return 23.2 - 0.52 * x * x - 1.36 * x; }
// Infrasoon: near-flat/near-symmetric — negligible atmospheric attenuation, >10 km reach (Mattsson et al. 2026)
function mInfrasoon(x) { return 20 - 0.05 * (3.4 * x + 1.3 * x * x); }

const CATEGORY = {
  hoorbaar: {
    key: 'hoorbaar', label: 'Hoorbaar geluid', shortLabel: 'Hoorbaar', unit: 'dB(A)',
    range: '≈200 Hz – 20 kHz', domainMin: 10, domainMax: 70, mFunc: mHoorbaar,
    note: 'Sterkste richtingsasymmetrie, kleinste reikwijdte (doorgaans 1–2 km).',
  },
  laagfrequent: {
    key: 'laagfrequent', label: 'Laagfrequent geluid', shortLabel: 'Laagfrequent', unit: 'dB(Lin)',
    range: '20–200 Hz', domainMin: 25, domainMax: 85, mFunc: mLaagfrequent,
    note: 'Gematigde asymmetrie, iets groter bereik dan hoorbaar geluid.',
  },
  infrasoon: {
    key: 'infrasoon', label: 'Infrasoon geluid', shortLabel: 'Infrasoon', unit: 'dB(G)',
    range: '<20 Hz', domainMin: 40, domainMax: 95, mFunc: mInfrasoon, threshold: 90,
    note: 'Nauwelijks asymmetrie, verwaarloosbare atmosferische demping — kan zich >10 km verspreiden.',
  },
};

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

function lpAt(d, x, categoryKey, lwCat, state) {
  const cat = CATEGORY[categoryKey];
  const lpRef120 = lwCat - ADIV_120;
  const base = lpRef120 - cat.mFunc(x) * Math.log10(d / 120);
  return base + addonAt(d, state).total;
}

// ---------- App state ----------
const state = {
  lwa: 106.0, windBearing: 0, daynight: 'dag', scenario: 'best', curtailment: false,
  category: 'hoorbaar', turbines: [], selectedTurbineId: null,
};
const DISTANCES = [500, 700, 900, 1100, 1300, 1500, 5000];
const DIR_LABELS = { N: 'het noorden', NE: 'het noordoosten', E: 'het oosten', SE: 'het zuidoosten', S: 'het zuiden', SW: 'het zuidwesten', W: 'het westen', NW: 'het noordwesten' };
const OPPOSITE_LABEL = { N: 'zuiden', NE: 'zuidwesten', E: 'westen', SE: 'noordwesten', S: 'noorden', SW: 'noordoosten', W: 'oosten', NW: 'zuidoosten' };
const MAX_TURBINES = 8;
let nextTurbineId = 1;

// ---------- DOM refs ----------
const lwaInput = document.getElementById('lwa-input');
const lwaReadout = document.getElementById('lwa-readout');
const outLwa = document.getElementById('out-lwa');
const outHoorbaar = document.getElementById('out-hoorbaar');
const outLaagfrequent = document.getElementById('out-laagfrequent');
const outInfrasoon = document.getElementById('out-infrasoon');
const octaveTableBody = document.querySelector('#octave-table tbody');
const offsetFormula = document.getElementById('offset-formula');
const windLabel = document.getElementById('wind-label');
const arrowGroup = document.getElementById('arrow-group');
const daynightToggle = document.getElementById('daynight-toggle');
const curtailmentRow = document.getElementById('curtailment-row');
const curtailmentCheck = document.getElementById('curtailment-check');
const scenarioList = document.getElementById('scenario-list');
const factorRows = document.getElementById('factor-rows');
const legendBar = document.getElementById('legend-bar');
const legendTicks = document.getElementById('legend-ticks');
const legendCaption = document.getElementById('legend-caption');
const dataTableBody = document.getElementById('data-table-body');
const dataTableHead = document.getElementById('data-table-head');
const dataTableTitle = document.getElementById('data-table-title');
const miniScenario = document.getElementById('mini-scenario');
const miniSub = document.getElementById('mini-sub');
const categoryTabs = document.getElementById('category-tabs');
const turbineCountEl = document.getElementById('turbine-count');
const clearTurbinesBtn = document.getElementById('clear-turbines');
const emptyMapHint = document.getElementById('empty-map-hint');
const infrasoundCallout = document.getElementById('infrasound-callout');

// ---------- Static: octave table ----------
(function fillOctaveTable() {
  const catByFreq = {};
  Object.entries(CATEGORY_BANDS).forEach(([cat, freqs]) => freqs.forEach(f => { catByFreq[f] = cat; }));
  octaveTableBody.innerHTML = OCTAVE_BANDS.map((f, i) => {
    const cat = catByFreq[f];
    const badge = `<span class="cat-badge cat-${cat}">${CATEGORY[cat].shortLabel}</span>`;
    return `<tr><td>${f}</td><td>${badge}</td><td>${LW_UNWEIGHTED_BASE[i].toFixed(1)}</td><td>${A_CORR[i] >= 0 ? '+' : ''}${A_CORR[i].toFixed(1)}</td><td>${LWA_BASE_PER_BAND[i].toFixed(1)}</td></tr>`;
  }).join('');
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

// ---------- Category tabs ----------
categoryTabs.querySelectorAll('.cat-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    categoryTabs.querySelectorAll('.cat-tab').forEach(b => b.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');
    state.category = btn.dataset.category;
    render();
  });
});

// ---------- Color scale ----------
const COLOR_STOPS = [
  { t: 0.0, c: [47, 125, 107] },   // teal-green, quiet
  { t: 0.25, c: [127, 174, 78] },  // yellow-green
  { t: 0.5, c: [212, 178, 63] },   // gold
  { t: 0.7, c: [217, 134, 59] },   // orange
  { t: 0.85, c: [193, 82, 63] },   // deep orange-red
  { t: 1.0, c: [156, 47, 58] },    // deep red, loud
];

function colorForDb(db, domainMin, domainMax) {
  const t = Math.max(0, Math.min(1, (db - domainMin) / (domainMax - domainMin)));
  let s0 = COLOR_STOPS[0], s1 = COLOR_STOPS[COLOR_STOPS.length - 1];
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    if (t >= COLOR_STOPS[i].t && t <= COLOR_STOPS[i + 1].t) { s0 = COLOR_STOPS[i]; s1 = COLOR_STOPS[i + 1]; break; }
  }
  const span = (s1.t - s0.t) || 1;
  const lt = (t - s0.t) / span;
  const c = s0.c.map((v, i) => Math.round(v + (s1.c[i] - v) * lt));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function buildLegend() {
  const cat = CATEGORY[state.category];
  const stops = COLOR_STOPS.map(s => colorForDb(cat.domainMin + s.t * (cat.domainMax - cat.domainMin), cat.domainMin, cat.domainMax));
  legendBar.style.background = `linear-gradient(to right, ${stops.join(',')})`;
  const n = 6;
  const ticks = Array.from({ length: n }, (_, i) => Math.round(cat.domainMin + (i / (n - 1)) * (cat.domainMax - cat.domainMin)));
  legendTicks.innerHTML = ticks.map(v => `<span>${v}</span>`).join('');
  legendCaption.textContent = `${cat.label} (${cat.unit}) — lichter/koeler = stiller, donkerder/warmer = luider`;
}

// ---------- Geo helpers ----------
const EARTH_R = 6371000;
function destPoint(lat, lng, bearingDeg, distM) {
  const brng = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180, lng1 = lng * Math.PI / 180;
  const dR = distM / EARTH_R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(brng));
  const lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(dR) * Math.cos(lat1), Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2));
  return [lat2 * 180 / Math.PI, ((lng2 * 180 / Math.PI) + 540) % 360 - 180];
}

// ---------- Leaflet map ----------
const RING_SEGMENTS = 16;
const ARC_SUBSTEPS = 4;
let map, mapRenderer, turbineLayer, tileLayer;
const turbineRingGroups = new Map(); // id -> L.LayerGroup
const turbineMarkers = new Map();    // id -> L.Marker

const TURBINE_ICON_SVG = (color) => `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(13,12)">
    <line x1="0" y1="0" x2="0" y2="20" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="0" cy="0" r="2.2" fill="${color}"/>
    <path d="M0 0 L0 -13 C5 -13 6.5 -9 6.5 -6.7 C6.5 -3.8 3 0 0 0 Z" fill="${color}" opacity="0.9"/>
    <path d="M0 0 L11.3 6.5 C9.4 10.9 4.3 11.6 2.2 10.1 C0 8.7 -0.7 4.3 0 0 Z" fill="${color}" opacity="0.65"/>
    <path d="M0 0 L-11.3 6.5 C-9.4 10.9 -4.3 11.6 -2.2 10.1 C0 8.7 0.7 4.3 0 0 Z" fill="${color}" opacity="0.4"/>
  </g>
</svg>`;

function turbineIcon(selected) {
  const color = selected ? '#c1523f' : '#0e4a4a';
  return L.divIcon({
    className: 'turbine-marker-icon',
    html: TURBINE_ICON_SVG(color),
    iconSize: [26, 34],
    iconAnchor: [13, 26],
  });
}

function initMap() {
  mapRenderer = L.canvas({ padding: 0.4 });
  map = L.map('turbine-map', {
    center: [52.15, 5.3],
    zoom: 7,
    minZoom: 6,
    maxZoom: 15,
    renderer: mapRenderer,
    zoomControl: true,
  });
  turbineLayer = L.layerGroup().addTo(map);
  applyMapTileTheme();

  map.on('click', (e) => {
    if (state.turbines.length >= MAX_TURBINES) {
      flashEmptyHint(`Maximaal ${MAX_TURBINES} turbines geplaatst. Verwijder er eerst een via de kaart of "Wis alle turbines".`);
      return;
    }
    addTurbine(e.latlng.lat, e.latlng.lng);
  });
}

function flashEmptyHint(msg) {
  emptyMapHint.textContent = msg;
  emptyMapHint.classList.add('visible', 'warn');
  clearTimeout(flashEmptyHint._t);
  flashEmptyHint._t = setTimeout(() => {
    emptyMapHint.classList.remove('warn');
    updateEmptyHint();
  }, 2600);
}

function updateEmptyHint() {
  if (state.turbines.length === 0) {
    emptyMapHint.textContent = 'Klik op de kaart om een windturbine te plaatsen (max. ' + MAX_TURBINES + ').';
    emptyMapHint.classList.add('visible');
  } else {
    emptyMapHint.classList.remove('visible');
  }
}

function applyMapTileTheme() {
  if (!map) return;
  if (tileLayer) map.removeLayer(tileLayer);
  const url = currentTheme === 'dark'
    ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
    : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  tileLayer = L.tileLayer(url, {
    attribution: '&copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, HERE, Garmin, FAO, NOAA, USGS',
    maxZoom: 16,
  });
  tileLayer.addTo(map);
  tileLayer.setZIndex(0);
}

function addTurbine(lat, lng) {
  const id = nextTurbineId++;
  const turbine = { id, lat, lng };
  state.turbines.push(turbine);

  const marker = L.marker([lat, lng], { icon: turbineIcon(false) }).addTo(turbineLayer);
  marker.bindPopup(`<div class="turbine-popup"><strong>Turbine #${id}</strong><br><button type="button" class="popup-remove-btn" data-remove-id="${id}">Verwijder deze turbine</button></div>`);
  marker.on('click', () => { selectTurbine(id); });
  marker.on('popupopen', () => {
    const btn = document.querySelector(`.popup-remove-btn[data-remove-id="${id}"]`);
    if (btn) btn.addEventListener('click', () => { removeTurbine(id); map.closePopup(); });
  });
  turbineMarkers.set(id, marker);

  const group = L.layerGroup().addTo(map);
  turbineRingGroups.set(id, group);

  selectTurbine(id);
  render();
}

function removeTurbine(id) {
  const marker = turbineMarkers.get(id);
  if (marker) { turbineLayer.removeLayer(marker); turbineMarkers.delete(id); }
  const group = turbineRingGroups.get(id);
  if (group) { map.removeLayer(group); turbineRingGroups.delete(id); }
  state.turbines = state.turbines.filter(t => t.id !== id);
  if (state.selectedTurbineId === id) {
    state.selectedTurbineId = state.turbines.length ? state.turbines[state.turbines.length - 1].id : null;
  }
  render();
}

function clearAllTurbines() {
  turbineRingGroups.forEach(g => map.removeLayer(g));
  turbineRingGroups.clear();
  turbineMarkers.forEach(m => turbineLayer.removeLayer(m));
  turbineMarkers.clear();
  state.turbines = [];
  state.selectedTurbineId = null;
  render();
}

function selectTurbine(id) {
  state.selectedTurbineId = id;
  turbineMarkers.forEach((marker, mid) => marker.setIcon(turbineIcon(mid === id)));
  render();
}

function ringsForTurbine(turbine, lwCat) {
  const downwindBearing = (state.windBearing + 180) % 360;
  const cat = CATEGORY[state.category];
  const polylines = [];
  [...DISTANCES].reverse().forEach(d => {
    for (let s = 0; s < RING_SEGMENTS; s++) {
      const a1 = (s / RING_SEGMENTS) * 360, a2 = ((s + 1) / RING_SEGMENTS) * 360;
      const mid = (a1 + a2) / 2;
      const x = xFromAngle(mid, downwindBearing);
      const db = lpAt(d, x, state.category, lwCat, state);
      const pts = [];
      for (let k = 0; k <= ARC_SUBSTEPS; k++) {
        const bear = a1 + (a2 - a1) * (k / ARC_SUBSTEPS);
        pts.push(destPoint(turbine.lat, turbine.lng, bear, d));
      }
      polylines.push(L.polyline(pts, {
        color: colorForDb(db, cat.domainMin, cat.domainMax),
        weight: 6, opacity: 0.85, lineCap: 'butt', interactive: false, renderer: mapRenderer,
      }));
    }
  });
  return polylines;
}

function renderAllTurbineRings() {
  const lwCat = computeCategoryLw(state.lwa)[state.category];
  state.turbines.forEach(turbine => {
    const group = turbineRingGroups.get(turbine.id);
    if (!group) return;
    group.clearLayers();
    ringsForTurbine(turbine, lwCat).forEach(pl => group.addLayer(pl));
  });
}

// ---------- Rendering ----------
function render() {
  lwaReadout.textContent = state.lwa.toFixed(1);
  outLwa.textContent = state.lwa.toFixed(1) + ' dB(A)';

  const catLw = computeCategoryLw(state.lwa);
  outHoorbaar.textContent = catLw.hoorbaar.toFixed(1) + ' dB(A)';
  outLaagfrequent.textContent = catLw.laagfrequent.toFixed(1) + ' dB(Lin)';
  outInfrasoon.textContent = catLw.infrasoon.toFixed(1) + ' dB(G)';

  offsetFormula.innerHTML =
    `Elke categorie telt een eigen subset octaafbanden energetisch (logaritmisch) op:<br>` +
    `Hoorbaar (250–8000 Hz, A-gewogen): <strong>${catLw.hoorbaar.toFixed(1)} dB(A)</strong><br>` +
    `Laagfrequent (31,5–125 Hz, ongewogen): <strong>${catLw.laagfrequent.toFixed(1)} dB(Lin)</strong><br>` +
    `Infrasoon (8–16 Hz, G-gewogen naar ISO 7196): <strong>${catLw.infrasoon.toFixed(1)} dB(G)</strong>`;

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
  const f = addonAt(500, state);
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
  miniSub.textContent = `${state.daynight === 'dag' ? 'Dag' : 'Nacht'} · Wind uit ${state.windDir}${state.curtailment && state.scenario !== 'best' ? ' · curtailment actief' : ''} · ${state.turbines.length} turbine${state.turbines.length === 1 ? '' : 's'}`;

  buildLegend();

  // turbine count / empty hint
  turbineCountEl.textContent = `${state.turbines.length} / ${MAX_TURBINES} turbines geplaatst`;
  updateEmptyHint();

  // data table for selected turbine
  const cat = CATEGORY[state.category];
  dataTableTitle.textContent = `${cat.label} (${cat.unit}) per afstand en richting`;
  const selected = state.turbines.find(t => t.id === state.selectedTurbineId);
  if (!selected) {
    dataTableBody.innerHTML = `<tr><td colspan="4" class="empty-row">Plaats een turbine op de kaart om resultaten te zien.</td></tr>`;
  } else {
    const lwCat = catLw[state.category];
    dataTableBody.innerHTML = DISTANCES.map(d => {
      const down = lpAt(d, 1, state.category, lwCat, state);
      const cross = lpAt(d, 0, state.category, lwCat, state);
      const up = lpAt(d, -1, state.category, lwCat, state);
      return `<tr><td>${d} m</td><td class="downwind">${down.toFixed(1)}</td><td>${cross.toFixed(1)}</td><td class="upwind">${up.toFixed(1)}</td></tr>`;
    }).join('');
  }

  // infrasound threshold callout
  if (state.category === 'infrasoon' && selected) {
    const lwCat = catLw.infrasoon;
    const worstNear = lpAt(500, 1, 'infrasoon', lwCat, state);
    if (worstNear >= CATEGORY.infrasoon.threshold) {
      infrasoundCallout.innerHTML = `Bij deze instellingen ligt het infrasone niveau op 500 m downwind (${worstNear.toFixed(1)} dB(G)) op of boven de ISO 7196-hoorbaarheidsdrempel van 90–100 dB(G) — normaliter wordt infrasoon geluid van windturbines daar ver onder gemeten.`;
      infrasoundCallout.classList.add('visible', 'danger');
    } else {
      const margin = CATEGORY.infrasoon.threshold - worstNear;
      infrasoundCallout.innerHTML = `Infrasoon niveau op 500 m downwind (${worstNear.toFixed(1)} dB(G)) ligt ${margin.toFixed(1)} dB onder de ISO 7196-hoorbaarheidsdrempel (90–100 dB(G)) — conform metingen in <a href="https://tethys.pnnl.gov/sites/default/files/publications/RSG-2016-Report.pdf" target="_blank" rel="noopener">RSG (2016)</a>, waar turbine-infrasoon doorgaans 25+ dB onder deze drempel bleef.`;
      infrasoundCallout.classList.add('visible');
      infrasoundCallout.classList.remove('danger');
    }
  } else {
    infrasoundCallout.classList.remove('visible', 'danger');
  }

  renderAllTurbineRings();
}

// ---------- Wire up turbine controls & init ----------
clearTurbinesBtn.addEventListener('click', clearAllTurbines);
initMap();
render();
