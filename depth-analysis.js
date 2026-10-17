/* Geometry and quality rules for matching measured points to a 100 m cast line. */
(() => {
  const EARTH_M=6371008.8, MAX_CROSS_TRACK_M=20, MIN_CROSS_TRACK_M=5, MAX_CONNECT_GAP_M=15, MAX_CONNECT_ACCURACY_M=5;
  const rad=value=>value*Math.PI/180;
  function distanceBearing(a,b){const p1=rad(a.lat),p2=rad(b.lat),dl=rad(b.lon-a.lon),dp=p2-p1;const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;const distance=2*EARTH_M*Math.asin(Math.min(1,Math.sqrt(h)));const y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return {distance,bearing:(Math.atan2(y,x)*180/Math.PI+360)%360};}
  function matchToCastLine(points,start,bearingDeg){
    const matched=[],rejected=[];
    for(const point of points||[]){
      if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||!Number.isFinite(point.depth_m)||point.depth_m<0){rejected.push({point,reason:'invalid'});continue;}
      const {distance,bearing}=distanceBearing(start,{lat:point.latitude,lon:point.longitude});
      const delta=rad(((bearing-bearingDeg+540)%360)-180),along=distance*Math.cos(delta),cross=distance*Math.sin(delta);
      const accuracy=Number.isFinite(point.horizontal_accuracy_m)?point.horizontal_accuracy_m:null;
      const tolerance=accuracy===null?MIN_CROSS_TRACK_M:Math.max(MIN_CROSS_TRACK_M,Math.min(MAX_CROSS_TRACK_M,accuracy));
      if(along<0||along>100||Math.abs(cross)>tolerance||(accuracy!==null&&accuracy>MAX_CROSS_TRACK_M)){rejected.push({point,reason:'outside-cast-corridor',crossTrackM:cross});continue;}
      matched.push({...point,distanceM:along,depthM:point.depth_m,crossTrackM:cross,crossTrackAbsM:Math.abs(cross),matchToleranceM:tolerance});
    }
    matched.sort((a,b)=>a.distanceM-b.distanceM);
    const segments=[];
    for(let i=1;i<matched.length;i++){
      const previous=matched[i-1],current=matched[i],gap=current.distanceM-previous.distanceM;
      if(gap<=MAX_CONNECT_GAP_M&&previous.horizontal_accuracy_m!==null&&previous.horizontal_accuracy_m!==undefined&&current.horizontal_accuracy_m!==null&&current.horizontal_accuracy_m!==undefined&&previous.horizontal_accuracy_m<=MAX_CONNECT_ACCURACY_M&&current.horizontal_accuracy_m<=MAX_CONNECT_ACCURACY_M&&previous.vertical_datum===current.vertical_datum){segments.push([previous,current]);}
    }
    return {points:matched,segments,rejectedCount:rejected.length,policy:{maxCrossTrackM:MAX_CROSS_TRACK_M,minCrossTrackM:MIN_CROSS_TRACK_M,maxConnectGapM:MAX_CONNECT_GAP_M,maxConnectAccuracyM:MAX_CONNECT_ACCURACY_M}};
  }
  window.HINATA_DEPTH_ANALYSIS={matchToCastLine,policy:{MAX_CROSS_TRACK_M,MIN_CROSS_TRACK_M,MAX_CONNECT_GAP_M,MAX_CONNECT_ACCURACY_M}};
})();
