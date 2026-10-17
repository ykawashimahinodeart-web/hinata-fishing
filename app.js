/* Optional shared storage settings. Fill these after creating the SQL schema in supabase/schema.sql. */
const SUPABASE_URL = window.HINATA_SUPABASE?.url || '';
const SUPABASE_ANON_KEY = window.HINATA_SUPABASE?.anonKey || '';
const STORAGE_KEY = 'hinata-fishing-spots-v1';
const DEFAULT_CENTER = [35.535, 135.196]; // Miyazu, Kyoto
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let map, userMarker, accuracyCircle, markers = [], spots = [], currentPosition = null, pendingCoords = null, client = null, channel = null, roomId = null, refreshTimer;

function initMap() {
  map = L.map('map', { zoomControl:false, scrollWheelZoom:false }).setView(DEFAULT_CENTER, 10);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'&copy; OpenStreetMap' }).addTo(map);
  L.control.zoom({ position:'topright' }).addTo(map);
  map.on('click', (event) => { pendingCoords = [event.latlng.lat, event.latlng.lng]; openSpotDialog(pendingCoords); });
  renderSpots(); setTimeout(() => map.invalidateSize(), 250);
}

function makeRoomId(){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}

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

function openSpotDialog(coords) { $('spotCoordinates').textContent=`${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`; $('spotName').value=''; $('spotDialog').showModal(); setTimeout(()=>$('spotName').focus(),100); }
function renderSpots() {
  if(!map) return; markers.forEach(m=>map.removeLayer(m)); markers=[]; const list=$('spotList'); list.innerHTML='';
  if(!spots.length) list.innerHTML='<div class="empty-state">地図の「ココを保存」から、仲間と共有する釣り場を追加できます。</div>';
  spots.forEach(spot=>{const marker=L.marker([spot.lat,spot.lon]).addTo(map).bindPopup(`<strong>${esc(spot.name)}</strong><br><button data-delete="${esc(spot.id)}">この釣り場を削除</button>`);markers.push(marker);marker.on('popupopen',()=>{const b=document.querySelector(`[data-delete="${CSS.escape(spot.id)}"]`);b?.addEventListener('click',()=>removeSpot(spot.id));});const card=document.createElement('button');card.className='spot-card';card.type='button';card.innerHTML=`<span class="spot-pin">⌖</span><span class="spot-info"><strong>${esc(spot.name)}</strong><small>${Number(spot.lat).toFixed(3)}, ${Number(spot.lon).toFixed(3)} · ${esc(spot.createdLabel||'登録済み')}</small></span><span class="spot-weather">›<small>天気を見る</small></span>`;card.addEventListener('click',()=>{map.setView([spot.lat,spot.lon],13);$('locationTitle').textContent=spot.name;loadWeather(spot.lat,spot.lon);document.querySelector('.hero').scrollIntoView({behavior:'smooth'});});list.appendChild(card);});
}
function persistLocal(){localStorage.setItem(STORAGE_KEY,JSON.stringify(spots));}
async function saveSpot(name,coords){const spot={id:crypto.randomUUID(),name:name.trim(),lat:coords[0],lon:coords[1],createdLabel:'登録 '+new Date().toLocaleDateString('ja-JP')};if(client&&roomId){const {error}=await client.rpc('add_spot',{p_room_id:roomId,p_name:spot.name,p_lat:spot.lat,p_lon:spot.lon});if(error){showInfo('共有保存に失敗しました','SupabaseのProject URL・anon key・SQL設定を確認してください。ポイントは保存されませんでした。');return;}await loadSharedSpots();}else{spots.unshift(spot);persistLocal();}renderSpots();}
async function removeSpot(id){if(client&&roomId){const {error}=await client.rpc('delete_spot',{p_room_id:roomId,p_spot_id:id});if(error){showInfo('削除できませんでした','共有DBとの接続を確認してください。');return;}await loadSharedSpots();}else{spots=spots.filter(s=>s.id!==id);persistLocal();}renderSpots();}

async function setupSharing(){const url=new URL(location.href);const hashParams=new URLSearchParams(url.hash.replace(/^#/,'').replace(/^room=/,'room='));roomId=hashParams.get('room')||url.searchParams.get('room');
  if(!roomId||!/^[a-f0-9]{24,64}$/i.test(roomId))roomId=makeRoomId();
  hashParams.set('room',roomId);url.searchParams.delete('room');url.hash=hashParams.toString();history.replaceState({},'',url);
  if(SUPABASE_URL&&SUPABASE_ANON_KEY&&window.supabase){client=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);await loadSharedSpots();$('shareStatus').classList.add('connected');$('shareStatusText').textContent='共有リンクを知る仲間と同期中';setInterval(()=>{if(document.visibilityState==='visible')loadSharedSpots();},15000);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')loadSharedSpots();});}
  else {try{spots=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');}catch{spots=[];} $('shareStatusText').textContent='この端末に保存中 · Supabase未設定';}
}
async function loadSharedSpots(){if(!client||!roomId)return;const {data,error}=await client.rpc('list_spots',{p_room_id:roomId});if(error){$('shareStatusText').textContent='共有DBに接続できません';return;}spots=data.map(s=>({...s,createdLabel:'登録 '+new Date(s.created_at).toLocaleDateString('ja-JP')}));renderSpots();}

async function copyShareLink(){try{await navigator.clipboard.writeText(location.href);$('copyLinkButton').textContent='コピーしました';setTimeout(()=>$('copyLinkButton').textContent='共有リンク',1800);}catch{showInfo('共有リンク',location.href);}}
function showInfo(title,body){$('infoTitle').textContent=title;$('infoBody').textContent=body;$('infoDialog').showModal();}
function bindUI(){ $('saveSpotButton').addEventListener('click',()=>{if(currentPosition)openSpotDialog([currentPosition.lat,currentPosition.lon]);else if(pendingCoords)openSpotDialog(pendingCoords);else showInfo('地点を選択','まず現在地を取得するか、地図をタップしてください。');}); $('confirmSave').addEventListener('click',async(e)=>{e.preventDefault();const name=$('spotName').value.trim();if(!name)return;await saveSpot(name,pendingCoords);$('spotDialog').close();}); $('locateButton').addEventListener('click',locate); $('shareButton').addEventListener('click',copyShareLink); $('copyLinkButton').addEventListener('click',copyShareLink); $('mapNav').addEventListener('click',()=>$('map').scrollIntoView({behavior:'smooth'})); $('helpButton').addEventListener('click',()=>showInfo('使い方','「ココを保存」で現在地を登録できます。地図をタップするとその地点を登録できます。共有リンクを知っている人は、同じ釣り場マップを開いてポイントを追加・削除できます。共有リンクは二人の間だけで扱ってください。天気・海況データはOpen-Meteoを使用します。潮汐情報はこの版では表示しません。')); }

async function start(){initMap();bindUI();await setupSharing();locate();navigator.serviceWorker?.register('./sw.js').catch(()=>{});refreshTimer=setInterval(()=>{const p=currentPosition;if(p)loadWeather(p.lat,p.lon);},30*60*1000);}
document.addEventListener('DOMContentLoaded',start);
