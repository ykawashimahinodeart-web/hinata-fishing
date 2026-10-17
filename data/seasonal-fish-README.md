# Seasonal fish content scope

The catalog and region registry are intentionally empty in Phase 2A. A regional species row may be published only after its geographic coverage, season, source URL/title/date, checked date, and confidence have been reviewed. Do not infer fishing conditions from general seafood seasonality.

Official candidate reference reviewed on 2026-10-17:
- Kyoto Prefecture, “京都ブランド丹後・旬のさかな”: https://www.pref.kyoto.jp/suisan/shun-sakana01.html
- The page says it was updated 2017-07-03 and describes selected seasonal Tango seafood. It explicitly calls mebaru a popular spring shore-fishing fish and white squid a popular target, but does not supply point-level geographic boundaries or current catch reports.
- Because the source is old and its geographic coverage cannot currently be safely matched to saved spot coordinates, this Phase 2A build does not publish species from it. Re-review freshness, reuse conditions, and region mapping before adding records.

Record shape expected by seasonal-fish.js:
`{ status: 'published', regionId, regionLabel, speciesName, startMonth, endMonth, summary, sourceTitle, sourceUrl, sourcePublishedAt, checkedAt, confidence }`
