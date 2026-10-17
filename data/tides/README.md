# HINATA TIDE data

The yearly JSON files in this directory are normalized copies of the Japan
Meteorological Agency (JMA) annual tide-table text files for Miyazu (`T2`).
They contain only JMA-published hourly predicted tide levels and predicted
high/low tide times and levels. No values are interpolated or extrapolated.

- 2026 source: https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/2026/T2.txt
- 2027 source: https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/2027/T2.txt
- Station page: https://www.data.jma.go.jp/kaiyou/db/tide/suisan/suisan.php?stn=T2
- Format: https://www.data.jma.go.jp/kaiyou/db/tide/suisan/readme.html

JMA's site terms permit reuse unless a specific notice says otherwise, and
require source attribution. This app credits JMA and states that the data was
processed. JMA publishes Miyazu's levels relative to its tide-table datum in
centimeters; the station page does not publish that datum's elevation above
mean sea level. Treat the values as station predictions, not measurements at
the selected fishing spot.

The JMA downloadable files do not provide an `Access-Control-Allow-Origin`
header, so a GitHub Pages browser app cannot fetch them directly. To refresh
coverage for a new year, obtain that year's `T2.txt` from the station page,
convert its 136-column rows using the published format (24 hourly readings,
date, station code, four high-water slots, four low-water slots), and publish
the corresponding `miyazu-YYYY.json` with the app. Add the file to the service
worker's precache list. Until a year is bundled, the app reports tide data as
unavailable instead of reusing stale data.
