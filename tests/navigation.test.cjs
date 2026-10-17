const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('main navigation exposes the five requested destinations in order', () => {
  const nav = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.match(nav, /ホーム[\s\S]*?MAP[\s\S]*?潮汐[\s\S]*?釣果[\s\S]*?その他/);
  for (const target of ['homeSection', 'mapSection', 'tideSection', 'catchSection', 'otherSection']) assert.match(nav, new RegExp(`data-target="${target}"`));
});

test('home puts spot, verdict, weather, tide and recommendation in the requested order', () => {
  const home = html.slice(html.indexOf('id="homeSection"'), html.indexOf('id="mapSection"'));
  const order = ['id="homeSpotSelect"', 'id="verdictCard"', 'class="metrics"', 'id="tideSection"', 'class="recommend"'];
  const positions = order.map(token => home.indexOf(token));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test('seasonal fish guide remains in the code but is hidden from normal UI', () => {
  assert.match(html, /class="seasonal-fish-section"[^>]*hidden[^>]*aria-hidden="true"/);
  assert.match(html, /src="seasonal-fish\.js"/);
  assert.match(fs.readFileSync(path.join(root, 'seasonal-fish.js'), 'utf8'), /HINATA_SEASONAL_FISH/);
});
