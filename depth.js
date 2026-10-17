/* HINATA DEPTH demo renderer. It accepts data; it never fetches bathymetry. */
(() => {
  const profiles = {
    shallow: { label:'遠浅', points:[[0,0.4],[10,0.7],[20,1.0],[30,1.4],[40,1.8],[50,2.1],[60,2.4],[70,2.7],[80,3.0],[90,3.2],[100,3.4]] },
    steep: { label:'急深', points:[[0,0.5],[10,1.0],[20,2.0],[30,4.0],[40,7.0],[50,10.0],[60,12.0],[70,14.0],[80,15.5],[90,16.5],[100,17.0]] },
    flat: { label:'平坦', points:[[0,4.0],[10,4.1],[20,4.0],[30,4.1],[40,4.0],[50,4.1],[60,4.0],[70,4.1],[80,4.0],[90,4.1],[100,4.0]] },
    undulating: { label:'起伏', points:[[0,1.0],[10,2.0],[20,4.0],[30,3.0],[40,6.0],[50,9.0],[60,6.0],[70,4.0],[80,7.0],[90,11.0],[100,8.0]] }
  };
  const scales = [5,10,20,30,50];
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function sampleProfile(name) {
    const profile = profiles[name] || profiles.shallow;
    return {
      mode:'demo', label:profile.label,
      source:'HINATA DEPTH sample only', quality:'illustrative',
      points:profile.points.map(([distanceM, depthM]) => ({distanceM, depthM, source:'demo', quality:'sample', missing:false}))
    };
  }

  function render(container, data) {
    if (!container) return;
    if (data?.mode === 'measured') { renderMeasured(container, data); return; }
    if (!data || data.mode !== 'demo' || !Array.isArray(data.points)) {
      container.innerHTML = '<div class="depth-no-data"><strong>この地点は詳細な水深データがありません</strong><span>海底の線は表示していません。</span></div>';
      return;
    }
    const points = data.points.filter(p => !p.missing && Number.isFinite(p.distanceM) && Number.isFinite(p.depthM) && p.distanceM >= 0 && p.distanceM <= 100 && p.depthM >= 0).sort((a,b)=>a.distanceM-b.distanceM);
    if (points.length < 2) { container.innerHTML = '<div class="depth-no-data"><strong>水深データが不足しています</strong><span>海底の線は表示していません。</span></div>'; return; }
    const maxDepth = Math.max(...points.map(p=>p.depthM));
    const depthMax = scales.find(scale => scale >= maxDepth * 1.15) || Math.ceil(maxDepth / 10) * 10;
    const width=760,height=350,left=72,right=16,waterY=54,bottom=304,plotH=bottom-waterY,plotW=width-left-right;
    const x = distance => left + plotW * distance / 100;
    const y = depth => waterY + plotH * depth / depthMax;
    const curve = points.map((p,i)=>`${i?'L':'M'}${x(p.distanceM).toFixed(1)},${y(p.depthM).toFixed(1)}`).join(' ');
    const first=points[0],last=points[points.length-1];
    const fillPath=`${curve} L${x(last.distanceM)},${bottom} L${x(first.distanceM)},${bottom} Z`;
    const ticks=[0,20,40,60,80,100].map(m=>`<g class="depth-x-tick"><line x1="${x(m)}" y1="${waterY}" x2="${x(m)}" y2="${bottom}"/><text x="${x(m)}" y="${bottom+22}" text-anchor="middle">${m}</text></g>`).join('');
    const yTicks=Array.from({length:5},(_,i)=>{const d=depthMax*i/4, yy=y(d);return `<g class="depth-y-tick"><line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text x="${left-11}" y="${yy+4}" text-anchor="end">${Number.isInteger(d)?d:d.toFixed(1)}</text></g>`;}).join('');
    const beam=`<path class="depth-beam" d="M115 ${waterY} L215 ${waterY} L310 ${bottom} L190 ${bottom} Z"/><path class="depth-beam depth-beam-soft" d="M330 ${waterY} L380 ${waterY} L490 ${bottom} L420 ${bottom} Z"/>`;
    const person=`<g class="depth-angler" aria-label="釣り人のイラスト"><circle cx="43" cy="37" r="9"/><path d="M39 47 Q30 55 34 70 L56 70 Q59 55 48 47 Z"/><path d="M39 52 L24 63 L29 68 L42 60 M49 52 L58 61"/><path d="M40 68 L37 83 L30 91 M51 68 L55 82 L65 89"/><path d="M55 52 Q79 37 111 30" class="depth-rod"/><path d="M111 30 Q135 36 155 50" class="depth-cast"/></g><path class="depth-pier" d="M0 77 H${left+8} V88 H0 Z"/>`;
    container.innerHTML=`<div class="depth-svg-wrap"><svg class="depth-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(data.label)}サンプル地形。横軸距離0から100メートル、縦軸水深0から${depthMax}メートル"><defs><linearGradient id="depth-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#145064"/><stop offset="1" stop-color="#071a2b"/></linearGradient><linearGradient id="depth-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#24434b"/><stop offset="1" stop-color="#101f2a"/></linearGradient><pattern id="depth-sand" width="26" height="18" patternUnits="userSpaceOnUse"><circle cx="4" cy="7" r="1" fill="#83a7a2" opacity=".24"/><circle cx="18" cy="13" r="1.4" fill="#83a7a2" opacity=".17"/></pattern><filter id="depth-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect x="0" y="0" width="${width}" height="${height}" fill="url(#depth-water)"/>${beam}<path class="depth-ground-fill" d="${fillPath}"/><path class="depth-ground-texture" d="${fillPath}"/><g class="depth-grid">${yTicks}${ticks}</g><line class="depth-surface" x1="${left}" y1="${waterY}" x2="${width-right}" y2="${waterY}"/><path class="depth-bottom-line" d="${curve}" filter="url(#depth-glow)"/>${person}<text class="depth-axis-label" x="${left+plotW/2}" y="${height-5}" text-anchor="middle">岸からの距離（m）</text><text class="depth-axis-label" transform="translate(15 ${waterY+plotH/2}) rotate(-90)" text-anchor="middle">水深（m）</text><text class="depth-scale-note" x="${width-right-4}" y="17" text-anchor="end">縦横の縮尺は異なります · 最大 ${depthMax}m</text></svg></div><div class="depth-legend"><span><i class="depth-legend-line"></i>サンプル海底ライン</span><span>釣り人・光線・海底質感は装飾</span></div><p class="depth-sample-stamp">サンプル地形・実際の水深ではありません</p>`;
  }

  function renderMeasured(container, data) {
    const matched=(data.points||[]).filter(p=>Number.isFinite(p.distanceM)&&Number.isFinite(p.depthM)&&p.distanceM>=0&&p.distanceM<=100&&p.depthM>=0).sort((a,b)=>a.distanceM-b.distanceM);
    const width=760,height=350,left=72,right=16,waterY=54,bottom=304,plotH=bottom-waterY,plotW=width-left-right;
    if(!matched.length){container.innerHTML='<div class="depth-measured-wrap"><div class="depth-no-data"><strong>CAST LINE付近に実測点がありません</strong><span>海底線・海底塗りつぶしは表示していません。方位を変えるか、測深点のある別地点を選んでください。</span></div></div>';return;}
    const maxDepth=Math.max(...matched.map(p=>p.depthM)),depthMax=scales.find(scale=>scale>=Math.max(0.5,maxDepth)*1.15)||Math.ceil(maxDepth/10)*10;
    const x=d=>left+plotW*d/100,y=d=>waterY+plotH*d/depthMax;
    const ticks=[0,20,40,60,80,100].map(m=>`<g class="depth-x-tick"><line x1="${x(m)}" y1="${waterY}" x2="${x(m)}" y2="${bottom}"/><text x="${x(m)}" y="${bottom+22}" text-anchor="middle">${m}</text></g>`).join('');
    const yTicks=Array.from({length:5},(_,i)=>{const d=depthMax*i/4,yy=y(d);return `<g class="depth-y-tick"><line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text x="${left-11}" y="${yy+4}" text-anchor="end">${Number.isInteger(d)?d:d.toFixed(1)}</text></g>`;}).join('');
    const segments=(data.segments||[]).map(segment=>{const [a,b]=segment;return {a,b,path:`M${x(a.distanceM).toFixed(1)},${y(a.depthM).toFixed(1)} L${x(b.distanceM).toFixed(1)},${y(b.depthM).toFixed(1)}`,fill:`M${x(a.distanceM).toFixed(1)},${y(a.depthM).toFixed(1)} L${x(b.distanceM).toFixed(1)},${y(b.depthM).toFixed(1)} L${x(b.distanceM).toFixed(1)},${bottom} L${x(a.distanceM).toFixed(1)},${bottom} Z`};});
    const fills=segments.map(s=>`<path class="depth-measured-fill" d="${s.fill}"/>`).join('');
    const lines=segments.map(s=>`<path class="depth-bottom-line" d="${s.path}"/>`).join('');
    const markers=matched.map(p=>`<circle class="depth-measured-point" cx="${x(p.distanceM).toFixed(1)}" cy="${y(p.depthM).toFixed(1)}" r="5"><title>${p.distanceM.toFixed(1)}m · 水深 ${p.depthM.toFixed(2)}m · CAST LINE横距 ${p.crossTrackM>=0?'+':''}${p.crossTrackM.toFixed(1)}m${p.measured_at?` · ${esc(p.measured_at)}`:''}</title></circle>`).join('');
    const person=`<g class="depth-angler" aria-label="釣り人のイラスト"><circle cx="43" cy="37" r="9"/><path d="M39 47 Q30 55 34 70 L56 70 Q59 55 48 47 Z"/><path d="M39 52 L24 63 L29 68 L42 60 M49 52 L58 61"/><path d="M40 68 L37 83 L30 91 M51 68 L55 82 L65 89"/><path d="M55 52 Q79 37 111 30" class="depth-rod"/><path d="M111 30 Q135 36 155 50" class="depth-cast"/></g><path class="depth-pier" d="M0 77 H${left+8} V88 H0 Z"/>`;
    const beam=`<path class="depth-beam" d="M115 ${waterY} L215 ${waterY} L310 ${bottom} L190 ${bottom} Z"/>`;
    const connected=segments.length;
    container.innerHTML=`<div class="depth-svg-wrap"><svg class="depth-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="実測水深断面図。横軸距離0から100メートル、縦軸水深0から${depthMax}メートル。${matched.length}測深点"><defs><linearGradient id="depth-water-real" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#145064"/><stop offset="1" stop-color="#071a2b"/></linearGradient><filter id="depth-glow-real" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect x="0" y="0" width="${width}" height="${height}" fill="url(#depth-water-real)"/>${beam}${fills}<g class="depth-grid">${yTicks}${ticks}</g><line class="depth-surface" x1="${left}" y1="${waterY}" x2="${width-right}" y2="${waterY}"/>${lines.replaceAll('class="depth-bottom-line"','class="depth-bottom-line" filter="url(#depth-glow-real)"')}${markers}${person}<text class="depth-axis-label" x="${left+plotW/2}" y="${height-5}" text-anchor="middle">岸からの距離（m）</text><text class="depth-axis-label" transform="translate(15 ${waterY+plotH/2}) rotate(-90)" text-anchor="middle">水深（m）</text><text class="depth-scale-note" x="${width-right-4}" y="17" text-anchor="end">縦横の縮尺は異なります · 最大 ${depthMax}m</text></svg></div><div class="depth-legend"><span><i class="depth-legend-point"></i>実測点 (${matched.length})</span><span>${connected?`精度・間隔条件を満たす実測区間 (${connected})`:'実測点のみ · 線で結ぶ条件を満たす区間なし'}</span></div><p class="depth-data-stamp">実測データ · ${esc(data.verticalDatum||'鉛直基準不明')} · 塗りつぶしは実測区間のみ</p>`;
  }

  window.HINATA_DEPTH = { sampleProfile, render, profiles:Object.keys(profiles) };
})();
