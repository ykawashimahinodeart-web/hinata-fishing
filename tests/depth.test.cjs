const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function loadScript(file, context) { vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file}); }
function browserContext() { const context={TextEncoder,URL,URLSearchParams,console};context.window=context;return context; }

test('CSV import validates required coordinates, depths and optional metadata', () => {
  const context=browserContext();loadScript('depth-data.js',context);
  const result=context.HINATA_DEPTH_DATA.parse('latitude,longitude,depth_m,measured_at,device,source,vertical_datum,horizontal_accuracy_m,depth_accuracy_m\n35.5,135.2,4.2,2026-10-01T10:00:00Z,Probe,Survey,Chart Datum,2,0.3');
  assert.equal(result.ok,true);assert.equal(result.points.length,1);assert.equal(result.points[0].vertical_datum,'Chart Datum');assert.equal(result.points[0].horizontal_accuracy_m,2);
});
test('CSV rejects missing headers, invalid ranges, mixed datums, malformed quoting and duplicate points are reported', () => {
  const context=browserContext();loadScript('depth-data.js',context);const parse=context.HINATA_DEPTH_DATA.parse;
  assert.equal(parse('lat,lon,depth\n1,2,3').ok,false);
  assert.equal(parse('latitude,longitude,depth_m\n91,0,1').ok,false);
  assert.equal(parse('latitude,longitude,depth_m,vertical_datum\n1,2,3,A\n2,3,4,B').ok,false);
  assert.equal(parse('latitude,longitude,depth_m\n"1,2,3').ok,false);
  const duplicates=parse('latitude,longitude,depth_m\n1,2,3\n1,2,3');assert.equal(duplicates.ok,true);assert.equal(duplicates.points.length,1);assert.equal(duplicates.warnings.length,1);
});
function destination(lat,lon,bearing,distance){const R=6371008.8,a=bearing*Math.PI/180,d=distance/R,p=lat*Math.PI/180,l=lon*Math.PI/180,p2=Math.asin(Math.sin(p)*Math.cos(d)+Math.cos(p)*Math.sin(d)*Math.cos(a)),l2=l+Math.atan2(Math.sin(a)*Math.sin(d)*Math.cos(p),Math.cos(d)-Math.sin(p)*Math.sin(p2));return {latitude:p2*180/Math.PI,longitude:(l2*180/Math.PI+540)%360-180};}
test('CAST LINE matching rejects off-corridor points and connects only documented accurate close measurements', () => {
  const context=browserContext();loadScript('depth-analysis.js',context);const start={lat:35.5,lon:135.2};
  const on1=destination(start.lat,start.lon,90,10),on2=destination(start.lat,start.lon,90,20),off=destination(start.lat,start.lon,0,15);
  const result=context.HINATA_DEPTH_ANALYSIS.matchToCastLine([
    {...on1,depth_m:2,horizontal_accuracy_m:2,vertical_datum:'A'},
    {...on2,depth_m:3,horizontal_accuracy_m:2,vertical_datum:'A'},
    {...off,depth_m:4,horizontal_accuracy_m:2,vertical_datum:'A'}
  ],start,90);
  assert.equal(result.points.length,2);assert.equal(result.segments.length,1);assert.equal(result.rejectedCount,1);
  const uncertain=context.HINATA_DEPTH_ANALYSIS.matchToCastLine([{...on1,depth_m:2,horizontal_accuracy_m:null,vertical_datum:'A'},{...on2,depth_m:3,horizontal_accuracy_m:null,vertical_datum:'A'}],start,90);
  assert.equal(uncertain.segments.length,0);
});
test('measured renderer draws discrete points and no seabed where there is no qualified segment', () => {
  const context=browserContext();loadScript('depth.js',context);const container={innerHTML:''};
  context.HINATA_DEPTH.render(container,{mode:'measured',points:[{distanceM:23,depthM:4,crossTrackM:2}],segments:[],verticalDatum:'unknown'});
  assert.match(container.innerHTML,/実測点/);assert.match(container.innerHTML,/depth-measured-point/);assert.doesNotMatch(container.innerHTML,/depth-measured-fill/);assert.doesNotMatch(container.innerHTML,/depth-sand/);
  context.HINATA_DEPTH.render(container,{mode:'measured',points:[],segments:[]});assert.match(container.innerHTML,/海底線・海底塗りつぶしは表示していません/);
});

test('data source status never treats configuration alone as a GEBCO response', () => {
  const context=browserContext();loadScript('depth-status.js',context);const status=context.HINATA_DEPTH_STATUS;
  assert.match(status.gebcoStatus({enabled:false,state:'unverified'}).label,/OFF/);
  assert.match(status.gebcoStatus({enabled:true,zoomAllowed:true,state:'unverified'}).label,/未確認/);
  assert.match(status.gebcoStatus({enabled:true,zoomAllowed:true,state:'available'}).label,/WMS応答あり/);
  assert.match(status.gebcoStatus({enabled:true,zoomAllowed:true,state:'error'}).label,/通信エラー/);
  assert.match(status.gebcoStatus({online:false,enabled:true,state:'available'}).label,/オフライン/);
});

test('precision and local CSV statuses distinguish measured points, qualified segments and missing matches', () => {
  const context=browserContext();loadScript('depth-status.js',context);const status=context.HINATA_DEPTH_STATUS;
  assert.match(status.precisionStatus(null,false).label,/十分な実測データなし/);
  assert.match(status.precisionStatus(null,true).label,/未確認/);
  assert.match(status.precisionStatus({points:[{}],segments:[]}).label,/実測点あり/);
  assert.match(status.precisionStatus({points:[{},{}],segments:[[{},{}]]}).label,/一部区間のみ/);
  assert.match(status.precisionStatus({points:[],segments:[]}).label,/十分な実測データなし/);
  assert.match(status.csvStatus({datasetCount:0}).label,/データなし/);
  assert.match(status.csvStatus({datasetCount:1,match:{points:[],segments:[]}}).label,/対象外/);
  assert.match(status.csvStatus({datasetCount:1,match:{points:[{}],segments:[]}}).label,/対象地点付近/);
  assert.match(status.csvStatus({datasetCount:1,error:true}).label,/読み込みエラー/);
});

test('Ver 1.5 Phase 1 hides bathymetry UI while retaining CAST LINE and data modules', () => {
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html,/<div class="bathymetry-control" hidden/);
  assert.match(html,/<section class="depth-status-panel"[^>]*hidden/);
  assert.match(html,/<section class="depth-section"[^>]*hidden/);
  assert.match(html,/<section class="cast-tool" aria-labelledby="castToolHeading">/);
  assert.match(html,/id="castBearing"/);
  assert.match(html,/id="castCoordinates"/);
  assert.match(html,/depth-store\.js/);
  assert.match(html,/depth-data\.js/);
  assert.match(html,/depth-status\.js/);
  const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  assert.match(worker,/hinata-fishing-v13/);
  assert.match(worker,/seasonal-fish\.js/);
  assert.doesNotMatch(worker,/hinata-fishing-v14/);
});
