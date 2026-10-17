const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const depthCss = fs.readFileSync(path.join(root, 'depth.css'), 'utf8');

test('CAST LINE controls are hidden while their markup and implementation remain available', () => {
  assert.match(html, /<section class="cast-tool"[^>]*hidden[^>]*aria-hidden="true">/);
  for (const id of ['castPickButton', 'castUseLocationButton', 'castBearing', 'castCoordinates']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /function updateDepthCast\(/);
  assert.match(app, /L\.polyline\(points/);
  assert.match(depthCss, /\.depth-cast-line,\.depth-cast-start,\.depth-cast-handle\{display:none!important\}/);
});

test('hiding CAST LINE preserves map, GPS, saved spot, weather and tide paths', () => {
  assert.match(html, /id="mapSection" class="map-section"/);
  assert.match(html, /id="homeSpotSelect"/);
  assert.match(html, /id="tideSection" class="tide-section"/);
  assert.match(app, /map\.on\('click'/);
  assert.match(app, /\$\('locateButton'\)\.addEventListener/);
  assert.match(app, /\$\('homeSpotSelect'\)\.addEventListener/);
  assert.match(app, /function loadWeather\(/);
  assert.match(app, /async function renderTide\(/);
  assert.match(app, /hinata-fishing-spots-v1/);
  assert.match(app, /hinata-fishing-room-v1/);
});

test('IndexedDB store remains present and is not deleted by the UI change', () => {
  const store = fs.readFileSync(path.join(root, 'depth-store.js'), 'utf8');
  assert.match(store, /indexedDB\.open/);
  assert.doesNotMatch(store, /deleteDatabase/);
});
