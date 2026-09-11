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
  cumDistance: 500, cumShowReceptors: false,
};
const DISTANCES = [500, 700, 900, 1100, 1300, 1500, 2000, 5000];
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
const locTabs = document.querySelectorAll('.loc-tab');
const locFieldAdres = document.getElementById('loc-field-adres');
const locFieldCoords = document.getElementById('loc-field-coords');
const addressInput = document.getElementById('address-input');
const addressSuggestions = document.getElementById('address-suggestions');
const latInput = document.getElementById('lat-input');
const lngInput = document.getElementById('lng-input');
const addTurbineBtn = document.getElementById('add-turbine-btn');
const locStatus = document.getElementById('loc-status');
const m3WindIndicator = document.getElementById('m3-wind-indicator');
const cumDistanceSelect = document.getElementById('cum-distance-select');
const cumShowReceptorsCheck = document.getElementById('cum-show-receptors');
const cumTableBody = document.getElementById('cum-table-body');
const cumCallout = document.getElementById('cum-callout');

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
function haversineDist(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}
function bearingBetween(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ---------- Leaflet map ----------
const RING_SEGMENTS = 16;
const ARC_SUBSTEPS = 4;
let map, mapRenderer, turbineLayer, tileLayer, turbineArrowLayer, receptorLayer;
const turbineRingGroups = new Map(); // id -> L.LayerGroup
const turbineMarkers = new Map();    // id -> L.Marker
const turbineWindArrows = new Map(); // id -> L.Marker (divIcon, rotated in place)

const WIND_ARROW_SIZE = 74;
function windArrowIcon() {
  const c = WIND_ARROW_SIZE / 2;
  return L.divIcon({
    className: 'wind-arrow-icon',
    html: `<div class="wind-arrow-rotate"><svg width="${WIND_ARROW_SIZE}" height="${WIND_ARROW_SIZE}" viewBox="0 0 ${WIND_ARROW_SIZE} ${WIND_ARROW_SIZE}">
      <line x1="${c}" y1="${c}" x2="${c}" y2="8" stroke="#a1332f" stroke-width="3" stroke-linecap="round"/>
      <path d="M${c} 8 L${c - 6} 19 L${c + 6} 19 Z" fill="#a1332f"/>
      <line x1="${c}" y1="${c}" x2="${c}" y2="${WIND_ARROW_SIZE - 8}" stroke="#3d7a4a" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 5"/>
      <circle cx="${c}" cy="${WIND_ARROW_SIZE - 8}" r="3.5" fill="#3d7a4a"/>
    </svg></div>`,
    iconSize: [WIND_ARROW_SIZE, WIND_ARROW_SIZE],
    iconAnchor: [WIND_ARROW_SIZE / 2, WIND_ARROW_SIZE / 2],
  });
}
function updateWindArrowRotations() {
  const downwindBearing = (state.windBearing + 180) % 360;
  turbineWindArrows.forEach(marker => {
    const el = marker.getElement();
    const inner = el && el.querySelector('.wind-arrow-rotate');
    if (inner) inner.style.transform = `rotate(${downwindBearing}deg)`;
  });
}

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
  turbineArrowLayer = L.layerGroup().addTo(map);
  turbineLayer = L.layerGroup().addTo(map);
  receptorLayer = L.layerGroup().addTo(map);
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
  tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-contributors, tegels via <a href="https://www.openstreetmap.fr/" target="_blank" rel="noopener">OpenStreetMap France</a>',
    subdomains: 'abc',
    maxZoom: 19,
  });
  tileLayer.addTo(map);
  tileLayer.setZIndex(0);
  const mapEl = document.getElementById('turbine-map');
  if (mapEl) mapEl.classList.toggle('map-dark-filter', currentTheme === 'dark');
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

  const arrowMarker = L.marker([lat, lng], { icon: windArrowIcon(), interactive: false, keyboard: false }).addTo(turbineArrowLayer);
  turbineWindArrows.set(id, arrowMarker);

  const group = L.layerGroup().addTo(map);
  turbineRingGroups.set(id, group);

  selectTurbine(id);
  render();
}

function removeTurbine(id) {
  const marker = turbineMarkers.get(id);
  if (marker) { turbineLayer.removeLayer(marker); turbineMarkers.delete(id); }
  const arrowMarker = turbineWindArrows.get(id);
  if (arrowMarker) { turbineArrowLayer.removeLayer(arrowMarker); turbineWindArrows.delete(id); }
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
  turbineWindArrows.forEach(m => turbineArrowLayer.removeLayer(m));
  turbineWindArrows.clear();
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
        weight: 2.5, opacity: 0.85, lineCap: 'butt', interactive: false, renderer: mapRenderer,
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
  if (m3WindIndicator) {
    m3WindIndicator.innerHTML = `Wind uit ${state.windDir} · <span class="dw-tag">rood = downwind</span> · <span class="uw-tag">groen = upwind</span>`;
  }
  updateWindArrowRotations();

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
  renderCumulativeModule(catLw);
}

// ---------- Locatie toevoegen: adreszoeker (PDOK Locatieserver) & coordinaten ----------
const NL_BOUNDS = { minLat: 50.4, maxLat: 53.8, minLng: 2.9, maxLng: 7.4 };
let activeLocTab = 'adres';
let selectedAddressResult = null; // { lat, lng, label }
let addressDebounceTimer = null;
let addressAbortController = null;

function setLocStatus(message, tone) {
  locStatus.textContent = message || '';
  locStatus.classList.remove('error', 'success');
  if (tone) locStatus.classList.add(tone);
}

locTabs.forEach(btn => {
  btn.addEventListener('click', () => {
    activeLocTab = btn.dataset.locTab;
    locTabs.forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    locFieldAdres.hidden = activeLocTab !== 'adres';
    locFieldCoords.hidden = activeLocTab !== 'coords';
    addressSuggestions.hidden = true;
    setLocStatus('');
  });
});

function hideSuggestions() {
  addressSuggestions.hidden = true;
  addressSuggestions.innerHTML = '';
}

addressInput.addEventListener('input', () => {
  selectedAddressResult = null;
  const q = addressInput.value.trim();
  clearTimeout(addressDebounceTimer);
  if (q.length < 2) { hideSuggestions(); return; }
  addressDebounceTimer = setTimeout(() => fetchAddressSuggestions(q), 300);
});

addressInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const firstItem = addressSuggestions.querySelector('li');
    if (firstItem) firstItem.click();
    else addTurbineBtn.click();
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.address-search')) hideSuggestions();
});

async function fetchAddressSuggestions(query) {
  if (addressAbortController) addressAbortController.abort();
  addressAbortController = new AbortController();
  try {
    const url = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest?q=${encodeURIComponent(query)}&fq=type:(woonplaats OR adres OR postcode OR weg)&rows=6`;
    const res = await fetch(url, { signal: addressAbortController.signal });
    if (!res.ok) throw new Error('PDOK suggest mislukt');
    const data = await res.json();
    const docs = (data.response && data.response.docs) || [];
    if (!docs.length) {
      addressSuggestions.innerHTML = '<li class="no-result">Geen resultaten gevonden.</li>';
      addressSuggestions.hidden = false;
      return;
    }
    addressSuggestions.innerHTML = docs.map(d => `<li role="option" data-id="${d.id}" data-label="${d.weergavenaam.replace(/"/g, '&quot;')}">${d.weergavenaam}</li>`).join('');
    addressSuggestions.hidden = false;
    addressSuggestions.querySelectorAll('li[data-id]').forEach(li => {
      li.addEventListener('click', () => selectAddressSuggestion(li.dataset.id, li.dataset.label));
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    addressSuggestions.innerHTML = '<li class="no-result">Zoeken via PDOK is mislukt. Probeer het opnieuw.</li>';
    addressSuggestions.hidden = false;
  }
}

async function selectAddressSuggestion(id, label) {
  hideSuggestions();
  addressInput.value = label;
  setLocStatus('Locatie ophalen\u2026');
  try {
    const res = await fetch(`https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup?id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('PDOK lookup mislukt');
    const data = await res.json();
    const doc = data.response && data.response.docs && data.response.docs[0];
    if (!doc || !doc.centroide_ll) throw new Error('Geen co\u00f6rdinaten gevonden');
    const match = /POINT\(([-0-9.]+) ([-0-9.]+)\)/.exec(doc.centroide_ll);
    if (!match) throw new Error('Onbekend co\u00f6rdinatenformaat');
    const lng = parseFloat(match[1]);
    const lat = parseFloat(match[2]);
    selectedAddressResult = { lat, lng, label };
    setLocStatus(`Gevonden: ${label}. Klik op "Turbine toevoegen".`, 'success');
  } catch (err) {
    selectedAddressResult = null;
    setLocStatus('Kon geen co\u00f6rdinaten ophalen voor deze locatie. Probeer het opnieuw.', 'error');
  }
}

function withinNetherlands(lat, lng) {
  return lat >= NL_BOUNDS.minLat && lat <= NL_BOUNDS.maxLat && lng >= NL_BOUNDS.minLng && lng <= NL_BOUNDS.maxLng;
}

addTurbineBtn.addEventListener('click', () => {
  if (state.turbines.length >= MAX_TURBINES) {
    setLocStatus(`Maximaal ${MAX_TURBINES} turbines geplaatst. Verwijder er eerst een.`, 'error');
    return;
  }

  let lat, lng, label;
  if (activeLocTab === 'adres') {
    if (!selectedAddressResult || selectedAddressResult.label !== addressInput.value) {
      setLocStatus('Kies eerst een locatie uit de suggesties hierboven.', 'error');
      return;
    }
    ({ lat, lng, label } = selectedAddressResult);
  } else {
    lat = parseFloat(latInput.value);
    lng = parseFloat(lngInput.value);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      setLocStatus('Vul zowel een geldige breedtegraad als lengtegraad in.', 'error');
      return;
    }
    label = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }

  if (!withinNetherlands(lat, lng)) {
    setLocStatus('Deze co\u00f6rdinaten liggen buiten Nederland (ongeveer lat 50,4\u201353,8 \u00b7 lon 2,9\u20137,4).', 'error');
    return;
  }

  addTurbine(lat, lng);
  map.flyTo([lat, lng], Math.max(map.getZoom(), 11), { duration: 0.6 });
  setLocStatus(`Turbine toegevoegd bij ${label}.`, 'success');

  addressInput.value = '';
  selectedAddressResult = null;
  latInput.value = '';
  lngInput.value = '';
});

// ---------- Module 4: cumulatie ----------
cumDistanceSelect.innerHTML = DISTANCES.map(d => `<option value="${d}">${d} m</option>`).join('');
cumDistanceSelect.value = String(state.cumDistance);
cumDistanceSelect.addEventListener('change', () => {
  state.cumDistance = parseInt(cumDistanceSelect.value, 10);
  render();
});
cumShowReceptorsCheck.addEventListener('change', () => {
  state.cumShowReceptors = cumShowReceptorsCheck.checked;
  render();
});

function renderCumulativeModule(catLw) {
  receptorLayer.clearLayers();
  const cat = CATEGORY[state.category];
  const lwCat = catLw[state.category];
  const downwindBearing = (state.windBearing + 180) % 360;
  const d = state.cumDistance;

  if (state.turbines.length === 0) {
    cumTableBody.innerHTML = `<tr><td colspan="4" class="empty-row">Plaats minstens één turbine op de kaart in Module 3 om cumulatie te berekenen.</td></tr>`;
    cumCallout.textContent = '';
    return;
  }

  const rows = state.turbines.map(anchor => {
    const receptor = destPoint(anchor.lat, anchor.lng, downwindBearing, d);
    const ownLevel = lpAt(d, 1, state.category, lwCat, state);
    const contributions = state.turbines.map(t => {
      const dist = Math.max(haversineDist(receptor[0], receptor[1], t.lat, t.lng), 30);
      const bearingFromTurbine = bearingBetween(t.lat, t.lng, receptor[0], receptor[1]);
      const x = xFromAngle(bearingFromTurbine, downwindBearing);
      return lpAt(dist, x, state.category, lwCat, state);
    });
    const total = logSum(contributions);
    const diff = total - ownLevel;
    return { anchor, receptor, ownLevel, total, diff };
  });

  cumTableBody.innerHTML = rows.map(r => {
    const diffClass = r.diff >= 0.15 ? 'up' : 'flat';
    const diffText = (r.diff >= 0 ? '+' : '') + r.diff.toFixed(1) + ' dB';
    return `<tr><td>Turbine #${r.anchor.id} · ${d} m downwind</td><td class="cum-own">${r.ownLevel.toFixed(1)}</td><td class="cum-total">${r.total.toFixed(1)}</td><td class="cum-diff ${diffClass}">${diffText}</td></tr>`;
  }).join('');

  const maxDiff = Math.max(...rows.map(r => r.diff));
  const cat_unit = cat.unit;
  if (state.turbines.length === 1) {
    cumCallout.textContent = `Met één turbine is er niets om mee te cumuleren — "cumulatief" is hier gelijk aan de eigen bijdrage. Plaats een tweede turbine om het effect van optelling te zien.`;
  } else if (maxDiff < 0.15) {
    cumCallout.textContent = `Bij de huidige turbineposities en windrichting dragen de andere turbines vrijwel niets bij op de downwind-referentiepunten (< 0,15 dB extra) — ze staan te ver uit elkaar of niet in elkaars downwind-lijn op ${d} m.`;
  } else {
    cumCallout.textContent = `Op minstens één referentiepunt loopt het niveau door cumulatie met +${maxDiff.toFixed(1)} ${cat_unit} op ten opzichte van de losse turbine — energetische optelling (10·log₁₀ Σ 10^(L/10)) van de bijdragen van alle geplaatste turbines op dat punt.`;
  }

  if (state.cumShowReceptors) {
    rows.forEach(r => {
      const marker = L.circleMarker(r.receptor, {
        radius: 5, color: '#1c2b28', weight: 1.5, fillColor: colorForDb(r.total, cat.domainMin, cat.domainMax), fillOpacity: 0.95, interactive: true, renderer: mapRenderer,
      });
      marker.bindTooltip(`<div class="receptor-popup">Referentiepunt turbine #${r.anchor.id}<br>Cumulatief: <strong>${r.total.toFixed(1)} ${cat_unit}</strong></div>`, { direction: 'top', offset: [0, -4] });
      marker.addTo(receptorLayer);
    });
  }
}

// ---------- Wire up turbine controls & init ----------
clearTurbinesBtn.addEventListener('click', clearAllTurbines);
initMap();
render();
