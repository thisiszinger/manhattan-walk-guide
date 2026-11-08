export const FILTERS = ['recommended', 'all', 'food', 'event', 'architecture'];
export const VISITED_KEY = 'manhattan-walk-2026-11-08.visited.v1';
export function safeUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function placeUrl(stop) {
  return safeUrl(stop.placeUrl) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.query || `${stop.name}, Manhattan, New York`)}`;
}
export function validateData(data) {
  const assert = (test, message) => { if (!test) throw new Error(`Walk data: ${message}`); };
  assert(data?.schemaVersion === 1, 'unsupported schemaVersion');
  assert(data.meta && Array.isArray(data.stops) && Array.isArray(data.variants) && Array.isArray(data.chapters), 'missing core collections');
  const ids = new Set(), chapters = new Set(data.chapters.map(c => c.id));
  for (const s of data.stops) {
    assert(/^[a-zA-Z0-9-]+$/.test(s.id) && !ids.has(s.id), 'stop IDs must be unique URL-safe strings'); ids.add(s.id);
    assert(typeof s.name === 'string' && typeof s.summary === 'string' && typeof s.detail === 'string', `missing text for ${s.id}`);
    assert(chapters.has(s.chapter), `unknown chapter for ${s.id}`);
    assert(Array.isArray(s.kinds) && s.kinds.length > 0, `missing kinds for ${s.id}`);
    assert(['main','optional'].includes(s.priority), `invalid priority for ${s.id}`);
    assert(Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.lat > 40.65 && s.lat < 40.9 && s.lng > -74.1 && s.lng < -73.85, `invalid Manhattan coordinate for ${s.id}`);
    if (s.placeUrl) assert(safeUrl(s.placeUrl), `unsafe place URL for ${s.id}`);
    if (s.source) assert(safeUrl(s.source.url), `unsafe source URL for ${s.id}`);
  }
  const variantIds = new Set();
  for (const v of data.variants) {
    assert(/^[a-z0-9-]+$/.test(v.id) && !variantIds.has(v.id), 'duplicate or unsafe variant ID'); variantIds.add(v.id);
    assert(Array.isArray(v.stopIds) && v.stopIds.length > 1 && new Set(v.stopIds).size === v.stopIds.length && v.stopIds.every(id => ids.has(id)), `invalid stops for ${v.id}`);
    if (v.geometry) {
      assert(v.geometry.kind === 'pedestrian-network' && v.geometry.geojson, 'geometry must be an explicit pedestrian-network GeoJSON');
      const checkGeometry = g => {
        if (g.type === 'FeatureCollection') { assert(Array.isArray(g.features), 'invalid features'); g.features.forEach(checkGeometry); return; }
        if (g.type === 'Feature') { checkGeometry(g.geometry); return; }
        assert(['LineString','MultiLineString'].includes(g.type), 'route geometry must contain lines');
        const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
        assert(Array.isArray(lines) && lines.length > 0, 'empty route geometry');
        for (const line of lines) assert(Array.isArray(line) && line.length > 1 && line.every(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90), 'invalid GeoJSON coordinates');
      };
      checkGeometry(v.geometry.geojson);
    }
    for (const d of v.directions || []) assert(typeof d.label === 'string' && safeUrl(d.url) && chapters.has(d.chapter), `invalid directions for ${v.id}`);
  }
  assert(ids.has(data.meta.startId) && variantIds.has(data.meta.defaultVariant), 'invalid default route or start');
  return data;
}
export function routeStops(data, routeId) {
  const variant = data.variants.find(v => v.id === routeId) || data.variants.find(v => v.id === data.meta.defaultVariant);
  const lookup = new Map(data.stops.map(s => [s.id,s]));
  return variant.stopIds.map((id,i) => ({...lookup.get(id), chapter:variant.stopChapterOverrides?.[id] || lookup.get(id).chapter, order:i+1}));
}
export function filterStops(stops, filter) {
  if (filter === 'recommended') return stops.filter(s => s.priority !== 'optional');
  if (filter === 'all') return stops;
  return stops.filter(s => s.kinds.includes(filter));
}
export function groupedStops(stops) {
  const groups = [];
  for (const stop of stops) {
    let group = groups.find(g => g.id === stop.chapter);
    if (!group) { group = {id:stop.chapter,stops:[]}; groups.push(group); }
    group.stops.push(stop);
  }
  return groups;
}
export function readVisited(storage) {
  try { const v = JSON.parse(storage.getItem(VISITED_KEY) || '[]'); return new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : []); } catch { return new Set(); }
}
export function saveVisited(storage, visited) {
  try { storage.setItem(VISITED_KEY, JSON.stringify([...visited])); return true; } catch { return false; }
}
export function namedDirections(stops) {
  if (stops.length < 2) return null;
  // A small set of named anchors, not coordinate pins or a claimed exact route.
  const selected = stops.length <= 5 ? stops : [stops[0],stops[Math.floor(stops.length/3)],stops[Math.floor(stops.length*2/3)],stops.at(-1)];
  const query = new URLSearchParams({api:'1',travelmode:'walking',origin:selected[0].query,destination:selected.at(-1).query});
  if (selected.length > 2) query.set('waypoints',selected.slice(1,-1).map(s => s.query).join('|'));
  return `https://www.google.com/maps/dir/?${query}`;
}
export function sourceList(data) {
  const sources = [...(data.sources || []),...data.stops.flatMap(s => [...(s.source ? [s.source] : []), ...(s.sources || []), ...(s.story?.sources || [])])];
  return [...new Map(sources.filter(s => safeUrl(s.url)).map(s => [s.url,s])).values()];
}
