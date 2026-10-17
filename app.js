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
  try {
    const q = new URLSearchParams({latitude:lat,longitude:lon,current:'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',hourly:'temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m',daily:'sunrise,sunset,weather_code,wind_speed_10m_max,wind_gusts_10m_max',timezone:'auto',forecast_days:2,wind_speed_unit:'ms'});
    const mq = new URLSearchParams({latitude:lat,longitude:lon,current:'wave_height,sea_surface_temperature',hourly:'wave_height',timezone:'auto',forecast_days:2});
    const [weatherRes, marineRes] = await Promise.all([fetch(`https://api.open-meteo.com/v1/forecast?${q}`),fetch(`https://marine-api.open-meteo.com/v1/marine?${mq}`)]);
    if (!weatherRes.ok) throw new Error('weather');
    const weather = await weatherRes.json(); const marine = marineRes.ok ? await marineRes.json() : null;
    renderWeather(weather, marine);
  } catch (_) {
    $('updatedAt').textContent = '気象データを取得できません'; $('verdictTitle').textContent = '天気は未取得'; $('verdictReason').textContent = '通信状況を確認して、もう一度お試しください。';
  }
}

const compass = (deg) => ['北','北東','東','南東','南','南西','西','北西'][Math.round(deg/45)%8];
const wxLabel = (code) => code === 0 ? '晴れ' : code <= 3 ? 'くもり' : code < 50 ? '霧' : code < 60 ? '霧雨' : code < 70 ? '雨' : code < 80 ? '雪' : code < 85 ? 'にわか雨' : '荒天';

function renderWeather(w, m) {
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
  const gust=Math.max(Number(c.wind_gusts_10m)||0,Number(d.wind_gusts_10m_max[idx])||0), wind=Number(c.wind_speed_10m)||0, wave=mc?.wave_height != null ? Number(mc.wave_height) : null, code=Number(c.weather_code), rain=Number(c.precipitation)||0;
  let grade='go', title='行け！', icon='🔥', reason=`${wxLabel(code)}で風は${wind.toFixed(1)}m/s。釣りやすい条件です。`;
  if (wind>=15 || gust>=20 || (wave!==null && wave>=3) || (code>=95&&code<=99) || code===65 || code===67 || code===75 || rain>=15) { grade='stop'; title='今日はやめとけ。'; icon='🛑'; reason=wind>=15||gust>=20?`強風（最大瞬間風速 ${gust.toFixed(1)}m/s）。安全を優先してください。`:wave!==null&&wave>=3?`波高 ${wave.toFixed(1)}mの予報です。海には近づかないでください。`:'荒天の予報です。釣行は見合わせてください。'; }
  else if (wind>=9 || (wave!==null&&wave>=1.5) || code>=80 || rain>=5) { grade='maybe'; title='微妙…'; icon='🤔'; reason=wind>=9?`風が${wind.toFixed(1)}m/s。風裏を選び、無理のない範囲で。`:wave!==null&&wave>=1.5?`波高 ${wave.toFixed(1)}m。足場と波の状況をよく確認してください。`:'雨や天候の変化に注意が必要です。'; }
  else if (wind>=5 || (wave!==null&&wave>=0.8) || code>=51 || rain>0) { grade='ok'; title='悪くない！'; icon='👍'; reason=wind>=5?`風は${wind.toFixed(1)}m/s。場所を選べば楽しめそう。`:wave!==null&&wave>=0.8?`波高 ${wave.toFixed(1)}m。足場に気をつけて。`:'天候の変化に気をつけて楽しめそう。'; }
  if(wave===null && grade==='go'){ title='悪くない！'; grade='ok'; reason='陸上の天気は穏やか。海況データがなく、現地の波を確認してください。'; }
  $('verdictCard').className=`verdict-card verdict-${grade}`; $('verdictIcon').textContent=icon; $('verdictTitle').textContent=title; $('verdictReason').textContent=reason;
  let best=''; if(hourIdx>=0 && h.time[hourIdx]) { const scores=[]; for(let i=hourIdx;i<Math.min(hourIdx+18,h.time.length);i++){ const dt=new Date(`${h.time[i]}:00${w.utc_offset_seconds>=0?'+':'-'}${String(Math.floor(Math.abs(w.utc_offset_seconds)/3600)).padStart(2,'0')}:${String(Math.floor((Math.abs(w.utc_offset_seconds)%3600)/60)).padStart(2,'0')}`); const nearSunrise=Math.abs(dt-sunrise)/3600000<1.5, nearSunset=Math.abs(dt-sunset)/3600000<1.5; if(nearSunrise||nearSunset) scores.push({i,score:(h.precipitation_probability[i]||0)+(h.wind_speed_10m[i]||0)*4+(h.wind_gusts_10m[i]||0)*2}); } if(scores.length){scores.sort((a,b)=>a.score-b.score);const time=h.time[scores[0].i].slice(11,16);best=`${time}ごろ（マズメ）`;} }
  $('recommendTime').textContent=grade==='stop'?'安全のため釣行を見合わせてください':best||'日の出・日の入り前後がおすすめ'; $('updatedAt').textContent=`${wxLabel(code)} · ${new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}更新`;
}

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
