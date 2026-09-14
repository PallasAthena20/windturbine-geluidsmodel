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
  // A-gewogen varianten van dezelfde twee categorieën (t.b.v. Module 8a) — zelfde octaafbanden,
  // maar nu gesommeerd via `lwa` (dus mét A_CORR) in plaats van via `lwUnweighted`/G_CORR.
  // Laat zien wat er numeriek gebeurt als je (zoals de wettelijke dB(A)-norm impliciet doet)
  // de A-weging ook toepast op laagfrequent en infrasoon geluid.
  const laagfrequentA = logSum(CATEGORY_BANDS.laagfrequent.map(f => lwa[BAND_INDEX[f]]));
  const infrasoonA = logSum(CATEGORY_BANDS.infrasoon.map(f => lwa[BAND_INDEX[f]]));
  return { hoorbaar, laagfrequent, infrasoon, laagfrequentA, infrasoonA, lwUnweighted, lwa, delta };
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
  // Module 7: shear-capacity-verkenner (Van Hooijdonk e.a. 2015 / Bosveld e.a. 2020) — zie script.js §M7.
  // De bewolkingsklasse is niet meer los instelbaar: elk scenario (best/middel/worst) heeft een vaste,
  // vastgekoppelde bewolkingsklasse (M7_SCENARIO_CLOUD) en de koppeling naar Module 6 staat permanent aan.
  m7Ugeo: 9,
  m7UgeoFetching: false, m7UgeoAutoInfo: null, m7UgeoAutoError: null,
  // Module 8: woningen (BAG) → bewoners → geschatte hinder per scenario — zie script.js §M8.
  m8HouseholdSize: 2.10, m8AddressData: null, m8Fetching: false, m8Error: null, m8StilstandNachten: 0,
  // Module 9/10: kosten- en DALY-berekening op basis van Module 8's bewonersaantallen — zie script.js §M9/§M10.
  m9CostPerPersonYear: 609.60, m9Horizon: 25,
  // Module 11: waardedaling woningen (Droës & Koster 2021) — zie script.js §M11. Tiphoogte-categorie
  // is een EIGEN categorie-as, los van state.category (hoorbaar/laagfrequent/infrasoon) van Module 3.
  m11Category: 'hoog', m11Method: 'vlak', m11Woz: 398000,
  m11CbsData: null, m11CbsFetching: false, m11CbsError: null,
  m11WozFetching: false, m11WozAutoInfo: null, m11WozAutoError: null,
  // Module 12: bouw-/investeringskosten per turbine (PBL-eindadvies SDE++ 2026) — zie script.js §M12.
  // Volledig losstaand van de geplaatste turbine(s)/locatie(s) hierboven: vrije invoer per turbinegroep.
  m12Groups: [],
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

// ---------- Module 7: shear-capacity-verkenner ----------
// De bewolkingsklasse per scenario ligt vast (M7_SCENARIO_CLOUD) en de koppeling naar Module 6 staat
// permanent aan — er zijn dus geen cloud-tabs of een aan/uit-checkbox meer om te binden.
const m7UgeoInput = document.getElementById('m7-ugeo-input');
if (m7UgeoInput) m7UgeoInput.addEventListener('input', () => {
  state.m7Ugeo = parseFloat(m7UgeoInput.value);
  state.m7UgeoAutoInfo = null;
  state.m7UgeoAutoError = null;
  render();
});
const m7UgeoAutoBtnEl = document.getElementById('m7-ugeo-auto-btn');
if (m7UgeoAutoBtnEl) m7UgeoAutoBtnEl.addEventListener('click', () => { m7FetchGeostrophicWind(); });

const m8HouseholdInput = document.getElementById('m8-household-size');
if (m8HouseholdInput) {
  m8HouseholdInput.addEventListener('input', () => {
    const v = parseFloat(m8HouseholdInput.value);
    state.m8HouseholdSize = Number.isNaN(v) ? 2.10 : v;
    render();
  });
}
const m8FetchBtnEl = document.getElementById('m8-fetch-btn');
if (m8FetchBtnEl) m8FetchBtnEl.addEventListener('click', () => { m8RunFetch(); });

// Stilstandnachten-invoer (jaargemiddelde-sectie, Module 8) — los van state.curtailment (dat is de
// bestaande "stalgeluid"-functionaliteit die dB toevoegt, geen gerelateerd concept).
const m8StilstandInputEl = document.getElementById('m8-stilstand-input');
if (m8StilstandInputEl) {
  m8StilstandInputEl.addEventListener('input', () => {
    let v = parseInt(m8StilstandInputEl.value, 10);
    if (Number.isNaN(v)) v = 0;
    v = Math.max(0, Math.min(365, v));
    state.m8StilstandNachten = v;
    renderModule8Jaarnorm();
  });
}

const m9CostInput = document.getElementById('m9-cost-per-person');
if (m9CostInput) {
  m9CostInput.addEventListener('input', () => {
    const v = parseFloat(m9CostInput.value);
    state.m9CostPerPersonYear = Number.isNaN(v) ? M9_DEFAULT_COST : v;
    renderModule9();
    renderModule10();
  });
}
const m9HorizonInput = document.getElementById('m9-horizon');
if (m9HorizonInput) {
  m9HorizonInput.addEventListener('input', () => {
    const v = parseInt(m9HorizonInput.value, 10);
    state.m9Horizon = Number.isNaN(v) || v < 1 ? M9_DEFAULT_HORIZON : v;
    renderModule9();
    renderModule10();
  });
}

// ---------- Module 11: tiphoogte-categorie, methode en WOZ-invoer ----------
const m11CategoryTabsEl = document.getElementById('m11-category-tabs');
if (m11CategoryTabsEl) {
  m11CategoryTabsEl.querySelectorAll('[data-m11-category]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.m11Category = btn.dataset.m11Category;
      if (state.m11Category !== 'hoog') state.m11Method = 'vlak';
      renderModule11();
    });
  });
}
const m11MethodTabsEl = document.getElementById('m11-method-tabs');
if (m11MethodTabsEl) {
  m11MethodTabsEl.querySelectorAll('[data-m11-method]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.m11Method === 'band' && state.m11Category !== 'hoog') return;
      state.m11Method = btn.dataset.m11Method;
      renderModule11();
    });
  });
}
const m11WozInput = document.getElementById('m11-woz-input');
if (m11WozInput) {
  m11WozInput.addEventListener('input', () => {
    const v = parseFloat(m11WozInput.value);
    state.m11Woz = Number.isNaN(v) ? 0 : v;
    state.m11WozAutoInfo = null; // handmatige aanpassing overschrijft eerder automatisch ophaalresultaat
    state.m11WozAutoError = null;
    renderModule11();
  });
}
const m11CbsFetchBtnEl = document.getElementById('m11-cbs-fetch-btn');
if (m11CbsFetchBtnEl) m11CbsFetchBtnEl.addEventListener('click', () => { m11CbsRunFetch(); });
const m11WozAutoBtnEl = document.getElementById('m11-woz-auto-btn');
if (m11WozAutoBtnEl) m11WozAutoBtnEl.addEventListener('click', () => { m11FetchLocalWoz(); });

// ---------- Module 12: turbinegroep toevoegen ----------
const m12AddBtnEl = document.getElementById('m12-add-btn');
if (m12AddBtnEl) m12AddBtnEl.addEventListener('click', () => { m12AddGroup(); });

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

// Gedeelde rijbouwer voor de norm-toetsingstabel (gebruikt door zowel Module 3's ingebedde
// toetsingswidget als Module 5): toont per vaste afstand de dagwaarde (referentie, downwind) en
// vervolgens DRIE aparte nachtwaarden + toetsingen — downwind (kritisch, verst dragend), upwind
// (snelst dempend) en zijwind/crosswind (tussenliggend) — in plaats van, zoals voorheen, uitsluitend
// downwind. Dit maakt expliciet zichtbaar dat een woning die niet exact downwind van de turbine
// ligt, op dezelfde afstand een lager niveau ondervindt en dus mogelijk niet overschrijdt.
function m5NormTableRowsHtml(categoryKey, baseState, norm) {
  const lwCat = computeCategoryLw(baseState.lwa)[categoryKey];
  const dayState = Object.assign({}, baseState, { daynight: 'dag' });
  const nightState = Object.assign({}, baseState, { daynight: 'nacht' });
  const toetsCell = (lval) => {
    if (norm.lnight == null) return `<td class="norm-na">n.v.t.</td>`;
    const exceed = lval > norm.lnight;
    const diff = lval - norm.lnight;
    return `<td class="${exceed ? 'norm-exceed' : 'norm-ok'}">${exceed ? 'Overschrijding' : 'Binnen norm'} (${diff >= 0 ? '+' : ''}${diff.toFixed(1)} dB)</td>`;
  };
  return DISTANCES.map((d) => {
    const lday = lpAt(d, 1, categoryKey, lwCat, dayState);
    const lDown = lpAt(d, 1, categoryKey, lwCat, nightState);
    const lUp = lpAt(d, -1, categoryKey, lwCat, nightState);
    const lCross = lpAt(d, 0, categoryKey, lwCat, nightState);
    return `<tr><td>${d} m</td><td>${lday.toFixed(1)}</td><td>${lDown.toFixed(1)}</td>${toetsCell(lDown)}<td>${lUp.toFixed(1)}</td>${toetsCell(lUp)}<td>${lCross.toFixed(1)}</td>${toetsCell(lCross)}</tr>`;
  }).join('');
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
    normTableBody.innerHTML = `<tr><td colspan="8" class="empty-row">Plaats een turbine op de kaart in Module 3 om te toetsen.</td></tr>`;
    return;
  }

  normTableBody.innerHTML = m5NormTableRowsHtml(state.category, state, norm);
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
  renderModule7();
  renderModule8();
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
      // preserveDrawingBuffer: nodig om de WebGL-kaart later als afbeelding te kunnen
      // vastleggen voor het Module 13-rapport (zie m13CaptureSingleView) — zonder deze optie
      // wist de browser de canvas-buffer meteen na elke render en levert toDataURL() een
      // leeg/zwart beeld op.
      preserveDrawingBuffer: true,
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
    normTableBody3a.innerHTML = `<tr><td colspan="8" class="empty-row">Plaats een turbine op de kaart hierboven om te toetsen.</td></tr>`;
    return;
  }

  normTableBody3a.innerHTML = m5NormTableRowsHtml(state.category, state, norm);
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
// Bronnen: Van den Berg (2004, 2008), Abraham & Monahan (2019, deel I & II), Baas e.a. (2009) — zie Verantwoording §5.
// (Module 7 voegt Bosveld e.a. (2020) / Van Hooijdonk e.a. (2015) / Van der Linden e.a. (2017) toe.)
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
  // Abraham & Monahan (2019, deel II): volhardend-wSBL (middel) en volhardend-vSBL (worst) komen bij
  // Cabauw ongeveer even vaak voor — 50/50 was de oude standaard-benadering, geen exacte meting van alle
  // nachten. Deze is permanent vervangen door de shear-capacity-gebaseerde verhouding uit Module 7
  // (Van Hooijdonk e.a. 2015 / Bosveld e.a. 2020), automatisch gekoppeld aan de vaste bewolkingsklasse per
  // scenario (half bewolkt=middel, helder=worst) — niet meer optioneel.
  const wsblShare = m7WsblShare();
  const middel = stable * wsblShare;
  const worst = stable * (1 - wsblShare);
  const best = 100 - stable;
  return { best, middel, worst, distKm, stable, wsblShare };
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
  // Abraham & Monahan (2019, deel II): langere nachten (winter) -> meer volhardend-wSBL ("middel");
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
      <span class="m6-pct-cloud">☁️ Bewolkt</span>
      <span class="m6-pct-value">${pct.best.toFixed(0)}%</span>
      <span class="m6-pct-days">≈ ${days.best} nachten/jaar</span>
      <div class="m6-pct-bar"><div class="m6-pct-bar-fill" style="width:${pct.best}%"></div></div>
    </div>
    <div class="m6-pct-card m6-middel">
      <span class="m6-pct-label">Middel case</span>
      <span class="m6-pct-cloud">⛅ Half bewolkt</span>
      <span class="m6-pct-value">${pct.middel.toFixed(0)}%</span>
      <span class="m6-pct-days">≈ ${days.middel} nachten/jaar</span>
      <div class="m6-pct-bar"><div class="m6-pct-bar-fill" style="width:${pct.middel}%"></div></div>
    </div>
    <div class="m6-pct-card m6-worst">
      <span class="m6-pct-label">Worst case</span>
      <span class="m6-pct-cloud">☀️ Helder</span>
      <span class="m6-pct-value">${pct.worst.toFixed(0)}%</span>
      <span class="m6-pct-days">≈ ${days.worst} nachten/jaar</span>
      <div class="m6-pct-bar"><div class="m6-pct-bar-fill" style="width:${pct.worst}%"></div></div>
    </div>
  `;

  if (explainer) {
    const splitNote = `Verdeling middel/worst binnen "stabiel": ${(pct.wsblShare * 100).toFixed(0)}%/${(100 - pct.wsblShare * 100).toFixed(0)}%, permanent automatisch afgeleid uit de shear-capacity-schatting in Module 7 (half bewolkt=middel, helder=worst — niet meer de vaste 50/50).`;
    explainer.textContent = `Stabiele atmosfeer (middel + worst samen): ${pct.stable.toFixed(0)}% van de nachten, geïnterpoleerd tussen 15% (kust, Lutjewad) en 40% (landinwaarts, Cabauw) op basis van de afstand tot de kust — zie Verantwoording §5. ${splitNote}`;
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

// ============================================================
// Module 7: Bosveld's eigen indeling — shear capacity (Van Hooijdonk e.a. 2015)
// en de vertaling naar Module 6
//
// CORRECTIE t.o.v. eerdere versie: de kwantitatieve claims die hierboven in Module 6
// stonden (expliciete verwerping van een derde regime, HMM-classificatie, ~50/50-
// persistentie, transitiestatistieken, sturing door geostrofische wind/bewolking) zijn
// niet van Bosveld e.a. (2020) zelf, maar van Abraham & Monahan (2019, deel I & II) —
// zie de correctiebox in de UI en §6 van de Verantwoording. Bosveld e.a. (2020) noemt in
// hun overzichtsartikel over 50 jaar Cabauw-onderzoek zelf twee andere, eigen
// classificaties voor wSBL/vSBL: (1) de "shear capacity" SC = U/Umin van Van Hooijdonk
// e.a. (2015, waarvan Bosveld zelf co-auteur is), en (2) de indeling van heldere nachten
// naar geostrofische windsnelheid van Van der Linden e.a. (2017). Module 7 gebruikt (1)
// als interactief model en herkalibreert Umin met de geostrofische-wind-drempels die
// Abraham & Monahan (2019b) rapporteren per bewolkingsklasse — dat is een eigen synthese,
// niet een waarde die letterlijk in een van beide papers staat (zie beperkingen).
// ============================================================
// Umin per bewolkingsklasse: geen vaste fysieke constante, maar hier gelijkgesteld aan de
// geostrofische-windsnelheid-drempel die Abraham & Monahan (2019b) rapporteren als scheiding
// tussen volhardend-wSBL en volhardend-vSBL, per bewolkingsklasse (Cabauw).
const M7_UMIN_BY_CLOUD = {
  helder: 12,   // helder (LLCC < 5%): drempel ≈ 12 m/s
  half: 9.5,    // tussenliggend — eigen interpolatie, geen datapunt uit de literatuur
  bewolkt: 7,   // bewolkt (LLCC > 95%): drempel ≈ 7 m/s
};
const M7_CLOUD_LABELS = { helder: 'Helder (LLCC < 5%)', half: 'Half bewolkt', bewolkt: 'Bewolkt (LLCC > 95%)' };
const M7_LOGISTIC_K = 4; // steilheid van de soft-transition rond SC = 1 — eigen keuze, niet uit de literatuur

// Vaste, niet meer los instelbare koppeling scenario ↔ bewolkingsklasse (zie Module 6-inleiding en de
// method-callout aan het begin van Module 6/7): veel bewolking onderdrukt de nachtelijke uitstraling
// waardoor de atmosfeer nauwelijks stabiel wordt (best case, neutraal/goed gemengd); onder heldere
// hemel is de uitstraling het sterkst en is turbulence collapse (vSBL) het waarschijnlijkst (worst case);
// half bewolkt ligt daar tussenin (wSBL, middel case). Dit vervangt de vrij te kiezen enkele
// bewolkingsklasse uit een eerdere versie van deze module.
const M7_SCENARIO_CLOUD = { best: 'bewolkt', middel: 'half', worst: 'helder' };
const M7_SCENARIO_LABELS = { best: 'Best case', middel: 'Middel case (wSBL)', worst: 'Worst case (vSBL)' };

function m7ShearCapacity(ugeo, cloud) {
  const umin = M7_UMIN_BY_CLOUD[cloud] ?? M7_UMIN_BY_CLOUD.half;
  const sc = ugeo / umin;
  const pWsbl = 1 / (1 + Math.exp(-M7_LOGISTIC_K * (sc - 1)));
  return { umin, sc, pWsbl, pVsbl: 1 - pWsbl };
}

// SC per scenario, elk met zijn eigen vastgekoppelde bewolkingsklasse — geen gedeelde, vrij te kiezen
// bewolkingsklasse meer. Alle drie gebruiken hetzelfde, wél instelbare U_geo.
function m7ScenarioSC(ugeo = state.m7Ugeo) {
  return {
    best: m7ShearCapacity(ugeo, M7_SCENARIO_CLOUD.best),
    middel: m7ShearCapacity(ugeo, M7_SCENARIO_CLOUD.middel),
    worst: m7ShearCapacity(ugeo, M7_SCENARIO_CLOUD.worst),
  };
}

// Verdeling van de "stabiele" nachten (middel+worst) tussen wSBL (middel, met half-bewolkt-drempel) en
// vSBL (worst, met helder-drempel): elke kant gebruikt automatisch zijn eigen vastgekoppelde
// bewolkingsklasse, genormaliseerd zodat middelShare + worstShare = 1 (eigen normalisatie, zie
// beperkingen Module 7). "Best" (bewolkt) telt hier niet mee — dat scenario valt buiten de wSBL/vSBL-
// tweedeling; het aandeel best/stabiel wordt elders (afstand tot kust) bepaald.
function m7WsblShare(ugeo = state.m7Ugeo) {
  const sc = m7ScenarioSC(ugeo);
  const wMiddel = sc.middel.pWsbl;
  const wWorst = sc.worst.pVsbl;
  const total = wMiddel + wWorst;
  return total > 0 ? wMiddel / total : 0.5;
}

function m7ComparisonRows() {
  const anchor = m6TurbineAnchor();
  const distKm = m6DistanceToCoastKm(anchor.lat, anchor.lng);
  const stable = m6StablePct(distKm);
  const scAll = m7ScenarioSC(state.m7Ugeo);
  const wsblShare = m7WsblShare(state.m7Ugeo);
  const toDays = pct => Math.round(pct / 100 * 365);
  const defaultMiddelPct = stable / 2, defaultWorstPct = stable / 2;
  const altMiddelPct = stable * wsblShare, altWorstPct = stable * (1 - wsblShare);
  return {
    anchor, stable, scAll, wsblShare,
    std: { middelPct: defaultMiddelPct, worstPct: defaultWorstPct, middelDays: toDays(defaultMiddelPct), worstDays: toDays(defaultWorstPct) },
    alt: { middelPct: altMiddelPct, worstPct: altWorstPct, middelDays: toDays(altMiddelPct), worstDays: toDays(altWorstPct) },
  };
}

// ---------- Module 7: automatische U_geo-ophaling uit ERA5-luchtdrukgradiënt ----------
// Fysische definitie: U_geo = |grad(p)| / (rho * f), met f = 2*Omega*sin(breedtegraad) de
// Coriolisparameter en rho de luchtdichtheid. |grad(p)| wordt per uur geschat met een gecentreerd
// eindige-differentieschema over vier hulppunten op ±1° breedte/lengte rond het zwaartepunt van de
// geplaatste turbine(s) (~100-110 km afstand, reële afstand berekend via haversineMeters — geen
// aanname van een vierkant grid). Per uur wordt eerst de snelheid berekend en pas daarna gemiddeld
// over het jongste volledige kalenderjaar — het middelen van de druk zélf zou de gradiënt over een
// jaar vrijwel wegmiddelen (windrichtingen wisselen), terwijl het middelen van de snelheid wél een
// representatieve jaarklimatologie oplevert (zie beperkingen Module 7, punt 8).
const M7_OMEGA = 7.2921159e-5; // rad/s, hoeksnelheid van de aarde
const M7_RHO = 1.225; // kg/m3, standaard luchtdichtheid op zeeniveau (eigen benadering)
const M7_GRID_OFFSET_DEG = 1.0; // ±1° breedte/lengte rond het zwaartepunt

function m7TurbineCentroid() {
  const turbines = state.turbines3a;
  if (!turbines || turbines.length === 0) return null;
  const lat = turbines.reduce((s, t) => s + t.lat, 0) / turbines.length;
  const lng = turbines.reduce((s, t) => s + t.lng, 0) / turbines.length;
  return { lat, lng };
}

async function m7FetchPressureSeries(lat, lng, year) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&start_date=${year}-01-01&end_date=${year}-12-31&hourly=pressure_msl&timezone=UTC`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ERA5-verzoek mislukt (${res.status})`);
  const data = await res.json();
  const values = data && data.hourly && data.hourly.pressure_msl;
  if (!Array.isArray(values) || values.length === 0) throw new Error('Geen luchtdrukreeks ontvangen');
  return values;
}

async function m7FetchGeostrophicWind() {
  const centroid = m7TurbineCentroid();
  if (!centroid) {
    state.m7UgeoAutoError = 'Plaats minstens één turbine op de kaart in Module 3 om U_geo automatisch te berekenen.';
    renderModule7();
    return;
  }
  state.m7UgeoFetching = true;
  state.m7UgeoAutoError = null;
  renderModule7();
  try {
    const { lat, lng } = centroid;
    const year = new Date().getFullYear() - 1; // jongste volledige kalenderjaar
    const north = { lat: lat + M7_GRID_OFFSET_DEG, lng };
    const south = { lat: lat - M7_GRID_OFFSET_DEG, lng };
    const east = { lat, lng: lng + M7_GRID_OFFSET_DEG };
    const west = { lat, lng: lng - M7_GRID_OFFSET_DEG };
    const [pNorth, pSouth, pEast, pWest] = await Promise.all([
      m7FetchPressureSeries(north.lat, north.lng, year),
      m7FetchPressureSeries(south.lat, south.lng, year),
      m7FetchPressureSeries(east.lat, east.lng, year),
      m7FetchPressureSeries(west.lat, west.lng, year),
    ]);
    const distNS = haversineMeters(north.lat, north.lng, south.lat, south.lng);
    const distEW = haversineMeters(east.lat, east.lng, west.lat, west.lng);
    const f = 2 * M7_OMEGA * Math.sin((lat * Math.PI) / 180);
    const n = Math.min(pNorth.length, pSouth.length, pEast.length, pWest.length);
    let sum = 0, count = 0;
    for (let i = 0; i < n; i++) {
      const pn = pNorth[i], ps = pSouth[i], pe = pEast[i], pw = pWest[i];
      if (pn == null || ps == null || pe == null || pw == null) continue;
      const dpdy = (pn - ps) * 100 / distNS; // hPa -> Pa
      const dpdx = (pe - pw) * 100 / distEW;
      const gradMag = Math.sqrt(dpdx * dpdx + dpdy * dpdy);
      const uGeo = gradMag / (M7_RHO * Math.abs(f));
      if (Number.isFinite(uGeo)) { sum += uGeo; count++; }
    }
    if (count === 0) throw new Error('Geen bruikbare uurwaarden in de ERA5-reeks');
    const avgUgeo = sum / count;
    const clamped = Math.min(22, Math.max(1, avgUgeo));
    const rounded = Math.round(clamped * 2) / 2; // afronden op stappen van 0,5 m/s (sliderstap)
    state.m7Ugeo = rounded;
    if (m7UgeoInputRef()) m7UgeoInputRef().value = rounded;
    state.m7UgeoAutoInfo = { value: rounded, rawValue: avgUgeo, year, nHours: count, lat, lng, fetchedAt: new Date() };
    state.m7UgeoAutoError = null;
  } catch (e) {
    state.m7UgeoAutoError = `Ophalen mislukt: ${e && e.message ? e.message : 'onbekende fout'}. Probeer het later opnieuw of vul U_geo handmatig in.`;
  } finally {
    state.m7UgeoFetching = false;
    renderModule7();
  }
}

function m7UgeoInputRef() { return document.getElementById('m7-ugeo-input'); }

function renderModule7() {
  const ugeoReadout = document.getElementById('m7-ugeo-readout');
  const scenarioCloudGrid = document.getElementById('m7-scenario-cloud-grid');
  const probGrid = document.getElementById('m7-prob-grid');
  const compareBody = document.getElementById('m7-compare-body');
  const applyNote = document.getElementById('m7-apply-m6-note');
  if (!probGrid) return;

  if (ugeoReadout) ugeoReadout.textContent = state.m7Ugeo.toFixed(1) + ' m/s';

  const ugeoAutoBtn = document.getElementById('m7-ugeo-auto-btn');
  const ugeoAutoStatus = document.getElementById('m7-ugeo-auto-status');
  const nTurbines7 = state.turbines3a.length;
  if (ugeoAutoBtn) ugeoAutoBtn.disabled = state.m7UgeoFetching || nTurbines7 === 0;
  if (ugeoAutoStatus) {
    ugeoAutoStatus.classList.remove('m8-status-error', 'm8-status-ok');
    if (state.m7UgeoFetching) {
      ugeoAutoStatus.textContent = 'Bezig met ophalen van ERA5-luchtdrukreeksen rond de turbine(s) (vier hulppunten, één jaar per uur) — dit kan enkele seconden duren...';
    } else if (state.m7UgeoAutoError) {
      ugeoAutoStatus.textContent = state.m7UgeoAutoError;
      ugeoAutoStatus.classList.add('m8-status-error');
    } else if (nTurbines7 === 0) {
      ugeoAutoStatus.textContent = 'Plaats eerst turbine(s) op de kaart in Module 3 om U_geo automatisch te berekenen.';
    } else if (state.m7UgeoAutoInfo) {
      const info = state.m7UgeoAutoInfo;
      const snap = m7TurbineCentroid();
      const stale = !snap || info.lat.toFixed(5) !== snap.lat.toFixed(5) || info.lng.toFixed(5) !== snap.lng.toFixed(5);
      const tijd = info.fetchedAt instanceof Date ? info.fetchedAt.toLocaleTimeString('nl-NL') : '';
      ugeoAutoStatus.textContent = `Automatisch ingevuld: ${info.value.toFixed(1)} m/s — jaargemiddelde uit de ERA5-luchtdrukgradiënt rond het zwaartepunt van de turbine(s) (${info.nHours} bruikbare uren, jaar ${info.year}, om ${tijd})${stale ? '. Let op: de turbineposities zijn sindsdien gewijzigd — klik opnieuw om bij te werken.' : '.'} Je kunt de waarde hierboven nog handmatig aanpassen.`;
      ugeoAutoStatus.classList.add(stale ? 'm8-status-error' : 'm8-status-ok');
    } else {
      ugeoAutoStatus.textContent = 'Nog niet opgehaald — klik op de knop hierboven om een jaargemiddelde U_geo te berekenen uit de ERA5-luchtdrukgradiënt rond de geplaatste turbine(s).';
    }
  }

  const cmp = m7ComparisonRows();
  const { scAll, wsblShare } = cmp;

  if (scenarioCloudGrid) {
    const rows = [
      { key: 'best', cls: 'm6-best', icon: '☁️' },
      { key: 'middel', cls: 'm6-middel', icon: '⛅' },
      { key: 'worst', cls: 'm6-worst', icon: '☀️' },
    ];
    scenarioCloudGrid.innerHTML = rows.map(r => `
      <div class="m6-pct-card ${r.cls}">
        <span class="m6-pct-label">${M7_SCENARIO_LABELS[r.key]}</span>
        <span class="m6-pct-cloud">${r.icon} ${M7_CLOUD_LABELS[M7_SCENARIO_CLOUD[r.key]]}</span>
        <span class="m6-pct-days">U<sub>min</sub> ≈ ${scAll[r.key].umin.toFixed(1)} m/s · SC = ${scAll[r.key].sc.toFixed(2)}</span>
      </div>
    `).join('');
  }

  probGrid.innerHTML = `
    <div class="m6-pct-card m6-best">
      <span class="m6-pct-label">Bewolkt → best case</span>
      <span class="m6-pct-value">SC ${scAll.best.sc.toFixed(2)}</span>
      <span class="m6-pct-days">U<sub>geo</sub> = ${state.m7Ugeo.toFixed(1)} m/s, U<sub>min</sub> = ${scAll.best.umin.toFixed(1)} m/s — ter info, telt niet mee in de middel/worst-verdeling (zie beperkingen)</span>
    </div>
    <div class="m6-pct-card m6-middel">
      <span class="m6-pct-label">Kans op wSBL (→ middel)</span>
      <span class="m6-pct-value">${(scAll.middel.pWsbl * 100).toFixed(0)}%</span>
      <span class="m6-pct-days">Half bewolkt, U<sub>geo</sub> = ${state.m7Ugeo.toFixed(1)} m/s, SC = ${scAll.middel.sc.toFixed(2)}</span>
      <div class="m6-pct-bar"><div class="m6-pct-bar-fill" style="width:${(scAll.middel.pWsbl * 100).toFixed(1)}%"></div></div>
    </div>
    <div class="m6-pct-card m6-worst">
      <span class="m6-pct-label">Kans op vSBL (→ worst)</span>
      <span class="m6-pct-value">${(scAll.worst.pVsbl * 100).toFixed(0)}%</span>
      <span class="m6-pct-days">Helder, U<sub>geo</sub> = ${state.m7Ugeo.toFixed(1)} m/s, SC = ${scAll.worst.sc.toFixed(2)}</span>
      <div class="m6-pct-bar"><div class="m6-pct-bar-fill" style="width:${(scAll.worst.pVsbl * 100).toFixed(1)}%"></div></div>
    </div>
  `;

  if (compareBody) {
    compareBody.innerHTML = `
      <tr>
        <td><strong>Oude standaard Module 6 (50/50, referentie)</strong></td>
        <td class="m6-month-cell">${cmp.std.middelDays}</td>
        <td class="m6-month-cell">${cmp.std.worstDays}</td>
      </tr>
      <tr>
        <td><strong>Module 7 — automatische bewolkings-koppeling (${(wsblShare * 100).toFixed(0)}/${(100 - wsblShare * 100).toFixed(0)})</strong></td>
        <td class="m6-month-cell">${cmp.alt.middelDays}</td>
        <td class="m6-month-cell">${cmp.alt.worstDays}</td>
      </tr>
    `;
  }

  if (applyNote) {
    applyNote.textContent = `Module 6 gebruikt nu altijd ${(wsblShare * 100).toFixed(0)}/${(100 - wsblShare * 100).toFixed(0)} (half bewolkt/helder) in plaats van 50/50 voor de middel/worst-verdeling.`;
  }
}


// ============================================================
// Module 8 — woningen (BAG) → bewoners → geschatte hinder per scenario
// ============================================================

// Hinderpercentages per scenario — zie module-callout in index.html voor bronnen:
// best = RIVM-basisscenario (47 dB Lden, ~8-9% ernstige hinder binnenshuis),
// middel = illustratieve tussenwaarde, worst = Pawlaczyk-Łuszczyńska e.a. (2018).
// De hinderpercentages zijn ONAFHANKELIJK van het ring/woningen-scenario (best/middel/worst) —
// elk ring-scenario wordt getoetst tegen alle drie de hinderpercentages, resulterend in een 3x3-matrix.
const M8_HINDER_SCENARIOS = [
  { key: 'best', pct: 9, label: 'RIVM-basisscenario' },
  { key: 'middel', pct: 30, label: 'Tussenscenario (illustratief)' },
  { key: 'worst', pct: 46, label: 'Pawlaczyk-Łuszczyńska e.a. (2018)' },
];
const M8_SCENARIO_LABEL = { best: 'Best case', middel: 'Middel', worst: 'Worst case' };
const M8_FETCH_RADIUS = 5000; // = grootste vaste ring uit Module 3; dekt alle scenario/categorie-combinaties
const M8_MAX_PAGES = 20; // veiligheidsgrens: 20 × limit=1000 = max 20.000 adressen per turbine

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Bepaalt, voor het gegeven scenario/categorie/richting/periode, de verste van de zes vaste ringen
// (Module 3) waar het geluidsniveau de actieve Lnight-norm (Module 5) nog overschrijdt.
// x = richtingscosinus t.o.v. de downwind-as: 1 = downwind (kritisch, verst dragend), -1 = upwind
// (snelst dempend), 0 = zijwind/crosswind (tussenliggend). Generalisatie van de vroegere, altijd-
// downwind m8ExceedanceRadius(), zodat Module 5/8/8a/9/10 dezelfde richtingslogica delen i.p.v. elk
// impliciet aan te nemen dat een ontvangpunt binnen een ring ook daadwerkelijk downwind ligt.
function m8ExceedanceRadiusX(scenarioKey, categoryKey, x, daynightKey, lwCatOverride) {
  const norm = getActiveNorm();
  if (norm.lnight == null) return null; // bv. WHO-preset heeft geen Lnight-waarde
  const lwCat = lwCatOverride != null ? lwCatOverride : computeCategoryLw(state.lwa)[categoryKey];
  const testState = { scenario: scenarioKey, daynight: daynightKey || 'nacht', curtailment: state.curtailment, windBearing: state.windBearing };
  let radius = null;
  DISTANCES.forEach((d) => {
    const lp = lpAt(d, x, categoryKey, lwCat, testState);
    if (lp > norm.lnight) radius = d;
  });
  return radius;
}

// Downwind-ring (x=1, nacht) — kortere naam voor de plekken waar uitsluitend de kritische
// (verst dragende) richting getoond hoeft te worden, bv. de gecombineerde downwind-context in
// tekstuele samenvattingen. Rekenkundig identiek aan m8ExceedanceRadiusX(s, c, 1, 'nacht').
function m8ExceedanceRadius(scenarioKey, categoryKey) {
  return m8ExceedanceRadiusX(scenarioKey, categoryKey, 1, 'nacht');
}

async function m8FetchAddressesForTurbine(turbine, radiusM) {
  const lat = turbine.lat, lng = turbine.lng;
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [(lng - dLon).toFixed(6), (lat - dLat).toFixed(6), (lng + dLon).toFixed(6), (lat + dLat).toFixed(6)].join(',');
  let url = `https://api.pdok.nl/kadaster/bag/ogc/v2/collections/adres/items?bbox=${bbox}&limit=1000&f=json`;
  const out = [];
  let pages = 0;
  let truncated = false;
  while (url && pages < M8_MAX_PAGES) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      truncated = true;
      break;
    }
    if (!res.ok) { truncated = true; break; }
    const data = await res.json();
    (data.features || []).forEach((f) => {
      const p = f.properties || {};
      const coords = f.geometry && f.geometry.coordinates;
      if (!coords) return;
      out.push({ id: p.adresseerbaar_object_identificatie || p.identificatie, lon: coords[0], lat: coords[1] });
    });
    const next = (data.links || []).find((l) => l.rel === 'next');
    url = next ? next.href : null;
    pages++;
  }
  if (url) truncated = true; // loop afgebroken op paginalimiet, niet omdat er geen 'next' meer was
  return { addresses: out, truncated };
}

function m8TurbineSnapshot() {
  return state.turbines3a.map((t) => `${t.id}:${t.lat.toFixed(5)},${t.lng.toFixed(5)}`).join('|');
}

async function m8RunFetch() {
  const n = state.turbines3a.length;
  if (n === 0) {
    state.m8Error = 'Plaats minstens één turbine op de kaart in Module 3 om woningen op te halen.';
    renderModule8();
    return;
  }
  state.m8Fetching = true;
  state.m8Error = null;
  renderModule8();
  try {
    const byTurbine = new Map();
    let anyTruncated = false;
    for (const t of state.turbines3a) {
      const { addresses, truncated } = await m8FetchAddressesForTurbine(t, M8_FETCH_RADIUS);
      byTurbine.set(t.id, addresses);
      if (truncated) anyTruncated = true;
    }
    state.m8AddressData = {
      byTurbine,
      turbineSnapshot: m8TurbineSnapshot(),
      truncated: anyTruncated,
      fetchedAt: new Date(),
    };
  } catch (e) {
    state.m8Error = 'Ophalen van BAG-adressen bij PDOK is mislukt. Probeer het later opnieuw.';
  } finally {
    state.m8Fetching = false;
    renderModule8();
  }
}

// Telt unieke BAG-adresobjecten binnen `radius` meter van minstens één geplaatste turbine.
function m8CountUnique(radius) {
  if (!state.m8AddressData || radius == null) return 0;
  const seen = new Set();
  state.turbines3a.forEach((t) => {
    const addrs = state.m8AddressData.byTurbine.get(t.id) || [];
    addrs.forEach((a) => {
      const d = haversineMeters(t.lat, t.lng, a.lat, a.lon);
      if (d <= radius) {
        seen.add(a.id || `${a.lat.toFixed(6)},${a.lon.toFixed(6)}`);
      }
    });
  });
  return seen.size;
}

function m8RingLabel(radius) {
  return radius == null ? 'geen overschrijding' : `≤ ${radius} m`;
}

// Compacte weergave van alle drie de richtingsringen tegelijk — downwind/upwind/zijwind — zodat in
// tabellen en kaarten in één oogopslag zichtbaar is dat de overschrijdingsafstand per richting
// verschilt (downwind draagt het verst, upwind het minst ver, zijwind zit ertussenin).
function m8RingLabelMulti(ringDown, ringUp, ringCross) {
  return `downwind ${m8RingLabel(ringDown)} · zijwind ${m8RingLabel(ringCross)} · upwind ${m8RingLabel(ringUp)}`;
}

// Toetst één BAG-adres exact aan de norm op basis van zijn WERKELIJKE afstand en peilrichting (bearing)
// t.o.v. de turbine — in plaats van aan te nemen dat elk adres binnen de (downwind-)overschrijdingsring
// ook daadwerkelijk downwind ligt. Een woning die toevallig binnen de downwind-ring valt maar in
// werkelijkheid upwind of zijwind van de turbine ligt, ondervindt een lager geluidsniveau en kan dus
// alsnog binnen de norm vallen — dit is de kern van de richtingsnuance in de woningtelling.
function m8AddressExceeds(turbine, addr, scenarioKey, categoryKey, daynightKey, lwCatOverride) {
  const norm = getActiveNorm();
  if (norm.lnight == null) return false;
  const lwCat = lwCatOverride != null ? lwCatOverride : computeCategoryLw(state.lwa)[categoryKey];
  const dist = Math.max(haversineMeters(turbine.lat, turbine.lng, addr.lat, addr.lon), 1);
  const downwindBearing = (state.windBearing + 180) % 360;
  const bearing = bearingBetween(turbine.lat, turbine.lng, addr.lat, addr.lon);
  const x = xFromAngle(bearing, downwindBearing);
  const testState = { scenario: scenarioKey, daynight: daynightKey || 'nacht', curtailment: state.curtailment, windBearing: state.windBearing };
  const lp = lpAt(dist, x, categoryKey, lwCat, testState);
  return lp > norm.lnight;
}

// Telt unieke BAG-adressen die — getoetst op hun werkelijke afstand+richting t.o.v. minstens één
// geplaatste turbine (niet via een isotrope ring) — de norm daadwerkelijk overschrijden. Dit vervangt
// de eerdere ring-gebaseerde telling (m8CountUnique) overal waar het gaat om de norm-overschrijding,
// zodat adressen die binnen de downwind-ring liggen maar in werkelijkheid upwind/zijwind staan,
// terecht buiten de telling vallen.
function m8CountExceedingUnique(scenarioKey, categoryKey, daynightKey, lwCatOverride) {
  if (!state.m8AddressData) return 0;
  const seen = new Set();
  state.turbines3a.forEach((t) => {
    const addrs = state.m8AddressData.byTurbine.get(t.id) || [];
    addrs.forEach((a) => {
      const id = a.id || `${a.lat.toFixed(6)},${a.lon.toFixed(6)}`;
      if (seen.has(id)) return;
      if (m8AddressExceeds(t, a, scenarioKey, categoryKey, daynightKey, lwCatOverride)) {
        seen.add(id);
      }
    });
  });
  return seen.size;
}

const M8_CATEGORY_META = [
  { key: 'hoorbaar', label: 'Hoorbaar (dB(A))' },
  { key: 'laagfrequent', label: 'Laagfrequent (dB(Lin))' },
  { key: 'infrasoon', label: 'Infrasoon (dB(G), indicatief)' },
];

// Bouwt de gedeelde 3 (scenario) × 3 (categorie) × 3 (hinderpercentage) datamatrix die Module 8, 9 en 10
// alle drie hergebruiken — zo wordt de overschrijdingsring/woningen/bewoners-berekening maar op één plek gedaan.
function m8ComputeRows() {
  const norm = getActiveNorm();
  const normHasLnight = norm.lnight != null;
  const hasData = !!state.m8AddressData;
  const hinderFor = (people) =>
    M8_HINDER_SCENARIOS.map((h) => ({
      pct: h.pct,
      label: h.label,
      people: people != null ? people * (h.pct / 100) : null,
    }));
  return ['best', 'middel', 'worst'].map((scenario) => {
    const categories = M8_CATEGORY_META.map((meta) => {
      const ring = normHasLnight ? m8ExceedanceRadiusX(scenario, meta.key, 1, 'nacht') : null;
      const ringUp = normHasLnight ? m8ExceedanceRadiusX(scenario, meta.key, -1, 'nacht') : null;
      const ringCross = normHasLnight ? m8ExceedanceRadiusX(scenario, meta.key, 0, 'nacht') : null;
      // Woningen/bewoners worden NIET meer via de (downwind-)ring geteld, maar per BAG-adres exact
      // getoetst op zijn werkelijke afstand en peilrichting t.o.v. de turbine (zie m8AddressExceeds).
      // Zo telt een woning die binnen de downwind-ring ligt maar in werkelijkheid upwind/zijwind staat,
      // terecht niet mee als deze op haar eigen richting binnen de norm blijft.
      const houses = hasData ? m8CountExceedingUnique(scenario, meta.key, 'nacht') : null;
      const people = houses != null ? houses * state.m8HouseholdSize : null;
      return { key: meta.key, label: meta.label, ring, ringUp, ringCross, houses, people, hinder: hinderFor(people) };
    });
    return { scenario, categories };
  });
}

// Ontdubbelde totaal per scenario: de drie categorieën (hoorbaar/laagfrequent/infrasoon) delen
// dezelfde turbinelocaties, dus hun overschrijdingscirkels liggen concentrisch (zelfde middelpunt,
// verschillende straal). De VERENIGING van drie concentrische cirkels is exact gelijk aan de cirkel
// met de grootste straal — dat geldt altijd, ongeacht welke categorie toevallig de grootste ring heeft.
// Daarom is dit de enige correcte manier om een scenario-totaal te bepalen zonder een huishouden dat
// binnen meerdere categorieringen valt twee- of driemaal mee te tellen (zie ook m8ComputeRows()).
function m8ComputeTotals() {
  const norm = getActiveNorm();
  const normHasLnight = norm.lnight != null;
  const hasData = !!state.m8AddressData;
  const hinderFor = (people) =>
    M8_HINDER_SCENARIOS.map((h) => ({
      pct: h.pct,
      label: h.label,
      people: people != null ? people * (h.pct / 100) : null,
    }));
  return ['best', 'middel', 'worst'].map((scenario) => {
    let unionRing = null, unionRingUp = null, unionRingCross = null;
    if (normHasLnight) {
      M8_CATEGORY_META.forEach((meta) => {
        const r = m8ExceedanceRadiusX(scenario, meta.key, 1, 'nacht');
        if (r != null && (unionRing == null || r > unionRing)) unionRing = r;
        const rUp = m8ExceedanceRadiusX(scenario, meta.key, -1, 'nacht');
        if (rUp != null && (unionRingUp == null || rUp > unionRingUp)) unionRingUp = rUp;
        const rCross = m8ExceedanceRadiusX(scenario, meta.key, 0, 'nacht');
        if (rCross != null && (unionRingCross == null || rCross > unionRingCross)) unionRingCross = rCross;
      });
    }
    // Exacte telling: een adres telt mee in het ontdubbelde totaal zodra het — op zijn eigen,
    // werkelijke afstand+richting — de norm overschrijdt voor MINSTENS één van de drie categorieën.
    let houses = null;
    if (hasData) {
      const seen = new Set();
      state.turbines3a.forEach((t) => {
        const addrs = state.m8AddressData.byTurbine.get(t.id) || [];
        addrs.forEach((a) => {
          const id = a.id || `${a.lat.toFixed(6)},${a.lon.toFixed(6)}`;
          if (seen.has(id)) return;
          const exceedsAny = normHasLnight && M8_CATEGORY_META.some((meta) => m8AddressExceeds(t, a, scenario, meta.key, 'nacht'));
          if (exceedsAny) seen.add(id);
        });
      });
      houses = seen.size;
    }
    const people = houses != null ? houses * state.m8HouseholdSize : null;
    return { scenario, ring: unionRing, ringUp: unionRingUp, ringCross: unionRingCross, houses, people, hinder: hinderFor(people) };
  });
}

// ---------- Module 8: jaargemiddelde toetsing van de Lnight-norm (best/middel/worst-mix) ----------
// De Lnight-norm (Module 5) is wettelijk een JAARGEMIDDELDE over alle nachten van het jaar, geen
// grenswaarde per afzonderlijke nacht. Deze functie rekent, voor elke overschrijdingsring die Module 8
// hierboven al voor hoorbaar geluid vindt (best/middel/worst hebben elk hun eigen ring), het energetisch
// (logaritmisch) jaargemiddelde Lnight uit op die afstand — gewogen met de werkelijke scenario-
// percentages per jaar uit Module 6 (locatieafhankelijk: afstand tot de kust en shear-capaciteit, zie
// Module 7) — en toetst dat jaargemiddelde opnieuw aan de norm. Formule:
//   L_jaar = 10·log10( Σ p_i · 10^(L_i/10) ),  p_best + p_middel + p_worst = 1
// Energetische (logaritmische) jaarmiddeling is de gangbare rekenmethode voor Lden/Lnight-toetsing.
// De drie canonieke toetsrichtingen die Module 5/8/8a/9/10 delen: downwind (kritisch, x=1),
// upwind (snelst dempend, x=-1) en zijwind/crosswind (tussenliggend, x=0).
const M8_DIRECTIONS = [
  { key: 'downwind', label: 'Downwind', x: 1 },
  { key: 'zijwind', label: 'Zijwind (crosswind)', x: 0 },
  { key: 'upwind', label: 'Upwind', x: -1 },
];
// De drie geluidscategorieën die de jaargemiddelde-toetsing hieronder apart doorrekent — bewust
// NIET tot één getal samengevoegd: dB(A)/dB(Lin)/dB(G) zijn verschillende wegingscurven over
// verschillende frequentiebanden, energetisch bij elkaar optellen of middelen tussen categorieën
// heeft geen natuurkundige betekenis (zie ook de "geen optelling over categorieën"-kanttekening
// bij Module 8 hierboven). Voor laagfrequent/infrasoon geldt geen wettelijke Lnight-norm in hun
// eigen eenheid — de dB(A)-norm dient daar, net als bij Module 8a, uitsluitend als indicatief
// referentiepunt, niet als wettelijk toetsingskader.
const JAARNORM_CATEGORIES = [
  { key: 'hoorbaar', label: 'Hoorbaar geluid', unit: 'dB(A)', indicatief: false },
  { key: 'laagfrequent', label: 'Laagfrequent geluid', unit: 'dB(Lin)', indicatief: true },
  { key: 'infrasoon', label: 'Infrasoon geluid', unit: 'dB(G)', indicatief: true },
];

function m8JaarnormRows(categoryKey) {
  const catKey = categoryKey || 'hoorbaar';
  const norm = getActiveNorm();
  if (norm.lnight == null || state.turbines3a.length === 0) return null;
  const anchor = m6TurbineAnchor();
  const pct = m6ScenarioPercentages(anchor.lat, anchor.lng);
  const lwCat = computeCategoryLw(state.lwa)[catKey];
  const levelAt = (scenario, d, x) => lpAt(d, x, catKey, lwCat, { scenario, daynight: 'nacht', curtailment: state.curtailment });
  const weightedAvgAt = (d, x) => 10 * Math.log10(
    ['best', 'middel', 'worst'].reduce((acc, s) => acc + (pct[s] / 100) * Math.pow(10, levelAt(s, d, x) / 10), 0)
  );
  // Per scenario één rij per richting (downwind/zijwind/upwind): elke richting heeft zijn eigen
  // overschrijdingsring (downwind draagt het verst, dus de grootste ring; upwind het minst ver) en dus
  // ook zijn eigen jaargemiddelde en toetsing — in plaats van, zoals voorheen, uitsluitend downwind.
  const rows = [];
  ['best', 'middel', 'worst'].forEach((scenario) => {
    M8_DIRECTIONS.forEach((dir) => {
      const ring = m8ExceedanceRadiusX(scenario, catKey, dir.x, 'nacht');
      if (ring == null) {
        rows.push({ scenario, direction: dir.key, directionLabel: dir.label, ring: null, levels: null, jaargemiddelde: null, exceeds: null });
        return;
      }
      const levels = { best: levelAt('best', ring, dir.x), middel: levelAt('middel', ring, dir.x), worst: levelAt('worst', ring, dir.x) };
      const jaargemiddelde = weightedAvgAt(ring, dir.x);
      rows.push({ scenario, direction: dir.key, directionLabel: dir.label, ring, levels, jaargemiddelde, exceeds: jaargemiddelde > norm.lnight });
    });
  });
  return { pct, anchor, rows };
}

// ---------- Stilstandnachten: effect van X nachten volledige turbinestilstand op het jaargemiddelde ----------
// Zet de scenario-percentages (Module 6/7) om in een concreet aantal nachten van de 365, en "verwijdert"
// daaruit het opgegeven aantal stilstandnachten — volgens de gebruikerskeuze bij voorrang uit de zwaarste
// nachten (worst case eerst, dan middel, dan best case): dat is de realistische volgorde voor een
// stilstandvoorziening, die zich in de praktijk juist op de zwaarste condities richt en zo het grootste
// effect per stilgezette nacht geeft. Op een stilstandnacht wordt de turbinebijdrage op 0 dB gezet (geen
// apart achtergrondniveau meegerekend — in werkelijkheid blijft er altijd wat restgeluid over, maar dat
// valt buiten wat dit turbine-model berekent).
const M8_JAAR_NACHTEN = 365;
function m8NachtenVanPct(pct) {
  let nWorst = Math.round((pct.worst / 100) * M8_JAAR_NACHTEN);
  let nMiddel = Math.round((pct.middel / 100) * M8_JAAR_NACHTEN);
  let nBest = M8_JAAR_NACHTEN - nWorst - nMiddel;
  if (nBest < 0) { nBest = 0; }
  return { nBest, nMiddel, nWorst };
}
function m8VerdeelStilstand(nachten, stilNachten) {
  let resterend = Math.max(0, Math.min(M8_JAAR_NACHTEN, Math.round(stilNachten) || 0));
  const uitWorst = Math.min(resterend, nachten.nWorst); resterend -= uitWorst;
  const uitMiddel = Math.min(resterend, nachten.nMiddel); resterend -= uitMiddel;
  const uitBest = Math.min(resterend, nachten.nBest); resterend -= uitBest;
  return {
    nBest: nachten.nBest - uitBest,
    nMiddel: nachten.nMiddel - uitMiddel,
    nWorst: nachten.nWorst - uitWorst,
    nStil: uitWorst + uitMiddel + uitBest,
  };
}
// Herberekent het energetisch jaargemiddelde met een vierde "stil"-emmer (0 dB) naast best/middel/worst,
// op basis van het aantal nachten per emmer (niet meer de originele percentages) — zelfde logaritmische
// middelingsformule als m8JaarnormRows() hierboven, nu met vier termen in plaats van drie.
function m8JaargemiddeldeMetStilstand(levels, pct, stilNachten) {
  // Verwijdert stilstandnachten uit de afgeronde nachtaantallen (nodig omdat "aantal nachten" per
  // definitie een geheel getal is), maar herberekent het jaargemiddelde met de ORIGINELE exacte
  // percentages geschaald met de overgebleven fractie per emmer — niet met de afgeronde
  // nachtaantallen zelf. Zo valt bij stilNachten = 0 (fractie = 1 in elke emmer) dit exact terug op
  // dezelfde weging als m8JaarnormRows()/weightedAvgAt() hierboven (geen afrondingsverschil met de
  // "huidig"-kolom hierboven).
  const nachten = m8NachtenVanPct(pct);
  const verdeeld = m8VerdeelStilstand(nachten, stilNachten);
  const fracBest = nachten.nBest > 0 ? verdeeld.nBest / nachten.nBest : 0;
  const fracMiddel = nachten.nMiddel > 0 ? verdeeld.nMiddel / nachten.nMiddel : 0;
  const fracWorst = nachten.nWorst > 0 ? verdeeld.nWorst / nachten.nWorst : 0;
  const wBest = (pct.best / 100) * fracBest;
  const wMiddel = (pct.middel / 100) * fracMiddel;
  const wWorst = (pct.worst / 100) * fracWorst;
  const wStil = (pct.best / 100) * (1 - fracBest) + (pct.middel / 100) * (1 - fracMiddel) + (pct.worst / 100) * (1 - fracWorst);
  const sum = wBest * Math.pow(10, levels.best / 10)
    + wMiddel * Math.pow(10, levels.middel / 10)
    + wWorst * Math.pow(10, levels.worst / 10)
    + wStil * Math.pow(10, 0 / 10);
  return { ...verdeeld, jaargemiddelde: 10 * Math.log10(sum) };
}

// Bemonstert m8JaargemiddeldeMetStilstand() over het hele bereik van 0 t/m 365 stilstandnachten, voor
// één richting (één "levels"-object). Gebruikt voor de grafiek hieronder. Neemt elke 5 nachten een punt
// én voegt expliciet de twee "knikpunten" toe waarop de verdeling van bucket wisselt (worst case op,
// dan middel op) — de curve is namelijk stuksgewijs vloeiend maar heeft daar een knik, dus zonder die
// twee extra punten zou een grove steekproef die knik afvlakken.
function m8StilstandCurvePoints(levels, pct, nachten) {
  const stops = new Set([0, M8_JAAR_NACHTEN, nachten.nWorst, nachten.nWorst + nachten.nMiddel]);
  for (let i = 0; i <= M8_JAAR_NACHTEN; i += 5) stops.add(i);
  return Array.from(stops).filter((n) => n >= 0 && n <= M8_JAAR_NACHTEN).sort((a, b) => a - b)
    .map((n) => ({ n, y: m8JaargemiddeldeMetStilstand(levels, pct, n).jaargemiddelde }));
}

// Bouwt een lichtgewicht inline-SVG-lijngrafiek (geen externe grafiekbibliotheek nodig, consistent met
// de andere handgetekende SVG's in deze app) die per richting (downwind/zijwind/upwind) het jaargemiddelde
// toont als functie van het aantal stilstandnachten, 0 t/m 365 — met de norm(indicatief)-lijn en een
// markering van de huidige invoerwaarde.
function m8StilstandChartSvg(series, normValue, normIndicatief, unit, currentX) {
  const W = 640, H = 260;
  const mL = 46, mR = 14, mT = 14, mB = 28;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const allY = series.flatMap((s) => s.points.map((p) => p.y)).concat(normValue != null ? [normValue] : []);
  let yMin = Math.min(...allY), yMax = Math.max(...allY);
  if (yMax - yMin < 1) { yMax += 0.5; yMin -= 0.5; }
  const pad = (yMax - yMin) * 0.1;
  yMin -= pad; yMax += pad;
  const xScale = (n) => mL + (n / M8_JAAR_NACHTEN) * plotW;
  const yScale = (y) => mT + (1 - (y - yMin) / (yMax - yMin)) * plotH;
  const gridCount = 4;
  let gridHtml = '';
  for (let i = 0; i <= gridCount; i++) {
    const y = yMin + (yMax - yMin) * (i / gridCount);
    const yy = yScale(y);
    gridHtml += `<line x1="${mL}" y1="${yy.toFixed(1)}" x2="${W - mR}" y2="${yy.toFixed(1)}" class="m8-chart-grid" />`;
    gridHtml += `<text x="${mL - 6}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" class="m8-chart-axis-label">${y.toFixed(0)}</text>`;
  }
  let xTickHtml = '';
  [0, 91, 182, 273, 365].forEach((t) => {
    xTickHtml += `<text x="${xScale(t).toFixed(1)}" y="${H - mB + 18}" text-anchor="middle" class="m8-chart-axis-label">${t}</text>`;
  });
  let normHtml = '';
  if (normValue != null && normValue >= yMin && normValue <= yMax) {
    const ny = yScale(normValue);
    normHtml = `<line x1="${mL}" y1="${ny.toFixed(1)}" x2="${W - mR}" y2="${ny.toFixed(1)}" class="m8-chart-norm-line" />`
      + `<text x="${W - mR}" y="${(ny - 5).toFixed(1)}" text-anchor="end" class="m8-chart-norm-label">Norm${normIndicatief ? ' (indicatief)' : ''}: ${normValue.toFixed(0)} ${unit}</text>`;
  }
  let seriesHtml = '';
  series.forEach((s) => {
    const pts = s.points.map((p) => `${xScale(p.n).toFixed(1)},${yScale(p.y).toFixed(1)}`).join(' ');
    seriesHtml += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" />`;
  });
  let markerHtml = '';
  if (currentX != null) {
    if (currentX > 0) {
      const mx = xScale(currentX);
      markerHtml += `<line x1="${mx.toFixed(1)}" y1="${mT}" x2="${mx.toFixed(1)}" y2="${H - mB}" class="m8-chart-current-line" />`;
    }
    series.forEach((s) => {
      let closest = s.points[0];
      s.points.forEach((p) => { if (Math.abs(p.n - currentX) < Math.abs(closest.n - currentX)) closest = p; });
      markerHtml += `<circle cx="${xScale(closest.n).toFixed(1)}" cy="${yScale(closest.y).toFixed(1)}" r="4.5" fill="${s.color}" class="m8-chart-current-dot" />`;
    });
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="m8-chart-svg" role="img" aria-label="Jaargemiddelde als functie van het aantal stilstandnachten, 0 tot 365">`
    + gridHtml
    + `<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${H - mB}" class="m8-chart-axis" />`
    + `<line x1="${mL}" y1="${H - mB}" x2="${W - mR}" y2="${H - mB}" class="m8-chart-axis" />`
    + xTickHtml + normHtml + markerHtml + seriesHtml
    + `</svg>`;
}
const M8_CHART_COLORS = { downwind: 'var(--color-chart-1)', zijwind: 'var(--color-chart-2)', upwind: 'var(--color-chart-3)' };
// Zelfde drie kleuren als hard gecodeerde hex (in plaats van CSS var()) voor het losstaande, altijd
// lichte PDF-rapport (Module 13) — dat document heeft geen dark-mode en geen toegang tot style.css.
const M8_CHART_COLORS_REPORT = { downwind: '#006494', zijwind: '#7a39bb', upwind: '#da7101' };

// ==================== MODULE 8a: gevolgen van A-weging op laagfrequent/infrasoon ====================
// Zelfde methodiek als Module 8 (ring → BAG-woningen → bewoners), maar nu berekend voor de twee
// categorieën die normaal NIET A-gewogen worden (laagfrequent: dB(Lin); infrasoon: dB(G)), en voor
// zowel dag als nacht. Laat zien wat er gebeurt als je (zoals de dB(A)-Lnight-norm in de praktijk
// impliciet doet) de A-weging ook over laagfrequent en infrasoon geluid legt: A-weging onderdrukt
// lage frequenties fors (zie Module 1/octaafbandtabel), dus "gewogen" geeft een veel lager niveau,
// een veel kleinere overschrijdingsring en dus veel minder getelde woningen/bewoners dan "ongewogen".
const M8A_CATEGORIES = [
  { key: 'laagfrequent', label: 'Laagfrequent geluid', unweightedUnit: 'dB(Lin)', lwKey: 'laagfrequent', lwKeyA: 'laagfrequentA' },
  { key: 'infrasoon', label: 'Infrasoon geluid', unweightedUnit: 'dB(G)', lwKey: 'infrasoon', lwKeyA: 'infrasoonA' },
];
const M8A_PERIODS = [
  { key: 'dag', label: 'Dag' },
  { key: 'nacht', label: 'Nacht' },
];

// Bouwt, per scenario (best/middel/worst — "in alle scenario's"), een directe rij-voor-rij
// vergelijking tussen Module 8 (ongewogen/G-gewogen — de vakliteratuur-juiste toetsing) en
// Module 8a (A-gewogen — de praktijk-toetsing die de dB(A)-Lnight-norm impliceert), per categorie
// (laagfrequent/infrasoon) en per periode (dag/nacht): 2 × 2 = 4 vergelijkingsrijen per scenario.
// Let op: er bestaat geen aparte, wettelijk vastgestelde dag-norm in dit model (zie Module 8/
// methodologie — toetsing gebeurt uitsluitend op Lnight); de dag-rijen hieronder toetsen daarom
// één-op-één aan datzelfde Lnight-getal, uitsluitend om het effect van de nachtelijke windschering/
// inversietoeslag (Module 2) te isoleren — net zoals Module 8 de dB(A)-Lnight-norm ook al als
// indicatief referentiepunt voor infrasoon (dB(G)) gebruikt.
function m8aComputeRows() {
  const catLw = computeCategoryLw(state.lwa);
  const hasData = !!state.m8AddressData;
  return ['best', 'middel', 'worst'].map((scenario) => {
    const rows = [];
    M8A_CATEGORIES.forEach((cat) => {
      M8A_PERIODS.forEach((period) => {
        const lwOngewogen = catLw[cat.lwKey];
        const lwGewogen = catLw[cat.lwKeyA];
        // Ring per richting (downwind/zijwind/upwind) — uitsluitend ter context: laat zien dat ook hier
        // downwind het verst draagt. De woningen/bewonerstelling hieronder gebruikt NIET deze ring,
        // maar toetst elk BAG-adres exact op zijn eigen werkelijke afstand+richting (zie m8AddressExceeds),
        // net als Module 8 hierboven.
        const ringM8 = m8ExceedanceRadiusX(scenario, cat.key, 1, period.key, lwOngewogen);
        const ringM8Cross = m8ExceedanceRadiusX(scenario, cat.key, 0, period.key, lwOngewogen);
        const ringM8Up = m8ExceedanceRadiusX(scenario, cat.key, -1, period.key, lwOngewogen);
        const ringM8a = m8ExceedanceRadiusX(scenario, cat.key, 1, period.key, lwGewogen);
        const ringM8aCross = m8ExceedanceRadiusX(scenario, cat.key, 0, period.key, lwGewogen);
        const ringM8aUp = m8ExceedanceRadiusX(scenario, cat.key, -1, period.key, lwGewogen);
        const housesM8 = hasData ? m8CountExceedingUnique(scenario, cat.key, period.key, lwOngewogen) : null;
        const housesM8a = hasData ? m8CountExceedingUnique(scenario, cat.key, period.key, lwGewogen) : null;
        const peopleM8 = housesM8 != null ? housesM8 * state.m8HouseholdSize : null;
        const peopleM8a = housesM8a != null ? housesM8a * state.m8HouseholdSize : null;
        const deltaDb = (lwOngewogen != null && lwGewogen != null) ? (lwGewogen - lwOngewogen) : null;
        let afnamePct = null;
        if (housesM8 != null && housesM8a != null) {
          afnamePct = housesM8 === 0 ? 0 : ((housesM8 - housesM8a) / housesM8) * 100;
        }
        rows.push({
          catKey: cat.key, catLabel: cat.label, periodLabel: period.label,
          unweightedUnit: cat.unweightedUnit,
          lwM8: lwOngewogen, lwM8a: lwGewogen, deltaDb,
          ringM8, ringM8Cross, ringM8Up, ringM8a, ringM8aCross, ringM8aUp,
          housesM8, housesM8a, peopleM8, peopleM8a,
          afnamePct,
        });
      });
    });
    return { scenario, rows };
  });
}

function renderModule8a() {
  const container = document.getElementById('m8a-tables');
  const contextCallout = document.getElementById('m8a-context-callout');
  if (!container) return;
  const n = state.turbines3a.length;
  const norm = getActiveNorm();
  const normHasLnight = norm.lnight != null;
  if (contextCallout) {
    if (n === 0) {
      contextCallout.textContent = 'Plaats minstens één turbine op de kaart in Module 3 om deze module te gebruiken.';
    } else if (!normHasLnight) {
      contextCallout.textContent = `De geselecteerde norm (${norm.label}) heeft geen Lnight-waarde — deze vergelijking kan hiermee niet worden bepaald. Kies een andere norm bij Module 5.`;
    } else if (!state.m8AddressData) {
      contextCallout.textContent = 'Nog geen BAG-gegevens — klik hierboven bij Module 8 op "Woningen ophalen (BAG)".';
    } else {
      contextCallout.innerHTML = `Zelfde ${m8CountUnique(M8_FETCH_RADIUS).toLocaleString('nl-NL')} BAG-adressen als Module 8 hierboven, nu doorgerekend met de A-gewogen variant van laagfrequent en infrasoon geluid, voor zowel dag als nacht.`;
    }
  }
  const rows = m8aComputeRows();
  const dash = '—';
  const arrow = (a, b) => `${a}<span class="m8a-arrow">→</span>${b}`;
  container.innerHTML = rows.map((r) => `
    <div class="data-table-card m8a-scenario-card">
      <h3>${M8_SCENARIO_LABEL[r.scenario]}</h3>
      <div class="cum-result-wrap">
      <table class="data-table m8a-table">
        <thead>
          <tr>
            <th>Categorie</th><th>Periode</th>
            <th>Bronniveau<br><span class="m8a-subhead">Module 8 → 8a</span></th>
            <th>Δ (dB)</th>
            <th>Overschrijdingsring<br><span class="m8a-subhead">Module 8 → 8a</span></th>
            <th>Woningen (BAG)<br><span class="m8a-subhead">Module 8 → 8a</span></th>
            <th>Bewoners<br><span class="m8a-subhead">Module 8 → 8a</span></th>
            <th>Afname</th>
          </tr>
        </thead>
        <tbody>
          ${n === 0 ? `<tr><td colspan="8" class="empty-row">Plaats een turbine op de kaart en klik bij Module 8 op "Woningen ophalen (BAG)".</td></tr>` : r.rows.map((row, idx) => {
            const firstOfCat = idx % 2 === 0;
            const hasExceedanceLeft = row.afnamePct != null && Math.round(row.afnamePct) < 100 && row.ringM8a != null;
            const rowClass = row.afnamePct != null && Math.round(row.afnamePct) >= 100 ? 'm8a-row-erased' : (hasExceedanceLeft ? 'm8a-row-partial' : '');
            return `<tr class="${rowClass}">
              <td>${firstOfCat ? row.catLabel : ''}</td>
              <td>${row.periodLabel}</td>
              <td>${row.lwM8 != null ? arrow(row.lwM8.toFixed(1) + ' ' + row.unweightedUnit, row.lwM8a.toFixed(1) + ' dB(A)') : dash}</td>
              <td>${row.deltaDb != null ? row.deltaDb.toFixed(1) : dash}</td>
              <td>${arrow(m8RingLabel(row.ringM8), m8RingLabel(row.ringM8a))} <span class="m8a-subhead">(downwind)</span><br>${arrow(m8RingLabel(row.ringM8Cross), m8RingLabel(row.ringM8aCross))} <span class="m8a-subhead">(zijwind)</span><br>${arrow(m8RingLabel(row.ringM8Up), m8RingLabel(row.ringM8aUp))} <span class="m8a-subhead">(upwind)</span></td>
              <td>${row.housesM8 != null ? arrow(row.housesM8.toLocaleString('nl-NL'), row.housesM8a.toLocaleString('nl-NL')) : dash}</td>
              <td>${row.peopleM8 != null ? arrow(Math.round(row.peopleM8).toLocaleString('nl-NL'), Math.round(row.peopleM8a).toLocaleString('nl-NL')) : dash}</td>
              <td class="m8a-afname">${row.afnamePct != null ? '−' + Math.round(row.afnamePct) + '%' : dash}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
    </div>`).join('');
}

function renderModule8() {
  const contextCallout = document.getElementById('m8-context-callout');
  const fetchStatus = document.getElementById('m8-fetch-status');
  const fetchBtn = document.getElementById('m8-fetch-btn');
  const householdInput = document.getElementById('m8-household-size');
  const grid = document.getElementById('m8-grid');
  const tableBody = document.getElementById('m8-table-body');
  if (!grid) return;

  const n = state.turbines3a.length;
  if (householdInput && document.activeElement !== householdInput) {
    householdInput.value = state.m8HouseholdSize;
  }

  if (contextCallout) {
    if (n === 0) {
      contextCallout.textContent = 'Plaats minstens één turbine op de kaart in Module 3 om deze module te gebruiken.';
    } else {
      contextCallout.innerHTML = `${n} turbine${n === 1 ? '' : 's'} geplaatst. Overschrijdingsafstanden gebruiken de huidige norm van Module 5 (<strong>${getActiveNorm().label}</strong>) en het huidige bronvermogen van Module 1.`;
    }
  }

  if (fetchBtn) fetchBtn.disabled = state.m8Fetching || n === 0;

  const norm = getActiveNorm();
  const normHasLnight = norm.lnight != null;

  if (fetchStatus) {
    fetchStatus.className = 'hint';
    if (!normHasLnight) {
      fetchStatus.textContent = `De geselecteerde norm (${norm.label}) heeft geen Lnight-waarde — overschrijdingsafstand kan hiermee niet worden bepaald. Kies een andere norm bij Module 5.`;
      fetchStatus.classList.add('m8-status-error');
    } else if (state.m8Fetching) {
      fetchStatus.textContent = `Bezig met ophalen van BAG-adressen rond ${n} turbine${n === 1 ? '' : 's'} (tot ${M8_FETCH_RADIUS} m)...`;
    } else if (state.m8Error) {
      fetchStatus.textContent = state.m8Error;
      fetchStatus.classList.add('m8-status-error');
    } else if (state.m8AddressData) {
      const totalUnique = m8CountUnique(M8_FETCH_RADIUS);
      const stale = state.m8AddressData.turbineSnapshot !== m8TurbineSnapshot();
      const when = state.m8AddressData.fetchedAt.toLocaleTimeString('nl-NL');
      let txt = `${totalUnique} unieke BAG-adressen gevonden binnen ${M8_FETCH_RADIUS} m van de geplaatste turbine(s) (opgehaald om ${when}).`;
      if (state.m8AddressData.truncated) txt += ' Let op: het aantal pagina\u2019s is afgekapt op de veiligheidsgrens — het werkelijke aantal kan hoger liggen.';
      if (stale) txt += ' Turbines zijn gewijzigd sinds deze ophaling — klik opnieuw op "Woningen ophalen (BAG)" voor actuele aantallen.';
      fetchStatus.textContent = txt;
      fetchStatus.classList.add(stale ? 'm8-status-error' : 'm8-status-ok');
    } else {
      fetchStatus.textContent = n > 0 ? 'Nog geen BAG-gegevens opgehaald — klik op "Woningen ophalen (BAG)".' : '';
    }
  }

  const rows = m8ComputeRows();
  const totals = m8ComputeTotals();
  window.__m8LastTotals = totals; // t.b.v. QA-scripts

  const totalsTextEl = document.getElementById('m8-totals-text');
  const totalsTableBody = document.getElementById('m8-totals-table-body');
  const dashT = '—';
  if (totalsTextEl) {
    if (n === 0 || !state.m8AddressData) {
      totalsTextEl.innerHTML = '<em>Nog geen gegevens \u2014 plaats turbines en haal de BAG-woningen op om het ontdubbelde totaal te zien.</em>';
    } else {
      totalsTextEl.innerHTML = totals
        .map((t) => `<div class="m8-totals-line"><strong>${M8_SCENARIO_LABEL[t.scenario]}</strong> \u2014 ontdubbelde ring ${m8RingLabelMulti(t.ring, t.ringUp, t.ringCross)}, ${t.houses != null ? t.houses.toLocaleString('nl-NL') : dashT} unieke woningen, ${t.people != null ? Math.round(t.people).toLocaleString('nl-NL') : dashT} bewoners in totaal (per adres getoetst op de werkelijke afstand+richting tot de turbine).</div>`)
        .join('');
    }
  }
  if (totalsTableBody) {
    if (n === 0 || !state.m8AddressData) {
      totalsTableBody.innerHTML = `<tr><td colspan="4" class="empty-row">Plaats een turbine op de kaart en klik op "Woningen ophalen (BAG)".</td></tr>`;
    } else {
      totalsTableBody.innerHTML = totals
        .map((t) => `<tr class="m8-totals-row">
            <td>${M8_SCENARIO_LABEL[t.scenario]}</td>
            <td>${m8RingLabelMulti(t.ring, t.ringUp, t.ringCross)}</td>
            <td>${t.houses != null ? t.houses.toLocaleString('nl-NL') : dashT}</td>
            <td>${t.people != null ? Math.round(t.people).toLocaleString('nl-NL') : dashT}</td>
          </tr>`)
        .join('');
    }
  }

  grid.innerHTML = rows
    .map((r) => {
      const dash = '—';
      const catBlocks = r.categories
        .map(
          (c) => `
        <div class="m8-cat-block">
          <span class="m8-cat-title">${c.label}</span>
          <div class="m8-row"><span class="m8-row-label">Overschrijdingsring</span><span class="m8-row-value">${m8RingLabelMulti(c.ring, c.ringUp, c.ringCross)}</span></div>
          <div class="m8-row"><span class="m8-row-label">Woningen in dat gebied (BAG)</span><span class="m8-row-value">${c.houses != null ? c.houses.toLocaleString('nl-NL') : dash}</span></div>
          <div class="m8-row"><span class="m8-row-label">Geschat aantal bewoners</span><span class="m8-row-value">${c.people != null ? Math.round(c.people).toLocaleString('nl-NL') : dash}</span></div>
          <div class="m8-hinder-matrix">
            <span class="m8-hinder-matrix-title">Geschatte hinder bij elk percentage</span>
            ${c.hinder
              .map(
                (h) => `<div class="m8-hinder-row">
              <span class="m8-hinder-pct">${h.pct}% <em>(${h.label})</em></span>
              <span class="m8-hinder-num">${h.people != null ? Math.round(h.people).toLocaleString('nl-NL') : dash}</span>
            </div>`
              )
              .join('')}
          </div>
        </div>`
        )
        .join('');
      return `
      <div class="m8-card m8-${r.scenario}">
        <span class="m8-card-title">${M8_SCENARIO_LABEL[r.scenario]}</span>
        ${catBlocks}
      </div>`;
    })
    .join('');

  if (tableBody) {
    if (n === 0) {
      tableBody.innerHTML = `<tr><td colspan="8" class="empty-row">Plaats een turbine op de kaart en klik op "Woningen ophalen (BAG)".</td></tr>`;
    } else {
      const dash = '—';
      tableBody.innerHTML = rows
        .flatMap((r) =>
          r.categories.map((c, idx) => {
            const hinderCells = c.hinder
              .map((h) => `<td>${h.people != null ? Math.round(h.people).toLocaleString('nl-NL') : dash}</td>`)
              .join('');
            return `<tr>
            <td>${idx === 0 ? M8_SCENARIO_LABEL[r.scenario] : ''}</td>
            <td>${c.label}</td>
            <td>${m8RingLabelMulti(c.ring, c.ringUp, c.ringCross)}</td>
            <td>${c.houses != null ? c.houses.toLocaleString('nl-NL') : dash}</td>
            <td>${c.people != null ? Math.round(c.people).toLocaleString('nl-NL') : dash}</td>
            ${hinderCells}
          </tr>`;
          })
        )
        .join('');
    }
  }

  renderModule8Jaarnorm();
  renderModule8a();
  renderModule9();
  renderModule10();
  renderModule11();
  renderModule13();
}

// Weergave van m8JaarnormRows() (3 categorieën apart) + de stilstandnachten-simulatie eronder.
// Zie functiecommentaar bij m8JaarnormRows()/m8JaargemiddeldeMetStilstand() hierboven voor de rekenmethode.
function renderModule8Jaarnorm() {
  const nachtenEl = document.getElementById('m8-jaarnorm-nachtenverdeling');
  const container = document.getElementById('m8-jaarnorm-container');
  const stilInput = document.getElementById('m8-stilstand-input');
  const stilContainer = document.getElementById('m8-stilstand-container');
  if (!container) return;
  const n = state.turbines3a.length;
  const norm = getActiveNorm();
  if (n === 0) {
    if (nachtenEl) nachtenEl.innerHTML = '';
    container.innerHTML = `<p class="empty-row">Plaats minstens één turbine op de kaart in Module 3.</p>`;
    if (stilContainer) stilContainer.innerHTML = '';
    return;
  }
  if (norm.lnight == null) {
    if (nachtenEl) nachtenEl.innerHTML = '';
    container.innerHTML = `<p class="empty-row">De geselecteerde norm (${escapeHtml(norm.label)}) heeft geen Lnight-waarde — jaargemiddelde toetsing is hiermee niet mogelijk.</p>`;
    if (stilContainer) stilContainer.innerHTML = '';
    return;
  }
  const catResults = {};
  JAARNORM_CATEGORIES.forEach((cat) => { catResults[cat.key] = m8JaarnormRows(cat.key); });
  const base = catResults.hoorbaar;
  if (!base) {
    container.innerHTML = `<p class="empty-row">Geen gegevens.</p>`;
    if (stilContainer) stilContainer.innerHTML = '';
    return;
  }
  const { pct, anchor } = base;
  const nachten = m8NachtenVanPct(pct);

  // ---- Nachtenverdeling: hoe de 365 nachten per jaar over de drie scenario's verdeeld zijn ----
  if (nachtenEl) {
    nachtenEl.innerHTML = `
      <p class="hint">Voor deze turbinepositie (${anchor.isDefault ? 'standaardlocatie' : `${pct.distKm.toFixed(0)} km landinwaarts`}, Module 6): van de ${M8_JAAR_NACHTEN} nachten per jaar zijn er naar schatting <strong>${nachten.nBest} best case</strong> (${pct.best.toFixed(1)}%), <strong>${nachten.nMiddel} middel</strong> (${pct.middel.toFixed(1)}%) en <strong>${nachten.nWorst} worst case</strong> (${pct.worst.toFixed(1)}%).</p>
      <div class="m8-nachten-bar" role="img" aria-label="Nachtenverdeling per jaar: ${pct.best.toFixed(1)}% best case, ${pct.middel.toFixed(1)}% middel, ${pct.worst.toFixed(1)}% worst case">
        <span class="m8-nachten-seg m8-nachten-best" style="width:${pct.best}%" title="Best case: ${nachten.nBest} nachten"></span>
        <span class="m8-nachten-seg m8-nachten-middel" style="width:${pct.middel}%" title="Middel: ${nachten.nMiddel} nachten"></span>
        <span class="m8-nachten-seg m8-nachten-worst" style="width:${pct.worst}%" title="Worst case: ${nachten.nWorst} nachten"></span>
      </div>
      <div class="m8-nachten-legend">
        <span><i class="m8-nachten-dot m8-nachten-best"></i>Best case</span>
        <span><i class="m8-nachten-dot m8-nachten-middel"></i>Middel</span>
        <span><i class="m8-nachten-dot m8-nachten-worst"></i>Worst case</span>
      </div>`;
  }

  // ---- Drie categorietabellen (hoorbaar / laagfrequent / infrasoon), bewust niet samengevoegd ----
  container.innerHTML = JAARNORM_CATEGORIES.map((cat) => {
    const result = catResults[cat.key];
    const rowsHtml = result.rows.map((r) => {
      if (r.ring == null) {
        return `<tr><td>${M8_SCENARIO_LABEL[r.scenario]}-ring</td><td>${r.directionLabel}</td><td colspan="4" class="empty-row">Geen overschrijding op de vaste ringen.</td></tr>`;
      }
      return `<tr class="${r.exceeds ? 'm8-jaarnorm-exceeds' : 'm8-jaarnorm-ok'}">
        <td>${M8_SCENARIO_LABEL[r.scenario]}-ring</td>
        <td>${r.directionLabel}</td>
        <td>${m8RingLabel(r.ring)}</td>
        <td>${r.levels.best.toFixed(1)} / ${r.levels.middel.toFixed(1)} / ${r.levels.worst.toFixed(1)} ${cat.unit}</td>
        <td><strong>${r.jaargemiddelde.toFixed(1)} ${cat.unit}</strong></td>
        <td>${r.exceeds ? 'Overschrijding' : 'Binnen de norm'}</td>
      </tr>`;
    }).join('');
    return `<div class="data-table-card m8-jaarnorm-cat-card">
      <h3>${cat.label} (${cat.unit})${cat.indicatief ? ' <span class="m8a-subhead">— indicatief referentiepunt, geen wettelijke norm</span>' : ''}</h3>
      <div class="cum-result-wrap">
        <table class="data-table m8-jaarnorm-table">
          <thead>
            <tr><th>Ring (bepaald door)</th><th>Richting</th><th>Afstand</th><th>L best / middel / worst</th><th>Jaargemiddelde</th><th>Toetsing jaargemiddelde</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  // ---- Stilstandnachten: invoer + effect op het jaargemiddelde, per categorie op de worst-case-ring ----
  // Beperkt tot de worst-case-ring (× 3 richtingen × 3 categorieën = 9 vergelijkingsrijen) — dit is de
  // ring die eerder in dit model als de beleidsmatig relevante (conservatieve) ring is toegelicht;
  // alle drie scenario's per richting laten zien zou het jaargemiddelde nodeloos negen keer herhalen.
  if (stilInput && document.activeElement !== stilInput) {
    stilInput.value = String(state.m8StilstandNachten);
  }
  if (stilContainer) {
    const stilX = state.m8StilstandNachten;
    const verdeling = m8VerdeelStilstand(nachten, stilX);
    const verdelingHtml = stilX > 0
      ? `<p class="hint">Bij <strong>${stilX} stilstandnacht${stilX === 1 ? '' : 'en'}</strong> per jaar (eerst worst case, dan middel, dan best case stilgezet): ${nachten.nWorst} → <strong>${verdeling.nWorst}</strong> worst case, ${nachten.nMiddel} → <strong>${verdeling.nMiddel}</strong> middel, ${nachten.nBest} → <strong>${verdeling.nBest}</strong> best case, plus <strong>${verdeling.nStil}</strong> stilstandnachten (0 dB turbinebijdrage).</p>`
      : `<p class="hint">Vul hierboven een aantal stilstandnachten per jaar in om het effect op het jaargemiddelde te zien.</p>`;
    const tablesHtml = JAARNORM_CATEGORIES.map((cat) => {
      const result = catResults[cat.key];
      const worstRows = result.rows.filter((r) => r.scenario === 'worst');
      const rowsHtml = worstRows.map((r) => {
        if (r.ring == null || r.levels == null) {
          return `<tr><td>${r.directionLabel}</td><td colspan="3" class="empty-row">Geen overschrijding op de vaste ringen.</td></tr>`;
        }
        const na = m8JaargemiddeldeMetStilstand(r.levels, pct, stilX);
        const verschil = r.jaargemiddelde - na.jaargemiddelde;
        const verbeterd = verschil > 0.05;
        return `<tr>
          <td>${r.directionLabel}</td>
          <td>${r.jaargemiddelde.toFixed(1)} ${cat.unit}</td>
          <td><strong>${na.jaargemiddelde.toFixed(1)} ${cat.unit}</strong></td>
          <td class="${verbeterd ? 'm8-stil-verbetering' : ''}">${verbeterd ? '−' + verschil.toFixed(1) : '0,0'} ${cat.unit}</td>
        </tr>`;
      }).join('');
      const chartSeries = worstRows
        .filter((r) => r.ring != null && r.levels != null)
        .map((r) => ({
          label: r.directionLabel,
          color: M8_CHART_COLORS[r.direction],
          points: m8StilstandCurvePoints(r.levels, pct, nachten),
        }));
      const chartHtml = chartSeries.length > 0
        ? `<div class="m8-chart-wrap">
            ${m8StilstandChartSvg(chartSeries, norm.lnight, cat.indicatief, cat.unit, stilX)}
            <div class="m8-chart-legend">
              ${chartSeries.map((s) => `<span><i class="m8-chart-dot" style="background:${s.color}"></i>${s.label}</span>`).join('')}
              ${norm.lnight != null ? `<span><i class="m8-chart-dot m8-chart-dot-norm"></i>Norm${cat.indicatief ? ' (indicatief)' : ''}</span>` : ''}
            </div>
            <p class="hint m8-chart-caption">Jaargemiddelde (${cat.unit}) op de worst-case-ring, per richting, bij 0 t/m 365 stilstandnachten per jaar. De stip markeert de huidige invoer (${stilX} nacht${stilX === 1 ? '' : 'en'}).</p>
          </div>`
        : '';
      return `<div class="data-table-card m8-jaarnorm-cat-card">
        <h3>${cat.label} (${cat.unit}) — worst-case-ring${cat.indicatief ? ' <span class="m8a-subhead">— indicatief referentiepunt</span>' : ''}</h3>
        ${chartHtml}
        <div class="cum-result-wrap">
          <table class="data-table m8-jaarnorm-table">
            <thead><tr><th>Richting</th><th>Jaargemiddelde (huidig)</th><th>Jaargemiddelde (met stilstand)</th><th>Verschil</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
    }).join('');
    stilContainer.innerHTML = verdelingHtml + tablesHtml;
  }
}

// ==================== MODULE 9: geschatte zorgkosten ====================
// Hergebruikt de bewonersaantallen die m8ComputeRows() per scenario/categorie/hinderpercentage
// al berekent (zie Module 8) en past daarop het kostenkengetal toe uit de kostenmodule ("Module 2")
// van het referentiemodel https://waardedaling-geluidshinder-windturbines.onrender.com/.
const M9_DEFAULT_COST = 609.60;
const M9_DEFAULT_HORIZON = 25;

function m9Fmt(n) {
  return n == null || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('nl-NL');
}
function m9FmtEuro(n) {
  return n == null || Number.isNaN(n) ? '—' : '€' + Math.round(n).toLocaleString('nl-NL');
}

function renderModule9() {
  const grid = document.getElementById('m9-grid');
  const tableBody = document.getElementById('m9-table-body');
  if (!grid) return;

  const costInput = document.getElementById('m9-cost-per-person');
  const horizonInput = document.getElementById('m9-horizon');
  if (costInput && document.activeElement !== costInput) costInput.value = state.m9CostPerPersonYear;
  if (horizonInput && document.activeElement !== horizonInput) horizonInput.value = state.m9Horizon;

  const n = state.turbines3a.length;
  const hasData = !!state.m8AddressData;
  const rows = m8ComputeRows();
  const costPerPerson = state.m9CostPerPersonYear;
  const horizon = state.m9Horizon;

  const withCost = rows.map((r) => ({
    scenario: r.scenario,
    categories: r.categories.map((c) => ({
      ...c,
      hinder: c.hinder.map((h) => ({
        ...h,
        costYear: h.people != null ? h.people * costPerPerson : null,
        costHorizon: h.people != null ? h.people * costPerPerson * horizon : null,
      })),
    })),
  }));

  const totalsTextEl = document.getElementById('m9-totals-text');
  if (totalsTextEl) {
    if (n === 0 || !hasData) {
      totalsTextEl.innerHTML = '<em>Nog geen gegevens \u2014 zie Module 8.</em>';
    } else {
      totalsTextEl.innerHTML = withCost
        .map((r) => {
          const catLines = r.categories
            .map((c) => {
              const pctTxt = c.hinder
                .map((h) => `${h.pct}%: ${m9Fmt(h.people)} bewoners \u2014 ${m9FmtEuro(h.costHorizon)} over ${horizon} jaar (${m9FmtEuro(h.costYear)}/jaar)`)
                .join('; ');
              return `<div>${c.label}: ${pctTxt}</div>`;
            })
            .join('');
          return `<div class="m9-totals-line"><strong>${M8_SCENARIO_LABEL[r.scenario]}</strong>${catLines}</div>`;
        })
        .join('');
    }
  }

  if (n === 0 || !hasData) {
    grid.innerHTML = `<p class="hint">${n === 0 ? 'Plaats minstens één turbine op de kaart in Module 3.' : 'Haal eerst BAG-woninggegevens op bij Module 8 om de kosten te kunnen berekenen.'}</p>`;
  } else {
    grid.innerHTML = withCost
      .map((r) => {
        const catBlocks = r.categories
          .map(
            (c) => `
          <div class="m9-cat-block">
            <span class="m9-cat-title">${c.label}</span>
            <div class="m9-cost-matrix">
              ${c.hinder
                .map(
                  (h) => `<div class="m9-cost-row">
                <span class="m9-cost-pct">${h.pct}% <em>(${h.label})</em> — ${m9Fmt(h.people)} bewoners</span>
                <div class="m9-cost-nums">
                  <span class="m9-cost-num">${m9FmtEuro(h.costYear)} <small>/jaar</small></span>
                  <span class="m9-cost-num sub">${m9FmtEuro(h.costHorizon)} <small>over ${horizon} jaar</small></span>
                </div>
              </div>`
                )
                .join('')}
            </div>
          </div>`
          )
          .join('');
        return `
        <div class="m9-card m9-${r.scenario}">
          <span class="m9-card-title">${M8_SCENARIO_LABEL[r.scenario]}</span>
          ${catBlocks}
        </div>`;
      })
      .join('');
  }

  if (tableBody) {
    if (n === 0 || !hasData) {
      tableBody.innerHTML = `<tr><td colspan="6" class="empty-row">${n === 0 ? 'Plaats een turbine op de kaart in Module 3.' : 'Haal eerst BAG-gegevens op bij Module 8.'}</td></tr>`;
    } else {
      tableBody.innerHTML = withCost
        .flatMap((r) =>
          r.categories.flatMap((c) =>
            c.hinder.map((h, hIdx) => `<tr>
              <td>${c === r.categories[0] && hIdx === 0 ? M8_SCENARIO_LABEL[r.scenario] : ''}</td>
              <td>${hIdx === 0 ? c.label : ''}</td>
              <td>${h.pct}% (${h.label})</td>
              <td>${m9Fmt(h.people)}</td>
              <td>${m9FmtEuro(h.costYear)}</td>
              <td>${m9FmtEuro(h.costHorizon)}</td>
            </tr>`)
          )
        )
        .join('');
    }
  }
}

// ==================== MODULE 10: DALY-berekening ====================
// Zet dezelfde bewonersaantallen (Module 8) om in Disability-Adjusted Life Years, met de
// WHO Europe (2024)-disability-weights en drie Nederlandse monetaire DALY-waarden
// (RIVM/PBL/Zorginstituut Nederland) — methodologie van de DALY-module ("Module 3") van het
// referentiemodel https://waardedaling-geluidshinder-windturbines.onrender.com/.
const M10_DW_SLAAP = 0.010;
const M10_DW_HINDER = 0.011;
const M10_VALUES = [
  { key: 'rivm', label: 'RIVM', euro: 50000 },
  { key: 'pbl', label: 'PBL', euro: 70000 },
  { key: 'zin', label: 'Zorginstituut NL', euro: 80000 },
];

function m10FmtDaly(n) {
  return n == null || Number.isNaN(n) ? '—' : n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderModule10() {
  const grid = document.getElementById('m10-grid');
  const tableBody = document.getElementById('m10-table-body');
  if (!grid) return;

  const horizonReadout = document.getElementById('m10-horizon-readout');
  const horizon = state.m9Horizon;
  if (horizonReadout) horizonReadout.textContent = horizon;

  const n = state.turbines3a.length;
  const hasData = !!state.m8AddressData;
  const rows = m8ComputeRows();
  const dwTotal = M10_DW_SLAAP + M10_DW_HINDER;

  const withDaly = rows.map((r) => ({
    scenario: r.scenario,
    categories: r.categories.map((c) => ({
      ...c,
      hinder: c.hinder.map((h) => {
        const dalyYear = h.people != null ? h.people * dwTotal : null;
        const dalyHorizon = dalyYear != null ? dalyYear * horizon : null;
        const values = M10_VALUES.map((v) => ({
          ...v,
          euroYear: dalyYear != null ? dalyYear * v.euro : null,
          euroHorizon: dalyHorizon != null ? dalyHorizon * v.euro : null,
        }));
        return { ...h, dalyYear, dalyHorizon, values };
      }),
    })),
  }));

  const totalsTextEl = document.getElementById('m10-totals-text');
  if (totalsTextEl) {
    if (n === 0 || !hasData) {
      totalsTextEl.innerHTML = '<em>Nog geen gegevens \u2014 zie Module 8.</em>';
    } else {
      totalsTextEl.innerHTML = withDaly
        .map((r) => {
          const catLines = r.categories
            .map((c) => {
              const pctTxt = c.hinder
                .map((h) => `${h.pct}%: ${m9Fmt(h.people)} bewoners \u2014 ${m10FmtDaly(h.dalyHorizon)} DALY over ${horizon} jaar (${m10FmtDaly(h.dalyYear)}/jaar)`)
                .join('; ');
              return `<div>${c.label}: ${pctTxt}</div>`;
            })
            .join('');
          return `<div class="m10-totals-line"><strong>${M8_SCENARIO_LABEL[r.scenario]}</strong>${catLines}</div>`;
        })
        .join('');
    }
  }

  if (n === 0 || !hasData) {
    grid.innerHTML = `<p class="hint">${n === 0 ? 'Plaats minstens één turbine op de kaart in Module 3.' : 'Haal eerst BAG-woninggegevens op bij Module 8 om de DALY-berekening te kunnen maken.'}</p>`;
  } else {
    grid.innerHTML = withDaly
      .map((r) => {
        const catBlocks = r.categories
          .map(
            (c) => `
          <div class="m10-cat-block">
            <span class="m10-cat-title">${c.label}</span>
            <div class="m10-daly-matrix">
              ${c.hinder
                .map(
                  (h) => `<div class="m10-daly-row">
                <span class="m10-daly-pct">${h.pct}% <em>(${h.label})</em> — ${m9Fmt(h.people)} bewoners</span>
                <div class="m10-daly-nums">
                  <span class="m10-daly-num">${m10FmtDaly(h.dalyYear)} DALY <small>/jaar</small></span>
                  <span class="m10-daly-num sub">${m10FmtDaly(h.dalyHorizon)} DALY <small>over ${horizon} jaar</small></span>
                </div>
                <div class="m10-value-grid">
                  ${h.values.map((v) => `<span class="m10-value-chip">${v.label} ${m9FmtEuro(v.euroHorizon)} <small>(${horizon}j)</small></span>`).join('')}
                </div>
              </div>`
                )
                .join('')}
            </div>
          </div>`
          )
          .join('');
        return `
        <div class="m10-card m10-${r.scenario}">
          <span class="m10-card-title">${M8_SCENARIO_LABEL[r.scenario]}</span>
          ${catBlocks}
        </div>`;
      })
      .join('');
  }

  if (tableBody) {
    if (n === 0 || !hasData) {
      tableBody.innerHTML = `<tr><td colspan="12" class="empty-row">${n === 0 ? 'Plaats een turbine op de kaart in Module 3.' : 'Haal eerst BAG-gegevens op bij Module 8.'}</td></tr>`;
    } else {
      tableBody.innerHTML = withDaly
        .flatMap((r) =>
          r.categories.flatMap((c) =>
            c.hinder.map((h, hIdx) => {
              const valueCells = h.values
                .flatMap((v) => [`<td>${m9FmtEuro(v.euroYear)}</td>`, `<td>${m9FmtEuro(v.euroHorizon)}</td>`])
                .join('');
              return `<tr>
                <td>${c === r.categories[0] && hIdx === 0 ? M8_SCENARIO_LABEL[r.scenario] : ''}</td>
                <td>${hIdx === 0 ? c.label : ''}</td>
                <td>${h.pct}% (${h.label})</td>
                <td>${m9Fmt(h.people)}</td>
                <td>${m10FmtDaly(h.dalyYear)}</td>
                <td>${m10FmtDaly(h.dalyHorizon)}</td>
                ${valueCells}
              </tr>`;
            })
          )
        )
        .join('');
    }
  }
}

// ==================== MODULE 11: waardedaling woningen (Droës & Koster 2021) ====================
// Neemt de percentagetabel en de 4%-NMR-splitsing over van het referentiemodel
// https://waardedaling-geluidshinder-windturbines.onrender.com/ ("Module 1"), gebaseerd op
// Droës & Koster (2021), Energy Policy 155, 112327 (https://doi.org/10.1016/j.enpol.2021.112327).
// Anders dan dat referentiemodel (CBS-buurtoppervlakte-toerekening) gebruikt deze module de unieke
// BAG-adressen die Module 8 hierboven al ophaalt: per adres wordt de afstand tot de dichtstbijzijnde
// geplaatste turbine bepaald, zodat bij overlap van meerdere turbines automatisch het sterkste effect
// (kortste afstand) telt, zonder dubbeltelling — zie de "Herkomst"-callout onder Module 11 in index.html.
const M11_CATEGORY_META = {
  laag: { label: 'Laag (<50 m tiphoogte)', radius: 1000, flatPct: 1.0 },
  midden: { label: 'Midden (50–150 m tiphoogte)', radius: 2000, flatPct: 3.0 },
  hoog: { label: 'Hoog (>150 m tiphoogte)', radius: 2000, flatPct: 5.4 },
};
// Alleen gepubliceerd voor de categorie "Hoog" (Fig. 6 van Droës & Koster 2021) — van de figuur afgelezen.
const M11_DISTANCE_BANDS = [
  { lo: 0, hi: 1000, pct: 8.3, label: '≤ 1.000 m' },
  { lo: 1000, hi: 1500, pct: 6.0, label: '1.000–1.500 m' },
  { lo: 1500, hi: 2000, pct: 4.0, label: '1.500–2.000 m' },
  { lo: 2000, hi: 2500, pct: 2.5, label: '2.000–2.500 m' },
];
const M11_BAND_MAX_RADIUS = 2500;
// Vaste jurisprudentie Afdeling bestuursrechtspraak Raad van State: waardedaling tot 2–4% is normaal
// maatschappelijk risico (NMR) bij planschade. Referentiemodel hanteert 4% als vaste grens.
const M11_NMR_THRESHOLD = 4.0;

// Retourneert, voor elk unieke BAG-adres binnen het toepasselijke bereik, de afstand tot de
// DICHTSTBIJZIJNDE geplaatste turbine ("sterkste effect telt, geen dubbeltelling" — zoals in het referentiemodel).
function m11AddressMinDistances() {
  if (!state.m8AddressData) return null;
  const meta = M11_CATEGORY_META[state.m11Category];
  const useBand = state.m11Category === 'hoog' && state.m11Method === 'band';
  const maxRadius = useBand ? M11_BAND_MAX_RADIUS : meta.radius;
  const distByAddr = new Map();
  state.turbines3a.forEach((t) => {
    const addrs = state.m8AddressData.byTurbine.get(t.id) || [];
    addrs.forEach((a) => {
      const d = haversineMeters(t.lat, t.lng, a.lat, a.lon);
      if (d <= maxRadius) {
        const id = a.id || `${a.lat.toFixed(6)},${a.lon.toFixed(6)}`;
        const prev = distByAddr.get(id);
        if (prev == null || d < prev) distByAddr.set(id, d);
      }
    });
  });
  return Array.from(distByAddr.values());
}

// Bouwt de rij-per-rij uitsplitsing (één rij voor Methode A, vier afstandsbanden voor Methode B)
// inclusief de 4%-NMR-splitsing in eigen risico / compensabele planschade, plus het totaal.
function m11ComputeResult() {
  const hasData = !!state.m8AddressData;
  const n = state.turbines3a.length;
  if (n === 0 || !hasData) return { hasData: false, n };
  const meta = M11_CATEGORY_META[state.m11Category];
  const useBand = state.m11Category === 'hoog' && state.m11Method === 'band';
  const distances = m11AddressMinDistances() || [];
  const woz = state.m11Woz || 0;

  let rows;
  if (useBand) {
    rows = M11_DISTANCE_BANDS.map((b) => ({
      label: b.label,
      pct: b.pct,
      woningen: distances.filter((d) => d > b.lo && d <= b.hi).length,
    }));
  } else {
    rows = [{ label: `Binnen invloedscirkel (\u2264 ${meta.radius.toLocaleString('nl-NL')} m)`, pct: meta.flatPct, woningen: distances.length }];
  }

  let totWoningen = 0, totWaarde = 0, totEigen = 0, totCompensabel = 0;
  rows = rows.map((r) => {
    const waarde = r.woningen * woz * (r.pct / 100);
    const eigen = r.woningen * woz * (Math.min(r.pct, M11_NMR_THRESHOLD) / 100);
    const compensabel = r.woningen * woz * (Math.max(0, r.pct - M11_NMR_THRESHOLD) / 100);
    totWoningen += r.woningen; totWaarde += waarde; totEigen += eigen; totCompensabel += compensabel;
    return { ...r, waarde, eigen, compensabel };
  });

  return {
    hasData: true, n, method: useBand ? 'band' : 'vlak', meta, rows,
    totals: { woningen: totWoningen, waarde: totWaarde, eigen: totEigen, compensabel: totCompensabel },
  };
}

// ---------- Module 11: TNO-vergelijking (CBS-vierkanten 100x100 m, live via PDOK) ----------
// Repliceert de operationalisatie van TNO (2022), "De verwachte impact van windturbines op
// huizenprijzen in Nederland" (p. 13, 18-19): Nederland ingedeeld in vierkanten van 100x100 m,
// woningen per vierkant gerepresenteerd door het middelpunt, bij overlap telt de turbine met het
// hoogste ontwaardingspercentage, en vierkanten met te weinig woningen voor CBS-publicatie
// (privacy) krijgen een aangenomen 3 woningen (wet van Benford). Dient als vergelijking naast de
// nauwkeurigere BAG-hoofdmethode hierboven — zie Beperkingen-callout, punt 1 en 8.
// Jaargang 2024 van deze PDOK-dataset publiceert nog geen gemiddelde WOZ-waarde per vierkant
// (veld staat overal op -99995, ook in dichtbebouwde gebieden — zelf gecontroleerd via de PDOK-API);
// 2023 is de meest recente jaargang met zowel het woningaantal als de WOZ-waarde gevuld.
const M11_CBS_JAARCODE = 2023;
const M11_CBS_MAX_PAGES = 30; // 30 x limit=1000 = ruim voldoende voor een bbox van ~5x5 km per turbine
const M11_CBS_ASSUMED_SUPPRESSED_WONINGEN = 3;

async function m11CbsFetchSquaresForTurbine(turbine, radiusM, squaresById) {
  const lat = turbine.lat, lng = turbine.lng;
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [(lng - dLon).toFixed(6), (lat - dLat).toFixed(6), (lng + dLon).toFixed(6), (lat + dLat).toFixed(6)].join(',');
  let url = `https://api.pdok.nl/cbs/vierkantstatistieken100m/ogc/v1/collections/vierkant100/items?bbox=${bbox}&limit=1000&f=json&jaarcode=${M11_CBS_JAARCODE}`;
  let pages = 0;
  let truncated = false;
  while (url && pages < M11_CBS_MAX_PAGES) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      truncated = true;
      break;
    }
    if (!res.ok) { truncated = true; break; }
    const data = await res.json();
    (data.features || []).forEach((f) => {
      const p = f.properties || {};
      const id = p.crs28992res100m;
      if (!id || squaresById.has(id)) return;
      const geom = f.geometry;
      let clat = null, clon = null;
      if (geom && geom.coordinates && geom.coordinates[0] && geom.coordinates[0][0]) {
        const ring = geom.coordinates[0][0];
        let sumLon = 0, sumLat = 0, cnt = 0;
        for (let i = 0; i < ring.length - 1; i++) { sumLon += ring[i][0]; sumLat += ring[i][1]; cnt++; } // laatste punt = eerste (gesloten ring), overslaan
        if (cnt > 0) { clon = sumLon / cnt; clat = sumLat / cnt; }
      }
      if (clat == null) return;
      const woningenRaw = p.aantal_woningen;
      const wozRaw = p.gemiddelde_woz_waarde_woning;
      squaresById.set(id, {
        lat: clat,
        lon: clon,
        woningen: (woningenRaw != null && woningenRaw >= 0) ? woningenRaw : null,
        woz: (wozRaw != null && wozRaw >= 0) ? wozRaw * 1000 : null, // CBS publiceert dit veld in duizend euro
      });
    });
    const next = (data.links || []).find((l) => l.rel === 'next');
    url = next ? next.href : null;
    pages++;
  }
  if (url) truncated = true;
  return truncated;
}

// Haalt de CBS-vierkanten op (of hergebruikt ze als de eerdere ophaling nog actueel is voor de
// huidige turbine-plaatsing) \u2014 gedeeld tussen de TNO-vergelijkingstabel en de automatische
// lokale/regionale WOZ-ophaling hieronder, zodat beide functies dezelfde PDOK-gegevens hergebruiken
// in plaats van dubbel op te halen.
async function m11EnsureCbsSquares() {
  const snapshot = m8TurbineSnapshot();
  if (state.m11CbsData && state.m11CbsData.turbineSnapshot === snapshot) {
    return state.m11CbsData;
  }
  const squaresById = new Map();
  let anyTruncated = false;
  for (const t of state.turbines3a) {
    const truncated = await m11CbsFetchSquaresForTurbine(t, M11_BAND_MAX_RADIUS, squaresById);
    if (truncated) anyTruncated = true;
  }
  state.m11CbsData = {
    squares: squaresById,
    turbineSnapshot: snapshot,
    truncated: anyTruncated,
    fetchedAt: new Date(),
  };
  return state.m11CbsData;
}

async function m11CbsRunFetch() {
  const n = state.turbines3a.length;
  if (n === 0) {
    state.m11CbsError = 'Plaats minstens \u00e9\u00e9n turbine op de kaart in Module 3 om CBS-vierkanten op te halen.';
    renderModule11();
    return;
  }
  state.m11CbsFetching = true;
  state.m11CbsError = null;
  renderModule11();
  try {
    await m11EnsureCbsSquares();
  } catch (e) {
    state.m11CbsError = 'Ophalen van CBS-vierkanten bij PDOK is mislukt. Probeer het later opnieuw.';
  } finally {
    state.m11CbsFetching = false;
    renderModule11();
  }
}

// Automatische lokale/regionale WOZ-ophaling: woningen-gewogen gemiddelde van de niet-afgeschermde
// CBS-vierkant-WOZ-waarden binnen 2.500 m van de geplaatste turbine(s), ter vervanging van het
// landelijke standaardcijfer in het WOZ-invoerveld hierboven.
async function m11FetchLocalWoz() {
  const n = state.turbines3a.length;
  if (n === 0) {
    state.m11WozAutoError = 'Plaats minstens \u00e9\u00e9n turbine op de kaart in Module 3 om dit te gebruiken.';
    renderModule11();
    return;
  }
  state.m11WozFetching = true;
  state.m11WozAutoError = null;
  renderModule11();
  try {
    const data = await m11EnsureCbsSquares();
    let sumWeighted = 0, sumWoningen = 0, nSquares = 0;
    data.squares.forEach((sq) => {
      if (sq.woz == null) return; // afgeschermde WOZ-waarden tellen niet mee in het gemiddelde
      let minD = Infinity;
      state.turbines3a.forEach((t) => {
        const d = haversineMeters(t.lat, t.lng, sq.lat, sq.lon);
        if (d < minD) minD = d;
      });
      if (minD > M11_BAND_MAX_RADIUS) return;
      const w = sq.woningen != null ? sq.woningen : M11_CBS_ASSUMED_SUPPRESSED_WONINGEN;
      sumWeighted += w * sq.woz;
      sumWoningen += w;
      nSquares++;
    });
    if (sumWoningen === 0) {
      state.m11WozAutoError = 'Geen betrouwbare lokale WOZ-gegevens gevonden binnen 2.500 m van de geplaatste turbine(s) \u2014 mogelijk overwegend privacy-afgeschermde vierkanten, of de locatie ligt buiten Nederland. De huidige waarde is ongewijzigd gebleven.';
      state.m11WozAutoInfo = null;
    } else {
      const avg = Math.round((sumWeighted / sumWoningen) / 1000) * 1000;
      state.m11Woz = avg;
      state.m11WozAutoInfo = { avg, nSquares, nWoningen: Math.round(sumWoningen), turbineSnapshot: m8TurbineSnapshot(), fetchedAt: new Date() };
    }
  } catch (e) {
    state.m11WozAutoError = 'Ophalen van lokale WOZ-gegevens bij PDOK is mislukt. Probeer het later opnieuw.';
  } finally {
    state.m11WozFetching = false;
    renderModule11();
  }
}

function renderModule11WozAuto() {
  const btn = document.getElementById('m11-woz-auto-btn');
  const statusEl = document.getElementById('m11-woz-auto-status');
  if (!btn) return;
  const n = state.turbines3a.length;
  const busy = state.m11WozFetching || state.m11CbsFetching;
  btn.disabled = busy || n === 0;
  if (!statusEl) return;
  statusEl.className = 'hint';
  if (n === 0) {
    statusEl.textContent = 'Plaats minstens \u00e9\u00e9n turbine op de kaart in Module 3 om dit te gebruiken.';
  } else if (state.m11WozFetching) {
    statusEl.textContent = 'Bezig met ophalen van lokale WOZ-gegevens (CBS Vierkantstatistieken 100m, PDOK)...';
  } else if (state.m11WozAutoError) {
    statusEl.textContent = state.m11WozAutoError;
    statusEl.classList.add('m8-status-error');
  } else if (!state.m11WozAutoInfo) {
    statusEl.textContent = 'Nog niet opgehaald \u2014 klik op de knop hierboven om het lokale/regionale WOZ-gemiddelde automatisch in te vullen.';
  } else {
    const stale = state.m11WozAutoInfo.turbineSnapshot !== m8TurbineSnapshot();
    if (stale) {
      statusEl.textContent = 'Turbines zijn gewijzigd sinds het ophalen van de lokale WOZ-waarde \u2014 klik opnieuw op de knop voor een actueel gemiddelde.';
      statusEl.classList.add('m8-status-error');
    } else {
      const when = state.m11WozAutoInfo.fetchedAt.toLocaleTimeString('nl-NL');
      statusEl.textContent = `Automatisch ingevuld: \u20ac${state.m11WozAutoInfo.avg.toLocaleString('nl-NL')} \u2014 woningen-gewogen gemiddelde over ${state.m11WozAutoInfo.nSquares} CBS-vierkanten (${state.m11WozAutoInfo.nWoningen.toLocaleString('nl-NL')} woningen) binnen 2.500 m van de geplaatste turbine(s), jaargang ${M11_CBS_JAARCODE} (om ${when}). Je kunt dit hierboven nog handmatig aanpassen.`;
      statusEl.classList.add('m8-status-ok');
    }
  }
}

// Voor elk opgehaald CBS-vierkant: de afstand tot de dichtstbijzijnde turbine ("sterkste effect
// telt", net als bij TNO p.19 en bij de BAG-methode hierboven), gefilterd op het bereik dat bij
// de huidige categorie/methode hoort.
function m11CbsSquareRows() {
  if (!state.m11CbsData) return null;
  const meta = M11_CATEGORY_META[state.m11Category];
  const useBand = state.m11Category === 'hoog' && state.m11Method === 'band';
  const maxRadius = useBand ? M11_BAND_MAX_RADIUS : meta.radius;
  const out = [];
  state.m11CbsData.squares.forEach((sq) => {
    let minD = Infinity;
    state.turbines3a.forEach((t) => {
      const d = haversineMeters(t.lat, t.lng, sq.lat, sq.lon);
      if (d < minD) minD = d;
    });
    if (minD <= maxRadius) out.push({ ...sq, distance: minD });
  });
  return out;
}

// Zelfde optelling/4%-splitsing als m11ComputeResult(), maar op basis van CBS-vierkanten met TNO's
// imputatieregel voor privacy-onderdrukte vierkanten (aangenomen aantal / landelijke WOZ-fallback).
function m11CbsComputeResult() {
  const rowsSquares = m11CbsSquareRows();
  if (!rowsSquares) return { hasData: false };
  const meta = M11_CATEGORY_META[state.m11Category];
  const useBand = state.m11Category === 'hoog' && state.m11Method === 'band';
  const fallbackWoz = state.m11Woz || 0;
  const bands = useBand ? M11_DISTANCE_BANDS : [{ lo: 0, hi: meta.radius, pct: meta.flatPct }];

  let totWoningen = 0, totWaarde = 0, totEigen = 0, totCompensabel = 0;
  bands.forEach((b) => {
    rowsSquares
      .filter((s) => s.distance > b.lo && s.distance <= b.hi)
      .forEach((s) => {
        const woningen = s.woningen != null ? s.woningen : M11_CBS_ASSUMED_SUPPRESSED_WONINGEN;
        const woz = s.woz != null ? s.woz : fallbackWoz;
        totWoningen += woningen;
        totWaarde += woningen * woz * (b.pct / 100);
        totEigen += woningen * woz * (Math.min(b.pct, M11_NMR_THRESHOLD) / 100);
        totCompensabel += woningen * woz * (Math.max(0, b.pct - M11_NMR_THRESHOLD) / 100);
      });
  });

  return { hasData: true, nSquares: rowsSquares.length, totals: { woningen: totWoningen, waarde: totWaarde, eigen: totEigen, compensabel: totCompensabel } };
}

function renderModule11CbsComparison() {
  const fetchBtn = document.getElementById('m11-cbs-fetch-btn');
  const statusEl = document.getElementById('m11-cbs-status');
  const tableWrap = document.getElementById('m11-cbs-table-wrap');
  const tableBody = document.getElementById('m11-cbs-table-body');
  const deltaEl = document.getElementById('m11-cbs-delta');
  if (!fetchBtn) return;

  const n = state.turbines3a.length;
  fetchBtn.disabled = state.m11CbsFetching || state.m11WozFetching || n === 0;

  if (statusEl) {
    statusEl.className = 'hint';
    if (n === 0) {
      statusEl.textContent = 'Plaats minstens \u00e9\u00e9n turbine op de kaart in Module 3 om deze vergelijking te gebruiken.';
    } else if (state.m11CbsFetching) {
      statusEl.textContent = `Bezig met ophalen van CBS-vierkanten (100\u00d7100 m, jaargang ${M11_CBS_JAARCODE}) rond ${n} turbine${n === 1 ? '' : 's'}...`;
    } else if (state.m11WozFetching) {
      statusEl.textContent = 'Bezig met ophalen van CBS-vierkanten via de WOZ-knop hierboven \u2014 deze vergelijking wordt daarna automatisch meteen bijgewerkt.';
    } else if (state.m11CbsError) {
      statusEl.textContent = state.m11CbsError;
      statusEl.classList.add('m8-status-error');
    } else if (!state.m11CbsData) {
      statusEl.textContent = 'Nog niet opgehaald \u2014 klik op "CBS-vierkanten ophalen" om de TNO-methode te berekenen.';
    } else {
      const stale = state.m11CbsData.turbineSnapshot !== m8TurbineSnapshot();
      if (stale) {
        statusEl.textContent = 'Turbines zijn gewijzigd sinds het ophalen van de CBS-vierkanten \u2014 klik opnieuw op de knop voor actuele cijfers.';
        statusEl.classList.add('m8-status-error');
      } else {
        const when = state.m11CbsData.fetchedAt.toLocaleTimeString('nl-NL');
        let txt = `${state.m11CbsData.squares.size} CBS-vierkanten opgehaald rond de geplaatste turbine(s) (om ${when}).`;
        if (state.m11CbsData.truncated) txt += ' Let op: het ophalen is afgekapt op de paginalimiet \u2014 het aantal kan onvolledig zijn.';
        statusEl.textContent = txt;
        statusEl.classList.add('m8-status-ok');
      }
    }
  }

  const bagResult = m11ComputeResult();
  const cbsResult = (state.m11CbsData && n > 0) ? m11CbsComputeResult() : { hasData: false };
  window.__m11CbsLastResult = cbsResult; // t.b.v. QA-scripts
  const showTable = bagResult.hasData || cbsResult.hasData;

  if (tableWrap) tableWrap.style.display = showTable ? '' : 'none';
  if (tableBody && showTable) {
    const rowHtml = (label, sub, res) => {
      if (!res.hasData) {
        return `<tr><td>${label}<br><span class="cat-tab-sub">${sub}</span></td><td colspan="4" class="empty-row">Nog geen gegevens.</td></tr>`;
      }
      const t = res.totals;
      return `<tr>
        <td>${label}<br><span class="cat-tab-sub">${sub}</span></td>
        <td>${Math.round(t.woningen).toLocaleString('nl-NL')}</td>
        <td>${m9FmtEuro(t.waarde)}</td>
        <td>${m9FmtEuro(t.eigen)}</td>
        <td>${m9FmtEuro(t.compensabel)}</td>
      </tr>`;
    };
    tableBody.innerHTML =
      rowHtml('BAG-adressen', 'hoofdmethode \u2014 adresniveau, geen imputatie', bagResult) +
      rowHtml('CBS-vierkanten', `TNO-methode \u2014 100\u00d7100 m, jaargang ${M11_CBS_JAARCODE}`, cbsResult);
  }

  if (deltaEl) {
    if (bagResult.hasData && cbsResult.hasData && bagResult.totals.waarde > 0) {
      const diff = cbsResult.totals.waarde - bagResult.totals.waarde;
      const pct = (diff / bagResult.totals.waarde) * 100;
      const richting = diff >= 0 ? 'hoger' : 'lager';
      deltaEl.textContent = `De TNO-methode (CBS-vierkanten) komt hier op een totale waardedaling die ${m9FmtEuro(Math.abs(diff))} (${Math.abs(pct).toFixed(1)}%) ${richting} uitvalt dan de BAG-hoofdmethode \u2014 het verschil komt door de middelpuntbenadering van vierkanten, de imputatie bij privacy-onderdrukte vierkanten en (waar van toepassing) het gebruik van het landelijke WOZ-gemiddelde in plaats van de lokale CBS-waarde.`;
    } else {
      deltaEl.textContent = '';
    }
  }
}

function renderModule11() {
  const catTabsEl = document.getElementById('m11-category-tabs');
  const methodTabsEl = document.getElementById('m11-method-tabs');
  const methodHint = document.getElementById('m11-method-hint');
  const wozInput = document.getElementById('m11-woz-input');
  const statusEl = document.getElementById('m11-status');
  const totalsText = document.getElementById('m11-totals-text');
  const kpiGrid = document.getElementById('m11-kpi-grid');
  const tableTitle = document.getElementById('m11-table-title');
  const tableBody = document.getElementById('m11-table-body');
  if (!catTabsEl) return;

  catTabsEl.querySelectorAll('[data-m11-category]').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.m11Category === state.m11Category ? 'true' : 'false');
  });
  if (methodTabsEl) {
    methodTabsEl.querySelectorAll('[data-m11-method]').forEach((btn) => {
      const isBand = btn.dataset.m11Method === 'band';
      if (isBand) btn.disabled = state.m11Category !== 'hoog';
      btn.setAttribute('aria-pressed', btn.dataset.m11Method === state.m11Method ? 'true' : 'false');
    });
  }
  if (methodHint) {
    methodHint.textContent = state.m11Category === 'hoog'
      ? 'Methode B (afstandsband) is alleen gepubliceerd voor de categorie Hoog.'
      : `Voor categorie ${M11_CATEGORY_META[state.m11Category].label} publiceert Dro\u00ebs & Koster (2021) geen afstandsbanden \u2014 alleen Methode A (vlak percentage) is beschikbaar.`;
  }
  if (wozInput && document.activeElement !== wozInput) wozInput.value = state.m11Woz;

  const n = state.turbines3a.length;
  const result = m11ComputeResult();
  window.__m11LastResult = result; // t.b.v. QA-scripts

  if (statusEl) {
    statusEl.className = 'hint';
    if (n === 0) {
      statusEl.textContent = 'Plaats minstens \u00e9\u00e9n turbine op de kaart in Module 3 om deze module te gebruiken.';
    } else if (!state.m8AddressData) {
      statusEl.textContent = 'Haal eerst de BAG-woningen op bij Module 8 ("Woningen ophalen (BAG)") \u2014 deze module hergebruikt die adressen.';
      statusEl.classList.add('m8-status-error');
    } else {
      const stale = state.m8AddressData.turbineSnapshot !== m8TurbineSnapshot();
      statusEl.textContent = stale
        ? 'Turbines zijn gewijzigd sinds de BAG-ophaling in Module 8 \u2014 klik daar opnieuw op "Woningen ophalen (BAG)" voor actuele aantallen.'
        : `Berekening op basis van de ${M11_CATEGORY_META[state.m11Category].label.toLowerCase()}, ${result.method === 'band' ? 'Methode B (afstandsband)' : 'Methode A (vlak percentage)'}, en de unieke BAG-adressen uit Module 8.`;
      statusEl.classList.add(stale ? 'm8-status-error' : 'm8-status-ok');
    }
  }

  const dash = '\u2014';
  if (totalsText) {
    if (!result.hasData) {
      totalsText.innerHTML = '<em>Nog geen gegevens \u2014 plaats turbines, haal de BAG-woningen op in Module 8 en stel de WOZ-waarde in.</em>';
    } else {
      const t = result.totals;
      totalsText.innerHTML = `<div class="m11-totals-line"><strong>${t.woningen.toLocaleString('nl-NL')} geraakte woningen</strong> \u00d7 gem. WOZ \u20ac${Math.round(state.m11Woz).toLocaleString('nl-NL')} \u2192 totale waardedaling <strong>${m9FmtEuro(t.waarde)}</strong>, waarvan <strong>${m9FmtEuro(t.eigen)}</strong> eigen risico (NMR \u2264${M11_NMR_THRESHOLD}%) en <strong>${m9FmtEuro(t.compensabel)}</strong> potentieel compensabele planschade (>${M11_NMR_THRESHOLD}%).</div>`;
    }
  }

  if (kpiGrid) {
    if (!result.hasData) {
      kpiGrid.innerHTML = '';
    } else {
      const t = result.totals;
      const gemPerWoning = t.woningen > 0 ? t.waarde / t.woningen : 0;
      kpiGrid.innerHTML = `
        <div class="m11-kpi-card m11-kpi-woningen"><span class="m11-kpi-label">Geraakte woningen</span><span class="m11-kpi-value">${t.woningen.toLocaleString('nl-NL')}</span><span class="m11-kpi-sub">unieke BAG-adressen</span></div>
        <div class="m11-kpi-card m11-kpi-totaal"><span class="m11-kpi-label">Totale waardedaling</span><span class="m11-kpi-value">${m9FmtEuro(t.waarde)}</span><span class="m11-kpi-sub">gem. ${m9FmtEuro(gemPerWoning)}/woning</span></div>
        <div class="m11-kpi-card m11-kpi-eigen"><span class="m11-kpi-label">Eigen risico (NMR \u2264${M11_NMR_THRESHOLD}%)</span><span class="m11-kpi-value">${m9FmtEuro(t.eigen)}</span><span class="m11-kpi-sub">voor rekening eigenaar</span></div>
        <div class="m11-kpi-card m11-kpi-compensabel"><span class="m11-kpi-label">Compensabele planschade (>${M11_NMR_THRESHOLD}%)</span><span class="m11-kpi-value">${m9FmtEuro(t.compensabel)}</span><span class="m11-kpi-sub">indicatief, per geval te bepalen</span></div>
      `;
    }
  }

  if (tableTitle) {
    tableTitle.textContent = !result.hasData
      ? 'Uitsplitsing'
      : result.method === 'band'
        ? 'Uitsplitsing per afstandsband (categorie Hoog, Methode B)'
        : `Uitsplitsing \u2014 ${M11_CATEGORY_META[state.m11Category].label}, Methode A (vlak percentage)`;
  }
  if (tableBody) {
    if (!result.hasData) {
      tableBody.innerHTML = `<tr><td colspan="6" class="empty-row">${n === 0 ? 'Plaats een turbine op de kaart in Module 3.' : 'Haal eerst BAG-gegevens op bij Module 8.'}</td></tr>`;
    } else {
      const rowsHtml = result.rows
        .map((r) => `<tr>
          <td>${r.label}</td>
          <td>\u2212${r.pct.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
          <td>${r.woningen.toLocaleString('nl-NL')}</td>
          <td>${m9FmtEuro(r.waarde)}</td>
          <td>${m9FmtEuro(r.eigen)}</td>
          <td>${m9FmtEuro(r.compensabel)}</td>
        </tr>`)
        .join('');
      const t = result.totals;
      const totalRow = result.rows.length > 1
        ? `<tr class="m11-totals-row"><td>Totaal</td><td>${dash}</td><td>${t.woningen.toLocaleString('nl-NL')}</td><td>${m9FmtEuro(t.waarde)}</td><td>${m9FmtEuro(t.eigen)}</td><td>${m9FmtEuro(t.compensabel)}</td></tr>`
        : '';
      tableBody.innerHTML = rowsHtml + totalRow;
    }
  }

  renderModule11WozAuto();
  renderModule11CbsComparison();
}

// ============================================================================
// Module 12: bouw-/investeringskosten per turbine (PBL-eindadvies SDE++ 2026)
// Volledig losstaand van de kaart/turbines hierboven — vrije invoer per groep.
// ============================================================================

// ---------- Generieke "berekening"-tooltips (gebruikt door Module 12) ----------
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}
function attrEscapeCalc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
// Wraps a rendered value in a hoverable/focusable/tappable span carrying the
// exact calculation text (met echte ingevulde waarden) in data-calc.
function calcSpan(calcText, displayHtml) {
  return `<span class="calc" tabindex="0" data-calc="${attrEscapeCalc(calcText)}">${displayHtml}</span>`;
}
function initCalcTooltip() {
  if (document.getElementById('calc-tooltip')) return;
  const tip = document.createElement('div');
  tip.id = 'calc-tooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let activeEl = null;

  function place(el) {
    const r = el.getBoundingClientRect();
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.classList.add('visible');
    const tipRect = tip.getBoundingClientRect();
    let left = r.left + r.width / 2 - tipRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
    let top = r.top - tipRect.height - 10;
    if (top < 8) top = r.bottom + 10;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  function show(el) {
    const text = el.getAttribute('data-calc');
    if (!text) return;
    activeEl = el;
    tip.innerHTML = '<span class="calc-tooltip-label">Berekening</span>' + escapeHtml(text).replace(/\n/g, '<br>');
    place(el);
  }
  function hide(el) {
    if (el && el !== activeEl) return;
    tip.classList.remove('visible');
    activeEl = null;
  }
  document.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-calc]'); if (el) show(el); });
  document.addEventListener('mouseout', (e) => { const el = e.target.closest('[data-calc]'); if (el) hide(el); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-calc]'); if (el) show(el); });
  document.addEventListener('focusout', (e) => { const el = e.target.closest('[data-calc]'); if (el) hide(el); });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-calc]');
    if (!el) { hide(); return; }
    if (activeEl === el) hide(el); else show(el);
  });
  window.addEventListener('scroll', () => hide(), true);
  window.addEventListener('resize', () => hide());
}

// ---------- Module 12: constanten (PBL, "Advies basisbedragen SDE++ 2026") ----------
const M12_TURBINEPRIJS_PER_KW = 1090;
const M12_INVESTERING_PER_KW = { regulier: 1540, hoogtebeperkt: 1550, waterkeringen: 1770 };
const M12_CATEGORY_LABELS = {
  regulier: 'Wind op land, regulier',
  hoogtebeperkt: 'Wind op land, met hoogtebeperking (max. 150 m tiphoogte)',
  waterkeringen: 'Wind op waterkeringen',
};
const M12_VOLLASTUREN = {
  I:   { regulier: 3660, hoogtebeperkt: 3040, waterkeringen: 3680 },
  II:  { regulier: 3290, hoogtebeperkt: 2690, waterkeringen: 3300 },
  III: { regulier: 2980, hoogtebeperkt: 2390, waterkeringen: 3000 },
  IV:  { regulier: 2780, hoogtebeperkt: 2210, waterkeringen: 2800 },
  V:   { regulier: 2580, hoogtebeperkt: 2020, waterkeringen: 2590 },
};
const M12_WINDPARKVERLIES_PCT = 13;
const M12_LEVENSDUUR_JAAR = 20;
let m12NextId = 1;

function m12FmtEuroDec(n) {
  return n == null || Number.isNaN(n) ? '\u2014' : '\u20ac' + n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function m12AddGroup() {
  const nameInput = document.getElementById('m12-name-input');
  const vermogenInput = document.getElementById('m12-vermogen-input');
  const aantalInput = document.getElementById('m12-aantal-input');
  const categorySelect = document.getElementById('m12-category-select');
  const windcatSelect = document.getElementById('m12-windcat-select');
  const statusEl = document.getElementById('m12-add-status');
  if (!vermogenInput || !aantalInput || !categorySelect || !windcatSelect) return;
  const vermogen = parseFloat(vermogenInput.value);
  const aantal = parseInt(aantalInput.value, 10);
  if (!(vermogen > 0)) {
    if (statusEl) { statusEl.textContent = 'Vul een geldig vermogen per turbine in (groter dan 0 MW).'; statusEl.className = 'hint m8-status-error'; }
    return;
  }
  if (!(aantal >= 1)) {
    if (statusEl) { statusEl.textContent = 'Vul een geldig aantal turbines in (minimaal 1).'; statusEl.className = 'hint m8-status-error'; }
    return;
  }
  state.m12Groups.push({
    id: m12NextId++,
    naam: (nameInput && nameInput.value || '').trim(),
    vermogenMw: vermogen,
    aantal: aantal,
    categorie: categorySelect.value,
    windcategorie: windcatSelect.value,
  });
  if (nameInput) nameInput.value = '';
  vermogenInput.value = '';
  aantalInput.value = '';
  if (statusEl) { statusEl.textContent = ''; statusEl.className = 'hint'; }
  renderModule12();
  renderModule13();
}

function m12RemoveGroup(id) {
  state.m12Groups = state.m12Groups.filter((g) => g.id !== id);
  renderModule12();
  renderModule13();
}

function m12ComputeRow(g, idx) {
  const vermogenTotaalMw = g.vermogenMw * g.aantal;
  const turbineprijsPerKw = M12_TURBINEPRIJS_PER_KW;
  const investeringPerKw = M12_INVESTERING_PER_KW[g.categorie];
  const turbineprijsPerTurbine = g.vermogenMw * 1000 * turbineprijsPerKw;
  const investeringPerTurbine = g.vermogenMw * 1000 * investeringPerKw;
  const turbineprijsTotaal = vermogenTotaalMw * 1000 * turbineprijsPerKw;
  const investeringTotaal = vermogenTotaalMw * 1000 * investeringPerKw;
  const vollasturen = M12_VOLLASTUREN[g.windcategorie][g.categorie];
  const jaarproductie = vermogenTotaalMw * vollasturen * (1 - M12_WINDPARKVERLIES_PCT / 100);
  const levensduurproductie = jaarproductie * M12_LEVENSDUUR_JAAR;
  const kostenJaar1 = jaarproductie > 0 ? investeringTotaal / jaarproductie : null;
  const kostenLevensduur = levensduurproductie > 0 ? investeringTotaal / levensduurproductie : null;
  const label = g.naam || `Groep ${idx + 1}`;
  return {
    ...g, label, vermogenTotaalMw, turbineprijsPerKw, investeringPerKw,
    turbineprijsPerTurbine, investeringPerTurbine, turbineprijsTotaal, investeringTotaal,
    vollasturen, jaarproductie, levensduurproductie, kostenJaar1, kostenLevensduur,
  };
}

function renderModule12() {
  const tableBody = document.getElementById('m12-table-body');
  const kpiGrid = document.getElementById('m12-kpi-grid');
  const totalsCallout = document.getElementById('m12-totals-callout');
  const totalsText = document.getElementById('m12-totals-text');
  if (!tableBody) return;

  const rows = state.m12Groups.map((g, i) => m12ComputeRow(g, i));

  if (rows.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="14" class="empty-row">Voeg hierboven \u00e9\u00e9n of meer turbinegroepen toe.</td></tr>';
    if (kpiGrid) kpiGrid.innerHTML = '';
    if (totalsCallout) totalsCallout.style.display = 'none';
    return;
  }

  const totals = rows.reduce((acc, r) => {
    acc.vermogenTotaalMw += r.vermogenTotaalMw;
    acc.turbineprijsTotaal += r.turbineprijsTotaal;
    acc.investeringTotaal += r.investeringTotaal;
    acc.jaarproductie += r.jaarproductie;
    acc.levensduurproductie += r.levensduurproductie;
    acc.aantalTurbines += r.aantal;
    return acc;
  }, { vermogenTotaalMw: 0, turbineprijsTotaal: 0, investeringTotaal: 0, jaarproductie: 0, levensduurproductie: 0, aantalTurbines: 0 });
  const gemKostenJaar1 = totals.jaarproductie > 0 ? totals.investeringTotaal / totals.jaarproductie : null;
  const gemKostenLevensduur = totals.levensduurproductie > 0 ? totals.investeringTotaal / totals.levensduurproductie : null;

  const rowsHtml = rows.map((r) => {
    const calcVermogenTotaal = calcSpan(
      `Vermogen per turbine \u00d7 aantal:\n${r.vermogenMw.toLocaleString('nl-NL', { maximumFractionDigits: 2 })} MW \u00d7 ${r.aantal}\n= ${r.vermogenTotaalMw.toLocaleString('nl-NL', { maximumFractionDigits: 2 })} MW.`,
      `${r.vermogenTotaalMw.toLocaleString('nl-NL', { maximumFractionDigits: 2 })} MW`
    );
    const calcTurbineprijsTurbine = calcSpan(
      `Vermogen per turbine (in kW) \u00d7 turbineprijs per kW:\n${m9Fmt(r.vermogenMw * 1000)} kW \u00d7 ${m12FmtEuroDec(r.turbineprijsPerKw)}/kW\n= ${m9FmtEuro(r.turbineprijsPerTurbine)}.`,
      m9FmtEuro(r.turbineprijsPerTurbine)
    );
    const calcInvesteringTurbine = calcSpan(
      `Vermogen per turbine (in kW) \u00d7 investering per kW voor categorie '${M12_CATEGORY_LABELS[r.categorie]}':\n${m9Fmt(r.vermogenMw * 1000)} kW \u00d7 ${m12FmtEuroDec(r.investeringPerKw)}/kW\n= ${m9FmtEuro(r.investeringPerTurbine)}.`,
      m9FmtEuro(r.investeringPerTurbine)
    );
    const calcInvesteringTotaal = calcSpan(
      `Totaal vermogen (in kW) \u00d7 investering per kW:\n${m9Fmt(r.vermogenTotaalMw * 1000)} kW \u00d7 ${m12FmtEuroDec(r.investeringPerKw)}/kW\n= ${m9FmtEuro(r.investeringTotaal)}.\n(Turbineprijs-deel: ${m9FmtEuro(r.turbineprijsTotaal)}; meerkosten: ${m9FmtEuro(r.investeringTotaal - r.turbineprijsTotaal)}.)`,
      m9FmtEuro(r.investeringTotaal)
    );
    const calcVollasturen = calcSpan(
      `Vaste tabelwaarde (PBL-eindadvies SDE++ 2026, Tabel 7.4) voor windsnelheidscategorie '${r.windcategorie}' en type '${M12_CATEGORY_LABELS[r.categorie]}'.\nGeen berekening \u2014 dit is een brongegeven.\n= ${m9Fmt(r.vollasturen)} vollasturen/jaar.`,
      m9Fmt(r.vollasturen)
    );
    const calcJaarproductie = calcSpan(
      `Totaal vermogen \u00d7 vollasturen \u00d7 (1 \u2212 windparkverlies):\n${r.vermogenTotaalMw.toLocaleString('nl-NL', { maximumFractionDigits: 2 })} MW \u00d7 ${m9Fmt(r.vollasturen)} \u00d7 (1 \u2212 ${M12_WINDPARKVERLIES_PCT}%)\n= ${m9Fmt(r.jaarproductie)} MWh/jaar.`,
      m9Fmt(r.jaarproductie)
    );
    const calcKostenJaar1 = calcSpan(
      `Totale investering / jaarproductie:\n${m9FmtEuro(r.investeringTotaal)} / ${m9Fmt(r.jaarproductie)} MWh\n= ${m12FmtEuroDec(r.kostenJaar1)}/MWh in jaar 1.`,
      m12FmtEuroDec(r.kostenJaar1)
    );
    const calcKostenLevensduur = calcSpan(
      `Totale investering / (jaarproductie \u00d7 economische levensduur van ${M12_LEVENSDUUR_JAAR} jaar):\n${m9FmtEuro(r.investeringTotaal)} / (${m9Fmt(r.jaarproductie)} \u00d7 ${M12_LEVENSDUUR_JAAR})\n= ${m12FmtEuroDec(r.kostenLevensduur)}/MWh.`,
      m12FmtEuroDec(r.kostenLevensduur)
    );
    return `<tr>
      <td>${escapeHtml(r.label)}</td>
      <td>${escapeHtml(M12_CATEGORY_LABELS[r.categorie])}</td>
      <td>${r.windcategorie}</td>
      <td>${r.vermogenMw.toLocaleString('nl-NL', { maximumFractionDigits: 2 })} MW</td>
      <td>${r.aantal}</td>
      <td>${calcVermogenTotaal}</td>
      <td>${calcTurbineprijsTurbine}</td>
      <td>${calcInvesteringTurbine}</td>
      <td>${calcInvesteringTotaal}</td>
      <td>${calcVollasturen}</td>
      <td>${calcJaarproductie}</td>
      <td>${calcKostenJaar1}</td>
      <td>${calcKostenLevensduur}</td>
      <td><button type="button" class="popup-remove-btn m12-remove-btn" data-m12-remove="${r.id}">Verwijder</button></td>
    </tr>`;
  }).join('');

  const totalRow = rows.length > 1
    ? `<tr class="m11-totals-row">
        <td>Totaal</td><td>\u2014</td><td>\u2014</td><td>\u2014</td><td>${totals.aantalTurbines}</td>
        <td>${totals.vermogenTotaalMw.toLocaleString('nl-NL', { maximumFractionDigits: 2 })} MW</td>
        <td>\u2014</td><td>\u2014</td>
        <td>${m9FmtEuro(totals.investeringTotaal)}</td>
        <td>\u2014</td>
        <td>${m9Fmt(totals.jaarproductie)}</td>
        <td>${m12FmtEuroDec(gemKostenJaar1)}</td>
        <td>${m12FmtEuroDec(gemKostenLevensduur)}</td>
        <td></td>
      </tr>`
    : '';
  tableBody.innerHTML = rowsHtml + totalRow;
  tableBody.querySelectorAll('[data-m12-remove]').forEach((btn) => {
    btn.addEventListener('click', () => m12RemoveGroup(parseInt(btn.dataset.m12Remove, 10)));
  });

  if (totalsCallout) totalsCallout.style.display = '';
  if (totalsText) {
    totalsText.innerHTML = `<div class="m11-totals-line"><strong>${totals.aantalTurbines.toLocaleString('nl-NL')} turbine(s)</strong> \u2014 totaal vermogen <strong>${totals.vermogenTotaalMw.toLocaleString('nl-NL', { maximumFractionDigits: 2 })} MW</strong>, totale investering <strong>${m9FmtEuro(totals.investeringTotaal)}</strong> (waarvan turbineprijs ${m9FmtEuro(totals.turbineprijsTotaal)} en meerkosten ${m9FmtEuro(totals.investeringTotaal - totals.turbineprijsTotaal)}), geschatte jaarproductie <strong>${m9Fmt(totals.jaarproductie)} MWh</strong> (na 13% windparkverlies).</div>`;
  }
  if (kpiGrid) {
    kpiGrid.innerHTML = `
      <div class="m11-kpi-card m11-kpi-totaal"><span class="m11-kpi-label">Totaal vermogen</span><span class="m11-kpi-value">${totals.vermogenTotaalMw.toLocaleString('nl-NL', { maximumFractionDigits: 2 })} MW</span><span class="m11-kpi-sub">${totals.aantalTurbines} turbine(s)</span></div>
      <div class="m11-kpi-card m11-kpi-eigen"><span class="m11-kpi-label">Totale investering</span><span class="m11-kpi-value">${m9FmtEuro(totals.investeringTotaal)}</span><span class="m11-kpi-sub">turbineprijs ${m9FmtEuro(totals.turbineprijsTotaal)}</span></div>
      <div class="m11-kpi-card m11-kpi-woningen"><span class="m11-kpi-label">Jaarproductie</span><span class="m11-kpi-value">${m9Fmt(totals.jaarproductie)} MWh</span><span class="m11-kpi-sub">per jaar, na 13% windparkverlies</span></div>
      <div class="m11-kpi-card m11-kpi-compensabel"><span class="m11-kpi-label">\u20ac/MWh (20 jaar)</span><span class="m11-kpi-value">${m12FmtEuroDec(gemKostenLevensduur)}</span><span class="m11-kpi-sub">jaar 1: ${m12FmtEuroDec(gemKostenJaar1)}</span></div>
    `;
  }
}

// ---------- Module 13: kritisch PDF-rapport (synthese van Module 1-12) ----------
// Dit is een pure synthese-/rapportagelaag: er wordt geen enkele formule opnieuw
// geïmplementeerd. Alle cijfers komen rechtstreeks uit de bestaande compute-functies
// van Module 6 (m6ComputeAll), 8 (m8ComputeRows/m8ComputeTotals), 9/10 (zelfde formules
// als renderModule9/renderModule10, hier gerepliceerd op de totals8-array), 11
// (m11ComputeResult) en 12 (m12ComputeRow), zodat het rapport per definitie consistent
// is met wat de rest van de app op het scherm toont.

function m13Readiness() {
  const nTurbines = state.turbines3a.length;
  const norm = getActiveNorm();
  const normOk = norm.lnight != null;
  const hasBag = !!state.m8AddressData;
  const bagStale = hasBag && state.m8AddressData.turbineSnapshot !== m8TurbineSnapshot();
  const hasM12 = state.m12Groups.length > 0;
  return { nTurbines, norm, normOk, hasBag, bagStale, hasM12 };
}

function m13StatusMessages() {
  const r = m13Readiness();
  const msgs = [];
  if (r.nTurbines === 0) msgs.push('Plaats minstens één turbine in Module 3 (kaart) — het rapport heeft een locatie nodig voor de scenario- en woningberekeningen.');
  if (!r.normOk) msgs.push(`De huidige norm bij Module 5 (${r.norm.label}) heeft geen Lnight-waarde, waardoor geen overschrijdingsafstand (en dus geen woningen/bewoners) bepaald kan worden — kies een andere norm.`);
  if (r.nTurbines > 0 && r.normOk && !r.hasBag) msgs.push('Nog geen BAG-woningen opgehaald bij Module 8 — het rapport toont zonder die stap geen woningen-, bewoners-, hinder-, zorgkosten- of DALY-cijfers.');
  if (r.hasBag && r.bagStale) msgs.push('De turbine(s) zijn gewijzigd sinds de laatste BAG-ophaling bij Module 8 — haal opnieuw op voor cijfers die bij de huidige plaatsing passen.');
  if (!r.hasM12) msgs.push('Nog geen turbinegroep toegevoegd bij Module 12 — zonder investeringscijfers ontbreekt de vergelijking maatschappelijke kosten vs. investeringskosten in het rapport (de rest van het rapport werkt wel).');
  return msgs;
}

function renderModule13() {
  const statusEl = document.getElementById('m13-status');
  const btn = document.getElementById('m13-generate-btn');
  if (!statusEl || !btn) return;
  const r = m13Readiness();
  const msgs = m13StatusMessages();
  const canGenerate = r.nTurbines > 0 && r.normOk;
  btn.disabled = !canGenerate;
  if (msgs.length === 0) {
    statusEl.className = 'hint m8-status-ok';
    statusEl.innerHTML = 'Alle onderliggende modules zijn ingevuld — het rapport bevat volledige cijfers voor deze locatie.';
  } else {
    statusEl.className = 'hint' + (canGenerate ? '' : ' m8-status-error');
    statusEl.innerHTML = (canGenerate
      ? '<strong>Rapport kan al gegenereerd worden, maar is nog niet volledig:</strong><br>'
      : '<strong>Nog niet mogelijk:</strong><br>') + msgs.map((m) => '• ' + escapeHtml(m)).join('<br>');
  }
}

function m13Pct(n, d) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('nl-NL', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }) + '%';
}
function m13Int(n) {
  return n == null || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('nl-NL');
}

// Bouwt de volledige rapport-HTML als losstaand document (eigen <style>, geen afhankelijkheid
// van style.css) zodat het exact zo afdrukt/PDF't als getoond, ook nadat de tab losstaat van de app.
function m13BuildReportHtml(mapImages) {
  const mapViews = mapImages || { closeup: null, regional: null };
  const now = new Date();
  const genDate = now.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  const genTime = now.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

  const r = m13Readiness();
  const catLw = computeCategoryLw(state.lwa);
  const turbines = state.turbines3a;
  const n = turbines.length;
  const norm = r.norm;
  const m6 = r.nTurbines > 0 ? m6ComputeAll() : null;
  const rows8 = m8ComputeRows();
  const totals8 = m8ComputeTotals();
  const horizon = state.m9Horizon;
  const costPerPerson = state.m9CostPerPersonYear;
  const dwTotal = M10_DW_SLAAP + M10_DW_HINDER;
  const m11 = m11ComputeResult();
  const m12rows = state.m12Groups.map(m12ComputeRow);
  const m12TotalInvest = m12rows.reduce((s, row) => s + row.investeringTotaal, 0);
  const m12TotalVermogen = m12rows.reduce((s, row) => s + row.vermogenTotaalMw, 0);
  const hasBag = r.hasBag;
  const hasM12 = r.hasM12;
  const rows8a = m8aComputeRows();

  // BELANGRIJK: hinder-, zorgkosten- en DALY-berekeningen moeten PER GELUIDSCATEGORIE (hoorbaar/
  // laagfrequent/infrasoon) worden toegepast op de bewoners die zich BINNEN DE RING VAN DIE CATEGORIE
  // bevinden (rows8, exact zoals Module 8/9/10 dat al doen) — niet op het "ontdubbelde" totaal
  // (totals8), dat slechts de vereniging van de drie ringen is (in de praktijk gelijk aan de grootste
  // ring, doorgaans infrasoon ≤5000 m). Anders zou bijv. bij best case hoorbaar geluid, waar maar 1
  // woning/2 bewoners binnen de norm-overschrijding vallen, het hinderpercentage worden toegepast op
  // duizenden bewoners die dat hoorbare geluid helemaal niet ervaren — een categorie/eenheidfout.
  const catMatrix = rows8.map((r) => ({
    scenario: r.scenario,
    categories: r.categories.map((c) => ({
      key: c.key, label: c.label, ring: c.ring, houses: c.houses, people: c.people,
      hinder: c.hinder.map((h) => {
        const costYear = h.people != null ? h.people * costPerPerson : null;
        const costHorizon = costYear != null ? costYear * horizon : null;
        const dalyYear = h.people != null ? h.people * dwTotal : null;
        const dalyHorizon = dalyYear != null ? dalyYear * horizon : null;
        const values = M10_VALUES.map((v) => ({
          ...v,
          euroHorizon: dalyHorizon != null ? dalyHorizon * v.euro : null,
        }));
        return { ...h, costYear, costHorizon, dalyYear, dalyHorizon, values };
      }),
    })),
  }));

  // Maatschappelijke kosten-totaal, PER GELUIDSCATEGORIE (niet meer geblend tot één ontdubbeld cijfer):
  // voor elke categorie het jaargewogen gemiddelde (gewicht = aandeel nachten per scenario, m6.pct) over
  // de drie hinderpercentages. De 9/30/46%-hinderstudies (RIVM/Pawlaczyk) betreffen bewoners die
  // aangeven hoorbaar turbinegeluid waar te nemen — de hoorbaar-rij is daarom de wetenschappelijk
  // best onderbouwde vergelijking; laagfrequent/infrasoon passen dezelfde percentages illustratief toe
  // op hun eigen (grotere) ringbevolking, bij gebrek aan aparte hinderstudies voor die frequentiebanden.
  const catSocByPct = M8_CATEGORY_META.map((meta) => {
    const byPct = M8_HINDER_SCENARIOS.map((hs, hIdx) => {
      let costHorizonWeighted = 0, dalyHorizonWeighted = 0, peopleWeighted = 0;
      let anyData = false;
      catMatrix.forEach((t) => {
        const cat = t.categories.find((c) => c.key === meta.key);
        if (!cat) return;
        const h = cat.hinder[hIdx];
        const weight = m6 ? (m6.pct[t.scenario] / 100) : (1 / 3);
        if (h.people != null) { peopleWeighted += h.people * weight; anyData = true; }
        if (h.costHorizon != null) costHorizonWeighted += h.costHorizon * weight;
        if (h.dalyHorizon != null) dalyHorizonWeighted += h.dalyHorizon * weight;
      });
      return {
        pct: hs.pct, label: hs.label,
        people: anyData ? peopleWeighted : null,
        costHorizon: anyData ? costHorizonWeighted : null,
        dalyHorizon: anyData ? dalyHorizonWeighted : null,
        euro70k: anyData ? dalyHorizonWeighted * 70000 : null,
      };
    });
    return { key: meta.key, label: meta.label, byPct };
  });
  const catSocFor = (key) => catSocByPct.find((c) => c.key === key);
  const socTotal = (s) => (s && s.costHorizon != null && s.euro70k != null) ? s.costHorizon + s.euro70k + (m11.hasData ? m11.totals.waarde : 0) : null;
  const hoorbaarCrit = catSocFor('hoorbaar').byPct[2];
  const infrasoonCrit = catSocFor('infrasoon').byPct[2];
  const hoorbaarCritTotal = socTotal(hoorbaarCrit);
  const infrasoonCritTotal = socTotal(infrasoonCrit);

  const warningBanner = (!r.normOk || r.nTurbines === 0)
    ? `<div class="rp-callout rp-warn"><strong>Let op — onvolledige basis:</strong> ${
        r.nTurbines === 0
          ? 'er is geen turbine geplaatst in Module 3; dit rapport toont daarom alleen de methodologie, geen locatiespecifieke cijfers.'
          : `de geselecteerde norm (${escapeHtml(norm.label)}) heeft geen Lnight-waarde, waardoor geen overschrijdingsafstanden bepaald konden worden.`
      }</div>`
    : (!hasBag
        ? `<div class="rp-callout rp-warn"><strong>Let op — geen BAG-gegevens:</strong> bij Module 8 zijn nog geen woningen opgehaald voor deze turbinepositie(s). Woningen-, bewoners-, hinder-, zorgkosten- en DALY-cijfers hieronder staan op "—" totdat dat is gedaan.</div>`
        : (r.bagStale ? `<div class="rp-callout rp-warn"><strong>Let op — mogelijk verouderd:</strong> de turbinepositie(s) zijn gewijzigd sinds de laatste BAG-ophaling bij Module 8; de cijfers hieronder kunnen niet meer bij de huidige plaatsing passen.</div>` : ''));

  const m12Banner = !hasM12
    ? `<div class="rp-callout rp-warn"><strong>Let op — geen investeringscijfers:</strong> bij Module 12 is nog geen turbinegroep toegevoegd. De vergelijking maatschappelijke kosten vs. investeringskosten in dit rapport kan daardoor niet worden gemaakt.</div>`
    : '';

  const turbineList = n > 0
    ? turbines.map((t, i) => `#${i + 1}: ${t.lat.toFixed(5)}, ${t.lng.toFixed(5)}`).join(' · ')
    : 'geen turbine geplaatst';

  const scenarioRow = (label, key) => {
    const days = m6 ? m6.days[key] : null;
    const pct = m6 ? m6.pct[key] : null;
    return `<tr><td>${label}</td><td>${pct != null ? m13Pct(pct) : '—'}</td><td>${days != null ? days + ' nachten/jaar' : '—'}</td></tr>`;
  };

  // ---- Sectie: Module 1-12 samenvatting ----
  const summarySection = `
  <section class="rp-section">
    <h2>1. Samenvatting — wat berekent elke module</h2>
    <p>Dit rapport is een synthese van de twaalf rekenmodules van het model; de onderstaande tabel geeft per module een korte uitleg en, waar van toepassing, de actuele uitkomst voor de hierboven vermelde turbinepositie(s).</p>
    <table class="rp-table">
      <thead><tr><th style="width:8%">Module</th><th style="width:32%">Wat het berekent</th><th>Actuele uitkomst voor deze locatie</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>Bronvermogen (L<sub>WA</sub>) van de turbine, opgesplitst in drie categorieën met eigen weging.</td><td>L<sub>WA</sub> = ${state.lwa.toFixed(1)} dB(A) → hoorbaar ${catLw.hoorbaar.toFixed(1)} dB(A), laagfrequent ${catLw.laagfrequent.toFixed(1)} dB(Lin), infrasoon ${catLw.infrasoon.toFixed(1)} dB(G)</td></tr>
        <tr><td>2</td><td>Omstandighedenfactoren (windschering/inversie, torenzog, amplitudemodulatie, curtailment) die 's nachts geluid kunnen versterken.</td><td>Bepaalt samen met Module 6/7 het onderscheid tussen best/middel/worst case hieronder.</td></tr>
        <tr><td>3</td><td>Plaatsing van turbine(s) op kaart en live geluidsniveau per categorie/afstand/richting.</td><td>${n} turbine(s) geplaatst — ${escapeHtml(turbineList)}</td></tr>
        <tr><td>4</td><td>Cumulatie: energetische optelling van meerdere turbines op een rekenpunt.</td><td>Zie Module 4 in de app voor het live cumulatie-resultaat op een zelf te kiezen punt.</td></tr>
        <tr><td>5</td><td>Toetsing van het berekende geluidsniveau aan een wettelijke/advies-norm (Lnight).</td><td>Actieve norm: ${escapeHtml(norm.label)}${norm.lnight != null ? ` (Lnight ≤ ${norm.lnight} dB)` : ' (geen Lnight-waarde)'}</td></tr>
        <tr><td>6</td><td>Hoe vaak de nachtelijke best/middel/worst-omstandigheden voorkomen, op basis van klimatologie.</td><td>${m6 ? `Best ${m13Pct(m6.pct.best)} (${m6.days.best} nachten/jr), middel ${m13Pct(m6.pct.middel)} (${m6.days.middel} nachten/jr), worst ${m13Pct(m6.pct.worst)} (${m6.days.worst} nachten/jr)` : '— (geen turbine geplaatst)'}</td></tr>
        <tr><td>7</td><td>Wetenschappelijke onderbouwing (shear-capacity, Bosveld/Abraham &amp; Monahan) van de middel/worst-splitsing in Module 6.</td><td>Geostrofische wind (ERA5) ter plaatse: U<sub>geo</sub> ≈ ${state.m7Ugeo} m/s</td></tr>
        <tr><td>8</td><td>Aantal woningen (BAG) en bewoners binnen de overschrijdingsring per scenario/categorie, met hinderpercentage 9/30/46%.</td><td>${hasBag ? `Zie §4 (ring/woningen) en §5 (hinderpercentages) hieronder` : '— (nog geen BAG-gegevens opgehaald)'}</td></tr>
        <tr><td>9</td><td>Geschatte jaarlijkse zorgkosten per gehinderde bewoner (Godono e.a. 2023).</td><td>€${costPerPerson.toFixed(2)}/bewoner/jaar, horizon ${horizon} jaar — zie §6</td></tr>
        <tr><td>10</td><td>DALY-verlies (disability-adjusted life years) door slaapverstoring + hinder, in drie monetaire waarderingen.</td><td>${dwTotal.toFixed(3)} DALY/bewoner/jaar × €50.000/€70.000/€80.000 per DALY — zie §7</td></tr>
        <tr><td>11</td><td>Waardedaling van woningen (Droës &amp; Koster 2021), naar tiphoogte-categorie.</td><td>${m11.hasData ? `${m11.totals.woningen.toLocaleString('nl-NL')} woningen, €${Math.round(m11.totals.waarde).toLocaleString('nl-NL')} totale waardedaling` : '— (geen BAG-gegevens of geen turbine geplaatst)'}</td></tr>
        <tr><td>12</td><td>Bouw-/investeringskosten per turbine(groep), PBL-eindadvies SDE++ 2026.</td><td>${hasM12 ? `${m12rows.length} groep(en), ${m12TotalVermogen.toLocaleString('nl-NL', { maximumFractionDigits: 2 })} MW totaal, €${Math.round(m12TotalInvest).toLocaleString('nl-NL')} investering` : '— (nog geen turbinegroep toegevoegd)'}</td></tr>
      </tbody>
    </table>
  </section>`;

  // ---- Sectie: waarom de nacht ----
  const nightSection = `
  <section class="rp-section">
    <h2>2. Waarom dit rapport zich richt op de nacht</h2>
    <p>Windturbinegeluid is een dosis-effectrelatie die 's nachts structureel ongunstiger uitvalt dan overdag: bij een stabiele nachtelijke grenslaag kan de turbine op ashoogte nog hard doordraaien terwijl het windstil is op maaiveld, waardoor het geluidsniveau op leefniveau met naar schatting 10 tot 15 dB kan stijgen ten opzichte van de jaargemiddelde situatie (Module 2, gebaseerd op de bijgevoegde Positioning Paper Laagfrequent Geluid en Windturbines). Slaapverstoring is bovendien de gezondheidsroute waarvoor het bewijs het meest consistent is (zie §6, DALY-berekening). Alle scenario- en hindercijfers in dit rapport betreffen daarom uitsluitend de <strong>nachtperiode</strong> (22.00–07.00 uur), niet de etmaalgemiddelde Lden.</p>
  </section>`;

  // ---- Sectie: uitgangspunt bronvermogen en positie ----
  const basisSection = `
  <section class="rp-section">
    <h2>3. Uitgangspunt: bronvermogen en turbinepositie</h2>
    <p>Alle berekeningen in dit rapport zijn afgeleid van twee vaste invoerwaarden:</p>
    <table class="rp-table">
      <thead><tr><th>Invoer</th><th>Waarde</th></tr></thead>
      <tbody>
        <tr><td>Bronvermogen L<sub>WA</sub> (Module 1)</td><td>${state.lwa.toFixed(1)} dB(A) totaal → hoorbaar ${catLw.hoorbaar.toFixed(1)} dB(A) / laagfrequent ${catLw.laagfrequent.toFixed(1)} dB(Lin) / infrasoon ${catLw.infrasoon.toFixed(1)} dB(G)</td></tr>
        <tr><td>Aantal turbines (Module 3)</td><td>${n}</td></tr>
        <tr><td>Positie(s)</td><td>${escapeHtml(turbineList)}</td></tr>
        <tr><td>Actieve norm (Module 5)</td><td>${escapeHtml(norm.label)}${norm.lnight != null ? `, Lnight ≤ ${norm.lnight} dB` : ''}</td></tr>
      </tbody>
    </table>
    <p>Vanuit dit bronvermogen en deze positie(s) berekent het model per categorie (hoorbaar/laagfrequent/infrasoon) en per scenario (best/middel/worst) de afstand waarop het geluidsniveau de norm overschrijdt (de "overschrijdingsring"), en telt het de unieke BAG-woningen binnen die ring.</p>
  </section>`;

  // ---- Sectie: scenarioberekening (hoorbaar/LF/infrasoon) ----
  const catRowsHtml = (scenario) => {
    const row = rows8.find((rr) => rr.scenario === scenario);
    if (!row) return '';
    return row.categories.map((c, idx) => `<tr>
      <td>${idx === 0 ? M8_SCENARIO_LABEL[scenario] : ''}</td>
      <td>${c.label}</td>
      <td>${m8RingLabelMulti(c.ring, c.ringUp, c.ringCross)}</td>
      <td>${c.houses != null ? c.houses.toLocaleString('nl-NL') : '—'}</td>
      <td>${c.people != null ? m13Int(c.people) : '—'}</td>
    </tr>`).join('');
  };
  const scenarioSection = `
  <section class="rp-section rp-avoid-break">
    <h2>4. Scenarioberekening: hoorbaar, laagfrequent en infrasoon geluid</h2>
    <p>Per scenario (best/middel/worst — zie §7 voor hoe vaak elk scenario voorkomt) en per geluidscategorie: de afstand waarbinnen de norm wordt overschreden, het aantal unieke BAG-woningen daarbinnen, en het geschat aantal bewoners (huishoudgrootte ${state.m8HouseholdSize.toFixed(2)} personen/woning).</p>
    <table class="rp-table">
      <thead><tr><th>Scenario</th><th>Categorie</th><th>Overschrijdingsring</th><th>Woningen (BAG)</th><th>Bewoners</th></tr></thead>
      <tbody>${catRowsHtml('best')}${catRowsHtml('middel')}${catRowsHtml('worst')}</tbody>
    </table>
    <p class="rp-note">Ontdubbeld totaal per scenario (grootste ring van de drie categorieën, geen dubbeltelling — uitsluitend informatief, dit cijfer wordt <strong>niet</strong> gebruikt in de hinder-, zorgkosten- of DALY-berekening hieronder; daarvoor geldt steeds het bewonersaantal van de eigen ring per categorie, zie §5–§7; woningen/bewoners worden per BAG-adres exact getoetst op de eigen werkelijke afstand+richting tot elke turbine, niet op basis van deze ring): ${totals8.map((t) => `<strong>${M8_SCENARIO_LABEL[t.scenario]}</strong> ${m8RingLabelMulti(t.ring, t.ringUp, t.ringCross)}, ${t.houses != null ? t.houses.toLocaleString('nl-NL') : '—'} woningen, ${t.people != null ? m13Int(t.people) : '—'} bewoners`).join(' · ')}.</p>
  </section>`;

  // ---- Sectie: hinderpercentages RIVM/illustratief/kritisch — PER CATEGORIE (hoorbaar/laagfrequent/infrasoon) ----
  const hinderRowsHtml = catMatrix.map((t) => t.categories.map((c, cIdx) => `<tr>
    ${cIdx === 0 ? `<td rowspan="3">${M8_SCENARIO_LABEL[t.scenario]}</td>` : ''}
    <td>${c.label}</td>
    <td>${m8RingLabelMulti(c.ring, c.ringUp, c.ringCross)}</td>
    <td>${c.houses != null ? c.houses.toLocaleString('nl-NL') : '—'}</td>
    <td>${c.people != null ? m13Int(c.people) : '—'}</td>
    <td>${c.hinder[0].people != null ? m13Int(c.hinder[0].people) : '—'}</td>
    <td>${c.hinder[1].people != null ? m13Int(c.hinder[1].people) : '—'}</td>
    <td>${c.hinder[2].people != null ? m13Int(c.hinder[2].people) : '—'}</td>
  </tr>`).join('')).join('');
  const hinderSection = `
  <section class="rp-section rp-avoid-break">
    <h2>5. Hindercijfers: RIVM, illustratief en kritisch scenario</h2>
    <p>Het aantal ernstig gehinderde bewoners hangt sterk af van welk hinderpercentage wordt toegepast — en, cruciaal, op <strong>welke bewonerspopulatie</strong>: elke geluidscategorie heeft een eigen overschrijdingsring en dus een eigen bewonersaantal (§4). Bij best case hoorbaar geluid vallen bijvoorbeeld maar enkele woningen binnen de norm-overschrijding — het hinderpercentage wordt daarom hier toegepast op die enkele woningen, niet op de veel grotere (en qua geluidstype andere) laagfrequent- of infrasoonpopulatie. Dit model toetst drie hinderpercentages naast elkaar, in plaats van er één als "de" uitkomst te presenteren:</p>
    <ul class="rp-list">
      <li><strong>9% — RIVM-basisscenario:</strong> ernstige hinder binnenshuis bij de oude 47 dB Lden-norm, uit de <a href="https://www.rivm.nl/sites/default/files/2026-02/Factsheet-gezondheidseffecten-van-windturbinegeluid.pdf" target="_blank" rel="noopener">RIVM-factsheet gezondheidseffecten van windturbinegeluid</a>.</li>
      <li><strong>30% — illustratief tussenscenario:</strong> geen uitkomst van één specifiek onderzoek, maar een tussenwaarde om de gevoeligheid van de uitkomst voor deze aanname te tonen.</li>
      <li><strong>46% — kritisch scenario:</strong> uit <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC6121431/" target="_blank" rel="noopener">Pawlaczyk-Łuszczyńska e.a. (2018)</a>, gerapporteerd voor bewoners die aangeven windturbinegeluid 's nachts te horen — deze en de RIVM-9% zijn onderzoek naar <strong>hoorbaar</strong> geluid; toepassing op laagfrequent/infrasoon in de tabel hieronder is een illustratieve extrapolatie, omdat er geen aparte hinderpercentage-studies voor die frequentiebanden bestaan.</li>
    </ul>
    <table class="rp-table rp-table-compact">
      <thead><tr><th>Scenario</th><th>Categorie</th><th>Overschrijdingsring</th><th>Woningen</th><th>Bewoners (ring)</th><th>9% gehinderd</th><th>30% gehinderd</th><th>46% gehinderd</th></tr></thead>
      <tbody>${hinderRowsHtml}</tbody>
    </table>
  </section>`;

  // ---- Sectie: zorgkosten — PER CATEGORIE ----
  const m13CostCell = (h) => h.people == null ? '—' : `${m13Int(h.people)} bew. → <strong>${m9FmtEuro(h.costHorizon)}</strong><br><span class="rp-src">(${m9FmtEuro(h.costYear)}/jr)</span>`;
  const costRowsHtml = catMatrix.map((t) => t.categories.map((c, cIdx) => `<tr>
    ${cIdx === 0 ? `<td rowspan="3">${M8_SCENARIO_LABEL[t.scenario]}</td>` : ''}
    <td>${c.label}</td>
    <td>${m13CostCell(c.hinder[0])}</td>
    <td>${m13CostCell(c.hinder[1])}</td>
    <td>${m13CostCell(c.hinder[2])}</td>
  </tr>`).join('')).join('');
  const costSection = `
  <section class="rp-section rp-avoid-break">
    <h2>6. Zorgkosten</h2>
    <p>Geschatte zorgkosten volgen de formule <code>kosten = gehinderde bewoners (per categorie/ring) × €${costPerPerson.toFixed(2)}/persoon/jaar</code>, gebaseerd op <a href="https://doi.org/10.1016/j.ijheh.2023.114273" target="_blank" rel="noopener">Godono e.a. (2023)</a>, over een horizon van ${horizon} jaar. Net als in §5 wordt elk hinderpercentage toegepast op het bewonersaantal van de eigen categorie-ring, niet op een gecombineerd totaal.</p>
    <table class="rp-table rp-table-compact">
      <thead><tr><th>Scenario</th><th>Categorie</th><th>${M8_HINDER_SCENARIOS[0].pct}% <span class="rp-src">(${escapeHtml(M8_HINDER_SCENARIOS[0].label)})</span></th><th>${M8_HINDER_SCENARIOS[1].pct}% <span class="rp-src">(${escapeHtml(M8_HINDER_SCENARIOS[1].label)})</span></th><th>${M8_HINDER_SCENARIOS[2].pct}% <span class="rp-src">(${escapeHtml(M8_HINDER_SCENARIOS[2].label)})</span></th></tr></thead>
      <tbody>${costRowsHtml}</tbody>
    </table>
  </section>`;

  // ---- Sectie: DALY's — PER CATEGORIE, PER MONETAIRE WAARDERING (RIVM/PBL/Zorginstituut, tabellen onder elkaar) ----
  const m13DalyCellFor = (h, vIdx) => {
    if (h.people == null) return '—';
    const v = h.values[vIdx];
    return `${m13Int(h.people)} bew. → <strong>${m10FmtDaly(h.dalyHorizon)} DALY</strong><br><span class="rp-src">${v && v.euroHorizon != null ? m9FmtEuro(v.euroHorizon) : '—'}</span>`;
  };
  const dalyTableFor = (vIdx) => {
    const meta = M10_VALUES[vIdx];
    const rows = catMatrix.map((t) => t.categories.map((c, cIdx) => `<tr>
      ${cIdx === 0 ? `<td rowspan="3">${M8_SCENARIO_LABEL[t.scenario]}</td>` : ''}
      <td>${c.label}</td>
      <td>${m13DalyCellFor(c.hinder[0], vIdx)}</td>
      <td>${m13DalyCellFor(c.hinder[1], vIdx)}</td>
      <td>${m13DalyCellFor(c.hinder[2], vIdx)}</td>
    </tr>`).join('')).join('');
    return `
    <h3>7.${vIdx + 1} ${escapeHtml(meta.label)} — €${meta.euro.toLocaleString('nl-NL')}/DALY</h3>
    <table class="rp-table rp-table-compact">
      <thead><tr><th>Scenario</th><th>Categorie</th><th>${M8_HINDER_SCENARIOS[0].pct}% <span class="rp-src">(${escapeHtml(M8_HINDER_SCENARIOS[0].label)})</span></th><th>${M8_HINDER_SCENARIOS[1].pct}% <span class="rp-src">(${escapeHtml(M8_HINDER_SCENARIOS[1].label)})</span></th><th>${M8_HINDER_SCENARIOS[2].pct}% <span class="rp-src">(${escapeHtml(M8_HINDER_SCENARIOS[2].label)})</span></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  };
  const dalySection = `
  <section class="rp-section">
    <h2>7. DALY's — gezondheidsverlies in monetaire termen</h2>
    <p>Disability weight slaapverstoring (0,010) + hinder (0,011) = <strong>${dwTotal.toFixed(3)} DALY per gehinderde bewoner per jaar</strong> (<a href="https://www.who.int/europe/publications/i/item/WHO-EURO-2024-9196-48968-72969" target="_blank" rel="noopener">WHO Europe 2024</a>), over ${horizon} jaar, per categorie/ring en per hinderpercentage — zelfde populatie-logica als §5–§6. Het aantal gehinderde bewoners en DALY's is in elke tabel hieronder identiek; alleen de monetaire waardering per DALY verschilt (€50.000 RIVM, €70.000 PBL, €80.000 Zorginstituut Nederland) — daarom staan de drie waarderingen hier volledig uitgeschreven, niet slechts één ervan.</p>
    ${dalyTableFor(0)}
    ${dalyTableFor(1)}
    ${dalyTableFor(2)}
  </section>`;

  // ---- Sectie: kritische analyse frequentie + jaargemiddelden ----
  const bestDays = m6 ? m6.days.best : null, middelDays = m6 ? m6.days.middel : null, worstDays = m6 ? m6.days.worst : null;
  const analysisSection = `
  <section class="rp-section">
    <h2>8. Kritische analyse — hoe vaak, en waarom de kosten sowieso optreden</h2>
    <h3>8.1 Hoe vaak komt elk scenario voor?</h3>
    ${m6 ? `
    <table class="rp-table">
      <thead><tr><th>Scenario</th><th>Aandeel nachten/jaar</th><th>Aantal nachten/jaar</th></tr></thead>
      <tbody>
        ${scenarioRow('Best case (bewolkt, neutrale/goed-gemengde grenslaag)', 'best')}
        ${scenarioRow('Middel case (half bewolkt, zwak stabiele grenslaag — wSBL)', 'middel')}
        ${scenarioRow('Worst case (helder, zeer stabiele grenslaag — vSBL)', 'worst')}
      </tbody>
    </table>
    <p>Deze verdeling is gebaseerd op de klimatologie van Cabauw en Lutjewad (Module 6/7: Van den Berg 2004/2008, Abraham &amp; Monahan 2019a/b, Baas e.a. 2009) en varieert met de afstand van de turbine tot de kust en de breedtegraad (maandverdeling). Zie de "Beperkingen"-callout bij Module 6/7 in de app voor de volledige onderbouwing.</p>` : '<p><em>Geen turbine geplaatst — deze verdeling kan niet worden getoond.</em></p>'}

    <h3>8.2 Waarom maatschappelijke kosten sowieso optreden</h3>
    <p>De kern van deze analyse is dat <strong>Module 9 en 10 werken met jaargemiddelden</strong> (zorgkosten per jaar, DALY's per jaar), niet met een eenmalige worst-case-schatting. Dat heeft een directe consequentie die vaak wordt gemist in het maatschappelijke debat: het is <em>geen</em> vereiste dat een omwonende voortdurend in het worst-case-scenario zit om toch reële jaarlijkse kosten te ondervinden.</p>
    <ul class="rp-list">
      ${m6 ? `<li>Zelfs in het <strong>beste geval</strong> (bewolkt) doet het gunstigste regime zich ${bestDays} van de 365 nachten voor — de overige ${365 - bestDays} nachten (${m13Pct(100 - m6.pct.best)}) vallen in het middel- of worst-case-regime.</li>
      <li>Het <strong>worst-case-scenario</strong> is met ${worstDays} nachten per jaar (${m13Pct(m6.pct.worst)}) geen zeldzame uitschieter, maar een terugkerend, voorspelbaar onderdeel van het jaar — geconcentreerd in heldere, koude en meestal winterse/vroege-voorjaarsnachten (zie de maandverdeling in Module 6).</li>` : '<li><em>Geen turbine geplaatst — de precieze verdeling kan hier niet worden getoond, maar het onderliggende principe (zie hierna) geldt onafhankelijk van de locatie.</em></li>'}
      <li>Omdat elk jaar <em>alle drie</em> de regimes met zekerheid optreden (in wisselende verhouding), is een jaargemiddelde zorgkosten- of DALY-schatting geen overschatting gebaseerd op een hypothetisch ergst geval — het is een <strong>gewogen gemiddelde van drie regimes die elk jaar daadwerkelijk plaatsvinden</strong>. De vraag is dus niet <em>of</em> deze kosten optreden, maar uitsluitend hoe ze zich verdelen over het jaar en welk hinderpercentage (9/30/46%, zie §5) het meest representatief is voor de specifieke situatie.</li>
      <li>Dit maakt de maatschappelijke kosten in §9 hieronder structureel, terugkerend en niet-hypothetisch — in tegenstelling tot de investeringskosten in Module 12, die eenmalig zijn.</li>
    </ul>

    <h3>8.3 Het jaargemiddelde is een beleidsgetal, geen ervaringsgetal</h3>
    <p><strong>Wie wil weten wat een omwonende daadwerkelijk als beperking van zijn geluidshinder ervaart, moet het jaargemiddelde uit §10 loslaten en naar de worst-case-kolom in §5–§7 kijken.</strong> Een jaargemiddelde is een nuttig getal voor een langjarige maatschappelijke-kostenraming (§8.2), maar het is per definitie een afgevlakt gemiddelde over drie regimes — en verhult daardoor precies de piekbelasting die de norm zou moeten begrenzen. Een omwonende ligt niet 's nachts in een "gewogen gemiddelde" wakker; die ervaart op ${worstDays != null ? worstDays : 'de'} worst-case-nachten per jaar (${m6 ? m13Pct(m6.pct.worst) : '—'} van alle nachten) het volle, ongedempte niveau.</p>
    ${(() => {
      const worstRow = catMatrix.find((t) => t.scenario === 'worst');
      const wHoorbaar = worstRow ? worstRow.categories.find((c) => c.key === 'hoorbaar') : null;
      const wInfrasoon = worstRow ? worstRow.categories.find((c) => c.key === 'infrasoon') : null;
      const wH46 = wHoorbaar ? wHoorbaar.hinder[2] : null;
      const wI46 = wInfrasoon ? wInfrasoon.hinder[2] : null;
      if (!wH46 || wH46.people == null) {
        return '<p class="rp-note"><em>Geen BAG-gegevens of geen turbine geplaatst — het worst-case-piekcijfer kan hier niet worden getoond.</em></p>';
      }
      return `<ul class="rp-list">
        <li>Op een worst-case-nacht vallen <strong>${wHoorbaar.houses.toLocaleString('nl-NL')} woningen</strong> binnen de hoorbaar-overschrijdingsring, met bij het kritische 46%-hinderpercentage naar schatting <strong>${m13Int(wH46.people)} gehinderde bewoners</strong> — dit is het getal dat de daadwerkelijke ernst van een worst-case-nacht weergeeft, niet het over drie regimes uitgesmeerde jaargemiddelde uit §10 (${hoorbaarCrit && hoorbaarCrit.people != null ? m13Int(hoorbaarCrit.people) : '—'} bewoners, hoorbaar/46%).</li>
        ${wI46 && wI46.people != null ? `<li>Wordt hetzelfde kritische percentage illustratief op de (grotere) infrasoonring toegepast, loopt dit op tot <strong>${m13Int(wI46.people)} bewoners</strong> op een enkele worst-case-nacht — een cijfer dat in een jaargemiddelde volledig verdwijnt tussen de rustiger best- en middel-case-nachten.</li>` : ''}
        <li>Beleid dat uitsluitend het jaargemiddelde rapporteert (zoals de vergelijking in §10) onderschat daarmee systematisch wat er op de kritieke nachten zelf gebeurt. Voor toetsing aan een gezondheidskundige norm — in plaats van een financiële raming — is het worst-case-cijfer de relevante maatstaf, niet het gemiddelde.</li>
      </ul>`;
    })()}

    <h3>8.4 Rekenvoorbeeld: haalt de nachtnorm het als jaargemiddelde tóch, ondanks deze piekwaarden?</h3>
    <p>Het jaargemiddelde in §8.3 was een kwalitatief punt; hier volgt het concrete rekenvoorbeeld, nu voor alle drie geluidscategorieën apart (hoorbaar, laagfrequent, infrasoon — bewust niet samengevoegd, want dat zijn verschillende eenheden). De Lnight-norm bij Module 5 (${norm.lnight != null ? norm.lnight + ' dB(A)' : '—'}) is zelf wettelijk óók een jaargemiddelde, geen grenswaarde per nacht; voor laagfrequent/infrasoon dient deze norm uitsluitend als indicatief referentiepunt, niet als wettelijk toetsingskader. De vraag is dus: als een woning op de worst-case-overschrijdingsring van §5 ligt, wordt de norm dán als jaargemiddelde alsnog gehaald, doordat de meeste nachten milder zijn? Onderstaande tabellen rekenen dit uit per scenario én per richting — downwind (kritisch), zijwind en upwind (het minst belastend) hebben elk hun eigen overschrijdingsring en dus een eigen jaargemiddelde — door voor elke scenario/richting-combinatie het energetisch jaargemiddelde te bepalen — gewogen met de daadwerkelijke scenarioverdeling van §8.1 — en dat gemiddelde opnieuw aan de norm te toetsen: <code>L_jaar = 10·log₁₀(Σ p_i·10^(L_i/10))</code>.</p>
    ${(() => {
      const catResults = {};
      JAARNORM_CATEGORIES.forEach((cat) => { catResults[cat.key] = m8JaarnormRows(cat.key); });
      const jn = catResults.hoorbaar;
      if (!jn) {
        return '<p class="rp-note"><em>Geen turbine geplaatst, of de gekozen norm heeft geen Lnight-waarde — dit rekenvoorbeeld kan niet worden getoond.</em></p>';
      }
      const catTablesHtml = JAARNORM_CATEGORIES.map((cat) => {
        const result = catResults[cat.key];
        const rowsHtml = result.rows.map((row) => {
          if (row.ring == null) {
            return `<tr><td>${M8_SCENARIO_LABEL[row.scenario]}-ring</td><td>${row.directionLabel}</td><td colspan="4"><em>Geen overschrijding op de vaste ringen.</em></td></tr>`;
          }
          return `<tr>
            <td>${M8_SCENARIO_LABEL[row.scenario]}-ring</td>
            <td>${row.directionLabel}</td>
            <td>${m8RingLabel(row.ring)}</td>
            <td>${row.levels.best.toFixed(1)} / ${row.levels.middel.toFixed(1)} / ${row.levels.worst.toFixed(1)} ${cat.unit}</td>
            <td><strong>${row.jaargemiddelde.toFixed(1)} ${cat.unit}</strong></td>
            <td>${row.exceeds ? '<strong>Overschrijding</strong>' : 'Binnen de norm'}</td>
          </tr>`;
        }).join('');
        return `<p class="rp-note"><strong>${cat.label} (${cat.unit})</strong>${cat.indicatief ? ' — indicatief referentiepunt, geen wettelijke norm in deze eenheid' : ''}</p>
        <table class="rp-table rp-table-compact">
          <thead><tr><th>Ring (bepaald door)</th><th>Richting</th><th>Afstand</th><th>L best / middel / worst</th><th>Jaargemiddelde</th><th>Toetsing</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>`;
      }).join('');
      const stilX = state.m8StilstandNachten || 0;
      const nachten = m8NachtenVanPct(jn.pct);
      // Grafiek + tabel per categorie, altijd getoond (ook bij stilX = 0) — zelfde opbouw als de
      // interactieve versie in de webapp (m8StilstandChartSvg/m8StilstandCurvePoints), maar met vaste
      // hex-kleuren omdat dit rapport een losstaand, altijd licht HTML-document is (geen CSS var()).
      const catChartsHtml = JAARNORM_CATEGORIES.map((cat) => {
        const result = catResults[cat.key];
        const worstRows = result.rows.filter((r) => r.scenario === 'worst');
        const chartSeries = worstRows
          .filter((r) => r.ring != null && r.levels != null)
          .map((r) => ({
            label: r.directionLabel,
            color: M8_CHART_COLORS_REPORT[r.direction],
            points: m8StilstandCurvePoints(r.levels, jn.pct, nachten),
          }));
        if (chartSeries.length === 0) return '';
        const rowsHtml = worstRows.map((r) => {
          if (r.ring == null || r.levels == null) {
            return `<tr><td>${r.directionLabel}</td><td colspan="3"><em>Geen overschrijding op de vaste ringen.</em></td></tr>`;
          }
          const na = m8JaargemiddeldeMetStilstand(r.levels, jn.pct, stilX);
          const verschil = r.jaargemiddelde - na.jaargemiddelde;
          return `<tr>
            <td>${r.directionLabel}</td>
            <td>${r.jaargemiddelde.toFixed(1)} ${cat.unit}</td>
            <td><strong>${na.jaargemiddelde.toFixed(1)} ${cat.unit}</strong></td>
            <td>${verschil > 0.05 ? '−' + verschil.toFixed(1) : '0,0'} ${cat.unit}</td>
          </tr>`;
        }).join('');
        return `<p class="rp-note"><strong>${cat.label} (${cat.unit}) — worst-case-ring</strong></p>
        <div class="rp-avoid-break">
          ${m8StilstandChartSvg(chartSeries, norm.lnight, cat.indicatief, cat.unit, stilX)}
          <div class="m8-chart-legend">
            ${chartSeries.map((s) => `<span><i class="m8-chart-dot" style="background:${s.color}"></i>${s.label}</span>`).join('')}
            ${norm.lnight != null ? `<span><i class="m8-chart-dot m8-chart-dot-norm"></i>Norm${cat.indicatief ? ' (indicatief)' : ''}</span>` : ''}
          </div>
          <p class="rp-note">Jaargemiddelde (${cat.unit}) op de worst-case-ring, per richting, bij 0 t/m 365 stilstandnachten per jaar. De stip markeert de huidige invoer (${stilX} nacht${stilX === 1 ? '' : 'en'}).</p>
        </div>
        <table class="rp-table rp-table-compact">
          <thead><tr><th>Richting</th><th>Jaargemiddelde (huidig)</th><th>Jaargemiddelde (met stilstand)</th><th>Verschil</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>`;
      }).join('');
      let stilHtml = '';
      if (stilX > 0) {
        const verdeling = m8VerdeelStilstand(nachten, stilX);
        stilHtml = `<h4>8.4b Effect van ${stilX} stilstandnacht${stilX === 1 ? '' : 'en'} per jaar op het jaargemiddelde</h4>
        <p>Bij een stilstandvoorziening van ${stilX} nacht${stilX === 1 ? '' : 'en'} per jaar (bij voorrang de zwaarste nachten stilgezet: eerst worst case, dan middel, dan best case; op een stilstandnacht is de turbinebijdrage 0 dB): ${nachten.nWorst} → ${verdeling.nWorst} worst case, ${nachten.nMiddel} → ${verdeling.nMiddel} middel, ${nachten.nBest} → ${verdeling.nBest} best case, plus ${verdeling.nStil} stilstandnachten. De onderstaande grafieken laten dit effect zien over het volledige bereik van 0 t/m 365 stilstandnachten per jaar; de tabellen tonen het concrete verschil bij de huidige invoer, voor de worst-case-ring (de meest conservatieve/beleidsmatig relevante ring per richting):</p>
        ${catChartsHtml}`;
      } else {
        stilHtml = `<h4>8.4b Effect van stilstandnachten op het jaargemiddelde</h4>
        <p class="rp-note"><em>In de interactieve versie van dit model is momenteel geen stilstandvoorziening ingesteld (0 nachten/jaar) — de tabellen hieronder tonen daarom nog geen verschil. Via het invoerveld bij deze module in de webapp kan een aantal stilstandnachten per jaar worden opgegeven. De grafieken laten niettemin het volledige effect zien over het hele bereik van 0 t/m 365 stilstandnachten per jaar.</em></p>
        ${catChartsHtml}`;
      }
      return `<p>Scenarioverdeling op deze locatie (§8.1, Module 6): best ${jn.pct.best.toFixed(1)}%, middel ${jn.pct.middel.toFixed(1)}%, worst ${jn.pct.worst.toFixed(1)}% van alle nachten per jaar (${nachten.nBest}/${nachten.nMiddel}/${nachten.nWorst} van de ${M8_JAAR_NACHTEN} nachten).</p>
      ${catTablesHtml}
      <p class="rp-note"><strong>Methodologische kanttekening:</strong> ook dit rekenvoorbeeld is een modelmatige schatting, geen meting. De scenario-percentages zijn afgeleid uit de afstand tot de kust en de shear-capaciteit (§8.1, Module 6/7) — geen gemeten jaarstatistiek van weerscondities per nacht op deze exacte locatie. De berekening neemt bovendien aan dat een hele nacht steeds volledig in één scenario valt (geen overgangen binnen één nacht). De jaargemiddelde toetsing wordt hier expliciet voor drie richtingen apart doorgerekend (downwind/zijwind/upwind), in plaats van uitsluitend voor de kritische downwind-richting — zodat zichtbaar is dat een woning die niet downwind van de turbine ligt bij hetzelfde scenario een lager jaargemiddelde ondervindt en de norm eerder haalt. Hoorbaar, laagfrequent en infrasoon geluid worden hier bewust niet tot één getal samengevoegd (zie ook de kanttekening bij §8.3 over optellen over categorieën).</p>
      ${stilHtml}`;
    })()}
  </section>`;

  // ---- Sectie: waardedaling (los van scenario) ----
  const valueSection = `
  <section class="rp-section">
    <h2>9. Waardedaling van woningen</h2>
    <p><strong>Let op — dit is de uitzondering op de best/middel/worst-indeling:</strong> waardedaling door de aanwezigheid van een turbine is, anders dan §4–7 hierboven, <strong>niet</strong> gekoppeld aan het nachtelijke geluidsscenario. Het is een blijvend effect van de turbine op de woningmarkt, niet een functie van de heersende atmosferische omstandigheden op een gegeven nacht — vandaar één vaste waarde in plaats van een best/middel/worst-uitsplitsing.</p>
    ${m11.hasData ? `
    <table class="rp-table">
      <thead><tr><th>Tiphoogte-categorie</th><th>Methode</th><th>Woningen</th><th>Totale waardedaling</th><th>Eigen risico (NMR ≤4%)</th><th>Compensabele planschade (&gt;4%)</th></tr></thead>
      <tbody><tr>
        <td>${escapeHtml(m11.meta.label)}</td>
        <td>${m11.method === 'band' ? 'Afstandsbanden (Fig. 6)' : 'Vlak percentage'}</td>
        <td>${m11.totals.woningen.toLocaleString('nl-NL')}</td>
        <td>€${Math.round(m11.totals.waarde).toLocaleString('nl-NL')}</td>
        <td>€${Math.round(m11.totals.eigen).toLocaleString('nl-NL')}</td>
        <td>€${Math.round(m11.totals.compensabel).toLocaleString('nl-NL')}</td>
      </tr></tbody>
    </table>
    <p>Bron: <a href="https://doi.org/10.1016/j.enpol.2021.112327" target="_blank" rel="noopener">Droës &amp; Koster (2021), "Wind turbines, solar farms, and house prices", Energy Policy 155, 112327</a>. WOZ-uitgangswaarde: €${state.m11Woz.toLocaleString('nl-NL')}.</p>` : '<p><em>Geen BAG-gegevens of geen turbine geplaatst — waardedaling kan niet worden berekend.</em></p>'}
  </section>`;

  // ---- Sectie: maatschappelijke kosten vs. investeringskosten — PER CATEGORIE (niet meer geblend) ----
  const socRowsHtml = catSocByPct.map((cat) => cat.byPct.map((s, sIdx) => `<tr>
    ${sIdx === 0 ? `<td rowspan="3">${cat.label}</td>` : ''}
    <td>${s.pct}% <span class="rp-src">(${escapeHtml(s.label)})</span></td>
    <td>${s.people != null ? m13Int(s.people) : '—'}</td>
    <td>${s.costHorizon != null ? m9FmtEuro(s.costHorizon) : '—'}</td>
    <td>${s.dalyHorizon != null ? m10FmtDaly(s.dalyHorizon) : '—'}</td>
    <td>${s.euro70k != null ? m9FmtEuro(s.euro70k) : '—'}</td>
    <td>${socTotal(s) != null ? m9FmtEuro(socTotal(s)) : '—'}</td>
  </tr>`).join('')).join('');
  const compareSection = `
  <section class="rp-section">
    <h2>10. Kritische vergelijking: maatschappelijke kosten versus investeringskosten</h2>
    <p>De "maatschappelijke kosten" hieronder zijn, <strong>per geluidscategorie apart</strong>, de som van drie componenten: waardedaling van woningen (§9, eenmalig maar reëel verlies voor eigenaren, categorie-onafhankelijk), zorgkosten (§6, jaarlijks terugkerend over ${horizon} jaar) en het DALY-verlies gewaardeerd tegen €70.000/DALY (§7, PBL-waarde, jaarlijks terugkerend over ${horizon} jaar). Omdat het jaargemiddelde blootstelling betreft (§8.2), is dit geen worst-case-optelsom maar een <strong>jaargewogen gemiddelde</strong> over het best/middel/worst-scenario, per categorie en hinderpercentage. Categorieën worden hier <strong>niet</strong> bij elkaar opgeteld: hoorbaar, laagfrequent en infrasoon zijn verschillende geluidstypen met eigen ringen en verschillende bewijskracht voor het toegepaste hinderpercentage (zie §5) — optellen zou tot dubbeltelling en categoriefouten leiden.</p>
    <table class="rp-table rp-table-compact">
      <thead><tr><th>Categorie</th><th>Hinderpercentage</th><th>Bewoners (jaargewogen)</th><th>Zorgkosten (${horizon} jr)</th><th>DALY (${horizon} jr)</th><th>DALY-waarde (€70k)</th><th>Totaal maatsch. kosten¹</th></tr></thead>
      <tbody>${socRowsHtml}</tbody>
    </table>
    <p class="rp-note">¹ Zorgkosten + DALY-waarde (€70k) + waardedaling (§9, eenmalig, niet scenario- of categorieafhankelijk — daarom in elke rij hetzelfde bedrag opgeteld). <strong>Hoorbaar</strong> is de wetenschappelijk best onderbouwde rij (RIVM/Pawlaczyk-onderzoek betreft hoorbaar geluid, §5); laagfrequent/infrasoon zijn illustratieve toepassingen van dezelfde hinderpercentages op hun eigen (grotere) ringpopulatie.</p>
    ${hasM12 ? `
    <p><strong>Investeringskosten (Module 12):</strong> ${m12rows.length} turbinegroep(en), totaal ${m12TotalVermogen.toLocaleString('nl-NL', { maximumFractionDigits: 2 })} MW, totale investering <strong>${m9FmtEuro(m12TotalInvest)}</strong>.</p>
    <div class="rp-callout rp-warn">
      <strong>Dit is geen appels-met-appels-vergelijking — en dat is precies het kritische punt:</strong>
      <ul class="rp-list">
        <li>De investeringskosten zijn <strong>eenmalig kapitaal</strong> van de projectontwikkelaar/investeerder, terugverdiend over de exploitatieperiode via energieverkoop (en doorgaans SDE++-subsidie) — een bedrijfseconomische kostenpost voor één partij.</li>
        <li>De maatschappelijke kosten zijn grotendeels <strong>jaarlijks terugkerende, gespreide lasten voor omwonenden</strong> — een andere partij, die geen deel heeft in de opbrengsten van de turbine.</li>
        <li>Op basis van de wetenschappelijk best onderbouwde rij (<strong>hoorbaar geluid, kritisch hinderpercentage 46%</strong>, §5) bedraagt de geschatte maatschappelijke kostenpost over ${horizon} jaar <strong>${hoorbaarCritTotal != null ? m9FmtEuro(hoorbaarCritTotal) : '—'}</strong>, tegenover een investering van <strong>${m9FmtEuro(m12TotalInvest)}</strong> — dat is <strong>${(hoorbaarCritTotal != null && m12TotalInvest > 0) ? (hoorbaarCritTotal / m12TotalInvest * 100).toLocaleString('nl-NL', { maximumFractionDigits: 0 }) + '%' : '—'}</strong> van de investering, puur aan externe kosten die niet in de businesscase van de ontwikkelaar zitten. Wordt hetzelfde hinderpercentage illustratief ook op de (grotere) infrasoonring toegepast, loopt dit op tot <strong>${infrasoonCritTotal != null ? m9FmtEuro(infrasoonCritTotal) : '—'}</strong> (<strong>${(infrasoonCritTotal != null && m12TotalInvest > 0) ? (infrasoonCritTotal / m12TotalInvest * 100).toLocaleString('nl-NL', { maximumFractionDigits: 0 }) + '%' : '—'}</strong>) — dat bovenste cijfer heeft echter geen eigen hinderstudie als onderbouwing (zie §5) en dient uitsluitend als gevoeligheidsindicatie.</li>
        <li>Deze externe kosten worden in de huidige vergunningverlening <strong>niet gecompenseerd of geïnternaliseerd</strong> (behalve, deels, via planschadevergoeding bij waardedaling boven de 4% NMR-drempel, §9) — ze blijven bij de omwonenden liggen, wat de aanleiding is voor het advies in §11.</li>
      </ul>
    </div>` : m12Banner}
  </section>`;

  // ---- Sectie: advies ----
  const advisorySection = `
  <section class="rp-section">
    <h2>11. Advies — internationale voorbeelden en normstelling</h2>
    <p>Nederland toetst windturbinegeluid uitsluitend op hoorbaar geluid (dB(A), Lden/Lnight) en kent <strong>geen enkele normstelling voor laagfrequent of infrasoon geluid</strong> — een leemte die drie landen om ons heen op uiteenlopende manieren hebben ingevuld.</p>

    <h3>11.1 Denemarken — expliciete LFN-norm</h3>
    <p>Denemarken hanteert sinds de <a href="https://eng.mst.dk/media/urbm0xut/statutory-order-on-noise-from-wind-turbines-2019-version.pdf" target="_blank" rel="noopener">Bekendtgørelse nr. 1284 van 15 december 2011</a> een bindende, <strong>berekende</strong> (niet gemeten) binnenwaarde voor laagfrequent geluid van windturbines: <strong>20 dB(A) in de avond (19-22u) en nacht (22-07u)</strong>, en 25 dB(A) overdag, in het 10-160 Hz-gebied per 1/3-octaafband. Deze norm bestond al als algemene richtlijn voor andere geluidsbronnen (<a href="https://eng.mst.dk/industry/noise/wind-turbines" target="_blank" rel="noopener">Deense Milieuagentschap</a>), maar werd in 2011 specifiek voor windturbines tot een verplichte, bij vergunningverlening te berekenen grenswaarde gemaakt — zie ook <a href="https://journals.sagepub.com/doi/pdf/10.1260/0263-0923.31.4.239" target="_blank" rel="noopener">Jakobsen (2012)</a> voor de onderliggende motivatie.</p>

    <h3>11.2 Duitsland — dynamische, weersafhankelijke nachtmodus</h3>
    <p>Duitsland heeft geen apart LFN-getal, maar kent via de <a href="https://de.wikipedia.org/wiki/Technische_Anleitung_zum_Schutz_gegen_L%C3%A4rm" target="_blank" rel="noopener">TA Lärm</a> gebiedsafhankelijke nachtnormen (35 dB(A) in reine Wohngebiete, 40 dB(A) in allgemeine Wohngebiete, 45 dB(A) in dorps-/mengbestemmingen) én de praktijk van <strong>"schallreduzierter nächtlicher Betrieb"</strong>: vergunningen kunnen een nachtelijke bedrijfsmodus voorschrijven die <em>afhankelijk van de heersende windsnelheid</em> vermogen (en daarmee geluid) terugregelt, om overschrijding te voorkomen zonder de turbine het hele jaar op verminderd vermogen te laten draaien. Deze aanpak — vermogensreductie precies op de momenten dat de omstandigheden risicovol zijn — werd nog in januari 2026 door het Bundesverwaltungsgericht bevestigd als toelaatbare vergunningsvoorwaarde (<a href="https://www.bverwg.de/pm/2025/4" target="_blank" rel="noopener">BVerwG, persbericht nr. 4/2025</a>).</p>

    <h3>11.3 WHO 2018 — een expliciete leemte, juist voor de nacht</h3>
    <p>De <a href="https://iris.who.int/bitstream/handle/10665/343936/WHO-EURO-2018-3287-43046-60243-eng.pdf" target="_blank" rel="noopener">WHO Environmental Noise Guidelines (2018)</a> geven voor windturbines een voorwaardelijke aanbeveling van Lden &lt;45 dB, maar <strong>expliciet geen Lnight-aanbeveling</strong> — als enige geluidsbron in de gehele richtlijn (wegverkeer, spoor en luchtvaart krijgen alle drie wél een Lnight-waarde). De WHO motiveert dit met de te lage bewijskwaliteit van de beschikbare nachtstudies, niet met de conclusie dat nachtelijke blootstelling onbelangrijk zou zijn (<a href="https://www.wbm.co.uk/wp-content/uploads/2018/11/WBM-WHO-2018-Summary-Nov-2018.pdf" target="_blank" rel="noopener">WBM-samenvatting</a>). Dit is relevant omdat dit rapport net laat zien dat de nacht de kern van het probleem is — precies waar de WHO geen harde ondergrens durft te trekken.</p>

    <h3>11.4 Aanbeveling voor Nederland</h3>
    <ol class="rp-list">
      <li><strong>Introduceer een Nederlandse LFN-norm naar Deens voorbeeld:</strong> een berekende binnenwaarde van orde 20 dB(A) in de 10-160 Hz-band voor de avond/nacht (met een ruimere dagwaarde), als aanvulling op — niet vervanging van — de bestaande hoorbaar-geluidnorm. Dit dicht de leemte die dit rapport in §4/§5 blootlegt: laagfrequent en infrasoon geluid worden nu alleen indicatief getoond, niet getoetst.</li>
      <li><strong>Koppel operationele maatregelen aan de scenario-detectie van Module 6/7:</strong> verplicht een noise-reduced-operation-modus (vermogensreductie) op nachten waarin de klimatologische/shear-capacity-indicatoren een worst-case (vSBL-)regime voorspellen, naar het Duitse precedent van een weersafhankelijke nachtmodus — in plaats van het hele jaar een vaste, permanente afregeling die op de meeste nachten onnodig is en op de kritieke nachten mogelijk nog steeds ontoereikend.</li>
      <li><strong>Houd cumulatie in de gaten (Module 4):</strong> bij meerdere turbines of naburige windparken moet de geluidsbijdrage energetisch worden opgeteld op het rekenpunt, niet per turbine afzonderlijk getoetst — een op zichzelf toelaatbare turbine kan gecombineerd met naburige turbines de norm alsnog doen overschrijden. Dit rapport rekent per turbinepositie; bij meerdere naburige projecten dient een gezamenlijke cumulatietoets te worden uitgevoerd.</li>
      <li><strong>Onafhankelijke verificatie na realisatie:</strong> vul de vooraf berekende prognose (zoals in dit model) aan met verplichte post-constructiemeting, zoals in de Duitse praktijk gebruikelijk is bij een schallreduzierter Betrieb — een berekende prognose is per definitie een model, geen meting van de werkelijke situatie.</li>
      <li><strong>Verplicht het worst-case-cijfer naast het jaargemiddelde te rapporteren, niet in plaats daarvan:</strong> zie §8.3 — een jaargemiddelde maatschappelijke-kostenraming (§10) is toelaatbaar voor een financiële afweging, maar ontoereikend als gezondheidskundige toets. Vergunningverlening moet dwingend het piekcijfer op een worst-case-nacht (§5, 46%-scenario) laten zien, anders wordt de daadwerkelijke beperking van omwonenden weggemiddeld tot een cijfer dat niemand op de kritieke nachten zelf ervaart.</li>
    </ol>
  </section>`;

  // ---- Sectie: Position paper (A-weging) — dynamisch, o.b.v. Module 8a en de actuele turbinepositie(s) ----
  const m13aFindRow = (scenario, catKey) => {
    const s = rows8a.find((rr) => rr.scenario === scenario);
    if (!s) return null;
    return s.rows.find((rr) => rr.catKey === catKey && rr.periodLabel === 'Nacht') || null;
  };
  const m13aPctRound = (row) => (row && row.afnamePct != null) ? Math.round(row.afnamePct) : null;
  const m13aErased = (row) => m13aPctRound(row) != null && m13aPctRound(row) >= 100;
  const m13aResidual = (row) => m13aPctRound(row) != null && m13aPctRound(row) < 100 && row.housesM8a > 0;
  const m13aScenarios = ['best', 'middel', 'worst'];
  const lfNightRows = m13aScenarios.map((sc) => ({ scenario: sc, label: M8_SCENARIO_LABEL[sc], row: m13aFindRow(sc, 'laagfrequent') }));
  const infraNightRows = m13aScenarios.map((sc) => ({ scenario: sc, label: M8_SCENARIO_LABEL[sc], row: m13aFindRow(sc, 'infrasoon') }));
  const lfHasAnyData = lfNightRows.some((x) => x.row && x.row.housesM8 != null);
  const infraHasAnyData = infraNightRows.some((x) => x.row && x.row.housesM8 != null);
  const lfResidual = lfNightRows.filter((x) => m13aResidual(x.row));
  const infraResidual = infraNightRows.filter((x) => m13aResidual(x.row));
  const lfErasedCount = lfNightRows.filter((x) => m13aErased(x.row)).length;
  const infraErasedCount = infraNightRows.filter((x) => m13aErased(x.row)).length;

  const m13aResidualSentence = (label, residual, erasedCount) => {
    if (residual.length === 0) {
      return `voor <strong>${label}</strong> verdwijnt de overschrijding in alle drie de scenario's (best/middel/worst) volledig na A-weging (${erasedCount}/3 op nul woningen na weging)`;
    }
    const worst = residual[residual.length - 1];
    return `voor <strong>${label}</strong> blijft in ${residual.length} van de 3 scenario's een overschrijding over na A-weging — het zwaarste geval (${worst.label.toLowerCase()}) resulteert in <strong>${m13Int(worst.row.housesM8a)} van de ${m13Int(worst.row.housesM8)} woningen</strong> die zonder A-weging binnen de overschrijdingsring zouden vallen (een afname van &ldquo;slechts&rdquo; ${m13aPctRound(worst.row)}% in plaats van 100%)`;
  };

  const m13aTableRow = (scenarioLabel, catLabel, row) => {
    if (!row || row.housesM8 == null) {
      return `<tr><td>${scenarioLabel}</td><td>${catLabel}</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`;
    }
    return `<tr><td>${scenarioLabel}</td><td>${catLabel}</td><td>${row.lwM8.toFixed(1)} ${row.unweightedUnit} → ${row.lwM8a.toFixed(1)} dB(A)</td><td>${row.deltaDb != null ? row.deltaDb.toFixed(1) : '—'}</td><td>${m13Int(row.housesM8)} → ${m13Int(row.housesM8a)}</td><td>${row.afnamePct != null ? '−' + Math.round(row.afnamePct) + '%' : '—'}</td></tr>`;
  };

  const positioningPaperSection = (hasBag && (lfHasAnyData || infraHasAnyData)) ? `
  <section class="rp-section rp-avoid-break">
    <h2>12. Position paper: A-weging maskeert laagfrequent en infrasoon geluid</h2>
    <h3>12.1 Kernboodschap</h3>
    <p><strong>De Nederlandse geluidsnorm voor windturbines (${escapeHtml(norm.label)}${norm.lnight != null ? `, Lnight ≤ ${norm.lnight} dB` : ''}) rekent uitsluitend in A-gewogen decibellen — de eenheid die is afgestemd op het menselijk gehoor voor gewoon, hoorbaar geluid. Op laagfrequent geluid (20–125 Hz) trekt die weging tot circa 39 dB af; op infrasoon geluid (&lt;20 Hz) tot bijna 78 dB. Doorgerekend op de hierboven vermelde turbinepositie(s) ${m13aResidualSentence('infrasoon geluid', infraResidual, infraErasedCount)}, en ${m13aResidualSentence('laagfrequent geluid', lfResidual, lfErasedCount)} — niet omdat er geen geluid meer is, maar omdat de meetmethode het numeriek onzichtbaar maakt.</strong></p>
    <p>Dat is geen bijverschijnsel maar een <strong>cirkelredenering</strong>: eerst een filter toepassen dat specifiek laagfrequent en infrasoon geluid onderdrukt, en vervolgens concluderen dat er geen probleem is (<a href="https://sonavyx.com/en/insights/iec-61672-1-frequency-weighting" target="_blank" rel="noopener">SonaVyx</a>). Denemarken doorbrak die redenering in 2012 met een aparte, ongewogen LFG-norm, getoetst bij representatieve <em>ongunstige</em> windsnelheden (6–8 m/s) in plaats van een jaargemiddelde (<a href="https://docs.wind-watch.org/vandenBerg-SoundOfHighWinds.pdf" target="_blank" rel="noopener">Van den Berg</a>). Nederland heeft die stap nooit gezet: de overheid achtte een aparte norm voor laagfrequent geluid &ldquo;tot nog toe onnodig&rdquo; (<a href="https://www.rivm.nl/sites/default/files/2018-11/Kennisbericht_Geluid_van_windturbines_versie_1punt0_20150611.pdf" target="_blank" rel="noopener">RIVM, 2015</a>), en beantwoordt Kamervragen over aanhoudende klachten met de stelling dat er &ldquo;geen reden&rdquo; is voor aanvullende normen (<a href="https://zoek.officielebekendmakingen.nl/ah-tk-20202021-620.html" target="_blank" rel="noopener">Rijksoverheid</a>).</p>
    ${lfResidual.length > 0 ? `<p>Het scenario met de grootste resterende overschrijding na A-weging — <strong>${lfResidual[lfResidual.length - 1].label.toLowerCase()}, nacht, laagfrequent</strong> — is precies het type piekmoment dat een jaargemiddelde Lnight-toets wegmiddelt tussen de vele rustigere nachten (zie §8.3). Dat scenario, niet het jaargemiddelde, is het scenario waarop beleid en vergunningverlening zich zouden moeten richten als het doel is om laagfrequente en infrasone hinder daadwerkelijk te kunnen zien voordat een vergunning wordt verleend.</p>` : `<p>Bij deze turbinepositie(s) verdwijnt de overschrijding voor beide categorieën in alle drie de scenario's volledig na A-weging. Dat betekent niet dat er geen laagfrequent of infrasoon geluid is — het betekent dat de gekozen meetmethode het bij deze specifieke plaatsing numeriek volledig onzichtbaar maakt, en dat een andere plaatsing (dichter bij woningen, of een zwaardere turbine) dit beeld kan omslaan naar een resterende overschrijding zoals bij een minder gunstige locatie.</p>`}

    <h3>12.2 Waar dit rapport is getoetst</h3>
    <p>De cijfers hierboven zijn niet abstract: ze zijn doorgerekend op de ${n} hierboven vermelde turbinepositie(s) (${escapeHtml(turbineList)}, bronvermogen ${state.lwa.toFixed(1)} dB(A)), met de zes vaste toetsingsringen van het model (500 / 900 / 1.300 / 1.500 / 2.000 / 5.000 m).</p>
    ${m13MapImagesHtml(mapViews, turbineList)}

    <h3>12.3 Wat de A-weging numeriek wegfiltert</h3>
    <table class="rp-table rp-table-compact">
      <thead><tr><th>Scenario</th><th>Categorie</th><th>Bronniveau<br><span class="rp-src">ongewogen → A-gewogen</span></th><th>Δ (dB)</th><th>Woningen<br><span class="rp-src">ongewogen → A-gewogen</span></th><th>Afname</th></tr></thead>
      <tbody>
        ${lfNightRows.map((x) => m13aTableRow(x.label, 'Laagfrequent', x.row)).join('')}
        ${infraNightRows.map((x) => m13aTableRow(x.label, 'Infrasoon', x.row)).join('')}
      </tbody>
    </table>
    <p class="rp-note">Alle rijen betreffen de nachtperiode (zie §2); cijfers afgeleid van Module 8a, ringen en woningtellingen zoals gedefinieerd in Module 3/8.</p>

    <h3>12.4 Beperkingen van Module 8a en beleidsaanbevelingen</h3>
    <p>Module 8a maakt het effect van A-weging zichtbaar, maar heeft zelf vijf methodologische beperkingen. Elke beperking wijst naar een concrete stap die nodig is om de onderliggende blinde vlek in de bestaande normstelling weg te nemen — niet in het model, maar in beleid en vergunningverlening.</p>
    <ol class="rp-list">
      <li><strong>Geen wettelijk vastgestelde dag-norm.</strong> Het model toetst de dag-periode indicatief aan dezelfde Lnight-waarde als de nacht, omdat een aparte wettelijke dagnorm voor laagfrequent/infrasoon geluid ontbreekt. <em>Aanbeveling:</em> introduceer een expliciete, aparte toetsingswaarde voor laagfrequent en infrasoon geluid overdag, analoog aan de bestaande Lden/Lnight-tweedeling voor hoorbaar geluid.</li>
      <li><strong>A-gewogen infrasoon is een rekenexercitie, geen erkende meetmethode.</strong> Er bestaat geen gepubliceerde praktijkstandaard die infrasoon geluid van windturbines routinematig A-weegt en tegen de Lnight-norm toetst. <em>Aanbeveling:</em> herstel een onafhankelijk, doorlopend expertiseplatform voor windturbinegeluid met een specifiek mandaat voor laagfrequent/infrasoon meting — de eerdere pilot van het Kennisplatform Windenergie werd na evaluatie stopgezet en niet uitgebreid (<a href="https://zoek.officielebekendmakingen.nl/kst-33612-61.pdf" target="_blank" rel="noopener">Kamerstuk 33 612, nr. 61</a>); laat dat platform een erkende, ongewogen meetmethode vaststellen vóórdat nieuwe vergunningen worden verleend.</li>
      <li><strong>Toetsingsring van 5 km ligt ruim binnen de werkelijke reikwijdte van infrasoon.</strong> Overschrijdingsafstanden worden afgerond op de eerstvolgende vaste ring, met 5.000 m als maximum. Onder gunstige atmosferische omstandigheden kan infrasoon van grote turbines zich over meer dan 10 km verspreiden (<a href="https://www.sciencedirect.com/science/article/pii/S0003682X26000817" target="_blank" rel="noopener">Mattsson e.a., 2026</a>), en wordt infrasoon volgens andere bronnen in de standaard emissiemeting (20–20.000 Hz) in het geheel niet meegenomen (<a href="https://www.platformwindenergiedezijpe.nl/wp-content/uploads/2020/11/Geluid-windturbines.pdf" target="_blank" rel="noopener">Platform Windenergie De Zijpe</a>). <em>Aanbeveling:</em> verplicht in de vergunningsaanvraag propagatiemodellering tot minimaal 10–15 km voor infrasoon bij gevoelige bestemmingen, en laat de emissiemeting het volledige frequentiebereik &lt;20 Hz omvatten.</li>
      <li><strong>Definitieverschil tussen de aangeleverde position papers en de octaafbanden van het model.</strong> De aangeleverde position papers definiëren &ldquo;laagfrequent geluid&rdquo; breder (20–200 Hz) dan de octaafbanden die dit model gebruikt (31,5/63/125 Hz); de richting van de bevindingen is gelijk, maar de exacte getallen zijn niet 1-op-1 herleidbaar naar die bredere definitie. <em>Aanbeveling:</em> harmoniseer de wettelijke/beleidsmatige definitie van laagfrequent geluid met een eenduidige, internationaal herkenbare tertsbanddefinitie zoals in de Deense norm.</li>
      <li><strong>Geen doorrekening naar zorgkosten of gezondheidsverlies op basis van A-weging.</strong> Module 9 (zorgkosten) en Module 10 (DALY's) blijven gebaseerd op de ongewogen/G-gewogen bewonersaantallen van Module 8; het A-wegingseffect van Module 8a wordt daar niet in doorgerekend. <em>Aanbeveling:</em> laat gezondheidseffectonderzoek (RIVM, GGD) blootstelling baseren op ongewogen, laagfrequent-specifieke geluidsniveaus in plaats van op de A-gewogen dB(A)-Lnight-waarde alleen.</li>
    </ol>
    <p class="rp-note">Bronnen bij deze position paper: <a href="https://sonavyx.com/en/insights/iec-61672-1-frequency-weighting" target="_blank" rel="noopener">SonaVyx — IEC 61672-1 frequency weighting</a> · <a href="https://docs.wind-watch.org/vandenBerg-SoundOfHighWinds.pdf" target="_blank" rel="noopener">Van den Berg — The Sound of High Winds</a> · <a href="https://www.rivm.nl/sites/default/files/2018-11/Kennisbericht_Geluid_van_windturbines_versie_1punt0_20150611.pdf" target="_blank" rel="noopener">RIVM (2015)</a> · <a href="https://zoek.officielebekendmakingen.nl/ah-tk-20202021-620.html" target="_blank" rel="noopener">Kamervragen Beckerman &amp; Van Gerven</a> · <a href="https://zoek.officielebekendmakingen.nl/kst-33612-61.pdf" target="_blank" rel="noopener">Kamerstuk 33 612, nr. 61</a> · <a href="https://www.platformwindenergiedezijpe.nl/wp-content/uploads/2020/11/Geluid-windturbines.pdf" target="_blank" rel="noopener">Platform Windenergie De Zijpe</a> · <a href="https://www.sciencedirect.com/science/article/pii/S0003682X26000817" target="_blank" rel="noopener">Mattsson e.a. (2026), Applied Acoustics</a>.</p>
  </section>` : `
  <section class="rp-section">
    <h2>12. Position paper: A-weging maskeert laagfrequent en infrasoon geluid</h2>
    <p><em>${n === 0 ? 'Plaats minstens één turbine in Module 3 en haal de BAG-woningen op bij Module 8 om deze positioning paper met locatiespecifieke cijfers te vullen.' : 'Nog geen BAG-gegevens opgehaald bij Module 8 voor deze turbinepositie(s) — plaats de turbine(s) en klik op "Woningen ophalen (BAG)" om deze sectie te vullen.'}</em></p>
  </section>`;

  const bronnenSection = `
  <section class="rp-section">
    <h2>Bronnen</h2>
    <ul class="rp-sources">
      <li>RIVM (2026), <a href="https://www.rivm.nl/sites/default/files/2026-02/Factsheet-gezondheidseffecten-van-windturbinegeluid.pdf" target="_blank" rel="noopener">Factsheet gezondheidseffecten van windturbinegeluid</a></li>
      <li>Pawlaczyk-Łuszczyńska e.a. (2018), <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC6121431/" target="_blank" rel="noopener">PMC6121431</a></li>
      <li>Godono e.a. (2023), <a href="https://doi.org/10.1016/j.ijheh.2023.114273" target="_blank" rel="noopener">doi.org/10.1016/j.ijheh.2023.114273</a></li>
      <li>WHO Europe (2024), <a href="https://www.who.int/europe/publications/i/item/WHO-EURO-2024-9196-48968-72969" target="_blank" rel="noopener">Disability weights</a></li>
      <li>PBL (2012), <a href="https://www.pbl.nl/sites/default/files/downloads/PBL_2012_Gezondheid_in_MKBAs_van_omgevingsbeleid_550051004.pdf" target="_blank" rel="noopener">Gezondheid in MKBA's van omgevingsbeleid</a></li>
      <li>Droës &amp; Koster (2021), <a href="https://doi.org/10.1016/j.enpol.2021.112327" target="_blank" rel="noopener">Energy Policy 155, 112327</a></li>
      <li>PBL (2026), <a href="https://www.pbl.nl/publicaties/advies-basisbedragen-sde-2026" target="_blank" rel="noopener">Advies basisbedragen SDE++ 2026</a></li>
      <li>Deens Milieuagentschap, <a href="https://eng.mst.dk/media/urbm0xut/statutory-order-on-noise-from-wind-turbines-2019-version.pdf" target="_blank" rel="noopener">Statutory Order on Noise from Wind Turbines</a> en <a href="https://eng.mst.dk/industry/noise/wind-turbines" target="_blank" rel="noopener">overzichtspagina</a></li>
      <li>Jakobsen (2012), <a href="https://journals.sagepub.com/doi/pdf/10.1260/0263-0923.31.4.239" target="_blank" rel="noopener">Noise & Vibration Worldwide 31(4), 239</a></li>
      <li>Technische Anleitung zum Schutz gegen Lärm, <a href="https://de.wikipedia.org/wiki/Technische_Anleitung_zum_Schutz_gegen_L%C3%A4rm" target="_blank" rel="noopener">overzicht</a></li>
      <li>Bundesverwaltungsgericht, <a href="https://www.bverwg.de/pm/2025/4" target="_blank" rel="noopener">persbericht nr. 4/2025 (schallreduzierter Betrieb)</a></li>
      <li>WHO (2018), <a href="https://iris.who.int/bitstream/handle/10665/343936/WHO-EURO-2018-3287-43046-60243-eng.pdf" target="_blank" rel="noopener">Environmental Noise Guidelines for the European Region</a>, samengevat door <a href="https://www.wbm.co.uk/wp-content/uploads/2018/11/WBM-WHO-2018-Summary-Nov-2018.pdf" target="_blank" rel="noopener">WBM (2018)</a></li>
    </ul>
    <p class="rp-note">Zie ook de uitgebreide methodologie- en bronnenlijst onderaan de webapplicatie (sectie "Methodologie &amp; bronnen") voor de volledige onderbouwing van Module 1-8.</p>
  </section>`;

  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<title>Windturbinegeluid — nachtelijke hinder, maatschappelijke kosten en normstelling</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Georgia', 'Times New Roman', serif; color: #1c2b28; background: #ffffff; font-size: 10.5pt; line-height: 1.5; margin: 0; }
  .rp-page { max-width: 800px; margin: 0 auto; padding: 10mm 4mm; }
  .rp-header { border-bottom: 3px solid #0e4a4a; padding-bottom: 14px; margin-bottom: 20px; }
  .rp-header .rp-eyebrow { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 9pt; letter-spacing: 0.08em; text-transform: uppercase; color: #a3651b; font-weight: 700; margin-bottom: 6px; }
  .rp-header h1 { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 19pt; font-weight: 700; color: #0e4a4a; margin: 0 0 8px; line-height: 1.25; }
  .rp-header .rp-sub { font-size: 10pt; color: #5c6a63; }
  .rp-toolbar { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 14px; }
  .rp-print-btn { font-family: 'Helvetica', 'Arial', sans-serif; background: #0e4a4a; color: #f5f3ee; border: none; border-radius: 6px; padding: 10px 18px; font-size: 10pt; font-weight: 700; cursor: pointer; }
  .rp-print-btn:hover { background: #0a3838; }
  h2 { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 13pt; color: #0e4a4a; border-bottom: 1px solid #cfc6ae; padding-bottom: 4px; margin: 26px 0 10px; }
  h3 { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 11pt; color: #1c2b28; margin: 16px 0 6px; }
  p { margin: 0 0 10px; }
  .rp-section { margin-bottom: 6px; }
  .rp-avoid-break { break-inside: avoid; page-break-inside: avoid; }
  .rp-table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; font-size: 9.3pt; }
  .rp-table th, .rp-table td { border: 1px solid #cfc6ae; padding: 5px 7px; text-align: left; vertical-align: top; }
  .rp-table thead th { background: #d3e0dd; font-family: 'Helvetica', 'Arial', sans-serif; font-weight: 700; font-size: 8.8pt; }
  .rp-table tbody tr:nth-child(even) { background: #f5f3ee; }
  .rp-table-compact { font-size: 8pt; }
  .rp-table-compact th, .rp-table-compact td { padding: 4px 5px; }
  .rp-table-compact .rp-src { font-size: 7.3pt; }
  .rp-src { color: #5c6a63; font-size: 8.6pt; }
  .rp-note { font-size: 9pt; color: #5c6a63; font-style: italic; }
  .rp-list { margin: 6px 0 12px 18px; }
  .rp-list li { margin-bottom: 6px; }
  .rp-callout { border-left: 4px solid #a3651b; background: #ecdcc4; border-radius: 4px; padding: 10px 14px; margin: 10px 0 16px; font-size: 9.6pt; }
  .rp-callout.rp-warn { border-left-color: #a1332f; background: #ecd4cf; }
  .rp-sources { margin: 8px 0 0 18px; font-size: 9pt; }
  .rp-sources li { margin-bottom: 4px; }
  code { font-family: 'Courier New', monospace; background: #ece8de; padding: 1px 4px; border-radius: 3px; font-size: 0.92em; }
  .rp-footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #cfc6ae; font-size: 8.3pt; color: #92998f; }
  .rp-map-grid { display: flex; gap: 12px; margin: 10px 0 6px; flex-wrap: wrap; }
  .rp-map-fig { flex: 1 1 0; min-width: 0; margin: 0; }
  .rp-map-grid-1 .rp-map-fig { flex: 0 1 68%; margin: 0 auto; }
  .rp-map-fig img { width: 100%; height: auto; display: block; border: 1px solid #cfc6ae; border-radius: 4px; }
  .rp-map-fig figcaption { font-size: 8.6pt; color: #5c6a63; margin-top: 4px; text-align: center; }
  a { color: #0e4a4a; }
  .m8-chart-wrap, .rp-avoid-break > svg.m8-chart-svg { margin: 6px 0 4px; }
  .m8-chart-svg { width: 100%; height: auto; display: block; }
  .m8-chart-grid { stroke: #cfc6ae; stroke-width: 1; }
  .m8-chart-axis { stroke: #92998f; stroke-width: 1; }
  .m8-chart-axis-label { fill: #5c6a63; font-family: 'Courier New', monospace; font-size: 9px; }
  .m8-chart-norm-line { stroke: #a1332f; stroke-width: 1.4; stroke-dasharray: 5 4; fill: none; }
  .m8-chart-norm-label { fill: #a1332f; font-family: 'Helvetica', 'Arial', sans-serif; font-size: 9px; font-weight: 700; }
  .m8-chart-current-line { stroke: #92998f; stroke-width: 1.2; stroke-dasharray: 3 3; }
  .m8-chart-current-dot { stroke: #ffffff; stroke-width: 1.2; }
  .m8-chart-legend { display: flex; flex-wrap: wrap; gap: 10px 16px; margin: 2px 0 4px; font-family: 'Helvetica', 'Arial', sans-serif; font-size: 8.6pt; color: #5c6a63; }
  .m8-chart-legend span { display: inline-flex; align-items: center; gap: 5px; }
  .m8-chart-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; }
  .m8-chart-dot-norm { background: none; width: 14px; height: 0; border-top: 2px dashed #a1332f; border-radius: 0; }
  @media print { .rp-toolbar { display: none !important; } .rp-page { max-width: none; padding: 0; } }
</style>
</head>
<body>
<div class="rp-page">
  <div class="rp-toolbar no-print"><button class="rp-print-btn" onclick="window.print()">Afdrukken / opslaan als PDF</button></div>
  <div class="rp-header">
    <div class="rp-eyebrow">Kritisch rapport — Module 13</div>
    <h1>Windturbinegeluid 's nachts: hinder, maatschappelijke kosten en normstelling</h1>
    <div class="rp-sub">Gegenereerd op ${genDate} om ${genTime} · Bronvermogen ${state.lwa.toFixed(1)} dB(A) · ${n} turbine(s): ${escapeHtml(turbineList)}</div>
  </div>
  ${warningBanner}
  ${summarySection}
  ${nightSection}
  ${basisSection}
  ${scenarioSection}
  ${hinderSection}
  ${costSection}
  ${dalySection}
  ${analysisSection}
  ${valueSection}
  ${compareSection}
  ${advisorySection}
  ${positioningPaperSection}
  ${bronnenSection}
  <div class="rp-footer">Automatisch gegenereerd door het interactieve windturbinegeluidsmodel (Module 13). Dient ter beleidsmatige illustratie — vervangt geen formeel akoestisch onderzoek, planschadetaxatie of gezondheidskundig advies. Klik linksboven op "Afdrukken / opslaan als PDF" en kies als bestemming "Opslaan als PDF" om dit rapport te downloaden.</div>
</div>
</body>
</html>`;
}

// ---- Kaartafbeeldingen voor het rapport (§12) — legt de daadwerkelijke turbinepositie(s)
// vast, niet een statische referentieafbeelding. Gebruikt html2canvas om de volledige
// kaartcontainer (MapLibre-GL-tegels + Leaflet-canvasrenderer met de ringen + DOM-markers)
// tot één PNG te composeren. preserveDrawingBuffer:true op tileLayer3a (zie applyMapTileTheme3a)
// zorgt dat de WebGL-tegellaag leesbaar blijft voor html2canvas/toDataURL.
function m13WaitMapIdle(timeout) {
  return new Promise((resolve) => {
    if (!map3a || !tileLayer3a || typeof tileLayer3a.getMaplibreMap !== 'function') {
      resolve();
      return;
    }
    const glMap = tileLayer3a.getMaplibreMap();
    if (!glMap) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      glMap.once('idle', finish);
    } catch (e) {
      finish();
      return;
    }
    setTimeout(finish, timeout || 900);
  });
}

// Steekproef op het vastgelegde canvas: hoeveel fractie van de pixels is NIET (bijna-)wit.
// De tegellaag (positron-stijl) kleurt verreweg het grootste deel van het beeld; blijft de
// achtergrondkaart leeg (WebGL-buffer nog niet klaar op het moment van uitlezen), dan bestaat
// het beeld alleen uit de dunne ring-omtrekken en het turbine-icoon op een verder wit vlak —
// een fractie van doorgaans <30% niet-wit, tegenover >90% wanneer de tegels wel zijn getekend.
function m13NonWhiteFraction(canvas) {
  try {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    if (!width || !height) return 0;
    const data = ctx.getImageData(0, 0, width, height).data;
    let nonWhite = 0;
    let total = 0;
    const step = 4 * 37; // steekproef i.p.v. elke pixel — snel genoeg voor een 2x-scale canvas
    for (let i = 0; i < data.length; i += step) {
      total++;
      // Zowel een (bijna-)wit gevulde als een grotendeels transparante pixel telt als "leeg":
      // een mislukte capture kan beide vormen aannemen, afhankelijk van wat er onder het
      // canvas-element doorschijnt op het moment van uitlezen.
      const alpha = data[i + 3];
      const isBlankPixel = alpha < 10 || (data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245);
      if (!isBlankPixel) nonWhite++;
    }
    return total ? nonWhite / total : 0;
  } catch (e) {
    return 1; // kon niet samplen (bv. CORS) — niet blokkeren op deze check
  }
}

async function m13CaptureSingleView(opts) {
  const mapEl = document.getElementById('turbine-map-3a');
  if (!mapEl || typeof html2canvas !== 'function' || !map3a) return null;
  const container = mapEl.closest('.m3a-map-wrap') || mapEl;
  const maxAttempts = (opts && opts.maxAttempts) || 5;
  container.classList.add('m13-capturing');
  try {
    map3a.invalidateSize();
    // Ruimere marge dan voorheen (900ms/120ms): op een tragere verbinding (bv. Render's
    // gratis omgeving) is de MapLibre-GL-tegellaag na een zoom-/pan-wijziging soms nog niet
    // klaar met tekenen wanneer html2canvas de canvas-buffer uitleest, waardoor de
    // achtergrondkaart in het vastgelegde beeld leeg/wit blijft.
    await m13WaitMapIdle(1200);
    await new Promise((r) => setTimeout(r, 220));
    // De wachttijd hierboven is een gok, geen garantie: op een trage verbinding of een zwaar
    // belaste pagina (bv. net na het inladen van duizenden BAG-adressen) kan de tegellaag ook
    // na 1400ms nog leeg zijn. Daarom controleren we het resultaat zelf en proberen we het
    // — met een oplopende extra wachttijd en een geforceerde herteken-aanroep — tot 5x opnieuw
    // (was 3x: bleek in de praktijk niet genoeg voor de EERSTE capture van de pagina, zie
    // m13CaptureMapViews) voordat we de beste (meest gevulde) poging teruggeven.
    let bestCanvas = null;
    let bestFrac = -1;
    const glMap = tileLayer3a && typeof tileLayer3a.getMaplibreMap === 'function' ? tileLayer3a.getMaplibreMap() : null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const canvas = await html2canvas(mapEl, {
        useCORS: true,
        backgroundColor: null,
        scale: 2,
        logging: false,
      });
      const frac = m13NonWhiteFraction(canvas);
      if (frac > bestFrac) { bestFrac = frac; bestCanvas = canvas; }
      if (frac >= 0.5) break; // achtergrondkaart is duidelijk zichtbaar — geen extra poging nodig
      if (glMap && typeof glMap.triggerRepaint === 'function') glMap.triggerRepaint();
      if (glMap && typeof glMap.resize === 'function') { try { glMap.resize(); } catch (e) { /* negeren */ } }
      await m13WaitMapIdle(900);
      await new Promise((r) => setTimeout(r, 450 + attempt * 350));
    }
    return bestCanvas ? bestCanvas.toDataURL('image/png') : null;
  } catch (e) {
    console.warn('Kaartafbeelding voor rapport kon niet worden vastgelegd:', e);
    return null;
  } finally {
    container.classList.remove('m13-capturing');
  }
}

async function m13CaptureMapViews() {
  if (!map3a || state.turbines3a.length === 0) return { closeup: null, regional: null };
  const originalCenter = map3a.getCenter();
  const originalZoom = map3a.getZoom();
  let closeup = null;
  let regional = null;
  // De windrichtingpijl (74px) is fors groter dan de turbine-badge (26x34px) en staat op
  // exact dezelfde positie: op de kleine rapportafbeelding overlapt de pijl de badge volledig,
  // waardoor de turbine zelf niet meer herkenbaar is. Voor de vastlegging van beide
  // kaartbeelden verwijderen we de pijllaag tijdelijk van de kaart; na afloop komt hij terug.
  const arrowWasOnMap = turbineArrowLayer3a && map3a.hasLayer(turbineArrowLayer3a);
  if (arrowWasOnMap) map3a.removeLayer(turbineArrowLayer3a);
  const mapElWarmup = document.getElementById('turbine-map-3a');
  // Opwarmronde: de EERSTE html2canvas-aanroep op een pagina is in de praktijk minder
  // betrouwbaar dan latere aanroepen (bleek uit rapporten waarin de closeup-kaart — altijd
  // als eerste vastgelegd — stelselmatig blanco bleef, terwijl de daarna vastgelegde
  // regionale kaart wel goed ging). Door hier een wegwerp-capture te doen vóór de
  // eigenlijke closeup-capture, is die laatste effectief ook een "latere" aanroep.
  if (mapElWarmup && typeof html2canvas === 'function') {
    try { await html2canvas(mapElWarmup, { useCORS: true, backgroundColor: null, scale: 1, logging: false }); } catch (e) { /* negeren, dit was slechts een opwarmronde */ }
  }
  try {
    closeup = await m13CaptureSingleView();
    // Was originalZoom - 4 (16x zo veel oppervlak): op een normale plaatsingszoom (~11) kwam de
    // "regionale" kaart daardoor op een landsdekkend zicht uit, met de turbine als vrijwel
    // onzichtbare speldenprik. -2 (4x zoveel oppervlak) toont wel de bredere omgeving
    // (buurdorpen/steden) zonder de turbinepositie tot een stipje te verkleinen.
    const regioZoom = Math.max(map3a.getMinZoom ? map3a.getMinZoom() : 6, originalZoom - 2);
    if (regioZoom < originalZoom) {
      map3a.setView(originalCenter, regioZoom, { animate: false });
      await new Promise((r) => setTimeout(r, 350));
      regional = await m13CaptureSingleView();
    }
  } finally {
    map3a.setView(originalCenter, originalZoom, { animate: false });
    if (arrowWasOnMap) map3a.addLayer(turbineArrowLayer3a);
    await new Promise((r) => setTimeout(r, 60));
  }
  return { closeup, regional };
}

function m13MapImagesHtml(mapViews, turbineListStr) {
  const closeup = mapViews && mapViews.closeup;
  const regional = mapViews && mapViews.regional;
  if (!closeup && !regional) {
    return `<p class="rp-note"><em>De kaartafbeelding van de turbinepositie(s) kon niet automatisch worden vastgelegd bij het genereren van dit rapport (mogelijk blokkeerde de browser het uitlezen van de kaart, of html2canvas kon niet laden). Zie Module 3 in de app voor de actuele kaartweergave op ${escapeHtml(turbineListStr)}.</em></p>`;
  }
  const figs = [];
  if (closeup) figs.push(`<figure class="rp-map-fig"><img src="${closeup}" alt="Kaart met de geplaatste turbine(s), directe omgeving"><figcaption>Directe omgeving van de geanalyseerde turbine(s): ${escapeHtml(turbineListStr)}.</figcaption></figure>`);
  if (regional) figs.push(`<figure class="rp-map-fig"><img src="${regional}" alt="Regionale context van de geplaatste turbine(s)"><figcaption>Regionale context van dezelfde locatie(s).</figcaption></figure>`);
  return `<div class="rp-map-grid rp-map-grid-${figs.length}">${figs.join('')}</div>`;
}

async function m13OpenReport() {
  const btn = document.getElementById('m13-generate-btn');
  const originalBtnText = btn ? btn.textContent : '';
  // Het venster meteen synchroon openen, binnen dezelfde click-gebeurtenis, zodat de browser
  // dit niet als pop-up blokkeert (dat gebeurt zodra window.open() pas na een 'await' — en dus
  // buiten de directe user-gesture — wordt aangeroepen, zoals nodig is voor de kaartcapture).
  const win = window.open('', '_blank');
  if (win) {
    win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rapport wordt opgebouwd…</title></head><body style="font-family:sans-serif;padding:40px;color:#333;">Rapport wordt opgebouwd, inclusief kaartafbeelding van de geplaatste turbine(s)…</body></html>');
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Kaart wordt vastgelegd…';
  }
  let mapViews = { closeup: null, regional: null };
  try {
    mapViews = await m13CaptureMapViews();
  } catch (e) {
    console.warn('Kaartcapture voor rapport mislukt:', e);
  }
  if (btn) btn.textContent = 'Rapport wordt opgebouwd…';
  const html = m13BuildReportHtml(mapViews);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  if (win) {
    win.location.href = url;
  } else {
    alert('De pop-up werd geblokkeerd door de browser — sta pop-ups toe voor deze pagina en klik opnieuw op "Rapport genereren (PDF)".');
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = originalBtnText || 'Rapport genereren (PDF)';
  }
}

// ---------- Wire up turbine controls & init ----------
initMap3a();
render();
renderModule12();
renderModule13();
initCalcTooltip();
const m13Btn = document.getElementById('m13-generate-btn');
if (m13Btn) m13Btn.addEventListener('click', m13OpenReport);
