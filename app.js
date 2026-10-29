// Host Match: mappa, statistiche e guida prezzi sugli annunci Airbnb di Milano.

const F = { lat: 0, lon: 1, type: 2, hood: 3, price: 4, guests: 5, beds: 6, occ: 7, rating: 8, reviews: 9, multi: 10 };
const css = getComputedStyle(document.documentElement);
const TYPE_COLORS = [0, 1, 2, 3].map(i => css.getPropertyValue(`--t${i}`).trim());
const MIN_COMPARABLES = 8;

const state = { type: null, hood: null, sort: { key: 'n', dir: -1 } };
let DATA, HOODS, TYPES, map, pointsLayer, hoodLayer;

const int = v => v == null ? '–' : Math.round(v).toLocaleString('it-IT', { useGrouping: 'always' });
const eur = v => v == null ? '–' : '€' + int(v);
const pct = v => v == null ? '–' : Math.round(v * 100) + '%';

function quantile(values, q) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo);
}

// Statistiche di un gruppo di annunci. Le notti prenotate contano solo gli annunci attivi (stima > 0).
function summarize(list) {
  const byType = [0, 0, 0, 0];
  const prices = [], occ = [];
  let multi = 0;
  for (const l of list) {
    byType[l[F.type]]++;
    if (l[F.price] != null) prices.push(l[F.price]);
    if (l[F.occ] > 0) occ.push(l[F.occ]);
    multi += l[F.multi];
  }
  return {
    n: list.length,
    byType,
    entire: list.length ? byType[0] / list.length : null,
    price: quantile(prices, 0.5),
    occ: quantile(occ, 0.5),
    multi: list.length ? multi / list.length : null,
  };
}

function filtered() {
  return DATA.filter(l => (state.type == null || l[F.type] === state.type) && (state.hood == null || l[F.hood] === state.hood));
}

/* ---------- KPI ---------- */

function renderKpis() {
  const s = summarize(DATA);
  const hosts = s.multi;
  document.getElementById('kpis').innerHTML = [
    [int(s.n), 'annunci a Milano'],
    [pct(s.entire), 'sono case intere'],
    [eur(s.price), 'prezzo mediano a notte'],
    [int(s.occ), 'notti prenotate/anno (mediana)'],
    [pct(hosts), 'gestiti da host con più annunci'],
  ].map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('');
}

/* ---------- Mappa ---------- */

function initMap(geo) {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  map = L.map('map', { preferCanvas: true, zoomControl: false, scrollWheelZoom: false }).setView([45.4642, 9.19], 12);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 18,
  }).addTo(map);
  map.on('focus', () => map.scrollWheelZoom.enable());
  map.on('blur', () => map.scrollWheelZoom.disable());

  hoodLayer = L.geoJSON(geo, {
    style: hoodStyle,
    onEachFeature: (f, layer) => {
      layer.bindTooltip(f.properties.name, { sticky: true, direction: 'top' });
      layer.on('click', () => selectHood(state.hood === f.properties.hood ? null : f.properties.hood));
    },
  }).addTo(map);

  pointsLayer = L.layerGroup().addTo(map);

  const filter = document.getElementById('typeFilter');
  const chips = [[null, 'Tutti', null], ...TYPES.map((t, i) => [i, t, TYPE_COLORS[i]])];
  filter.innerHTML = chips.map(([v, label, color]) =>
    `<button class="chip" data-type="${v ?? ''}" aria-pressed="${v == null}">${color ? `<i class="dot" style="background:${color}"></i>` : ''}${label}</button>`
  ).join('');
  filter.addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.type = btn.dataset.type === '' ? null : Number(btn.dataset.type);
    filter.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c === btn));
    renderMap();
  });
}

function hoodStyle(f) {
  const selected = f.properties.hood === state.hood;
  return {
    color: selected ? css.getPropertyValue('--text').trim() : '#8a929b',
    weight: selected ? 2.5 : 0.8,
    opacity: selected ? 0.9 : 0.5,
    fillOpacity: 0,
  };
}

function renderMap() {
  pointsLayer.clearLayers();
  const renderer = L.canvas({ padding: 0.5 });
  for (const l of filtered()) {
    L.circleMarker([l[F.lat], l[F.lon]], {
      renderer,
      radius: 2.6,
      stroke: false,
      fillColor: TYPE_COLORS[l[F.type]],
      fillOpacity: 0.65,
      interactive: false,
    }).addTo(pointsLayer);
  }
  hoodLayer.setStyle(hoodStyle);
  renderPanel();
}

function selectHood(hood, fly = true) {
  state.hood = hood;
  renderMap();
  if (!fly) return;
  if (hood == null) {
    map.flyTo([45.4642, 9.19], 12, { duration: 0.6 });
  } else {
    hoodLayer.eachLayer(layer => {
      if (layer.feature.properties.hood === hood) map.flyToBounds(layer.getBounds(), { padding: [40, 40], duration: 0.6 });
    });
  }
}

function renderPanel() {
  const area = state.hood == null ? DATA : DATA.filter(l => l[F.hood] === state.hood);
  const s = summarize(area);
  const legend = TYPES.map((t, i) => s.byType[i] ? `<div><i class="dot" style="background:${TYPE_COLORS[i]}"></i>${t}<b>${int(s.byType[i])}</b></div>` : '').join('');
  const mix = TYPES.map((_, i) => `<i style="width:${(s.byType[i] / s.n) * 100}%;background:${TYPE_COLORS[i]}"></i>`).join('');
  const shown = state.type == null ? '' : `<p class="sub" style="margin:8px 0 0">Sulla mappa: ${int(filtered().length)} ${TYPES[state.type].toLowerCase()}</p>`;
  document.getElementById('areaPanel').innerHTML = `
    <h3>${state.hood == null ? 'Tutta Milano' : HOODS[state.hood]}</h3>
    <p class="sub">${state.hood == null ? 'Clicca un quartiere sulla mappa' : '<button class="reset" id="resetHood">← Tutta Milano</button>'}</p>
    <div class="big">${int(s.n)}</div>
    <div class="sub" style="margin:4px 0 0">annunci</div>
    ${shown}
    <div class="mix">${mix}</div>
    <div class="legend">${legend}</div>
    <ul class="stat-list">
      <li>Prezzo mediano a notte <b>${eur(s.price)}</b></li>
      <li>Notti prenotate/anno <b>${int(s.occ)}</b></li>
      <li>Host con più annunci <b>${pct(s.multi)}</b></li>
    </ul>`;
  document.getElementById('resetHood')?.addEventListener('click', () => selectHood(null));
}

/* ---------- Guida prezzi ---------- */

function initCalc() {
  const hoodSel = document.getElementById('cHood');
  const order = HOODS.map((name, i) => [name, i]).sort((a, b) => a[0].localeCompare(b[0], 'it'));
  hoodSel.innerHTML = '<option value="">Tutta Milano</option>' + order.map(([n, i]) => `<option value="${i}">${n}</option>`).join('');
  hoodSel.value = String(HOODS.indexOf('Navigli'));
  document.getElementById('cGuests').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(g =>
    `<option value="${g}" ${g === 2 ? 'selected' : ''}>${g === 8 ? '8 o più' : g}</option>`).join('');
  document.getElementById('calcForm').addEventListener('change', renderCalc);
  renderCalc();
}

// Cerca annunci simili; se sono troppo pochi allarga la ricerca un passo alla volta.
function comparables(hood, type, guests, beds) {
  const priced = DATA.filter(l => l[F.price] != null && l[F.type] === type);
  const sameGuests = l => guests >= 8 ? l[F.guests] >= 8 : l[F.guests] === guests;
  const sameBeds = l => type !== 0 || (beds >= 4 ? l[F.beds] >= 4 : l[F.beds] === beds);
  const inHood = l => hood == null || l[F.hood] === hood;
  const steps = [
    [l => inHood(l) && sameGuests(l) && sameBeds(l), 'stesso quartiere, stessi ospiti e camere'],
    [l => inHood(l) && sameGuests(l), 'stesso quartiere e numero di ospiti'],
    [l => inHood(l) && Math.abs(l[F.guests] - guests) <= 1, 'stesso quartiere, ospiti simili'],
    [l => sameGuests(l) && sameBeds(l), 'tutta Milano, stessi ospiti e camere'],
    [l => sameGuests(l), 'tutta Milano, stesso numero di ospiti'],
  ];
  for (const [test, label] of steps) {
    const list = priced.filter(test);
    if (list.length >= MIN_COMPARABLES) return { list, label, widened: label !== steps[0][1] };
  }
  return { list: [], label: '', widened: true };
}

// Il consiglio per gli annunci con ottime recensioni dipende da quanto chiedono davvero quelli simili.
function topTip(p50, p75, topPrice) {
  if (topPrice == null) return `puoi provare a salire verso ${eur(p75)}.`;
  if (topPrice > p50 * 1.03) return `puoi salire verso ${eur(Math.max(topPrice, p75))}: gli annunci simili con questi voti chiedono di solito ${eur(topPrice)}.`;
  return `qui i voti alti non fanno salire molto il prezzo (gli annunci simili con questi voti chiedono di solito ${eur(topPrice)}). Usali per riempire più notti; prova ${eur(p75)} solo nei periodi di alta richiesta.`;
}

function renderCalc() {
  const hoodVal = document.getElementById('cHood').value;
  const hood = hoodVal === '' ? null : Number(hoodVal);
  const type = Number(document.getElementById('cType').value);
  const guests = Number(document.getElementById('cGuests').value);
  const beds = Number(document.getElementById('cBeds').value);
  document.getElementById('cBeds').disabled = type !== 0;

  const out = document.getElementById('calcResult');
  const { list, label, widened } = comparables(hood, type, guests, beds);
  if (!list.length) {
    out.innerHTML = '<p>Non ci sono abbastanza annunci simili per dare un prezzo affidabile. Prova a cambiare quartiere o numero di ospiti.</p>';
    return;
  }

  const prices = list.map(l => l[F.price]);
  const p25 = quantile(prices, 0.25), p50 = quantile(prices, 0.5), p75 = quantile(prices, 0.75);
  const lo = quantile(prices, 0.05), hi = quantile(prices, 0.95);
  const occList = list.filter(l => l[F.occ] > 0).map(l => l[F.occ]);
  const occ = quantile(occList, 0.5);
  const top = list.filter(l => l[F.rating] >= 4.8 && l[F.reviews] >= 20).map(l => l[F.price]);
  const topPrice = top.length >= 5 ? quantile(top, 0.5) : null;
  const pos = v => Math.min(100, Math.max(0, ((v - lo) / (hi - lo || 1)) * 100));
  const where = hood == null ? 'a Milano' : `a ${HOODS[hood]}`;

  out.innerHTML = `
    <div class="sub" style="color:var(--muted);font-size:14px;margin-bottom:8px">Prezzo consigliato ${where}</div>
    <div class="price-main">${eur(p50)} <small>a notte</small></div>
    <div class="range">
      <div class="range-bar">
        <div class="range-fill" style="left:${pos(p25)}%;width:${pos(p75) - pos(p25)}%"></div>
        <div class="range-mid" style="left:calc(${pos(p50)}% - 1.5px)"></div>
      </div>
      <div class="range-labels"><span>${eur(lo)}</span><span>fascia tipica ${eur(p25)} – ${eur(p75)}</span><span>${eur(hi)}</span></div>
    </div>
    <div class="facts">
      <div><b>${int(list.length)}</b><span>annunci simili</span></div>
      <div><b>${int(occ)}</b><span>notti prenotate/anno</span></div>
      <div><b>${occ && p50 ? eur(occ * p50) : '–'}</b><span>incasso lordo annuo stimato</span></div>
    </div>
    <ul class="tips">
      <li><b>Annuncio nuovo o con poche recensioni:</b> parti da circa ${eur(p25)} per riempire il calendario e raccogliere le prime recensioni.</li>
      <li><b>Annuncio avviato:</b> stai intorno a ${eur(p50)}, a metà strada tra gli alloggi simili (metà chiede meno, metà di più).</li>
      <li><b>Recensioni ottime (4,8+ con oltre 20 recensioni):</b> ${topTip(p50, p75, topPrice)}</li>
    </ul>
    <p class="note">Confronto su: ${label}.${widened ? ' Nella zona scelta c\'erano pochi annunci identici, quindi abbiamo allargato la ricerca.' : ''} Prezzo base a notte, senza pulizie e commissioni. Nei periodi di fiere ed eventi (Salone del Mobile, Fashion Week) i prezzi salgono molto.</p>`;
}

/* ---------- Tabella quartieri ---------- */

let hoodRows = [];

function initTable() {
  const groups = HOODS.map(() => []);
  for (const l of DATA) groups[l[F.hood]].push(l);
  hoodRows = groups.map((list, i) => ({ hood: i, name: HOODS[i], ...summarize(list) })).filter(r => r.n > 0);

  document.querySelectorAll('#hoodTable th').forEach(th => th.addEventListener('click', () => {
    const key = th.dataset.key;
    state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : (key === 'name' ? 1 : -1) };
    renderTable();
  }));
  document.getElementById('hoodSearch').addEventListener('input', renderTable);
  document.querySelector('#hoodTable tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    selectHood(Number(tr.dataset.hood));
    document.getElementById('mappa').scrollIntoView({ behavior: 'smooth' });
  });
  renderTable();
}

function renderTable() {
  const q = document.getElementById('hoodSearch').value.trim().toLowerCase();
  const { key, dir } = state.sort;
  const rows = hoodRows
    .filter(r => r.name.toLowerCase().includes(q))
    .sort((a, b) => key === 'name' ? a.name.localeCompare(b.name, 'it') * dir : ((a[key] ?? -1) - (b[key] ?? -1)) * dir);
  document.querySelectorAll('#hoodTable th').forEach(th =>
    th.setAttribute('aria-sort', th.dataset.key === key ? (dir > 0 ? 'ascending' : 'descending') : 'none'));
  document.querySelector('#hoodTable tbody').innerHTML = rows.map(r => `
    <tr data-hood="${r.hood}">
      <td>${r.name}</td>
      <td class="num">${int(r.n)}</td>
      <td class="num"><span class="bar-cell">${pct(r.entire)}<span class="mini-bar"><i style="width:${(r.entire ?? 0) * 100}%"></i></span></span></td>
      <td class="num">${eur(r.price)}</td>
      <td class="num">${int(r.occ)}</td>
    </tr>`).join('');
}

/* ---------- Avvio ---------- */

Promise.all([
  fetch('data/listings.json').then(r => r.json()),
  fetch('data/neighbourhoods.geojson').then(r => r.json()),
]).then(([data, geo]) => {
  DATA = data.listings;
  HOODS = data.neighbourhoods;
  TYPES = data.roomTypes;
  document.getElementById('snapshot').textContent =
    new Date(data.snapshot).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  renderKpis();
  initMap(geo);
  renderMap();
  initCalc();
  initTable();
});
