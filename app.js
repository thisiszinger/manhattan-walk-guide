import { FILTERS, VISITED_KEY, safeUrl, placeUrl, validateData, routeStops, filterStops, groupedStops, readVisited, saveVisited, namedDirections, sourceList } from './model.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const external = (label, url, className = '') => `<a class="${esc(className)}" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} <span aria-hidden="true">↗</span></a>`;
let data, map, markers, routeLayer, activeVariant, activeFilter = 'recommended', selectedId, visited = new Set(), tileLoaded = false;
let allStops = [], visibleStops = [], openStops = new Set(), toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; },4500); }
function updateUrl() {
  const u = new URL(location.href);
  u.searchParams.set('route',activeVariant.id);
  if (activeFilter !== 'recommended') u.searchParams.set('filter',activeFilter); else u.searchParams.delete('filter');
  history.replaceState(null,'',u);
}
function getStorage() { try { return window.localStorage; } catch { return null; } }
function stopMarkup(s) {
  const isOpen = openStops.has(s.id), seen = visited.has(s.id);
  const label = s.anchor ? 'Food anchor' : s.priority === 'optional' ? 'Optional' : s.kinds.includes('event') ? 'Browse if you like' : s.kinds.includes('meetup') ? 'Start here' : s.kinds.includes('architecture') ? 'Exterior / public space' : s.kinds.includes('connection') ? 'Public-street connection' : 'Along the way';
  return `<li class="stop ${s.anchor?'food-anchor':''} ${seen?'visited':''} ${selectedId===s.id?'selected':''}" id="stop-${esc(s.id)}" data-stop-id="${esc(s.id)}">
    <button type="button" class="stop-row" aria-expanded="${isOpen}" aria-controls="detail-${esc(s.id)}" data-toggle-stop="${esc(s.id)}">
      <span class="stop-number" aria-hidden="true">${seen?'✓':String(s.order).padStart(2,'0')}</span><span class="stop-text"><span class="stop-labels"><span class="kind-label ${s.anchor?'food':''} ${s.priority==='optional'?'optional':''}">${esc(label)}</span></span><span class="stop-title">${esc(s.name)}</span><span class="stop-summary">${esc(s.summary)}</span></span><span class="stop-toggle" aria-hidden="true">${isOpen?'−':'+'}</span>
    </button>
    <div class="stop-detail" id="detail-${esc(s.id)}" ${isOpen?'':'hidden'}><p>${esc(s.detail)}</p>${s.access?`<p class="access-note">${esc(s.access)}</p>`:''}${s.hours?`<span class="hours">${esc(s.hours)}</span>`:''}
      ${s.story?`<aside class="place-story"><p class="eyebrow">ONE THING TO NOTICE</p><p>${esc(s.story.text)}</p>${(s.story.sources || []).map(source => external('Story source',source.url,'source-link')).join('')}</aside>`:''}
      <div class="stop-actions"><button type="button" data-show-map="${esc(s.id)}">Show on map</button>${external('Open place',placeUrl(s))}<button type="button" class="visited-button" data-visited="${esc(s.id)}" aria-pressed="${seen}" aria-label="${seen?'Unmark':'Mark'} ${esc(s.name)} as visited"><span aria-hidden="true">${seen?'✓':'○'}</span> ${seen?'Visited':'Been here'}</button></div>${(s.sources || (s.source?[s.source]:[])).map(source=>external(source.label,source.url,'source-link')).join(' ')}
    </div></li>`;
}
function renderTimeline() {
  visibleStops = filterStops(allStops,activeFilter);
  const allGroups = groupedStops(allStops), groups = groupedStops(visibleStops);
  $('#filter-status').textContent = activeFilter === 'recommended' ? 'The main thread. Optional tastes live under Food or Everything.' : activeFilter === 'all' ? 'All choices on this branch—not a list to complete.' : `${activeFilter === 'event'?'Markets & seasonal browsing':activeFilter === 'architecture'?'Street-level architecture':'Food anchors & optional tastes'} · in walking order`;
  $('#timeline').innerHTML = groups.map(group => {
    const chapter = {...data.chapters.find(c => c.id === group.id), ...(activeVariant.chapterOverrides?.[group.id] || {})};
    const index = allGroups.findIndex(g => g.id === group.id)+1;
    const directions = (activeVariant.directions || []).filter(d => d.chapter === group.id);
    const fallback = namedDirections(allGroups.find(g => g.id === group.id).stops);
    const directionMarkup = directions.length ? directions.map(d => external(d.label,d.url,'chapter-directions') + (d.note?`<p class="navigation-note">${esc(d.note)}</p>`:'')).join('') : !activeVariant.navigationVerified && fallback ? external('Preview named anchors in walking Maps',fallback,'chapter-directions') + '<p class="navigation-note">Preview only, not complete verified navigation. Maps chooses the path; use the public-access notes above.</p>' : '';
    const decisions = activeFilter === 'recommended' || activeFilter === 'all' ? (data.decisions || []).filter(d => d.afterChapter === group.id).map(d => `<aside class="decision"><p class="eyebrow">A SMALL DECISION · ${esc(d.number)}</p><h3>${esc(d.title)}</h3><p>${esc(d.body)}</p>${d.action==='routes'?'<button type="button" data-choose-route>Choose the southbound branch ↑</button>':d.action==='transit'?external('Check MTA service','https://www.mta.info/','chapter-directions'):''}</aside>`).join('') : '';
    return `<section class="chapter" aria-labelledby="chapter-${esc(group.id)}"><header class="chapter-heading"><span class="chapter-number" aria-hidden="true">${String(index).padStart(2,'0')}</span><div><h3 id="chapter-${esc(group.id)}">${esc(chapter.title)}</h3><p class="eyebrow">${esc(chapter.eyebrow)}</p></div></header><p class="chapter-blurb">${esc(chapter.blurb)}</p><ol class="stop-list">${group.stops.map(stopMarkup).join('')}</ol>${directionMarkup}${decisions}</section>`;
  }).join('');
  $$('[data-filter]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.filter === activeFilter)));
}
function zoomToStop(id, scrollToMap = false) {
  const s = allStops.find(s => s.id === id); if (!s) return;
  selectedId = id;
  if (map) { map.setView([s.lat,s.lng],16,{animate:false}); renderMarkers(); }
  if (scrollToMap) document.querySelector('.map-heading').scrollIntoView({block:'start',behavior:'smooth'});
  $$('.stop').forEach(el => el.classList.toggle('selected',el.dataset.stopId === id));
}
function goToStop(id) {
  if (!visibleStops.some(s => s.id === id)) { activeFilter='all'; updateUrl(); }
  selectedId=id; openStops.add(id); renderTimeline();
  const el = $(`#stop-${CSS.escape(id)}`);
  if (el) { el.scrollIntoView({block:'start',behavior:'smooth'}); el.querySelector('.stop-row').focus({preventScroll:true}); history.replaceState(null,'',`${location.pathname}${location.search}#stop-${id}`); }
}
function renderMarkers() {
  if (!map || !markers) return;
  markers.clearLayers();
  const overview = map.getZoom() < 13;
  // One representative per neighborhood at island scale; zoom reveals the places.
  const overviewIds = new Set(groupedStops(visibleStops).map(group => (group.stops.find(s => s.anchor) || group.stops.find(s => s.mapAnchor) || group.stops[0]).id));
  visibleStops.filter(s => !overview || overviewIds.has(s.id) || s.id === selectedId).forEach(s => {
    const icon = L.divIcon({className:`walk-pin ${s.anchor?'food':''} ${selectedId===s.id?'active':''}`,html:`<span class="pin-disc">${s.order}</span>`,iconSize:[44,44],iconAnchor:[22,22]});
    const marker = L.marker([s.lat,s.lng],{icon,keyboard:true,title:s.name,alt:s.name}).addTo(markers);
    const content = document.createElement('div');
    content.innerHTML = `<strong>${esc(s.name)}</strong><p>${esc(s.summary)}</p><button type="button" data-popup-stop="${esc(s.id)}">Read in field guide</button>${external('Open place',placeUrl(s))}`;
    content.querySelector('button').addEventListener('click',() => { map.closePopup(); goToStop(s.id); });
    marker.bindPopup(content,{maxWidth:260,minWidth:200,autoPanPaddingTopLeft:[20,45]});
    marker.on('click',() => { selectedId=s.id; $$('.stop').forEach(el => el.classList.toggle('selected',el.dataset.stopId===s.id)); });
  });
}
function renderRoute() {
  const isNetwork = !!activeVariant.geometry;
  $('#geometry-note').textContent = isNetwork ? activeVariant.geometry.note || 'Pedestrian-network route. Posted access signs always govern.' : 'Schematic connections, not walking directions. Zoom for places.';
  $('.line-key').style.borderTopStyle = isNetwork ? 'solid' : 'dashed';
  if (!map) return;
  routeLayer.clearLayers();
  if (isNetwork) L.geoJSON(activeVariant.geometry.geojson,{style:{color:'#214f42',weight:4,opacity:.8},interactive:false}).addTo(routeLayer);
  else {
    const main = allStops.filter(s => s.priority !== 'optional');
    L.polyline(main.map(s => [s.lat,s.lng]),{color:'#214f42',weight:2.5,opacity:.72,dashArray:'5 7',interactive:false}).addTo(routeLayer);
  }
  renderMarkers(); fitMap();
}
function fitMap() { if (map && allStops.length) map.fitBounds(allStops.map(s => [s.lat,s.lng]),{padding:[35,28],animate:false}); }
function initMap() {
  if (!window.L) { $('#map-error').hidden=false; return; }
  map = L.map('map',{scrollWheelZoom:false,zoomControl:true,zoomSnap:0.25,minZoom:10,maxZoom:18,attributionControl:true});
  const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).addTo(map);
  tileLayer.on('tileload',() => { tileLoaded=true; $('#map-error').hidden=true; });
  tileLayer.on('tileerror',() => { if(!tileLoaded) { $('#map-error').textContent='Basemap tiles unavailable. Pins and the linked field guide still work.'; $('#map-error').hidden=false; } });
  routeLayer = L.layerGroup().addTo(map); markers = L.layerGroup().addTo(map);
  map.on('zoomend',renderMarkers);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
}
function renderEssentials() {
  const sections = (data.essentials || []).map(section => `<section class="plan-section"><h3>${esc(section.title)}</h3>${(section.paragraphs || []).map(p => `<p>${esc(p)}</p>`).join('')}${section.bullets?`<ul>${section.bullets.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`:''}${(section.links || []).filter(l => safeUrl(l.url)).map(l => external(l.label,l.url,'chapter-directions')).join('')}</section>`);
  const weather = data.weather ? `<section class="plan-section"><h3>Layers for the waterfront</h3><p>${esc(data.weather.summary)}</p><p>${esc(data.weather.sunset)}</p><p class="research-stamp">${esc(data.weather.checkedLabel)}</p><details class="practical-details"><summary>Hourly forecast · 8 AM–8 PM</summary><table class="weather-table"><caption>November 8 · Eastern Standard Time · °F</caption><thead><tr><th scope="col">Time</th><th scope="col">Temp / feels</th><th scope="col">Rain</th><th scope="col">Wind / gust</th></tr></thead><tbody>${data.weather.hours.map(h => `<tr><th scope="row">${esc(h.time)}</th><td>${esc(h.temperature)} / ${esc(h.feelsLike)}°</td><td>${esc(h.rain)}%</td><td>${esc(h.wind)}<br>gust ${esc(h.gust)} mph</td></tr>`).join('')}</tbody></table>${data.weather.sources.map(s => external(s.label,s.url,'source-link')).join(' ')}</details></section>` : '';
  const restrooms = `<section class="plan-section"><h3>Public toilets, north to south</h3><p>Published Sunday hours, not a check of unlocked doors or queues. No ticket or purchase assumed. Pier 51 is closed; Cloisters museum toilets are not part of this walk.</p><details class="practical-details"><summary>Six restroom anchors & hours</summary><ol class="restroom-list">${(data.restrooms || []).map(r=>`<li><h4>${esc(r.name)}</h4><p>${esc(r.location)} · ${esc(r.hours)}</p><p>${esc(r.note)}</p>${external('Open named place',r.placeUrl,'source-link')} ${(r.sources || []).map(s=>external(s.label,s.url,'source-link')).join(' ')}</li>`).join('')}</ol></details></section>`;
  const bailouts = `<section class="plan-section"><h3>Make the day shorter</h3><p>Use the subway whenever needed; Christopher Street / W 4th or SoHo are sensible early finishes. These are station areas, not measured nearest-station walks or step-free guarantees. Check MTA service and access before entering.</p><details class="practical-details"><summary>Subway options by neighborhood</summary><ul>${(data.bailouts || []).map(b=>`<li><strong>${esc(b.zone)}:</strong> ${esc(b.stations)}</li>`).join('')}</ul>${external('Check MTA service','https://www.mta.info/','source-link')}</details></section>`;
  $('#plan-content').innerHTML = sections.slice(0,1).join('') + weather + restrooms + bailouts + sections.slice(1).join('');
  $('#print-essentials').innerHTML = '<h2>Essentials · November 8, 2026</h2>' + $('#plan-content').innerHTML;
  $('#print-essentials').querySelectorAll('details').forEach(d => { d.open = true; });
  $('#sources-content').innerHTML = `<p>${esc((data.notices || []).join(' '))}</p><p>Walking Maps links use named places. Unless a segment is explicitly verified, Maps chooses its own path: use the public-access notes in this guide, not an assumed shortcut.</p><ul class="sources-list">${sourceList(data).map(s => `<li>${external(s.label,s.url)}</li>`).join('')}</ul>`;
}
function renderNavigation() {
  const legs = activeVariant.directions || [];
  const main = legs.filter(d => !d.id?.startsWith('O'));
  const optional = legs.filter(d => d.id?.startsWith('O'));
  $('#directions-summary').textContent = `Walking directions · ${main.length || 'chapter'} named-place legs`;
  const list = items => `<ol class="restroom-list">${items.map(d => `<li>${external(d.label,d.url,'chapter-directions')}${d.note ? `<p class="navigation-note">${esc(d.note)}</p>` : ''}</li>`).join('')}</ol>`;
  $('#directions-content').innerHTML = main.length ? `<p>Open these in order. Long routes are split for mobile Maps; the next leg starts where the last ends. Names, order and walking mode were browser-checked, not every path or phone app. Follow signs and the High Line instructions.</p>${list(main)}${optional.length ? '<h3>Optional replacements</h3>'+list(optional) : ''}` : '<p>Use the chapter anchor previews below; this branch has not yet received complete navigation links.</p>';
}
function setVariant(id) {
  activeVariant = data.variants.find(v => v.id === id) || data.variants.find(v => v.id === data.meta.defaultVariant);
  allStops = routeStops(data,activeVariant.id);
  if (!allStops.some(s => s.id === selectedId)) selectedId=null;
  $('#route-select').value=activeVariant.id;
  $('#route-summary').textContent = activeVariant.description + (activeVariant.distanceLabel ? ` ${activeVariant.distanceLabel}` : '');
  renderNavigation(); renderTimeline(); renderRoute(); updateUrl();
}
async function share() {
  const url = new URL(location.href); // preserves the current branch, filter, and place
  try { if (navigator.share) { await navigator.share({title:data.meta.title,url:url.href}); return; } } catch (error) { if(error.name==='AbortError') return; }
  try { if(navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url.href); toast('Guide link copied. Pass it along.'); return; } } catch { /* Manual copy remains usable on non-secure origins. */ }
  $('#share-url').value=url.href; $('#share-dialog').showModal(); $('#share-url').focus(); $('#share-url').select();
}
function bindEvents() {
  $('#route-select').addEventListener('change',e => setVariant(e.target.value));
  $$('[data-filter]').forEach(button => button.addEventListener('click',() => { activeFilter=button.dataset.filter; renderTimeline(); renderMarkers(); updateUrl(); }));
  $('#timeline').addEventListener('click',event => {
    const toggle = event.target.closest('[data-toggle-stop]');
    if(toggle) {
      const id=toggle.dataset.toggleStop;
      if(openStops.has(id)) openStops.delete(id); else openStops.add(id);
      toggle.setAttribute('aria-expanded',String(openStops.has(id))); $(`#detail-${id}`).hidden=!openStops.has(id);
      toggle.querySelector('.stop-toggle').textContent=openStops.has(id)?'−':'+';
      if(openStops.has(id)) zoomToStop(id);
      return;
    }
    const show = event.target.closest('[data-show-map]'); if(show) { zoomToStop(show.dataset.showMap,true); return; }
    const mark = event.target.closest('[data-visited]');
    if(mark) {
      const id=mark.dataset.visited; if(visited.has(id)) visited.delete(id); else visited.add(id);
      const saved=saveVisited(getStorage(),visited); renderTimeline();
      $(`[data-visited="${id}"]`)?.focus({preventScroll:true});
      toast(saved?(visited.has(id)?'Marked on this device. No checklist to finish.':'Visited mark removed.'):'Marked for this visit only; browser storage is unavailable.'); return;
    }
    if(event.target.closest('[data-choose-route]')) { $('#route-select').scrollIntoView({block:'center',behavior:'smooth'}); $('#route-select').focus({preventScroll:true}); }
  });
  $('#fit-map').addEventListener('click',fitMap);
  $$('[data-open-plan]').forEach(button => button.addEventListener('click',() => $('#plan-dialog').showModal()));
  $$('[data-close-dialog]').forEach(button => button.addEventListener('click',() => button.closest('dialog').close()));
  $$('dialog').forEach(dialog => dialog.addEventListener('click',event => { if(event.target===dialog) { const r=dialog.getBoundingClientRect(); if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) dialog.close(); } }));
  $('#sources-button').addEventListener('click',() => $('#sources-dialog').showModal());
  $('#share-button').addEventListener('click',share);
  $('#print-button').addEventListener('click',() => { $('#plan-dialog').close(); window.print(); });
  let filterBeforePrint;
  window.addEventListener('beforeprint',() => { filterBeforePrint ??= activeFilter; activeFilter='all'; renderTimeline(); });
  window.addEventListener('afterprint',() => { if(filterBeforePrint) { activeFilter=filterBeforePrint; filterBeforePrint=null; renderTimeline(); } });
  $('#clear-visited').addEventListener('click',() => { visited.clear(); saveVisited(getStorage(),visited); renderTimeline(); toast('Visited marks cleared on this device.'); });
  $('[data-nav="map"]').addEventListener('click',event => { event.preventDefault(); $('.map-heading').scrollIntoView({block:'start',behavior:'smooth'}); });
  window.addEventListener('storage',event => { if(event.key===VISITED_KEY) { visited=readVisited(getStorage()); renderTimeline(); } });
  window.addEventListener('hashchange',() => { const id=location.hash.replace('#stop-',''); if(allStops.some(s => s.id===id)) goToStop(id); });
}
async function start() {
  try {
    const response=await fetch(new URL('./data.json',import.meta.url),{cache:'no-cache'});
    if(!response.ok) throw new Error(`data load ${response.status}`);
    data=validateData(await response.json());
    const params = new URL(location.href).searchParams;
    activeFilter=FILTERS.includes(params.get('filter'))?params.get('filter'):'recommended';
    visited=readVisited(getStorage());
    $('#walk-date').textContent=data.meta.dateLabel;
    $('#saved-map-link').href=safeUrl(data.meta.savedMapUrl);
    $('#meetup-link').href=placeUrl(data.stops.find(s => s.id===data.meta.startId));
    $('#route-select').innerHTML=data.variants.map(v => `<option value="${esc(v.id)}">${esc(v.shortLabel || ({west:'West & Village · main',central:'Central streets · swap',coast:'Coast · swap'}[v.id]) || v.label)}</option>`).join('');
    openStops.add(data.meta.startId);
    renderEssentials(); initMap(); bindEvents(); setVariant(params.get('route') || data.meta.defaultVariant);
    const hashId=location.hash.replace('#stop-',''); if(allStops.some(s => s.id===hashId)) goToStop(hashId);
    document.documentElement.dataset.ready='true';
  } catch(error) {
    console.error('Guide initialization failed:',error);
    $('#timeline').innerHTML='<p class="plan-section">The field guide could not load. Please reload, or <a href="https://maps.app.goo.gl/aYMuLDd1MVHAo93v5">open the saved map</a>. Meet at the Broadway / W 207 street elevator at 8:30 AM.</p>';
    $('#map-error').hidden=false;
  }
}
start();
