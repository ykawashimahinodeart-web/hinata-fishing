/* Optional shared storage settings. Fill these after creating the SQL schema in supabase/schema.sql. */
const SUPABASE_URL = window.HINATA_SUPABASE?.url || '';
const SUPABASE_ANON_KEY = window.HINATA_SUPABASE?.anonKey || '';
const STORAGE_KEY = 'hinata-fishing-spots-v1';
// Keep a normal document base as a first-load fallback. On later launches the
// service worker scope is authoritative, even if a shared link has a path suffix.
const APP_BASE_URL = new URL('.', document.currentScript?.src || location.href);
// Stored separately from spot data. Safari and an installed iOS PWA may have
// separate storage, so a missing value must lead to an invite prompt, not a new room.
const ROOM_STORAGE_KEY = 'hinata-fishing-room-v1';
const DEFAULT_CENTER = [35.535, 135.196]; // Miyazu, Kyoto
const GEBCO_WMS_URL = 'https://wms.gebco.net/mapserv?';
const GEBCO_WMS_LAYER = 'GEBCO_LATEST_2';
const GEBCO_MAX_ZOOM = 12; // GEBCO 15-arcsecond grid; avoid implying finer detail.
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let map, userMarker, accuracyCircle, markers = [], spots = [], currentPosition = null, pendingCoords = null, client = null, channel = null, roomId = null, refreshTimer, syncTimer;
let selectedTideSpotId = '', tideYearCache = new Map(), tideRenderToken = 0;
let depthMapPicking = false, depthStart = null, depthStartSpotId = '', depthBearing = 0, depthCastLine = null, depthStartMarker = null, depthEndMarker = null;
let depthDatasets = [], activeDepthDataset = null;
let lastDepthMatch = null, depthStoreFailed = false;
let gebcoBathymetryLayer = null, gebcoBathymetryEnabled = false, gebcoTileFailed = false, gebcoRequestState = 'unverified';

const TIDE_STATION = { name:'宮津', code:'T2', lat:35 + 32 / 60, lon:135 + 12 / 60 };

function tideDistanceKm(lat, lon) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(TIDE_STATION.lat - Number(lat)), dLon = rad(TIDE_STATION.lon - Number(lon));
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(Number(lat))) * Math.cos(rad(TIDE_STATION.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function setTideStatus(message) { $('tideStatus').textContent = message; }

async function getTideYear(year) {
  if (!tideYearCache.has(year)) {
    const request = (async () => {
      const registration = await navigator.serviceWorker?.getRegistration().catch(() => null);
      const appBase = registration?.scope || APP_BASE_URL;
      const dataUrl = new URL(`data/tides/miyazu-${year}.json`, appBase);
      const response = await fetch(dataUrl, { cache:'no-cache' });
      if (!response.ok) throw new Error('tide data unavailable');
      const data = await response.json();
      if (data.stationCode !== TIDE_STATION.code || data.year !== year || !Array.isArray(data.days)) throw new Error('invalid tide data');
      return data;
    })().catch(error => { tideYearCache.delete(year); throw error; });
    tideYearCache.set(year, request);
  }
  return tideYearCache.get(year);
}

function formatTideEvents(day) {
  if (!day) return '<div class="tide-event-day"><strong>潮汐データ未取得</strong></div>';
  const items = [
    ...day.highs.map(event => ({ ...event, type:'満潮' })),
    ...day.lows.map(event => ({ ...event, type:'干潮' }))
  ].sort((a, b) => a.time.localeCompare(b.time));
  const date = new Date(`${day.date}T00:00:00`);
  const label = date.toLocaleDateString('ja-JP', { month:'numeric', day:'numeric', weekday:'short' });
  return `<div class="tide-event-day"><strong>${label}</strong>${items.length ? items.map(event => `<span><b>${event.type}</b> ${event.time.trim()} · ${event.cm}cm</span>`).join('') : '<span>満干潮の予測なし</span>'}</div>`;
}

function buildTideChart(samples, markerOffset) {
  const valid = samples.filter(sample => Number.isFinite(sample.cm));
  if (valid.length < 2) return '<p class="forecast-empty">この期間の潮位データ未取得</p>';
  const width = 720, height = 205, left = 38, right = 12, top = 22, bottom = 28;
  const values = valid.map(sample => sample.cm), min = Math.min(...values), max = Math.max(...values);
  const pad = Math.max(3, (max - min) * 0.12), low = min - pad, high = max + pad;
  const x = index => left + (width - left - right) * index / 24;
  const y = value => top + (height - top - bottom) * (high - value) / (high - low || 1);
  let hasPrevious = false;
  const path = samples.map(sample => {
    if (!Number.isFinite(sample.cm)) { hasPrevious = false; return ''; }
    const command = hasPrevious ? 'L' : 'M'; hasPrevious = true;
    return `${command}${x(sample.index).toFixed(1)},${y(sample.cm).toFixed(1)}`;
  }).filter(Boolean).join(' ');
  const ticks = [0,6,12,18,24].map(index => `<text x="${x(index)}" y="${height - 6}" text-anchor="middle">${samples[index]?.time || ''}</text>`).join('');
  const markerX = x(Math.max(0, Math.min(24, markerOffset)));
  const yTicks = [0,0.5,1].map(fraction => { const value = high - (high-low)*fraction; const yy = top + (height-top-bottom)*fraction; return `<line class="tide-grid" x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text x="${left-6}" y="${yy+3}" text-anchor="end">${Math.round(value)}</text>`; }).join('');
  const points = valid.map(sample => `<circle cx="${x(sample.index)}" cy="${y(sample.cm)}" r="2.7"/>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="気象庁 宮津の毎時推算潮位、cm"><g class="tide-axis">${yTicks}${ticks}</g><path class="tide-line" d="${path}"/>${points}<line class="tide-now" x1="${markerX}" y1="${top}" x2="${markerX}" y2="${height-bottom}"/><text class="tide-now-label" x="${Math.min(width-32,Math.max(left+20,markerX))}" y="14" text-anchor="middle">現在</text></svg><div class="tide-legend"><span>潮位表基準面上 (cm)</span><span><i></i>気象庁 推算潮位</span></div>`;
}

async function renderTide(spot) {
  const renderToken = ++tideRenderToken;
  if (!spot) {
    setTideStatus(spots.length ? '釣り場を選択してください' : '登録ポイントがありません');
    $('tideStation').textContent = '登録済みポイントを選ぶと、対応する潮汐データを表示します。';
    $('tideEvents').innerHTML = '';
    $('tideChart').innerHTML = '<p class="forecast-empty">釣り場を選択すると、今日から24時間の潮位を表示します。</p>';
    return;
  }
  const distance = tideDistanceKm(spot.lat, spot.lon);
  $('tideStation').textContent = `${spot.name} → 潮汐予測地点：宮津（直線距離 約${distance.toFixed(1)}km）`;
  setTideStatus('気象庁の予測値');
  $('tideEvents').innerHTML = '<div class="tide-event-day"><span>潮汐データを読み込み中…</span></div>';
  $('tideChart').innerHTML = '<p class="forecast-empty">潮位データを読み込み中…</p>';
  const now = new Date();
  const start = new Date(now); start.setMinutes(0, 0, 0);
  const dates = Array.from({length:25}, (_, index) => new Date(start.getTime() + index * 3600000));
  const years = [...new Set(dates.map(date => date.getFullYear()))];
  try {
    const datasets = await Promise.all(years.map(getTideYear));
    if (renderToken !== tideRenderToken) return;
    setTideStatus(`気象庁 年次予測（${years.join('・')}）`);
    const lookup = new Map();
    datasets.forEach(data => data.days.forEach(day => lookup.set(day.date, day)));
    const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const today = dateKey(now), tomorrow = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()+1));
    $('tideEvents').innerHTML = [lookup.get(today), lookup.get(tomorrow)].map(formatTideEvents).join('');
    const samples = dates.map((date, index) => {
      const day = lookup.get(dateKey(date));
      return {index, time:date.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}), cm:day?.hourly?.[date.getHours()]};
    });
    $('tideChart').innerHTML = buildTideChart(samples, now.getMinutes()/60);
    if (samples.some(sample => !Number.isFinite(sample.cm))) setTideStatus('一部の時間帯は潮汐データ未取得');
    $('tideNote').textContent = '潮位は気象庁の推算値です。毎時値のみを表示し、時刻間の値は補間していません。潮位表基準面からの高さ（cm）で、平均海面からの標高ではありません。';
  } catch {
    $('tideEvents').innerHTML = '<div class="tide-event-day"><strong>潮汐データ未取得</strong></div>';
    $('tideChart').innerHTML = '<p class="forecast-empty">この年の潮汐データはアプリに収録されていません。</p>';
    setTideStatus('潮汐データ未取得');
  }
}

function updateTideSpotOptions() {
  const select = $('tideSpotSelect');
  if (!select) return;
  const previous = selectedTideSpotId || select.value;
  select.innerHTML = '<option value="">登録済みポイントから選択</option>';
  spots.forEach(spot => {
    const option = document.createElement('option'); option.value = String(spot.id); option.textContent = spot.name; select.appendChild(option);
  });
  if (spots.some(spot => String(spot.id) === previous)) selectedTideSpotId = previous;
  else selectedTideSpotId = spots.length ? String(spots[0].id) : '';
  select.value = selectedTideSpotId;
  renderTide(spots.find(spot => String(spot.id) === selectedTideSpotId));
}

function setGebcoStatus(message) {
  const status = $('gebcoBathymetryStatus');
  if (status) status.textContent = message;
}

function renderDepthDataStatus() {
  const box=$('depthDataStatus'); if(!box||!window.HINATA_DEPTH_STATUS)return;
  const precision=HINATA_DEPTH_STATUS.precisionStatus(lastDepthMatch,!!activeDepthDataset);
  const csv=HINATA_DEPTH_STATUS.csvStatus({match:activeDepthDataset?lastDepthMatch:null,datasetCount:depthDatasets.length,error:depthStoreFailed});
  const gebco=HINATA_DEPTH_STATUS.gebcoStatus({online:navigator.onLine,enabled:gebcoBathymetryEnabled,zoomAllowed:!!map&&map.getZoom()<=GEBCO_MAX_ZOOM,state:gebcoRequestState});
  box.innerHTML=`<div class="depth-source-status"><b>広域水深（GEBCO）</b><strong>${esc(gebco.label)}</strong><span>${esc(gebco.detail)}</span></div><div class="depth-source-status"><b>100m精密断面（実測照合）</b><strong>${esc(precision.label)}</strong><span>${esc(precision.detail)} ${activeDepthDataset?`使用中：${esc(activeDepthDataset.name)}（${esc(activeDepthDataset.vertical_datum||'鉛直基準不明')}）`:'実測データセット未選択'}</span></div><div class="depth-source-status"><b>端末内CSV測深データ</b><strong>${esc(csv.label)}</strong><span>${esc(csv.detail)} ${activeDepthDataset?`照合対象：${esc(activeDepthDataset.name)}`:''}</span></div><p class="depth-status-note">GEBCOは広域参考画像で、個別地点の測深確認や100m断面には使用しません。CSVはこの端末内のみで、Safariとホーム画面PWAの保存領域は別の場合があります。${!activeDepthDataset&&depthDatasets.length?' データセットを選択すると断面への適合を確認します。':''}</p>`;
}

function syncGebcoBathymetry() {
  if (!map || !gebcoBathymetryLayer) return;
  const canShow = gebcoBathymetryEnabled && map.getZoom() <= GEBCO_MAX_ZOOM;
  if (canShow && !map.hasLayer(gebcoBathymetryLayer)) gebcoBathymetryLayer.addTo(map);
  if (!canShow && map.hasLayer(gebcoBathymetryLayer)) map.removeLayer(gebcoBathymetryLayer);
  if (!gebcoBathymetryEnabled) setGebcoStatus('OFF');
  else if (map.getZoom() > GEBCO_MAX_ZOOM) setGebcoStatus(`ON · ズーム${GEBCO_MAX_ZOOM}以下で表示`);
  else if (gebcoRequestState==='error') setGebcoStatus('取得できません · 地図は利用できます');
  else if (gebcoRequestState==='available') setGebcoStatus('表示中 · 広域参考データ');
  else setGebcoStatus('確認中 · GEBCO WMS');
  renderDepthDataStatus();
}

function initGebcoBathymetry() {
  if (!$('gebcoBathymetryToggle')) return;
  gebcoBathymetryLayer = L.tileLayer.wms(GEBCO_WMS_URL, {
    layers: GEBCO_WMS_LAYER,
    version: '1.3.0',
    format: 'image/png',
    transparent: true,
    crs: L.CRS.EPSG3857,
    maxZoom: GEBCO_MAX_ZOOM,
    opacity: 0.62,
    attribution: 'GEBCO_2026 Grid · GEBCO Bathymetric Compilation Group (2026)'
  });
  gebcoBathymetryLayer.on('loading', () => { gebcoTileFailed = false; gebcoRequestState='loading'; renderDepthDataStatus(); });
  gebcoBathymetryLayer.on('tileload', () => { if(!gebcoTileFailed)gebcoRequestState='available'; renderDepthDataStatus(); });
  gebcoBathymetryLayer.on('tileerror', () => {
    gebcoTileFailed = true;
    gebcoRequestState='error'; renderDepthDataStatus();
    if (gebcoBathymetryEnabled && map.getZoom() <= GEBCO_MAX_ZOOM) syncGebcoBathymetry();
  });
  gebcoBathymetryLayer.on('load', () => {
    if(gebcoBathymetryEnabled&&!gebcoTileFailed)gebcoRequestState='available';
    if (gebcoBathymetryEnabled) syncGebcoBathymetry();
  });
  $('gebcoBathymetryToggle').addEventListener('change', event => {
    gebcoBathymetryEnabled = event.target.checked;
    gebcoTileFailed = false; gebcoRequestState='unverified';
    syncGebcoBathymetry();
  });
  map.on('zoomend', syncGebcoBathymetry);
  window.addEventListener('online',()=>{gebcoRequestState='unverified';if(gebcoBathymetryEnabled)gebcoBathymetryLayer?.redraw();renderDepthDataStatus();});
  window.addEventListener('offline',()=>{gebcoRequestState='error';renderDepthDataStatus();});
}

function initMap() {
  map = L.map('map', { zoomControl:false, scrollWheelZoom:false }).setView(DEFAULT_CENTER, 10);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'&copy; OpenStreetMap' }).addTo(map);
  L.control.zoom({ position:'topright' }).addTo(map);
  initGebcoBathymetry();
  map.on('click', (event) => {
    if (depthMapPicking) { setDepthOrigin(event.latlng.lat, event.latlng.lng, '', '地図で選択した地点'); $('depthPickButton').classList.remove('active'); $('depthPickButton').textContent='地図で開始地点を選ぶ'; $('castPickButton').classList.remove('active'); $('castPickButton').textContent='地図で地点を指定'; depthMapPicking=false; map.getContainer().classList.remove('depth-pick-cursor'); return; }
    pendingCoords = [event.latlng.lat, event.latlng.lng]; openSpotDialog(pendingCoords);
  });
  renderSpots(); setTimeout(() => map.invalidateSize(), 250);
}

function destinationPoint(lat, lon, bearingDeg, distanceM=100) {
  const radius=6371008.8, bearing=bearingDeg*Math.PI/180, angular=distanceM/radius, phi1=lat*Math.PI/180, lambda1=lon*Math.PI/180;
  const phi2=Math.asin(Math.sin(phi1)*Math.cos(angular)+Math.cos(phi1)*Math.sin(angular)*Math.cos(bearing));
  const lambda2=lambda1+Math.atan2(Math.sin(bearing)*Math.sin(angular)*Math.cos(phi1),Math.cos(angular)-Math.sin(phi1)*Math.sin(phi2));
  return [phi2*180/Math.PI,((lambda2*180/Math.PI+540)%360)-180];
}
function setDepthOrigin(lat, lon, spotId='', label='地図で選択した地点') {
  depthStart={lat:Number(lat),lon:Number(lon),label}; depthStartSpotId=spotId?String(spotId):'';
  const select=$('depthSpotSelect'); if(select) select.value=depthStartSpotId;
  const castSelect=$('castSpotSelect'); if(castSelect) castSelect.value=depthStartSpotId;
  updateDepthCast();
}
function updateDepthCast() {
  if(!$('depthBearingValue')) return;
  depthBearing=Number($('depthBearing').value)||0;
  $('depthBearingValue').textContent=`${compass(depthBearing)} ${depthBearing}°`;
  if($('castBearingValue')) $('castBearingValue').textContent=`${compass(depthBearing)} ${depthBearing}°`;
  if($('castBearing')) $('castBearing').value=String(depthBearing);
  if(!depthStart) {
    $('depthCoordinates').textContent='開始地点を選択してください';
    if($('castCoordinates')) $('castCoordinates').textContent='開始地点を選択してください';
    [depthCastLine,depthStartMarker,depthEndMarker].forEach(layer=>{if(layer&&map?.hasLayer(layer))map.removeLayer(layer);});
    depthCastLine=depthStartMarker=depthEndMarker=null; renderDepthDataset(); return;
  }
  const end=destinationPoint(depthStart.lat,depthStart.lon,depthBearing);
  const readout=`開始 ${depthStart.lat.toFixed(5)}, ${depthStart.lon.toFixed(5)} → 100m先 ${end[0].toFixed(5)}, ${end[1].toFixed(5)} · ${compass(depthBearing)} ${depthBearing}°`;
  $('depthCoordinates').textContent=readout;
  if($('castCoordinates')) $('castCoordinates').textContent=readout;
  const points=[[depthStart.lat,depthStart.lon],end];
  if(depthCastLine) depthCastLine.setLatLngs(points); else depthCastLine=L.polyline(points,{className:'depth-cast-line',color:'#d8fdff',weight:4,dashArray:'8 6'}).addTo(map);
  if(depthStartMarker) depthStartMarker.setLatLng(points[0]); else depthStartMarker=L.circleMarker(points[0],{className:'depth-cast-start',radius:7,fillOpacity:1,weight:2}).addTo(map).bindTooltip('CAST LINE 始点');
  if(depthEndMarker) depthEndMarker.setLatLng(end); else depthEndMarker=L.circleMarker(end,{className:'depth-cast-handle',radius:6,fillOpacity:1,weight:2}).addTo(map).bindTooltip('100m先');
  renderDepthDataset();
}
function refreshDepthSpotOptions() {
  const select=$('depthSpotSelect'); if(!select)return;
  select.innerHTML='<option value="">登録済みポイントから選択</option>';
  const castSelect=$('castSpotSelect'); if(castSelect)castSelect.innerHTML='<option value="">登録済みポイントから選択</option>';
  spots.forEach(spot=>{const option=document.createElement('option');option.value=String(spot.id);option.textContent=spot.name;select.appendChild(option);if(castSelect)castSelect.appendChild(option.cloneNode(true));});
  if(depthStartSpotId && !spots.some(spot=>String(spot.id)===depthStartSpotId)){depthStart=null;depthStartSpotId='';}
  if(depthStartSpotId) select.value=depthStartSpotId;
  if(castSelect)castSelect.value=depthStartSpotId;
  if(!depthStart && spots.length) setDepthOrigin(spots[0].lat,spots[0].lon,spots[0].id,spots[0].name);
}
function initializeDepthUI() {
  $('depthDemoProfile').addEventListener('change',()=>{if(!activeDepthDataset)HINATA_DEPTH.render($('depthDrawing'),HINATA_DEPTH.sampleProfile($('depthDemoProfile').value));});
  $('depthBearing').addEventListener('input',updateDepthCast);
  $('depthSpotSelect').addEventListener('change',()=>{const spot=spots.find(item=>String(item.id)===$('depthSpotSelect').value);if(spot){setDepthOrigin(spot.lat,spot.lon,spot.id,spot.name);map.setView([spot.lat,spot.lon],13);}});
  $('depthPickButton').addEventListener('click',()=>{depthMapPicking=!depthMapPicking;$('depthPickButton').classList.toggle('active',depthMapPicking);$('depthPickButton').textContent=depthMapPicking?'地図をタップして地点を指定':'地図で開始地点を選ぶ';$('castPickButton').classList.toggle('active',depthMapPicking);$('castPickButton').textContent=depthMapPicking?'地図をタップして地点を指定':'地図で地点を指定';map.getContainer().classList.toggle('depth-pick-cursor',depthMapPicking);if(depthMapPicking)document.querySelector('.map-section').scrollIntoView({behavior:'smooth'});});
  $('depthUseLocationButton').addEventListener('click',()=>{if(currentPosition)setDepthOrigin(currentPosition.lat,currentPosition.lon,'','現在地');else showInfo('現在地がありません','先に「現在地」を取得してください。');});
  $('castSpotSelect').addEventListener('change',()=>{$('depthSpotSelect').value=$('castSpotSelect').value;$('depthSpotSelect').dispatchEvent(new Event('change'));});
  $('castBearing').addEventListener('input',()=>{$('depthBearing').value=$('castBearing').value;$('depthBearing').dispatchEvent(new Event('input'));});
  $('castPickButton').addEventListener('click',()=>$('depthPickButton').click());
  $('castUseLocationButton').addEventListener('click',()=>$('depthUseLocationButton').click());
  $('depthImportButton').addEventListener('click',importDepthCsv);
  $('depthDatasetSelect').addEventListener('change',()=>selectDepthDataset($('depthDatasetSelect').value));
  $('depthExportButton').addEventListener('click',exportDepthCsv);
  $('depthDeleteButton').addEventListener('click',deleteDepthDataset);
  HINATA_DEPTH.render($('depthDrawing'),HINATA_DEPTH.sampleProfile('shallow'));
  refreshDepthSpotOptions();
  refreshDepthDatasets();
}

function renderDepthDataset(){
  const demoSelect=$('depthDemoProfile'),warning=$('depthSampleWarning'),badge=$('depthModeBadge'),status=$('depthDrawStatus');
  if(!activeDepthDataset){lastDepthMatch=null;if(demoSelect)demoSelect.disabled=false;if(warning)warning.hidden=false;if(badge)badge.textContent='サンプル';if(status)status.textContent='デモ地形を表示中。実際の地点の水深を表しません。';HINATA_DEPTH.render($('depthDrawing'),HINATA_DEPTH.sampleProfile(demoSelect?.value||'shallow'));renderDepthDataStatus();return;}
  if(demoSelect)demoSelect.disabled=true;if(warning)warning.hidden=true;if(badge)badge.textContent='実測';
  if(!depthStart){lastDepthMatch=null;HINATA_DEPTH.render($('depthDrawing'),{mode:'measured',points:[],segments:[]});if(status)status.textContent='キャスト開始地点を選択すると、保存済み測深点を照合します。';renderDepthDataStatus();return;}
  const result=HINATA_DEPTH_ANALYSIS.matchToCastLine(activeDepthDataset.points,depthStart,depthBearing);lastDepthMatch=result;
  HINATA_DEPTH.render($('depthDrawing'),{mode:'measured',points:result.points,segments:result.segments,verticalDatum:activeDepthDataset.vertical_datum});
  const offset=result.points.length?` · 横距離 最大 ${Math.max(...result.points.map(p=>p.crossTrackAbsM)).toFixed(1)}m`:'';
  if(status)status.textContent=`${activeDepthDataset.name} · CAST LINEから最大${result.policy.maxCrossTrackM}m以内（精度不明は${result.policy.minCrossTrackM}m以内）を表示 · ${result.points.length}点採用 / ${result.rejectedCount}点除外${offset} · 線の接続は間隔${result.policy.maxConnectGapM}m以内かつ水平精度${result.policy.maxConnectAccuracyM}m以内`;
  renderDepthDataStatus();
}
function depthDatasetOptionLabel(dataset){return `${dataset.name} · ${dataset.count.toLocaleString()}点 · ${new Date(dataset.created_at).toLocaleDateString('ja-JP')}`;}
async function refreshDepthDatasets(selectId=activeDepthDataset?.dataset_id||''){
  try{depthStoreFailed=false;depthDatasets=await HINATA_DEPTH_STORE.list();const select=$('depthDatasetSelect');select.innerHTML='<option value="">データセットを選択</option>';depthDatasets.forEach(dataset=>{const option=document.createElement('option');option.value=dataset.dataset_id;option.textContent=depthDatasetOptionLabel(dataset);select.appendChild(option);});const desiredId=selectId||(depthDatasets[0]?.dataset_id||'');if(desiredId&&depthDatasets.some(item=>item.dataset_id===desiredId)){select.value=desiredId;await selectDepthDataset(desiredId);}else if(!desiredId){activeDepthDataset=null;select.value='';$('depthExportButton').disabled=true;$('depthDeleteButton').disabled=true;$('depthDatasetInfo').textContent=`この保存領域に${depthDatasets.length}件のデータセットがあります。Safariとホーム画面PWAでは保存が別になる場合があります。`;renderDepthDataset();}}
  catch(error){depthStoreFailed=true;$('depthDatasetInfo').textContent=`端末内保存を利用できません: ${error.message}`;renderDepthDataStatus();}
}
async function selectDepthDataset(id){
  try{depthStoreFailed=false;activeDepthDataset=id?await HINATA_DEPTH_STORE.get(id):null;}catch(error){depthStoreFailed=true;activeDepthDataset=null;lastDepthMatch=null;$('depthDatasetInfo').textContent=`データセットを読み込めません: ${error.message}`;renderDepthDataset();return;}
  $('depthExportButton').disabled=!activeDepthDataset;$('depthDeleteButton').disabled=!activeDepthDataset;
  if(activeDepthDataset){$('depthDatasetInfo').textContent=`${activeDepthDataset.name} · ${activeDepthDataset.count.toLocaleString()}点 · 鉛直基準 ${activeDepthDataset.vertical_datum||'不明'} · 端末内のみ（Safari/PWA間で共有されません）`;}
  else{$('depthDatasetInfo').textContent=`保存データはこのブラウザの端末内に保管されます。${depthDatasets.length}件保存済み。`;}
  renderDepthDataset();
}
async function importDepthCsv(){
  const input=$('depthCsvFile'),file=input.files?.[0];if(!file){$('depthImportStatus').textContent='先にCSVファイルを選択してください。';return;}
  if(file.size>HINATA_DEPTH_DATA.MAX_BYTES){$('depthImportStatus').textContent='ファイルは5MB以下にしてください。';return;}
  $('depthImportButton').disabled=true;$('depthImportStatus').textContent='CSVを検証しています…';
  try{const text=await file.text(),result=HINATA_DEPTH_DATA.parse(text,file.name);if(!result.ok){$('depthImportStatus').textContent=`取り込めませんでした（${result.errors.length}件）: ${result.errors.join(' ')}`;return;}
    const dataset={dataset_id:crypto.randomUUID(),name:file.name,created_at:new Date().toISOString(),count:result.points.length,points:result.points,source:result.metadata.sources.join(', '),vertical_datum:result.metadata.verticalDatum,measured_at_min:result.points.map(p=>p.measured_at).filter(Boolean).sort()[0]||null,measured_at_max:result.points.map(p=>p.measured_at).filter(Boolean).sort().at(-1)||null,original_csv:text,size_bytes:file.size};
    await HINATA_DEPTH_STORE.put(dataset);await refreshDepthDatasets(dataset.dataset_id);input.value='';$('depthImportStatus').textContent=`検証・保存しました: ${result.points.length.toLocaleString()}点。${result.warnings.length?`注意 ${result.warnings.length}件: ${result.warnings.slice(0,4).join(' ')}`:'欠測・重複エラーなし。'} データはこの端末に保存されています。`;
  }catch(error){$('depthImportStatus').textContent=`読み込み・保存に失敗しました: ${error.message}`;}finally{$('depthImportButton').disabled=false;}
}
function exportDepthCsv(){if(!activeDepthDataset)return;const blob=new Blob([activeDepthDataset.original_csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=activeDepthDataset.name.replace(/[\\/:*?"<>|]/g,'_')||'depth-backup.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function deleteDepthDataset(){if(!activeDepthDataset)return;if(!confirm(`「${activeDepthDataset.name}」の水深データセットをこの端末から削除しますか？釣りポイントや共有ルームには影響しません。`))return;const id=activeDepthDataset.dataset_id;try{await HINATA_DEPTH_STORE.remove(id);activeDepthDataset=null;await refreshDepthDatasets();$('depthImportStatus').textContent='選択した水深データセットを端末から削除しました。釣りポイント・共有データには影響していません。';}catch(error){$('depthImportStatus').textContent=`削除できませんでした: ${error.message}`;}}

function validRoomId(value){return typeof value==='string'&&/^[a-f0-9]{24,64}$/i.test(value);}
function roomIdFromInput(value){
  const text=String(value||'').trim();
  if(validRoomId(text))return text;
  try{
    const url=new URL(text,location.href);
    const fromQuery=url.searchParams.get('room');
    const fromHash=new URLSearchParams(url.hash.replace(/^#/, '').replace(/^room=/, 'room=')).get('room');
    const room=fromHash||fromQuery;
    return validRoomId(room)?room:null;
  }catch{return null;}
}
function setRoomInAddress(id){
  const url=new URL(location.href);
  const params=new URLSearchParams(url.hash.replace(/^#/, ''));
  params.set('room',id);
  url.searchParams.delete('room');
  url.hash=params.toString();
  history.replaceState({},'',url);
}

function setLocation(lat, lon, accuracy) {
  currentPosition = { lat, lon };
  if (userMarker) userMarker.setLatLng([lat,lon]); else userMarker = L.circleMarker([lat,lon], { radius:8, color:'#fff', weight:3, fillColor:'#418cfa', fillOpacity:1 }).addTo(map).bindPopup('現在地');
  if (accuracy) { if (accuracyCircle) accuracyCircle.setLatLng([lat,lon]).setRadius(accuracy); else accuracyCircle = L.circle([lat,lon],{radius:accuracy,color:'#418cfa',weight:1,fillColor:'#418cfa',fillOpacity:.09}).addTo(map); }
  $('locationTitle').textContent = '現在地'; $('updatedAt').textContent = 'GPS位置情報'; map.setView([lat,lon], 13); loadWeather(lat,lon);
}

function locate() {
  if (!navigator.geolocation) { showInfo('位置情報に未対応','このブラウザでは位置情報を利用できません。地図をタップして釣り場を登録できます。'); return; }
  $('updatedAt').textContent = '位置情報を取得中…';
  navigator.geolocation.getCurrentPosition(({coords}) => setLocation(coords.latitude,coords.longitude,coords.accuracy), (error) => {
    $('updatedAt').textContent = '位置情報を取得できません';
    if (error?.code === 1) showInfo('位置情報の許可を確認してください','このサイトの位置情報がブラウザで許可されているか確認してください。地図をタップして地点を登録することもできます。');
    else if (error?.code === 3) showInfo('現在地の取得に時間がかかっています','位置情報の許可は済んでいても、PCが現在地を特定できない場合があります。地図をタップして地点を選ぶか、スマートフォンでお試しください。');
    else showInfo('現在地を特定できません','位置情報サービスやGPS・Wi-Fiの情報を取得できないようです。地図をタップして地点を選ぶか、スマートフォンでお試しください。');
  }, {enableHighAccuracy:false, timeout:20000, maximumAge:300000});
}

async function loadWeather(lat, lon) {
  const cacheKey = `hinata-weather-v11-${lat.toFixed(3)}-${lon.toFixed(3)}`;
  const cached = readWeatherCache(cacheKey);
  if (cached) renderWeather(cached.weather, cached.marine, true);
  $('forecastStatus').textContent = '最新予報を取得中…';
  try {
    const q = new URLSearchParams({latitude:lat,longitude:lon,current:'temperature_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',hourly:'temperature_2m,precipitation_probability,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',daily:'sunrise,sunset,weather_code,wind_speed_10m_max,wind_gusts_10m_max',timezone:'auto',forecast_days:2,wind_speed_unit:'ms',precipitation_unit:'mm'});
    const mq = new URLSearchParams({latitude:lat,longitude:lon,current:'wave_height,wave_period,sea_surface_temperature',hourly:'wave_height,wave_period',timezone:'auto',forecast_days:2});
    const [weatherRes, marineRes] = await Promise.all([fetch(`https://api.open-meteo.com/v1/forecast?${q}`),fetch(`https://marine-api.open-meteo.com/v1/marine?${mq}`)]);
    if (!weatherRes.ok) throw new Error('weather');
    const weather = await weatherRes.json(); const marine = marineRes.ok ? await marineRes.json() : null;
    writeWeatherCache(cacheKey, weather, marine);
    renderWeather(weather, marine, false);
  } catch (_) {
    if (cached) { $('updatedAt').textContent = `最新予報の取得失敗 · ${new Date(cached.savedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}時点`; $('forecastStatus').textContent = '最新情報を取得できません'; }
    else { $('updatedAt').textContent = '気象データを取得できません'; $('forecastStatus').textContent = '予報を取得できません'; $('verdictTitle').textContent = '判定できません'; $('verdictReason').textContent = '予報データがないため判定しません。通信状況を確認してください。'; $('hourlyForecast').innerHTML = '<p class="forecast-empty">予報データを取得できません。時間や条件を推測して表示していません。</p>'; }
  }
}

function readWeatherCache(key){try{const value=JSON.parse(localStorage.getItem(key)||'null');return value&&Date.now()-value.savedAt<30*60*1000?value:null;}catch{return null;}}
function writeWeatherCache(key,weather,marine){try{localStorage.setItem(key,JSON.stringify({savedAt:Date.now(),weather,marine}));}catch{}}

const compass = (deg) => ['北','北東','東','南東','南','南西','西','北西'][Math.round(deg/45)%8];
const wxLabel = (code) => code === 0 ? '晴れ' : code <= 3 ? 'くもり' : code < 50 ? '霧' : code < 60 ? '霧雨' : code < 70 ? '雨' : code < 80 ? '雪' : code < 85 ? 'にわか雨' : '荒天';

function renderWeather(w, m, isCached=false) {
  const c=w.current, d=w.daily, h=w.hourly, mc=m?.current; $('temperature').textContent=`${Math.round(c.temperature_2m)}°`;
  $('wind').textContent=`${compass(c.wind_direction_10m)} ${Number(c.wind_speed_10m).toFixed(1)}`;
  $('wave').textContent=mc?.wave_height != null ? `${Number(mc.wave_height).toFixed(1)}m` : '--';
  $('seaTemp').textContent=mc?.sea_surface_temperature != null ? `${Number(mc.sea_surface_temperature).toFixed(1)}°` : '--';
  const now=new Date();
  // Open-Meteo timestamps are local time at the requested coordinates. Resolve
  // the matching forecast date there instead of comparing with the device's UTC date.
  const localNow = new Intl.DateTimeFormat('sv-SE',{timeZone:w.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const idx=Math.max(0,d.time.findIndex(day=>day===localNow));
  const hourIdx=h.time.findIndex(t=>new Date(`${t}:00${w.utc_offset_seconds>=0?'+':'-'}${String(Math.floor(Math.abs(w.utc_offset_seconds)/3600)).padStart(2,'0')}:${String(Math.floor((Math.abs(w.utc_offset_seconds)%3600)/60)).padStart(2,'0')}`)>=now);
  const sunrise=new Date(d.sunrise[idx]), sunset=new Date(d.sunset[idx]);
  const tomorrowDate=new Date(sunrise);tomorrowDate.setDate(tomorrowDate.getDate()+1);const tomorrowSunrise=d.sunrise[idx+1]?new Date(d.sunrise[idx+1]):tomorrowDate;
  const nowMs=Date.now(), offset=w.utc_offset_seconds||0;
  const hours=[];
  for(let i=0;i<h.time.length;i++){
    const ts=localForecastDate(h.time[i],offset);
    if(ts.getTime()<nowMs-3600000||ts.getTime()>nowMs+24*3600000)continue;
    const mi=m?.hourly?.time?.indexOf(h.time[i]) ?? -1;
    const point={time:h.time[i],temp:h.temperature_2m?.[i],wind:h.wind_speed_10m?.[i],direction:h.wind_direction_10m?.[i],gust:h.wind_gusts_10m?.[i],rain:h.precipitation?.[i] ?? h.rain?.[i] ?? h.showers?.[i],precipProbability:h.precipitation_probability?.[i],code:h.weather_code?.[i],wave:mi>=0?m.hourly.wave_height?.[mi]:null,wavePeriod:mi>=0?m.hourly.wave_period?.[mi]:null};
    point.verdict=window.HinataVerdict.evaluate(point);hours.push(point);
  }
  const code=Number.isFinite(c.weather_code)?Number(c.weather_code):null;
  const current=hours[0]||window.HinataVerdict.evaluate({wind:c.wind_speed_10m,gust:c.wind_gusts_10m,wave:mc?.wave_height,rain:c.precipitation,code});
  $('verdictCard').className=`verdict-card verdict-${current.cls||'loading'}`;$('verdictIcon').textContent=current.icon;$('verdictTitle').textContent=current.title;$('verdictReason').textContent=current.reason;
  renderHourly(hours);
  const candidates=[];
  for(const point of hours){const ts=localForecastDate(point.time,offset);const near=Math.min(Math.abs(ts-sunrise),Math.abs(ts-sunset),Math.abs(ts-tomorrowSunrise));if(near<=2*3600000&&point.verdict.grade&&point.verdict.grade!=='D'){const v=point.verdict;const score=(v.grade==='A'?0:v.grade==='B'?2:5)+(point.wind??0)*.5+(point.precipProbability??0)/25+(point.gust??0)*.2+(point.wave??0)*2;candidates.push({point,score});}}
  candidates.sort((a,b)=>a.score-b.score);const picks=[];for(const x of candidates){const minute=Number(x.point.time.slice(11,13))*60+Number(x.point.time.slice(14,16));if(!picks.some(p=>Math.abs(p.minute-minute)<90))picks.push({minute,time:x.point.time.slice(11,16),grade:x.point.verdict.grade});if(picks.length===3)break;}
  $('recommendTime').textContent=current.grade==='D'?'安全のため釣行を見合わせてください':picks.length?picks.map(p=>`${p.time} (${p.grade})`).join(' · '):'安全条件を満たす時間帯を見つけられません';
  $('updatedAt').textContent=`${code==null?'天気コード未取得':wxLabel(code)} · ${isCached?'保存済み予報':'更新 '+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}`;
}

function localForecastDate(value,offset){return new Date(`${value}:00${offset>=0?'+':'-'}${String(Math.floor(Math.abs(offset)/3600)).padStart(2,'0')}:${String(Math.floor((Math.abs(offset)%3600)/60)).padStart(2,'0')}`);}
const gradeIcon={A:'🔥',B:'👍',C:'🤔',D:'🛑'};
function renderHourly(hours){const box=$('hourlyForecast');if(!hours.length){$('forecastStatus').textContent='時間別データなし';box.innerHTML='<p class="forecast-empty">この時間の予報データはありません。</p>';return;}$('forecastStatus').textContent=`${hours.length}時間分 · Open-Meteo`;
 box.innerHTML=hours.map((p,i)=>`<button class="hour-card" type="button" data-hour="${i}" aria-label="${p.time.slice(11,16)} ${p.verdict.title}"><strong>${p.time.slice(11,16)}</strong><span class="hour-weather">${p.code==null?'--':wxLabel(p.code)}</span><span>${p.temp==null?'--':`${Math.round(p.temp)}°`}</span><small>風 ${p.wind==null?'--':`${Number(p.wind).toFixed(1)}m/s`}</small><small>瞬間 ${p.gust==null?'--':`${Number(p.gust).toFixed(1)}m/s`}</small><small>波 ${p.wave==null?'--':`${Number(p.wave).toFixed(1)}m`}</small><small>雨 ${p.precipProbability==null?'--':`${Math.round(p.precipProbability)}%`}</small><b class="hour-grade">${gradeIcon[p.verdict.grade]||'ℹ️'} ${p.verdict.grade||'--'}</b></button>`).join('');
 box.querySelectorAll('[data-hour]').forEach(button=>button.addEventListener('click',()=>{const p=hours[Number(button.dataset.hour)];$('hourDialogTitle').textContent=`${p.time.replace('T',' ')} · ${p.verdict.title}`;$('hourDialogBody').textContent=`天気 ${p.code==null?'未取得':wxLabel(p.code)} / 気温 ${p.temp==null?'--':`${Math.round(p.temp)}°C`} / 風 ${p.wind==null?'--':`${Number(p.wind).toFixed(1)}m/s`} ${p.direction==null?'':compass(p.direction)} / 最大瞬間風速 ${p.gust==null?'--':`${Number(p.gust).toFixed(1)}m/s`} / 波高 ${p.wave==null?'未取得':`${Number(p.wave).toFixed(1)}m`} / 波周期 ${p.wavePeriod==null?'未取得':`${Number(p.wavePeriod).toFixed(0)}秒`} / 降水確率 ${p.precipProbability==null?'未取得':`${Math.round(p.precipProbability)}%`} / 降水量 ${p.rain==null?'未取得':`${Number(p.rain).toFixed(1)}mm/h`}。 ${p.verdict.reason}`;$('hourDialog').showModal();}));}

function openSpotDialog(coords) { if(!roomId){$('roomDialog').showModal();return;} $('spotCoordinates').textContent=`${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`; $('spotName').value=''; $('spotDialog').showModal(); setTimeout(()=>$('spotName').focus(),100); }
function renderSpots() {
  if(!map) return; markers.forEach(m=>map.removeLayer(m)); markers=[]; const list=$('spotList'); list.innerHTML='';
  if(!spots.length) list.innerHTML='<div class="empty-state">地図の「ココを保存」から、仲間と共有する釣り場を追加できます。</div>';
  spots.forEach(spot=>{const marker=L.marker([spot.lat,spot.lon]).addTo(map).bindPopup(`<strong>${esc(spot.name)}</strong><br><button data-delete="${esc(spot.id)}">この釣り場を削除</button>`);markers.push(marker);marker.on('popupopen',()=>{const b=document.querySelector(`[data-delete="${CSS.escape(spot.id)}"]`);b?.addEventListener('click',()=>removeSpot(spot.id));});const card=document.createElement('button');card.className='spot-card';card.type='button';card.innerHTML=`<span class="spot-pin">⌖</span><span class="spot-info"><strong>${esc(spot.name)}</strong><small>${Number(spot.lat).toFixed(3)}, ${Number(spot.lon).toFixed(3)} · ${esc(spot.createdLabel||'登録済み')}</small></span><span class="spot-weather">›<small>天気を見る</small></span>`;card.addEventListener('click',()=>{map.setView([spot.lat,spot.lon],13);setDepthOrigin(spot.lat,spot.lon,spot.id,spot.name);$('locationTitle').textContent=spot.name;loadWeather(spot.lat,spot.lon);selectedTideSpotId=String(spot.id);$('tideSpotSelect').value=selectedTideSpotId;renderTide(spot);document.querySelector('.hero').scrollIntoView({behavior:'smooth'});});list.appendChild(card);});
  updateTideSpotOptions(); refreshDepthSpotOptions();
}
function persistLocal(){localStorage.setItem(STORAGE_KEY,JSON.stringify(spots));}
async function saveSpot(name,coords){const spot={id:crypto.randomUUID(),name:name.trim(),lat:coords[0],lon:coords[1],createdLabel:'登録 '+new Date().toLocaleDateString('ja-JP')};if(client&&roomId){const {error}=await client.rpc('add_spot',{p_room_id:roomId,p_name:spot.name,p_lat:spot.lat,p_lon:spot.lon});if(error){showInfo('共有保存に失敗しました','SupabaseのProject URL・anon key・SQL設定を確認してください。ポイントは保存されませんでした。');return;}await loadSharedSpots();}else{spots.unshift(spot);persistLocal();}renderSpots();}
async function removeSpot(id){if(client&&roomId){const {error}=await client.rpc('delete_spot',{p_room_id:roomId,p_spot_id:id});if(error){showInfo('削除できませんでした','共有DBとの接続を確認してください。');return;}await loadSharedSpots();}else{spots=spots.filter(s=>s.id!==id);persistLocal();}renderSpots();}

async function setupSharing(){
  const url=new URL(location.href);
  const hashParams=new URLSearchParams(url.hash.replace(/^#/,''));
  const linkedRoom=hashParams.get('room')||url.searchParams.get('room');
  let savedRoom=null;
  try{savedRoom=localStorage.getItem(ROOM_STORAGE_KEY);}catch{}
  const hasLinkedRoom=validRoomId(linkedRoom);
  const initialRoom=hasLinkedRoom?linkedRoom:(validRoomId(savedRoom)?savedRoom:null);
  if(initialRoom){await activateRoom(initialRoom,{updateAddress:!hasLinkedRoom});return;}

  // Do not silently create a fresh room. In iOS, the installed app's manifest
  // start_url commonly omits the #room fragment used by Safari share links.
  $('shareStatusText').textContent='共有ルーム未選択 · 共有リンクから参加してください';
  $('spotList').innerHTML='<div class="empty-state">共有ルームが未選択です。Safariで使っている共有リンクを「共有リンク」から貼り付けてください。保存済みポイントは変更されません。</div>';
  $('roomDialog').showModal();
  if(SUPABASE_URL&&SUPABASE_ANON_KEY&&window.supabase)client=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  else {try{spots=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');}catch{spots=[];}renderSpots();}
}
async function activateRoom(id,{updateAddress=true}={}){
  if(!validRoomId(id))return false;
  roomId=id;
  try{localStorage.setItem(ROOM_STORAGE_KEY,id);}catch{}
  if(updateAddress)setRoomInAddress(id);
  if(SUPABASE_URL&&SUPABASE_ANON_KEY&&window.supabase){
    client=client||window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
    $('shareStatus').classList.add('connected');
    $('shareStatusText').textContent='共有リンクのルームを読み込み中…';
    await loadSharedSpots();
    if(!syncTimer)syncTimer=setInterval(()=>{if(document.visibilityState==='visible')loadSharedSpots();},15000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')loadSharedSpots();});
  }else{
    $('shareStatusText').textContent='共有DB未設定 · 端末内の保存データを表示';
    try{spots=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');}catch{spots=[];}
    renderSpots();
  }
  return true;
}
async function loadSharedSpots(){if(!client||!roomId)return;const {data,error}=await client.rpc('list_spots',{p_room_id:roomId});if(error){$('shareStatusText').textContent='共有DBに接続できません';return;}spots=(data||[]).map(s=>({...s,createdLabel:'登録 '+new Date(s.created_at).toLocaleDateString('ja-JP')}));$('shareStatusText').textContent='共有リンクを知る仲間と同期中';renderSpots();}

async function copyShareLink(){if(!roomId){$('roomError').textContent='共有ルームが未選択です。Safariの共有リンクを貼り付けて参加してください。';if(!$('roomDialog').open)$('roomDialog').showModal();return;}try{await navigator.clipboard.writeText(location.href);$('copyLinkButton').textContent='コピーしました';setTimeout(()=>$('copyLinkButton').textContent='共有リンク',1800);}catch{showInfo('共有リンク',location.href);}}
function showInfo(title,body){$('infoTitle').textContent=title;$('infoBody').textContent=body;$('infoDialog').showModal();}
function bindUI(){ $('saveSpotButton').addEventListener('click',()=>{if(!roomId){$('roomDialog').showModal();return;}if(currentPosition)openSpotDialog([currentPosition.lat,currentPosition.lon]);else if(pendingCoords)openSpotDialog(pendingCoords);else showInfo('地点を選択','まず現在地を取得するか、地図をタップしてください。');}); $('confirmSave').addEventListener('click',async(e)=>{e.preventDefault();const name=$('spotName').value.trim();if(!name)return;await saveSpot(name,pendingCoords);$('spotDialog').close();}); $('locateButton').addEventListener('click',locate); $('shareButton').addEventListener('click',copyShareLink); $('copyLinkButton').addEventListener('click',copyShareLink); $('tideSpotSelect').addEventListener('change',()=>{selectedTideSpotId=$('tideSpotSelect').value;renderTide(spots.find(spot=>String(spot.id)===selectedTideSpotId));}); $('roomForm').addEventListener('submit',async(e)=>{e.preventDefault();const id=roomIdFromInput($('roomLinkInput').value);if(!id){$('roomError').textContent='有効な共有リンクまたはルームIDを確認してください。';return;}$('roomError').textContent='';$('roomDialog').close();await activateRoom(id);}); $('roomLaterButton').addEventListener('click',()=>$('roomDialog').close()); $('mapNav').addEventListener('click',()=>$('map').scrollIntoView({behavior:'smooth'})); $('helpButton').addEventListener('click',()=>showInfo('使い方','「ココを保存」で現在地を登録できます。地図をタップするとその地点を登録できます。共有リンクを知っている人は、同じ釣り場マップを開いてポイントを追加・削除できます。共有リンクは二人の間だけで扱ってください。天気・海況データはOpen-Meteoを使用します。潮汐は気象庁の宮津推算値を、登録済みポイントから選んで表示します。')); }

async function start(){initMap();bindUI();await setupSharing();initializeDepthUI();locate();navigator.serviceWorker?.register('./sw.js').catch(()=>{});refreshTimer=setInterval(()=>{const p=currentPosition;if(p)loadWeather(p.lat,p.lon);},30*60*1000);}
document.addEventListener('DOMContentLoaded',start);
