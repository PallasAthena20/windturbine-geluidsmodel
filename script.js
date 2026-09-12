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
    applyMapTileTheme3a();
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

// Windschering/inversie, torenzog en amplitudemodulatie (AM) zijn volgens de onafhankelijke
// vakliteratuur (Bowdler/IOA-submission; VTT-onderzoeksrapport 2011; Van den Berg, JSV 2004)
// grotendeels dezelfde onderliggende fysica: torenzog is een van de mechanismen van AM, en
// windschering/stabiele atmosfeer is de meteorologische aanjager van diezelfde AM. Deze drie
// worden daarom niet meer bij elkaar opgeteld, maar er wordt het maximum van genomen — de
// aanname dat het dominante mechanisme het effect al grotendeels beschrijft. Curtailment/
// stall-afregeling is als enige factor een operationele/vergunningskeuze, geen weersomstandigheid,
// en telt daarom wel gewoon los bovenop.
function combinedFactors(d, scenarioKey, daynight, curtailmentActive) {
  const f = SCENARIO_FACTORS[scenarioKey];
  const shear = daynight === 'nacht' ? f.shear : 0;
  const wake = wakeAtDistance(d, f.wake);
  const am = f.am;
  const groupMax = Math.max(shear, wake, am);
  const curt = (curtailmentActive && scenarioKey !== 'best') ? (CURTAILMENT_FACTORS[scenarioKey] || 0) : 0;
  return { shear, wake, am, groupMax, curt, total: groupMax + curt };
}

function addonAt(d, state) {
  return combinedFactors(d, state.scenario, state.daynight, state.curtailment);
}

function lpAt(d, x, categoryKey, lwCat, state) {
  const cat = CATEGORY[categoryKey];
  const lpRef120 = lwCat - ADIV_120;
  const base = lpRef120 - cat.mFunc(x) * Math.log10(d / 120);
  return base + addonAt(d, state).total;
}

// Absolute worst case: alle versterkende factoren tegelijk (nacht, scenario 'worst', curtailment actief) —
// onafhankelijk van de huidige UI-selectie, gebruikt voor de methodologische kanttekening in Module 2.
function computeAbsoluteWorstCaseTotal(d) {
  // 's nachts, scenario 'worst', curtailment actief — zie combinedFactors() voor de max-i.p.v.-som-logica.
  return combinedFactors(d, 'worst', 'nacht', true).total;
}

// ---------- App state ----------
const state = {
  lwa: 106.0, windBearing: 0, daynight: 'dag', scenario: 'best', curtailment: false,
  category: 'hoorbaar', turbines: [], selectedTurbineId: null,
  cumDistance: 500, cumShowReceptors: false,
  normPreset: 'oud', normCustomLnight: 41,
  // Module 3a: volledig eigen turbine-invoer en dag/nacht — onafhankelijk van Module 2/5 hierboven.
  // state.category is BEWUST gedeeld met Module 3 (zie category-tabs-3a), net als scenario/curtailment/windBearing/lwa.
  turbines3a: [], selectedTurbineId3a: null, daynight3a: 'dag',
  normPreset3a: 'oud', normCustomLnight3a: 41,
};
// Referentiewaarden voor Module 5 (toetsing aan wettelijke normen) — zie module-desc voor bronnen.
// 'eigen' heeft geen vaste waarden; die komen uit state.normCustomLden/Lnight.
const NORM_PRESETS = {
  oud: { lden: 47, lnight: 41, label: 'Oude landelijke norm (Activiteitenbesluit/-regeling)' },
  who: { lden: 45, lnight: null, label: 'WHO-advieswaarde' },
};
function getActiveNorm() {
  if (state.normPreset === 'eigen') {
    return { lnight: state.normCustomLnight, label: 'Eigen/lokale norm' };
  }
  return NORM_PRESETS[state.normPreset];
}
function getActiveNorm3a() {
  if (state.normPreset3a === 'eigen') {
    return { lnight: state.normCustomLnight3a, label: 'Eigen/lokale norm' };
  }
  return NORM_PRESETS[state.normPreset3a];
}
// Lden-benadering is voor nu verwijderd (zie module-callouts) — toetsing gebeurt rechtstreeks op Lnight.
const DISTANCES = [500, 900, 1300, 1500, 2000, 5000];
// Vaste kleur per afstandsring — toont uitsluitend de afstand tot de turbine,
// NIET het geluidsniveau. De dB-waarde per afstand/richting staat in de datatabel.
const RING_COLORS = {
  500: '#2f8f5b',   // groen
  900: '#c9a227',   // geel
  1300: '#b83b33',  // rood
  1500: '#3b6fb5',  // blauw
  2000: '#7d4fb5',  // paars
  5000: '#d9863b',  // oranje
};
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
const worstCaseReadout = document.getElementById('worst-case-readout');
const normPresetSelect = document.getElementById('norm-preset-select');
const normCustomLnightField = document.getElementById('norm-custom-lnight-field');
const normCustomLnightInput = document.getElementById('norm-custom-lnight');
const normContextCallout = document.getElementById('norm-context-callout');
const normTableBody = document.getElementById('norm-table-body');
if (normPresetSelect) {
  normPresetSelect.addEventListener('change', () => {
    state.normPreset = normPresetSelect.value;
    const isCustom = state.normPreset === 'eigen';
    normCustomLnightField.style.display = isCustom ? '' : 'none';
    render();
  });
  normCustomLnightInput.addEventListener('input', () => {
    state.normCustomLnight = parseFloat(normCustomLnightInput.value);
    if (Number.isNaN(state.normCustomLnight)) state.normCustomLnight = 41;
    render();
  });
}
const categoryTabs = document.getElementById('category-tabs');
const cumDistanceSelect = document.getElementById('cum-distance-select');
const cumShowReceptorsCheck = document.getElementById('cum-show-receptors');
const cumTableBody = document.getElementById('cum-table-body');
const cumCallout = document.getElementById('cum-callout');
const normTableTitle = document.getElementById('norm-table-title');
const normAweightNote = document.getElementById('norm-aweight-note');

// ---------- Module 3a DOM refs ----------
const m3aContextCallout = document.getElementById('m3a-context-callout');
const categoryTabs3a = document.getElementById('category-tabs-3a');
const daynightToggle3a = document.getElementById('daynight-toggle-3a');
const normPresetSelect3a = document.getElementById('norm-preset-select-3a');
const normCustomLnightField3a = document.getElementById('norm-custom-lnight-field-3a');
const normCustomLnightInput3a = document.getElementById('norm-custom-lnight-3a');
const normTableTitle3a = document.getElementById('norm-table-title-3a');
const normAweightNote3a = document.getElementById('norm-aweight-note-3a');
const locTabs3a = document.querySelectorAll('[data-loc-tab-3a]');
const locFieldAdres3a = document.getElementById('loc-field-adres-3a');
const locFieldCoords3a = document.getElementById('loc-field-coords-3a');
const addressInput3a = document.getElementById('address-input-3a');
const addressSuggestions3a = document.getElementById('address-suggestions-3a');
const latInput3a = document.getElementById('lat-input-3a');
const lngInput3a = document.getElementById('lng-input-3a');
const pickOnMapBtn3a = document.getElementById('pick-on-map-btn-3a');
const addTurbineBtn3a = document.getElementById('add-turbine-btn-3a');
const locStatus3a = document.getElementById('loc-status-3a');
const turbineCount3a = document.getElementById('turbine-count-3a');
const m3aWindIndicator = document.getElementById('m3a-wind-indicator');
const clearTurbinesBtn3a = document.getElementById('clear-turbines-3a');
const emptyMapHint3a = document.getElementById('empty-map-hint-3a');
const ringLegend3a = document.getElementById('ring-legend-3a');
const legendCaption3a = document.getElementById('legend-caption-3a');

const miniScenario3a = document.getElementById('mini-scenario-3a');
const miniSub3a = document.getElementById('mini-sub-3a');
const normTableBody3a = document.getElementById('norm-table-body-3a');

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

// ---------- Category tabs (Module 3 en Module 3a delen state.category en blijven onderling gesynchroniseerd) ----------
function bindCategoryTabs(el) {
  if (!el) return;
  el.querySelectorAll('.cat-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.category = btn.dataset.category;
      render();
    });
  });
}
bindCategoryTabs(categoryTabs);
bindCategoryTabs(categoryTabs3a);
function syncCategoryTabButtons() {
  [categoryTabs, categoryTabs3a].forEach(el => {
    if (!el) return;
    el.querySelectorAll('.cat-tab').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.category === state.category ? 'true' : 'false');
    });
  });
}

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
const WIND_ARROW_SIZE = 74;

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

function renderNormModule() {
  if (!normTableBody) return;
  const n = state.turbines3a.length;
  const norm = getActiveNorm();
  const cat = CATEGORY[state.category];
  if (normTableTitle) normTableTitle.textContent = `Toetsing geselecteerde turbine (${cat.label.toLowerCase()}, ${cat.unit})`;
  if (normAweightNote) {
    if (state.category === 'hoorbaar') {
      normAweightNote.style.display = 'none';
    } else {
      normAweightNote.style.display = '';
      normAweightNote.innerHTML = `De wettelijke norm is gedefinieerd in <strong>dB(A)</strong> (het hoorbare, A-gewogen geluid). Voor ${cat.shortLabel.toLowerCase()} geluid vervalt de A-weging en wordt hier getoetst in <strong>${cat.unit}</strong> — er bestaat geen formeel vastgestelde, direct vergelijkbare grenswaarde in deze eenheid; de hierboven gekozen dB(A)-norm dient uitsluitend als indicatief referentiepunt.`;
    }
  }
  if (n === 0) {
    normContextCallout.textContent = 'Plaats minstens één turbine in Module 3 om te toetsen.';
  } else if (n <= 2) {
    normContextCallout.innerHTML = `${n} turbine${n === 1 ? '' : 's'} geplaatst: bij 1–2 turbines blijft de oude landelijke norm (41 dB Lnight) <strong>formeel van toepassing</strong>.`;
  } else {
    normContextCallout.innerHTML = `${n} turbines geplaatst: bij 3 of meer turbines gelden sinds de Delfzijluitspraak (2021) <strong>geen landelijke normen meer</strong> — het bevoegd gezag moet zelf een norm motiveren. De hier gekozen waarde is een referentie, geen automatisch geldende wettelijke norm.`;
  }

  const selected = state.turbines3a.find(t => t.id === state.selectedTurbineId3a);
  if (!selected) {
    normTableBody.innerHTML = `<tr><td colspan="4" class="empty-row">Plaats een turbine op de kaart in Module 3 om te toetsen.</td></tr>`;
    return;
  }

  const lwCat = computeCategoryLw(state.lwa)[state.category];
  const dayState = Object.assign({}, state, { daynight: 'dag' });
  const nightState = Object.assign({}, state, { daynight: 'nacht' });

  normTableBody.innerHTML = DISTANCES.map(d => {
    const lday = lpAt(d, 1, state.category, lwCat, dayState);
    const lnight = lpAt(d, 1, state.category, lwCat, nightState);

    let lnightCell;
    if (norm.lnight != null) {
      const exceed = lnight > norm.lnight;
      const diff = (lnight - norm.lnight);
      lnightCell = `<td class="${exceed ? 'norm-exceed' : 'norm-ok'}">${exceed ? 'Overschrijding' : 'Binnen norm'} (${diff >= 0 ? '+' : ''}${diff.toFixed(1)} dB)</td>`;
    } else {
      lnightCell = `<td class="norm-na">n.v.t.</td>`;
    }

    return `<tr><td>${d} m</td><td>${lday.toFixed(1)}</td><td>${lnight.toFixed(1)}</td>${lnightCell}</tr>`;
  }).join('');
}

function updateWorstCaseReadout() {
  if (!worstCaseReadout) return;
  const wc500 = computeAbsoluteWorstCaseTotal(500);
  const wc1300 = computeAbsoluteWorstCaseTotal(1300);
  const wc2000 = computeAbsoluteWorstCaseTotal(2000);
  const allEqual = Math.abs(wc500 - wc1300) < 0.05 && Math.abs(wc1300 - wc2000) < 0.05;
  if (allEqual) {
    worstCaseReadout.innerHTML = `<strong>Absolute worst case (nacht, maximum i.p.v. som, curtailment actief):</strong> de toeslag is nu een vlakke <strong>+${wc500.toFixed(1)} dB</strong>, ongeacht de afstand tot de turbine (500–2000 m). Windschering, torenzog en AM worden niet meer opgeteld maar er wordt het maximum van genomen — hier domineert windschering (12 dB) de andere twee, en windschering dooft (in lijn met Van den Berg, JSV 2004) niet uit met afstand. Curtailment (2 dB) telt als enige factor nog wel apart mee. Dit blijft een bewust conservatieve bovengrens voor toetsing, geen te verwachten gemiddelde nacht.`;
  } else {
    worstCaseReadout.innerHTML = `<strong>Absolute worst case (nacht, maximum i.p.v. som, curtailment actief):</strong> de toeslag loopt op tot <strong>+${wc500.toFixed(1)} dB</strong> op 500 m, <strong>+${wc1300.toFixed(1)} dB</strong> op 1300 m en <strong>+${wc2000.toFixed(1)} dB</strong> op 2000 m. Windschering, torenzog en AM worden niet meer opgeteld maar er wordt het maximum van genomen, om dubbeltelling van overlappende fysica te voorkomen; curtailment telt als enige factor apart mee. Dit blijft een bewust conservatieve bovengrens voor toetsing, geen te verwachten gemiddelde nacht.`;
  }
}

// ---------- Rendering ----------
function render() {
  syncCategoryTabButtons();
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

  // factor breakdown — windschering/torenzog/AM worden NIET meer opgeteld (overlappende fysica),
  // in plaats daarvan wordt het maximum van de drie meegeteld; curtailment blijft wel optelbaar.
  const f = addonAt(500, state);
  factorRows.innerHTML = `
    <div class="factor-row group-source"><span class="f-label">Windschering / inversie (alleen nacht)</span><span class="f-val">+${f.shear.toFixed(1)} dB</span></div>
    <div class="factor-row group-source"><span class="f-label">Toren-/gondelzog (≤1000 m, dooft uit tot 2000 m)</span><span class="f-val">+${f.wake.toFixed(1)} dB</span></div>
    <div class="factor-row group-source"><span class="f-label">Amplitudemodulatie (AM/OAM)</span><span class="f-val">+${f.am.toFixed(1)} dB</span></div>
    <div class="factor-row group-max"><span class="f-label">↳ meegeteld: hoogste van deze drie (geen som — overlappende fysica)</span><span class="f-val">+${f.groupMax.toFixed(1)} dB</span></div>
    <div class="factor-row"><span class="f-label">Curtailment/stall-afregeling ${state.curtailment && state.scenario !== 'best' ? '(actief)' : '(niet actief)'}</span><span class="f-val">+${f.curt.toFixed(1)} dB</span></div>
    <div class="factor-row total"><span class="f-label">Totaal op 500 m</span><span class="f-val">+${f.total.toFixed(1)} dB</span></div>
  `;

  updateWorstCaseReadout();

  renderCumulativeModule(catLw);
  renderNormModule();
  renderModule3a();
  renderModule6();
}

// ---------- Locatie toevoegen: adreszoeker (PDOK Locatieserver) & coordinaten ----------
const NL_BOUNDS = { minLat: 50.4, maxLat: 53.8, minLng: 2.9, maxLng: 7.4 };
function withinNetherlands(lat, lng) {
  return lat >= NL_BOUNDS.minLat && lat <= NL_BOUNDS.maxLat && lng >= NL_BOUNDS.minLng && lng <= NL_BOUNDS.maxLng;
}
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
  if (receptorLayer3a) receptorLayer3a.clearLayers();
  const cat = CATEGORY[state.category];
  const lwCat = catLw[state.category];
  const downwindBearing = (state.windBearing + 180) % 360;
  const d = state.cumDistance;

  if (state.turbines3a.length === 0) {
    cumTableBody.innerHTML = `<tr><td colspan="4" class="empty-row">Plaats minstens één turbine op de kaart in Module 3 om cumulatie te berekenen.</td></tr>`;
    cumCallout.textContent = '';
    return;
  }

  const rows = state.turbines3a.map(anchor => {
    const receptor = destPoint(anchor.lat, anchor.lng, downwindBearing, d);
    const ownLevel = lpAt(d, 1, state.category, lwCat, state);
    const contributions = state.turbines3a.map(t => {
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
  if (state.turbines3a.length === 1) {
    cumCallout.textContent = `Met één turbine is er niets om mee te cumuleren — "cumulatief" is hier gelijk aan de eigen bijdrage. Plaats een tweede turbine om het effect van optelling te zien.`;
  } else if (maxDiff < 0.15) {
    cumCallout.textContent = `Bij de huidige turbineposities en windrichting dragen de andere turbines vrijwel niets bij op de downwind-referentiepunten (< 0,15 dB extra) — ze staan te ver uit elkaar of niet in elkaars downwind-lijn op ${d} m.`;
  } else {
    cumCallout.textContent = `Op minstens één referentiepunt loopt het niveau door cumulatie met +${maxDiff.toFixed(1)} ${cat_unit} op ten opzichte van de losse turbine — energetische optelling (10·log₁₀ Σ 10^(L/10)) van de bijdragen van alle geplaatste turbines op dat punt.`;
  }

  if (state.cumShowReceptors) {
    rows.forEach(r => {
      const marker = L.circleMarker(r.receptor, {
        radius: 5, color: '#1c2b28', weight: 1.5, fillColor: colorForDb(r.total, cat.domainMin, cat.domainMax), fillOpacity: 0.95, interactive: true, renderer: mapRenderer3a,
      });
      marker.bindTooltip(`<div class="receptor-popup">Referentiepunt turbine #${r.anchor.id}<br>Cumulatief: <strong>${r.total.toFixed(1)} ${cat_unit}</strong></div>`, { direction: 'top', offset: [0, -4] });
      marker.addTo(receptorLayer3a);
    });
  }
}

// ============================================================
// Module 3a — herbouwde kaart: asymmetrische isofoon-contouren,
// grijze basemap (CARTO Positron) en een neutrale windpijlkleur.
// Volledig eigen turbine-invoer, dag/nacht-toggle en normselectie,
// onafhankelijk van Module 3/2/5 hierboven.
// ============================================================
let map3a, mapRenderer3a, turbineLayer3a, tileLayer3a, turbineArrowLayer3a, receptorLayer3a;
const turbineRingGroups3a = new Map(); // id -> L.LayerGroup met L.circle-ringen op vaste afstand
const turbineMarkers3a = new Map();
const turbineWindArrows3a = new Map();
let nextTurbine3aId = 1;

// Eén neutrale, donkere kleur i.p.v. rood/groen — vorm (pijlpunt vs. open cirkel) blijft het
// enige onderscheid tussen downwind en upwind, zodat de pijl niet meer visueel botst met
// de zes RING_COLORS (groen/geel/rood/blauw/paars/oranje) van de contouren.
const WIND_ARROW_COLOR_3A = '#334155';
function windArrowIcon3a() {
  const c = WIND_ARROW_SIZE / 2;
  return L.divIcon({
    className: 'wind-arrow-icon',
    html: `<div class="wind-arrow-rotate"><svg width="${WIND_ARROW_SIZE}" height="${WIND_ARROW_SIZE}" viewBox="0 0 ${WIND_ARROW_SIZE} ${WIND_ARROW_SIZE}">
      <line x1="${c}" y1="${c}" x2="${c}" y2="8" stroke="${WIND_ARROW_COLOR_3A}" stroke-width="3" stroke-linecap="round"/>
      <path d="M${c} 8 L${c - 6} 19 L${c + 6} 19 Z" fill="${WIND_ARROW_COLOR_3A}"/>
      <line x1="${c}" y1="${c}" x2="${c}" y2="${WIND_ARROW_SIZE - 8}" stroke="${WIND_ARROW_COLOR_3A}" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 3.5" opacity="0.55"/>
      <circle cx="${c}" cy="${WIND_ARROW_SIZE - 8}" r="4.5" fill="none" stroke="${WIND_ARROW_COLOR_3A}" stroke-width="2.2"/>
    </svg></div>`,
    iconSize: [WIND_ARROW_SIZE, WIND_ARROW_SIZE],
    iconAnchor: [WIND_ARROW_SIZE / 2, WIND_ARROW_SIZE / 2],
  });
}
function updateWindArrowRotations3a() {
  const downwindBearing = (state.windBearing + 180) % 360;
  turbineWindArrows3a.forEach(marker => {
    const el = marker.getElement();
    const inner = el && el.querySelector('.wind-arrow-rotate');
    if (inner) inner.style.transform = `rotate(${downwindBearing}deg)`;
  });
}

// Kompasroos linksboven op de kaart, in de eigen merkkleur i.p.v. het groen uit het referentiebeeld.
const CompassRoseControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd: function () {
    const div = L.DomUtil.create('div', 'compass-rose-ctrl');
    div.innerHTML = `<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="17.5" fill="var(--color-surface)" stroke="var(--color-primary)" stroke-width="2"/>
      <path d="M20 6 L24 20 L20 34 L16 20 Z" fill="var(--color-primary)"/>
      <text x="20" y="11" text-anchor="middle" font-size="7" font-weight="700" fill="var(--color-primary)">N</text>
      <text x="20" y="33.5" text-anchor="middle" font-size="6" fill="var(--color-text-secondary)">Z</text>
      <text x="5.5" y="22.5" text-anchor="middle" font-size="6" fill="var(--color-text-secondary)">W</text>
      <text x="34.5" y="22.5" text-anchor="middle" font-size="6" fill="var(--color-text-secondary)">O</text>
    </svg>`;
    L.DomEvent.disableClickPropagation(div);
    return div;
  },
});

function initMap3a() {
  if (!document.getElementById('turbine-map-3a')) return;
  mapRenderer3a = L.canvas({ padding: 0.4 });
  map3a = L.map('turbine-map-3a', {
    center: [52.15, 5.3],
    zoom: 7,
    minZoom: 6,
    maxZoom: 18,
    renderer: mapRenderer3a,
    zoomControl: false,
  });
  L.control.zoom({ position: 'topright' }).addTo(map3a);
  new CompassRoseControl({ position: 'topleft' }).addTo(map3a);
  turbineArrowLayer3a = L.layerGroup().addTo(map3a);
  turbineLayer3a = L.layerGroup().addTo(map3a);
  receptorLayer3a = L.layerGroup().addTo(map3a);
  applyMapTileTheme3a();

  map3a.on('click', (e) => {
    if (!pickModeArmed3a) return;
    if (state.turbines3a.length >= MAX_TURBINES) {
      flashEmptyHint3a(`Maximaal ${MAX_TURBINES} turbines geplaatst. Verwijder er eerst een via de kaart of "Wis alle turbines".`);
      setPickMode3a(false);
      return;
    }
    latInput3a.value = e.latlng.lat.toFixed(4);
    lngInput3a.value = e.latlng.lng.toFixed(4);
    setPickMode3a(false);
    setLocStatus3a(`Locatie gekozen op de kaart: ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}. Klik op "Turbine toevoegen" om te bevestigen.`, 'success');
  });
}

// Lichte MapLibre GL/OpenFreeMap "positron"-kaart (dezelfde stijl als het andere tool) i.p.v. de
// eerdere Esri-grijskaart. De maplibre-gl-leaflet-plugin plaatst de GL-laag standaard in Leaflet's
// tilePane, dus de bestaande donkere-modus-CSS-filter op .leaflet-tile-pane (zie style.css) werkt
// automatisch door, zonder de laag opnieuw te moeten opbouwen bij het wisselen van thema.
function applyMapTileTheme3a() {
  if (!map3a) return;
  if (!tileLayer3a) {
    tileLayer3a = L.maplibreGL({
      style: 'https://tiles.openfreemap.org/styles/positron',
      attributionControl: {
        customAttribution: 'MapLibre | <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> \u00a9 <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      },
    });
    tileLayer3a.addTo(map3a);
  }
  const mapEl = document.getElementById('turbine-map-3a');
  if (mapEl) mapEl.classList.toggle('map-dark-filter', currentTheme === 'dark');
}

function flashEmptyHint3a(msg) {
  emptyMapHint3a.textContent = msg;
  emptyMapHint3a.classList.add('visible', 'warn');
  clearTimeout(flashEmptyHint3a._t);
  flashEmptyHint3a._t = setTimeout(() => {
    emptyMapHint3a.classList.remove('warn');
    updateEmptyHint3a();
  }, 2600);
}

function updateEmptyHint3a() {
  if (state.turbines3a.length === 0) {
    emptyMapHint3a.textContent = 'Zoek een adres, voer co\u00f6rdinaten in, of klik op "Of wijs de locatie aan op de kaart" om een windturbine te plaatsen (max. ' + MAX_TURBINES + ').';
    emptyMapHint3a.classList.add('visible');
  } else {
    emptyMapHint3a.classList.remove('visible');
  }
}

let pickModeArmed3a = false;
function setPickMode3a(on) {
  pickModeArmed3a = on;
  pickOnMapBtn3a.setAttribute('aria-pressed', String(on));
  const mapEl = document.getElementById('turbine-map-3a');
  if (mapEl) mapEl.classList.toggle('pick-armed', on);
  if (on) {
    setLocStatus3a(PICK_HINT);
  } else if (locStatus3a.textContent === PICK_HINT) {
    setLocStatus3a('');
  }
}
pickOnMapBtn3a.addEventListener('click', () => setPickMode3a(!pickModeArmed3a));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pickModeArmed3a) setPickMode3a(false);
});

function addTurbine3a(lat, lng) {
  const id = nextTurbine3aId++;
  const turbine = { id, lat, lng };
  state.turbines3a.push(turbine);

  const marker = L.marker([lat, lng], { icon: turbineIcon(false) }).addTo(turbineLayer3a);
  marker.bindPopup(`<div class="turbine-popup"><strong>Turbine #${id}</strong><br><button type="button" class="popup-remove-btn-3a" data-remove-id-3a="${id}">Verwijder deze turbine</button></div>`);
  marker.on('click', () => { selectTurbine3a(id); });
  marker.on('popupopen', () => {
    const btn = document.querySelector(`.popup-remove-btn-3a[data-remove-id-3a="${id}"]`);
    if (btn) btn.addEventListener('click', () => { removeTurbine3a(id); map3a.closePopup(); });
  });
  turbineMarkers3a.set(id, marker);

  const arrowMarker = L.marker([lat, lng], { icon: windArrowIcon3a(), interactive: false, keyboard: false }).addTo(turbineArrowLayer3a);
  turbineWindArrows3a.set(id, arrowMarker);

  const group = L.layerGroup().addTo(map3a);
  turbineRingGroups3a.set(id, group);

  selectTurbine3a(id);
  render();
}

function removeTurbine3a(id) {
  const marker = turbineMarkers3a.get(id);
  if (marker) { turbineLayer3a.removeLayer(marker); turbineMarkers3a.delete(id); }
  const arrowMarker = turbineWindArrows3a.get(id);
  if (arrowMarker) { turbineArrowLayer3a.removeLayer(arrowMarker); turbineWindArrows3a.delete(id); }
  const group = turbineRingGroups3a.get(id);
  if (group) { map3a.removeLayer(group); turbineRingGroups3a.delete(id); }
  state.turbines3a = state.turbines3a.filter(t => t.id !== id);
  if (state.selectedTurbineId3a === id) {
    state.selectedTurbineId3a = state.turbines3a.length ? state.turbines3a[state.turbines3a.length - 1].id : null;
  }
  render();
}

function clearAllTurbines3a() {
  turbineRingGroups3a.forEach(g => map3a.removeLayer(g));
  turbineRingGroups3a.clear();
  turbineMarkers3a.forEach(m => turbineLayer3a.removeLayer(m));
  turbineMarkers3a.clear();
  turbineWindArrows3a.forEach(m => turbineArrowLayer3a.removeLayer(m));
  turbineWindArrows3a.clear();
  state.turbines3a = [];
  state.selectedTurbineId3a = null;
  render();
}

function selectTurbine3a(id) {
  state.selectedTurbineId3a = id;
  turbineMarkers3a.forEach((marker, mid) => marker.setIcon(turbineIcon(mid === id)));
  render();
}

// ---------- Afstandsringen (zelfde patroon als Module 3's ringsForTurbine/renderAllTurbineRings) ----------
function ringsForTurbine3a(turbine, lwCat) {
  const cat = CATEGORY[state.category];
  // De dB-waarde bij hover volgt de dag/nacht-instelling van Module 3a zelf; scenario/curtailment/wind blijven gedeeld met Module 3.
  const synthState = { scenario: state.scenario, daynight: state.daynight3a, curtailment: state.curtailment, windBearing: state.windBearing };
  const circles = [];
  [...DISTANCES].reverse().forEach(d => {
    const down = lpAt(d, 1, state.category, lwCat, synthState);
    const cross = lpAt(d, 0, state.category, lwCat, synthState);
    const up = lpAt(d, -1, state.category, lwCat, synthState);
    const circle = L.circle([turbine.lat, turbine.lng], {
      radius: d,
      color: RING_COLORS[d],
      weight: 2.5, opacity: 0.85, fill: false, interactive: true, renderer: mapRenderer3a,
    });
    circle.bindTooltip(
      `<div class="ring-tooltip"><strong>${d} m</strong><br>Downwind: ${down.toFixed(1)} ${cat.unit}<br>Zijwind: ${cross.toFixed(1)} ${cat.unit}<br>Upwind: ${up.toFixed(1)} ${cat.unit}</div>`,
      { sticky: true, direction: 'top', className: 'ring-tooltip-wrap' }
    );
    circles.push(circle);
  });
  return circles;
}

function renderAllTurbineRings3a() {
  if (!map3a) return;
  const lwCat = computeCategoryLw(state.lwa)[state.category];
  state.turbines3a.forEach(turbine => {
    const group = turbineRingGroups3a.get(turbine.id);
    if (!group) return;
    group.clearLayers();
    ringsForTurbine3a(turbine, lwCat).forEach(pl => group.addLayer(pl));
  });
}

function buildRingLegend3a() {
  if (!ringLegend3a) return;
  const cat = CATEGORY[state.category];
  ringLegend3a.innerHTML = DISTANCES.map(d => `<span class="ring-legend-item"><span class="ring-swatch" style="border-color:${RING_COLORS[d]}"></span>${d} m</span>`).join('');
  if (legendCaption3a) {
    legendCaption3a.textContent = `Ringkleur toont de afstand tot de turbine (niet het geluidsniveau) \u2014 de ${cat.label.toLowerCase()} (${cat.unit}) per afstand en richting staat in de tabel hiernaast.`;
  }
}

function renderNormTable3a() {
  if (!normTableBody3a) return;
  const n = state.turbines3a.length;
  const norm = getActiveNorm3a();
  const cat = CATEGORY[state.category];
  if (normTableTitle3a) normTableTitle3a.textContent = `Toetsing geselecteerde turbine (${cat.label.toLowerCase()}, ${cat.unit})`;
  if (normAweightNote3a) {
    if (state.category === 'hoorbaar') {
      normAweightNote3a.style.display = 'none';
    } else {
      normAweightNote3a.style.display = '';
      normAweightNote3a.innerHTML = `De wettelijke norm is gedefinieerd in <strong>dB(A)</strong> (het hoorbare, A-gewogen geluid). Voor ${cat.shortLabel.toLowerCase()} geluid vervalt de A-weging en wordt hier getoetst in <strong>${cat.unit}</strong> \u2014 er bestaat geen formeel vastgestelde, direct vergelijkbare grenswaarde in deze eenheid; de hierboven gekozen dB(A)-norm dient uitsluitend als indicatief referentiepunt.`;
    }
  }
  if (m3aContextCallout) {
    if (n === 0) {
      m3aContextCallout.textContent = 'Plaats minstens \u00e9\u00e9n turbine hierboven om te toetsen.';
    } else if (n <= 2) {
      m3aContextCallout.innerHTML = `${n} turbine${n === 1 ? '' : 's'} geplaatst: bij 1\u20132 turbines blijft de oude landelijke norm (41 dB Lnight) <strong>formeel van toepassing</strong>.`;
    } else {
      m3aContextCallout.innerHTML = `${n} turbines geplaatst: bij 3 of meer turbines gelden sinds de Delfzijluitspraak (2021) <strong>geen landelijke normen meer</strong> \u2014 het bevoegd gezag moet zelf een norm motiveren. De hier gekozen waarde is een referentie, geen automatisch geldende wettelijke norm.`;
    }
  }

  const selected = state.turbines3a.find(t => t.id === state.selectedTurbineId3a);
  if (!selected) {
    normTableBody3a.innerHTML = `<tr><td colspan="4" class="empty-row">Plaats een turbine op de kaart hierboven om te toetsen.</td></tr>`;
    return;
  }

  const lwCat = computeCategoryLw(state.lwa)[state.category];
  const dayState = Object.assign({}, state, { daynight: 'dag' });
  const nightState = Object.assign({}, state, { daynight: 'nacht' });

  normTableBody3a.innerHTML = DISTANCES.map(d => {
    const lday = lpAt(d, 1, state.category, lwCat, dayState);
    const lnight = lpAt(d, 1, state.category, lwCat, nightState);

    let lnightCell;
    if (norm.lnight != null) {
      const exceed = lnight > norm.lnight;
      const diff = (lnight - norm.lnight);
      lnightCell = `<td class="${exceed ? 'norm-exceed' : 'norm-ok'}">${exceed ? 'Overschrijding' : 'Binnen norm'} (${diff >= 0 ? '+' : ''}${diff.toFixed(1)} dB)</td>`;
    } else {
      lnightCell = `<td class="norm-na">n.v.t.</td>`;
    }

    return `<tr><td>${d} m</td><td>${lday.toFixed(1)}</td><td>${lnight.toFixed(1)}</td>${lnightCell}</tr>`;
  }).join('');
}

function renderModule3a() {
  if (!document.getElementById('module-3a')) return;

  if (m3aWindIndicator) {
    m3aWindIndicator.innerHTML = `Wind uit ${state.windDir} \u00b7 pijlpunt = downwind \u00b7 open cirkel = upwind`;
  }
  updateWindArrowRotations3a();

  const scenarioLabels3a = { best: 'Best case', middel: 'Middenscenario', worst: 'Worst case' };
  if (miniScenario3a) miniScenario3a.textContent = scenarioLabels3a[state.scenario];
  if (miniSub3a) miniSub3a.textContent = `${state.daynight3a === 'dag' ? 'Dag' : 'Nacht'} \u00b7 Wind uit ${state.windDir} \u00b7 ${state.turbines3a.length} turbine${state.turbines3a.length === 1 ? '' : 's'}`;

  buildRingLegend3a();
  if (turbineCount3a) turbineCount3a.textContent = `${state.turbines3a.length} / ${MAX_TURBINES} turbines geplaatst`;
  updateEmptyHint3a();

  renderNormTable3a();
  renderAllTurbineRings3a();
}

// ---------- Module 3a: dag/nacht-toggle ----------
daynightToggle3a.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    daynightToggle3a.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');
    state.daynight3a = btn.dataset.val;
    render();
  });
});

// ---------- Module 3a: normselectie ----------
if (normPresetSelect3a) {
  normPresetSelect3a.addEventListener('change', () => {
    state.normPreset3a = normPresetSelect3a.value;
    const isCustom = state.normPreset3a === 'eigen';
    normCustomLnightField3a.style.display = isCustom ? '' : 'none';
    render();
  });
  normCustomLnightInput3a.addEventListener('input', () => {
    state.normCustomLnight3a = parseFloat(normCustomLnightInput3a.value);
    if (Number.isNaN(state.normCustomLnight3a)) state.normCustomLnight3a = 41;
    render();
  });
}

// ---------- Module 3a: locatie toevoegen (adres/coördinaten/kaart) ----------
let activeLocTab3a = 'adres';
let selectedAddressResult3a = null;
let addressDebounceTimer3a = null;
let addressAbortController3a = null;

function setLocStatus3a(message, tone) {
  locStatus3a.textContent = message || '';
  locStatus3a.classList.remove('error', 'success');
  if (tone) locStatus3a.classList.add(tone);
}

locTabs3a.forEach(btn => {
  btn.addEventListener('click', () => {
    activeLocTab3a = btn.getAttribute('data-loc-tab-3a');
    locTabs3a.forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    locFieldAdres3a.hidden = activeLocTab3a !== 'adres';
    locFieldCoords3a.hidden = activeLocTab3a !== 'coords';
    addressSuggestions3a.hidden = true;
    if (pickModeArmed3a) setPickMode3a(false);
    setLocStatus3a('');
  });
});

function hideSuggestions3a() {
  addressSuggestions3a.hidden = true;
  addressSuggestions3a.innerHTML = '';
}

addressInput3a.addEventListener('input', () => {
  selectedAddressResult3a = null;
  const q = addressInput3a.value.trim();
  clearTimeout(addressDebounceTimer3a);
  if (q.length < 2) { hideSuggestions3a(); return; }
  addressDebounceTimer3a = setTimeout(() => fetchAddressSuggestions3a(q), 300);
});

addressInput3a.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const firstItem = addressSuggestions3a.querySelector('li');
    if (firstItem) firstItem.click();
    else addTurbineBtn3a.click();
  } else if (e.key === 'Escape') {
    hideSuggestions3a();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#module-3a .address-search')) hideSuggestions3a();
});

async function fetchAddressSuggestions3a(query) {
  if (addressAbortController3a) addressAbortController3a.abort();
  addressAbortController3a = new AbortController();
  try {
    const url = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest?q=${encodeURIComponent(query)}&fq=type:(woonplaats OR adres OR postcode OR weg)&rows=6`;
    const res = await fetch(url, { signal: addressAbortController3a.signal });
    if (!res.ok) throw new Error('PDOK suggest mislukt');
    const data = await res.json();
    const docs = (data.response && data.response.docs) || [];
    if (!docs.length) {
      addressSuggestions3a.innerHTML = '<li class="no-result">Geen resultaten gevonden.</li>';
      addressSuggestions3a.hidden = false;
      return;
    }
    addressSuggestions3a.innerHTML = docs.map(d => `<li role="option" data-id="${d.id}" data-label="${d.weergavenaam.replace(/"/g, '&quot;')}">${d.weergavenaam}</li>`).join('');
    addressSuggestions3a.hidden = false;
    addressSuggestions3a.querySelectorAll('li[data-id]').forEach(li => {
      li.addEventListener('click', () => selectAddressSuggestion3a(li.dataset.id, li.dataset.label));
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    addressSuggestions3a.innerHTML = '<li class="no-result">Zoeken via PDOK is mislukt. Probeer het opnieuw.</li>';
    addressSuggestions3a.hidden = false;
  }
}

async function selectAddressSuggestion3a(id, label) {
  hideSuggestions3a();
  addressInput3a.value = label;
  setLocStatus3a('Locatie ophalen\u2026');
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
    selectedAddressResult3a = { lat, lng, label };
    setLocStatus3a(`Gevonden: ${label}. Klik op "Turbine toevoegen".`, 'success');
  } catch (err) {
    selectedAddressResult3a = null;
    setLocStatus3a('Kon geen co\u00f6rdinaten ophalen voor deze locatie. Probeer het opnieuw.', 'error');
  }
}

addTurbineBtn3a.addEventListener('click', () => {
  if (state.turbines3a.length >= MAX_TURBINES) {
    setLocStatus3a(`Maximaal ${MAX_TURBINES} turbines geplaatst. Verwijder er eerst een.`, 'error');
    return;
  }

  let lat, lng, label;
  if (activeLocTab3a === 'adres') {
    if (!selectedAddressResult3a || selectedAddressResult3a.label !== addressInput3a.value) {
      setLocStatus3a('Kies eerst een locatie uit de suggesties hierboven.', 'error');
      return;
    }
    ({ lat, lng, label } = selectedAddressResult3a);
  } else {
    lat = parseFloat(latInput3a.value);
    lng = parseFloat(lngInput3a.value);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      setLocStatus3a('Vul zowel een geldige breedtegraad als lengtegraad in.', 'error');
      return;
    }
    label = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }

  if (!withinNetherlands(lat, lng)) {
    setLocStatus3a('Deze co\u00f6rdinaten liggen buiten Nederland (ongeveer lat 50,4\u201353,8 \u00b7 lon 2,9\u20137,4).', 'error');
    return;
  }

  addTurbine3a(lat, lng);
  map3a.flyTo([lat, lng], Math.max(map3a.getZoom(), 11), { duration: 0.6 });
  setLocStatus3a(`Turbine toegevoegd bij ${label}.`, 'success');

  addressInput3a.value = '';
  selectedAddressResult3a = null;
  latInput3a.value = '';
  lngInput3a.value = '';
});

clearTurbinesBtn3a.addEventListener('click', clearAllTurbines3a);



// ============================================================
// Module 6: frequentie van de nacht-scenario's (best/middel/worst)
// Toont hoe vaak (dagen/jaar, dagen/maand) elk nacht-scenario optreedt,
// gekoppeld aan de turbineposities uit Module 3 (state.turbines3a) en
// aan de windrichting-instelling (state.windDir/windBearing).
// Bronnen: Van den Berg (2004, 2008), Bosveld e.a. (2020), Baas e.a. (2009) — zie Verantwoording §5.
// ============================================================
const M6_COAST_POINTS = [
  { name: 'Vlissingen', lat: 51.45, lng: 3.57 },
  { name: 'Domburg', lat: 51.56, lng: 3.50 },
  { name: 'Hoek van Holland', lat: 51.98, lng: 4.12 },
  { name: 'Zandvoort', lat: 52.37, lng: 4.53 },
  { name: 'IJmuiden', lat: 52.46, lng: 4.60 },
  { name: 'Den Helder', lat: 52.93, lng: 4.76 },
  { name: 'De Cocksdorp (Texel)', lat: 53.17, lng: 4.85 },
  { name: 'Harlingen', lat: 53.17, lng: 5.42 },
  { name: 'Holwerd', lat: 53.38, lng: 5.85 },
  { name: 'Lauwersoog', lat: 53.40, lng: 6.22 },
  { name: 'Delfzijl', lat: 53.33, lng: 6.93 },
  { name: 'Renesse', lat: 51.73, lng: 3.78 },
];
const M6_DEFAULT_LAT = 52.11; // De Bilt fallback (centraal NL)
const M6_DEFAULT_LNG = 5.18;
const M6_STABLE_PCT_COAST = 15;   // Van den Berg (2008), Lutjewad-referentie (kust)
const M6_STABLE_PCT_INLAND = 40;  // Van den Berg (2008), Cabauw-referentie (~50 km landinwaarts)
const M6_INLAND_CAP_KM = 50;

function m6TurbineAnchor() {
  if (state.turbines3a.length === 0) return { lat: M6_DEFAULT_LAT, lng: M6_DEFAULT_LNG, isDefault: true };
  const lat = state.turbines3a.reduce((s, t) => s + t.lat, 0) / state.turbines3a.length;
  const lng = state.turbines3a.reduce((s, t) => s + t.lng, 0) / state.turbines3a.length;
  return { lat, lng, isDefault: false };
}

function m6DistanceToCoastKm(lat, lng) {
  let min = Infinity;
  for (const p of M6_COAST_POINTS) {
    const d = haversineDist(lat, lng, p.lat, p.lng) / 1000;
    if (d < min) min = d;
  }
  return min;
}

function m6StablePct(distKm) {
  const frac = Math.min(1, Math.max(0, distKm / M6_INLAND_CAP_KM));
  return M6_STABLE_PCT_COAST + frac * (M6_STABLE_PCT_INLAND - M6_STABLE_PCT_COAST);
}

function m6ScenarioPercentages(lat, lng) {
  const distKm = m6DistanceToCoastKm(lat, lng);
  const stable = m6StablePct(distKm);
  // Bosveld e.a. (2020): volhardend-wSBL (middel) en volhardend-vSBL (worst) ongeveer even vaak
  // binnen de stabiele nachten — 50/50 als benadering, geen exacte meting van alle nachten.
  const middel = stable / 2;
  const worst = stable / 2;
  const best = 100 - stable;
  return { best, middel, worst, distKm, stable };
}

// ---------- Astronomische nachtlengte per maand (voor illustratieve maandverdeling) ----------
function m6SolarDeclinationDeg(dayOfYear) {
  // Cooper (1969)-benadering, gangbaar in daglicht-/zonnestand-modellen.
  return 23.45 * Math.sin((2 * Math.PI / 365) * (284 + dayOfYear));
}

function m6DayLengthHours(latDeg, dayOfYear) {
  const decl = m6SolarDeclinationDeg(dayOfYear) * Math.PI / 180;
  const latRad = latDeg * Math.PI / 180;
  let cosH = -Math.tan(latRad) * Math.tan(decl);
  cosH = Math.max(-1, Math.min(1, cosH));
  const H = Math.acos(cosH); // halve-daglengte-hoek in radialen
  return (2 * H * 180 / Math.PI) / 15; // uren
}

const M6_MONTH_NAMES = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const M6_DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const M6_MONTH_MID_DAY = [16, 45, 75, 105, 136, 166, 197, 228, 259, 289, 320, 350]; // dag-van-jaar, maandmidden

function m6MonthlyDayNightLengths(latDeg) {
  const nightLen = [];
  const dayLen = [];
  for (let m = 0; m < 12; m++) {
    const dl = m6DayLengthHours(latDeg, M6_MONTH_MID_DAY[m]);
    dayLen.push(dl);
    nightLen.push(24 - dl);
  }
  return { nightLen, dayLen };
}

function m6Normalize(weights, totalDays) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map(w => (w / sum) * totalDays);
  const rounded = raw.map(Math.round);
  let diff = totalDays - rounded.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    let idx = rounded.indexOf(Math.max(...rounded));
    rounded[idx] += diff;
  }
  return rounded;
}

function m6ComputeAll() {
  const anchor = m6TurbineAnchor();
  const pct = m6ScenarioPercentages(anchor.lat, anchor.lng);
  let bestDays = Math.round(pct.best / 100 * 365);
  let middelDays = Math.round(pct.middel / 100 * 365);
  let worstDays = 365 - bestDays - middelDays;
  const { nightLen, dayLen } = m6MonthlyDayNightLengths(anchor.lat);
  // Bosveld e.a. (2020): langere nachten (winter) -> meer volhardend-wSBL ("middel");
  // kortere nachten (zomer) -> meer volhardend-vSBL ("worst"). Best case: gelijk verdeeld
  // over dagen-per-maand (geen sterk seizoenspatroon gedocumenteerd voor de neutrale/goed-gemengde toestand).
  const middelMonthly = m6Normalize(nightLen, middelDays);
  const worstMonthly = m6Normalize(dayLen, worstDays);
  const bestMonthly = m6Normalize(M6_DAYS_IN_MONTH, bestDays);
  return {
    anchor, pct,
    days: { best: bestDays, middel: middelDays, worst: worstDays },
    monthly: { best: bestMonthly, middel: middelMonthly, worst: worstMonthly },
  };
}

// ---------- Windrichting-verband (illustratief/kwalitatief, Baas e.a. 2009) ----------
// Bredere piek NO-Z (45-180°), secundaire piek ZZW-W (225-270°), laag bij noordelijke richtingen.
const M6_WIND_RISK = { N: 20, NE: 55, E: 90, SE: 95, S: 70, SW: 55, W: 70, NW: 35 };
function m6WindRiskLabel(idx) {
  if (idx >= 80) return 'verhoogd';
  if (idx >= 50) return 'gemiddeld';
  return 'verlaagd';
}

function renderModule6() {
  const grid = document.getElementById('m6-pct-grid');
  if (!grid) return;
  const explainer = document.getElementById('m6-pct-explainer');
  const monthBody = document.getElementById('m6-month-table-body');
  const contextCallout = document.getElementById('m6-context-callout');
  const windCallout = document.getElementById('m6-wind-callout');
  const compass = document.getElementById('m6-compass');

  const result = m6ComputeAll();
  const { anchor, pct, days, monthly } = result;

  if (contextCallout) {
    contextCallout.textContent = anchor.isDefault
      ? `Nog geen turbine geplaatst in Module 3 — onderstaande cijfers gebruiken een landelijk gemiddelde (De Bilt, ${M6_DEFAULT_LAT.toFixed(2)}°N).`
      : `Gebaseerd op ${state.turbines3a.length} turbine${state.turbines3a.length === 1 ? '' : 's'} uit Module 3, gemiddeld ${pct.distKm.toFixed(0)} km van de dichtstbijzijnde kustreferentie.`;
  }

  grid.innerHTML = `
    <div class="m6-pct-card m6-best">
      <span class="m6-pct-label">Best case</span>
      <span class="m6-pct-value">${pct.best.toFixed(0)}%</span>
      <span class="m6-pct-days">≈ ${days.best} nachten/jaar</span>
      <div class="m6-pct-bar"><div class="m6-pct-bar-fill" style="width:${pct.best}%"></div></div>
    </div>
    <div class="m6-pct-card m6-middel">
      <span class="m6-pct-label">Middel case</span>
      <span class="m6-pct-value">${pct.middel.toFixed(0)}%</span>
      <span class="m6-pct-days">≈ ${days.middel} nachten/jaar</span>
      <div class="m6-pct-bar"><div class="m6-pct-bar-fill" style="width:${pct.middel}%"></div></div>
    </div>
    <div class="m6-pct-card m6-worst">
      <span class="m6-pct-label">Worst case</span>
      <span class="m6-pct-value">${pct.worst.toFixed(0)}%</span>
      <span class="m6-pct-days">≈ ${days.worst} nachten/jaar</span>
      <div class="m6-pct-bar"><div class="m6-pct-bar-fill" style="width:${pct.worst}%"></div></div>
    </div>
  `;

  if (explainer) {
    explainer.textContent = `Stabiele atmosfeer (middel + worst samen): ${pct.stable.toFixed(0)}% van de nachten, geïnterpoleerd tussen 15% (kust, Lutjewad) en 40% (landinwaarts, Cabauw) op basis van de afstand tot de kust — zie Verantwoording §5.`;
  }

  if (monthBody) {
    const scenarios = [
      { key: 'best', label: 'Best' },
      { key: 'middel', label: 'Middel' },
      { key: 'worst', label: 'Worst' },
    ];
    const maxByMonth = M6_MONTH_NAMES.map((_, m) => Math.max(monthly.best[m], monthly.middel[m], monthly.worst[m]));
    monthBody.innerHTML = scenarios.map(sc => {
      const cells = monthly[sc.key].map((v, m) => {
        const isMax = v === maxByMonth[m] && v > 0;
        return `<td class="m6-month-cell"${isMax ? ' style="font-weight:700;background:var(--color-surface-offset);"' : ''}>${v}</td>`;
      }).join('');
      return `<tr><td><strong>${sc.label}</strong></td><td class="m6-month-cell"><strong>${days[sc.key]}</strong></td>${cells}</tr>`;
    }).join('');
  }

  // Windrichting: hergebruikt de bestaande state.windDir/windBearing-instelling uit Module 3.
  const dir = state.windDir || 'N';
  const idx = M6_WIND_RISK[dir] ?? 50;
  const label = m6WindRiskLabel(idx);
  if (windCallout) {
    windCallout.textContent = `Huidige instelling: wind uit het ${dir} (Module 3). Volgens de Cabauw-klimatologie van nachtelijke low-level jets (Baas e.a. 2009) is de kans op omstandigheden die het worst-case-mechanisme bevorderen bij deze windrichting ${label} (illustratieve risico-index ${idx}/100).`;
  }
  if (compass) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const dots = dirs.map((d, i) => {
      const angle = i * 45;
      const risk = M6_WIND_RISK[d];
      const active = d === dir;
      const hue = risk >= 80 ? 'var(--color-error)' : risk >= 50 ? '#d69e2e' : 'var(--color-success)';
      return `<div style="position:absolute;top:50%;left:50%;width:11px;height:11px;border-radius:50%;background:${hue};opacity:${active ? 1 : 0.35};transform:translate(-50%,-50%) rotate(${angle}deg) translateY(-78px);${active ? 'outline:2px solid var(--color-text);' : ''}" title="${d}: risico-index ${risk}"></div>`;
    }).join('');
    const centerLabel = `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:11px;font-weight:700;color:var(--color-text-faint);text-align:center;">${dir}<br><span style="font-size:9px;font-weight:400;">huidig</span></div>`;
    compass.innerHTML = dots + centerLabel;
  }
}

// ---------- Wire up turbine controls & init ----------
initMap3a();
render();
