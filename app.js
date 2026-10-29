// Host Match: mappa, guida prezzi, servizi, zona e previsione di guadagno sugli annunci Airbnb di Milano.

const F = { lat: 0, lon: 1, type: 2, hood: 3, price: 4, guests: 5, beds: 6, occ: 7, rating: 8, reviews: 9, multi: 10, amen: 11, metro: 12 };
const css = getComputedStyle(document.documentElement);
const TYPE_COLORS = [0, 1, 2, 3].map(i => css.getPropertyValue(`--t${i}`).trim());
const MIN_COMPARABLES = 8;
const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const MONTHS_LONG = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const state = { type: null, hood: null, metro: false, sort: { key: 'n', dir: -1 }, home: null, suggestion: null };
let DATA, HOODS, TYPES, AMEN, CTX, BASE, map, pointsLayer, pointsRenderer, hoodLayer, metroLayer;

const int = v => v == null ? '–' : Math.round(v).toLocaleString('it-IT', { useGrouping: 'always' });
const eur = v => v == null ? '–' : (v < 0 ? '−€' : '€') + int(Math.abs(v));
const pct = v => v == null ? '–' : Math.round(v * 100) + '%';
const signedPct = v => (v > 0 ? '+' : '−') + Math.abs(Math.round(v * 100)) + '%';
const list = names => names.length > 1 ? names.slice(0, -1).join(', ') + ' e ' + names.at(-1) : names[0] ?? '';

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

// Prezzo diviso per il prezzo mediano di Milano a parità di tipo e ospiti: permette di confrontare
// annunci di dimensioni diverse quando si misura l'effetto di un servizio o della metro.
const baseKey = l => l[F.type] + '-' + Math.min(l[F.guests] || 1, 8);
function buildBase() {
  const groups = {};
  for (const l of DATA) if (l[F.price] != null) (groups[baseKey(l)] ??= []).push(l[F.price]);
  BASE = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, quantile(v, 0.5)]));
}
const priceIndex = l => l[F.price] != null && BASE[baseKey(l)] ? l[F.price] / BASE[baseKey(l)] : null;
const medianIndex = list => quantile(list.map(priceIndex).filter(v => v != null), 0.5);
const pricedCount = list => list.reduce((n, l) => n + (l[F.price] != null), 0);

function filtered() {
  return DATA.filter(l => (state.type == null || l[F.type] === state.type) && (state.hood == null || l[F.hood] === state.hood));
}

/* ---------- KPI ---------- */

function renderKpis() {
  const s = summarize(DATA);
  document.getElementById('kpis').innerHTML = [
    [int(s.n), 'annunci a Milano'],
    [pct(s.entire), 'sono case intere'],
    [eur(s.price), 'prezzo mediano a notte'],
    [int(s.occ), 'notti prenotate/anno (mediana)'],
    [pct(s.multi), 'gestiti da host con più annunci'],
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

  pointsRenderer = L.canvas({ padding: 0.5 });
  pointsLayer = L.layerGroup().addTo(map);

  // Le stazioni metro stanno in un livello sopra i punti degli annunci.
  map.createPane('metro').style.zIndex = 450;
  const metroRenderer = L.svg({ pane: 'metro' });
  metroLayer = L.layerGroup(CTX.metroStations.map(([name, lat, lon]) =>
    L.circleMarker([lat, lon], {
      renderer: metroRenderer, pane: 'metro', radius: 5, weight: 2,
      color: css.getPropertyValue('--text').trim(), fillColor: '#ffffff', fillOpacity: 1,
    }).bindTooltip('Metro ' + name, { direction: 'top' })
  ));

  const filter = document.getElementById('typeFilter');
  const chips = [[null, 'Tutti', null], ...TYPES.map((t, i) => [i, t, TYPE_COLORS[i]])];
  filter.innerHTML = chips.map(([v, label, color]) =>
    `<button class="chip" data-type="${v ?? ''}" aria-pressed="${v == null}">${color ? `<i class="dot" style="background:${color}"></i>` : ''}${label}</button>`
  ).join('') + '<button class="chip" data-metro aria-pressed="false"><i class="dot metro-dot"></i>Metro</button>';
  filter.addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    if (btn.hasAttribute('data-metro')) {
      showMetro(!state.metro);
      return;
    }
    state.type = btn.dataset.type === '' ? null : Number(btn.dataset.type);
    filter.querySelectorAll('.chip[data-type]').forEach(c => c.setAttribute('aria-pressed', c === btn));
    renderMap();
  });
}

function showMetro(on) {
  state.metro = on;
  if (on) metroLayer.addTo(map); else metroLayer.remove();
  document.querySelector('.chip[data-metro]').setAttribute('aria-pressed', on);
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
  for (const l of filtered()) {
    L.circleMarker([l[F.lat], l[F.lon]], {
      renderer: pointsRenderer,
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
  const mix = s.n ? TYPES.map((_, i) => `<i style="width:${(s.byType[i] / s.n) * 100}%;background:${TYPE_COLORS[i]}"></i>`).join('') : '';
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

/* ---------- 1. Quanto chiedere ---------- */

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
  state.home = { hood, type, guests, beds };

  const out = document.getElementById('calcResult');
  const { list, label, widened } = comparables(hood, type, guests, beds);
  if (!list.length) {
    out.innerHTML = '<p>Non ci sono abbastanza annunci simili per dare un prezzo affidabile. Prova a cambiare quartiere o numero di ospiti.</p>';
    state.suggestion = null;
  } else {
    const prices = list.map(l => l[F.price]);
    const p25 = quantile(prices, 0.25), p50 = quantile(prices, 0.5), p75 = quantile(prices, 0.75);
    const lo = quantile(prices, 0.05), hi = quantile(prices, 0.95);
    const occ = quantile(list.filter(l => l[F.occ] > 0).map(l => l[F.occ]), 0.5);
    const top = list.filter(l => l[F.rating] >= 4.8 && l[F.reviews] >= 20).map(l => l[F.price]);
    const topPrice = top.length >= 5 ? quantile(top, 0.5) : null;
    const pos = v => Math.min(100, Math.max(0, ((v - lo) / (hi - lo || 1)) * 100));
    const where = hood == null ? 'a Milano' : `a ${HOODS[hood]}`;
    state.suggestion = { price: p50, occ };

    out.innerHTML = `
      <div class="eyebrow">Prezzo consigliato ${where}</div>
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

  renderOffer();
  renderZone();
  resetForecast();
}

const homeLabel = () => {
  const { hood, type, guests } = state.home;
  return `${TYPES[type]} per ${guests}${guests >= 8 ? '+' : ''} ospit${guests === 1 ? 'e' : 'i'} a ${hood == null ? 'Milano' : HOODS[hood]}`;
};

/* ---------- 2. Cosa offrire ---------- */

function renderOffer() {
  const { hood, type } = state.home;
  let seg = DATA.filter(l => l[F.type] === type && (hood == null || l[F.hood] === hood));
  let where = hood == null ? 'Milano' : HOODS[hood];
  if (pricedCount(seg) < 40) {
    seg = DATA.filter(l => l[F.type] === type);
    where = 'Milano (nel quartiere ci sono pochi annunci di questo tipo)';
  }
  document.querySelector('#servizi [data-seg]').textContent =
    `Quali servizi offrono gli annunci di tipo “${TYPES[type].toLowerCase()}” a ${where} e quanto incidono sul prezzo. ${int(seg.length)} annunci analizzati.`;

  const rows = AMEN.map((name, bit) => {
    const has = l => (l[F.amen] >> bit) & 1;
    const yes = seg.filter(has), no = seg.filter(l => !has(l));
    const share = yes.length / seg.length;
    const enough = pricedCount(yes) >= 10 && pricedCount(no) >= 10;
    const premium = enough ? medianIndex(yes) / medianIndex(no) - 1 : null;
    const tag = share >= 0.75 ? 'must' : premium != null && premium >= 0.05 ? 'plus' : 'opt';
    return { name, share, premium, tag };
  });
  const rank = { must: 0, plus: 1, opt: 2 };
  rows.sort((a, b) => rank[a.tag] - rank[b.tag] || (a.tag === 'plus' ? b.premium - a.premium : b.share - a.share));

  const must = rows.filter(r => r.tag === 'must');
  const plus = rows.filter(r => r.tag === 'plus');
  const rare = plus.filter(r => r.share < 0.35);
  const tagLabel = { must: 'Indispensabile', plus: 'Fa la differenza', opt: 'Facoltativo' };
  const effect = r => r.premium == null ? '<span class="muted">pochi dati</span>'
    : Math.abs(r.premium) < 0.03 ? '<span class="muted">≈ uguale</span>'
    : `<span class="${r.premium > 0 ? 'up' : 'muted'}">${signedPct(r.premium)}</span>`;

  document.getElementById('offer').innerHTML = `
    <div class="offer-summary">
      <div class="card"><h3>Da avere per forza</h3><p>${must.length ? `${list(must.map(r => r.name))}: li offrono almeno 3 annunci su 4. Senza, parti svantaggiato.` : 'Nessun servizio è offerto da quasi tutti: qui c\'è spazio per distinguersi.'}</p></div>
      <div class="card"><h3>Per chiedere di più</h3><p>${plus.length ? list(plus.slice(0, 3).map(r => `${r.name} (${signedPct(r.premium)})`)) + ': gli annunci che li offrono chiedono di più a parità di ospiti.' : 'Nessun servizio, da solo, sposta molto il prezzo in questa zona.'}</p></div>
      <div class="card"><h3>Per distinguerti</h3><p>${rare.length ? `${list(rare.slice(0, 3).map(r => r.name))}: li offrono in pochi ma rendono. Sono il modo più semplice per emergere.` : 'Concentrati sulla qualità di foto, descrizione e recensioni: i servizi che rendono di più sono già diffusi.'}</p></div>
    </div>
    <div class="table-scroll">
      <table class="offer-table">
        <thead><tr><th>Servizio</th><th>Quanti lo offrono</th><th class="num">Effetto sul prezzo</th><th>Consiglio</th></tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            <td>${r.name}</td>
            <td><span class="bar-cell left"><span class="mini-bar wide"><i style="width:${r.share * 100}%"></i></span>${pct(r.share)}</span></td>
            <td class="num">${effect(r)}</td>
            <td><span class="pill ${r.tag}">${tagLabel[r.tag]}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="note">L'effetto sul prezzo confronta annunci con lo stesso tipo e numero di ospiti, con e senza il servizio. È una tendenza, non una garanzia: chi offre più servizi spesso ha anche case più curate.</p>`;
}

/* ---------- 3. La zona ---------- */

function renderZone() {
  const { hood, type } = state.home;
  const zones = CTX.zones;
  const valid = zones.filter(z => z && z.area > 0.3);
  const foodDensity = quantile(valid.map(z => z.food / z.area), 0.5);
  const parkDensity = quantile(valid.map(z => z.parks / z.area), 0.5);

  // Effetto della metro su tutta Milano, per lo stesso tipo di alloggio.
  const sameType = DATA.filter(l => l[F.type] === type);
  const near = medianIndex(sameType.filter(l => l[F.metro] <= 400));
  const far = medianIndex(sameType.filter(l => l[F.metro] > 800));
  const metroEffect = near && far ? near / far - 1 : null;
  const metroLine = metroEffect != null && Math.abs(metroEffect) >= 0.03
    ? `A Milano, a parità di ospiti, gli alloggi entro 400 m dalla metro chiedono ${metroEffect > 0 ? 'il ' + Math.round(metroEffect * 100) + '% in più' : 'il ' + Math.round(-metroEffect * 100) + '% in meno'} di quelli oltre 800 m.`
    : 'A Milano la distanza dalla metro, da sola, non cambia molto il prezzo: conta di più il quartiere.';

  const out = document.getElementById('zone');
  if (hood == null || !zones[hood]) {
    out.innerHTML = `<p class="empty">Scegli un quartiere nella sezione <a href="#prezzo">Quanto chiedere</a> per vedere locali, parchi e trasporti della zona.</p><p class="note">${metroLine}</p>`;
    return;
  }

  const z = zones[hood];
  const listings = DATA.filter(l => l[F.hood] === hood);
  const metroDist = quantile(listings.map(l => l[F.metro]), 0.5);
  const fd = z.food / z.area, pd = z.parks / z.area;
  const rankFood = valid.filter(v => v.food / v.area < fd).length / valid.length;
  const life = rankFood >= 0.75 ? 'Molto vivace' : rankFood >= 0.4 ? 'Vivace' : 'Tranquilla';
  const transit = metroDist <= 400 ? 'Ottima' : metroDist <= 800 ? 'Buona' : 'Lontana dalla metro';
  const green = pd >= parkDensity * 1.15 ? 'Molto verde' : pd <= parkDensity * 0.85 ? 'Poco verde' : 'Verde nella media';
  const times = (v, ref) => {
    const r = v / ref;
    return r >= 1.15 ? `${r.toFixed(1).replace('.', ',')} volte la media di Milano` : r <= 0.85 ? `sotto la media di Milano` : 'in linea con la media di Milano';
  };

  const tips = [];
  if (z.metro.length) tips.push(`Cita nell'annuncio la metro più vicina: ${list(z.metro.slice(0, 3))}.`);
  else if (z.tram) tips.push(`Il quartiere non ha fermate della metro: spiega come arrivare in tram (${z.tram} fermate in zona) o con il passante.`);
  if (metroDist > 800) tips.push('Gli ospiti cercano alloggi ben collegati: se hai un parcheggio offrilo, e indica i tempi per arrivare in centro.');
  if (rankFood >= 0.6) tips.push(`Valorizza la vita del quartiere: ${int(z.food)} tra bar, ristoranti e caffè. Funziona con coppie e giovani.`);
  else tips.push('Zona tranquilla: puntala su famiglie, soggiorni di lavoro e chi cerca riposo.');
  if (pd >= parkDensity) tips.push('Ci sono molti parchi e giardini: è un punto a favore per famiglie e per chi viaggia con animali.');

  out.innerHTML = `
    <div class="zone-head">
      <h3>${HOODS[hood]}</h3>
      <span class="pill">${life}</span><span class="pill">${green}</span><span class="pill">Metro: ${transit.toLowerCase()}</span>
    </div>
    <div class="facts zone-facts">
      <div><b>${int(z.food)}</b><span>bar, ristoranti e caffè · ${times(fd, foodDensity)}</span></div>
      <div><b>${int(z.parks)}</b><span>parchi e giardini · ${times(pd, parkDensity)}</span></div>
      <div><b>${z.metro.length}</b><span>stazioni metro nel quartiere${z.metro.length ? ': ' + list(z.metro) : ''}</span></div>
      <div><b>${int(metroDist)} m</b><span>distanza tipica degli annunci dalla metro</span></div>
      <div><b>${int(z.tram)}</b><span>fermate del tram</span></div>
    </div>
    <h4>Cosa dire nell'annuncio</h4>
    <ul class="tips">${tips.map(t => `<li>${t}</li>`).join('')}</ul>
    <p class="note">${metroLine} <button class="reset" id="showZoneMap">Vedi il quartiere e la metro sulla mappa →</button></p>`;
  document.getElementById('showZoneMap').addEventListener('click', () => {
    showMetro(true);
    selectHood(hood);
    document.getElementById('mappa').scrollIntoView({ behavior: 'smooth' });
  });
}

/* ---------- 4. Previsione di guadagno ---------- */

function initForecast() {
  document.getElementById('fForm').addEventListener('input', renderForecast);
}

// Ogni volta che cambia l'alloggio ripartiamo dai valori suggeriti dal confronto.
function resetForecast() {
  const s = state.suggestion;
  document.getElementById('fPrice').value = s ? Math.round(s.price) : '';
  document.getElementById('fNights').value = s?.occ ? Math.round(s.occ) : 60;
  renderForecast();
}

function renderForecast() {
  const v = id => Math.max(0, Number(document.getElementById(id).value) || 0);
  const price = v('fPrice'), nightsYear = Math.min(365, v('fNights')), stay = Math.max(1, v('fStay'));
  const clean = v('fClean'), fee = v('fFee') / 100, tax = v('fTax') / 100, mgmt = v('fMgmt') / 100, fixed = v('fFixed');
  const hood = state.home.hood;
  const season = (hood != null && CTX.season.hoods[hood]) || CTX.season.city;

  const months = season.map((w, m) => {
    const nights = Math.min(DAYS[m], nightsYear * w);
    const gross = nights * price;
    const net = gross * (1 - fee - tax - mgmt) - (nights / stay) * clean - fixed;
    return { m, nights, gross, net };
  });
  const sum = k => months.reduce((t, x) => t + x[k], 0);
  const gross = sum('gross'), nights = sum('nights'), net = sum('net');
  const cost = {
    fee: gross * fee, tax: gross * tax, mgmt: gross * mgmt, clean: (nights / stay) * clean, fixed: fixed * 12,
  };
  const maxGross = Math.max(...months.map(x => x.gross), 1);
  const byNights = [...months].sort((a, b) => b.nights - a.nights);
  const best = byNights.slice(0, 3).map(x => MONTHS_LONG[x.m]);
  const worst = byNights.slice(-2).reverse().map(x => MONTHS_LONG[x.m]);

  document.getElementById('fResult').innerHTML = `
    <div class="eyebrow">${homeLabel()} · guadagno netto stimato</div>
    <div class="price-main ${net < 0 ? 'neg' : ''}">${eur(net)} <small>all'anno</small></div>
    <p class="sub-line">circa ${eur(net / 12)} al mese, con ${int(nights)} notti prenotate</p>
    <div class="months" role="img" aria-label="Incasso lordo e netto per mese">
      ${months.map(x => `
        <div class="month" title="${MONTHS_LONG[x.m]}: ${int(x.nights)} notti, lordo ${eur(x.gross)}, netto ${eur(x.net)}">
          <div class="month-bars">
            <i class="gross" style="height:${(x.gross / maxGross) * 100}%"></i>
            <i class="net" style="height:${Math.max(0, x.net / maxGross) * 100}%"></i>
          </div>
          <span>${MONTHS[x.m]}</span>
        </div>`).join('')}
    </div>
    <div class="legend inline"><div><i class="dot" style="background:var(--accent-soft);border:1px solid var(--accent)"></i>Lordo</div><div><i class="dot" style="background:var(--accent)"></i>Netto</div></div>
    <p class="sub-line">Mesi più richiesti: <b>${list(best)}</b>. Più deboli: <b>${list(worst)}</b>.</p>
    <ul class="stat-list breakdown">
      <li>Incasso lordo <b>${eur(gross)}</b></li>
      <li>Commissione Airbnb <b>${eur(-cost.fee)}</b></li>
      <li>Tasse <b>${eur(-cost.tax)}</b></li>
      ${cost.mgmt ? `<li>Gestione <b>${eur(-cost.mgmt)}</b></li>` : ''}
      <li>Pulizie (${int(nights / stay)} soggiorni) <b>${eur(-cost.clean)}</b></li>
      <li>Spese fisse <b>${eur(-cost.fixed)}</b></li>
      <li class="total">Netto <b>${eur(net)}</b></li>
    </ul>
    <p class="note">Le notti sono distribuite sui mesi in base alle recensioni degli ultimi tre anni ${hood != null && CTX.season.hoods[hood] ? 'nel quartiere' : 'a Milano'}. Il prezzo è considerato uguale tutto l'anno: nei mesi di fiere ed eventi puoi chiedere di più. Tasse calcolate sull'incasso lordo. Commissione Airbnb: circa 15% con la tariffa solo host, circa 3% con la tariffa condivisa. Stime indicative: per le tasse fai riferimento al tuo commercialista.</p>`;
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
  fetch('data/context.json').then(r => r.json()),
]).then(([data, geo, context]) => {
  DATA = data.listings;
  HOODS = data.neighbourhoods;
  TYPES = data.roomTypes;
  AMEN = data.amenities;
  CTX = context;
  buildBase();
  document.getElementById('snapshot').textContent =
    new Date(data.snapshot).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  renderKpis();
  initMap(geo);
  renderMap();
  initForecast();
  initCalc();
  initTable();
});
