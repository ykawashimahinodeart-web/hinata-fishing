(function (root) {
  'use strict';

  // No region/species records are published until geographic scope and sources are reviewed.
  const REGIONS = [];
  const ENTRIES = [];
  const SEASONS = [
    { name: '冬', months: [12, 1, 2] },
    { name: '春', months: [3, 4, 5] },
    { name: '夏', months: [6, 7, 8] },
    { name: '秋', months: [9, 10, 11] }
  ];

  function seasonForMonth(month) {
    return SEASONS.find(season => season.months.includes(Number(month)))?.name || '';
  }

  function hasRequiredEvidence(entry) {
    return Boolean(entry && entry.status === 'published' && entry.speciesName && entry.regionId &&
      entry.regionLabel && entry.sourceTitle && /^https:\/\//i.test(entry.sourceUrl || '') &&
      entry.sourcePublishedAt && entry.checkedAt && ['high', 'medium', 'low'].includes(entry.confidence) &&
      Number.isInteger(entry.startMonth) && entry.startMonth >= 1 && entry.startMonth <= 12 &&
      Number.isInteger(entry.endMonth) && entry.endMonth >= 1 && entry.endMonth <= 12);
  }

  function monthMatches(month, start, end) {
    return start <= end ? month >= start && month <= end : month >= start || month <= end;
  }

  function findRegion(spot, regions) {
    if (!spot || !Number.isFinite(Number(spot.lat)) || !Number.isFinite(Number(spot.lon))) return null;
    return regions.find(region => region && typeof region.contains === 'function' && region.contains(Number(spot.lat), Number(spot.lon))) || null;
  }

  function select({ spot, now = new Date(), regions = REGIONS, entries = ENTRIES } = {}) {
    const month = now.getMonth() + 1;
    const region = findRegion(spot, regions);
    if (!spot) return { status: 'no-spot', month, season: seasonForMonth(month), region: null, entries: [] };
    if (!Number.isFinite(Number(spot.lat)) || !Number.isFinite(Number(spot.lon)) || Math.abs(Number(spot.lat)) > 90 || Math.abs(Number(spot.lon)) > 180) {
      return { status: 'invalid-location', month, season: seasonForMonth(month), region: null, entries: [] };
    }
    if (!region) return { status: 'region-unmatched', month, season: seasonForMonth(month), region: null, entries: [] };
    const matching = entries.filter(entry => hasRequiredEvidence(entry) && entry.regionId === region.id && monthMatches(month, entry.startMonth, entry.endMonth));
    return { status: matching.length ? 'available' : 'no-data', month, season: seasonForMonth(month), region, entries: matching };
  }

  const api = Object.freeze({ select, seasonForMonth, hasRequiredEvidence, monthMatches, regions: REGIONS, entries: ENTRIES });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HINATA_SEASONAL_FISH = api;
})(typeof window !== 'undefined' ? window : globalThis);
