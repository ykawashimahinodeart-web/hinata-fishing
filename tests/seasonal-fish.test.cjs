const test = require('node:test');
const assert = require('node:assert/strict');
const fish = require('../seasonal-fish.js');

const spot = { lat: 35.5, lon: 135.2 };
const region = { id: 'test-region', contains: (lat, lon) => lat > 35 && lon > 135 };
const sourcedEntry = {
  status: 'published', regionId: 'test-region', regionLabel: 'Test Coast', speciesName: 'メバル',
  startMonth: 3, endMonth: 5, summary: '春の沿岸魚の参考情報', sourceTitle: 'Official source',
  sourceUrl: 'https://example.jp/source', sourcePublishedAt: '2025-01-01', checkedAt: '2026-10-17', confidence: 'medium'
};

test('shows no species for unmatched regions rather than extrapolating', () => {
  assert.equal(fish.select({ spot, now: new Date('2026-04-01T00:00:00Z') }).status, 'region-unmatched');
});

test('selects only published entries with complete evidence for the matched region and season', () => {
  const result = fish.select({ spot, regions: [region], entries: [sourcedEntry], now: new Date('2026-04-01T00:00:00Z') });
  assert.equal(result.status, 'available');
  assert.equal(result.region.id, 'test-region');
  assert.deepEqual(result.entries.map(entry => entry.speciesName), ['メバル']);
  assert.equal(fish.select({ spot, regions: [region], entries: [sourcedEntry], now: new Date('2026-10-01T00:00:00Z') }).status, 'no-data');
});

test('rejects unpublished or incomplete evidence and supports seasons crossing year end', () => {
  assert.equal(fish.hasRequiredEvidence({ ...sourcedEntry, sourceUrl: 'http://example.jp' }), false);
  assert.equal(fish.hasRequiredEvidence({ ...sourcedEntry, sourceUrl: '' }), false);
  assert.equal(fish.hasRequiredEvidence({ ...sourcedEntry, status: 'draft' }), false);
  assert.equal(fish.monthMatches(12, 11, 2), true);
  assert.equal(fish.monthMatches(1, 11, 2), true);
  assert.equal(fish.monthMatches(7, 11, 2), false);
});

test('rejects invalid locations and classifies the current season in Japanese', () => {
  assert.equal(fish.select({ spot: { lat: 95, lon: 135 } }).status, 'invalid-location');
  assert.equal(fish.seasonForMonth(10), '秋');
  assert.equal(fish.seasonForMonth(1), '冬');
});
