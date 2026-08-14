"use strict";
const PARCEL = window.__PARCEL__;
const $ = id => document.getElementById(id);

/* ══════════════════════════════════════════════════════════════
   1. PROJECTION — Maine West State Plane (NAD83), US survey feet
   TM, CM -70°10', origin 42°50', k0=0.9999666667, FE 900000 m.
   Verified against the nine State Plane coordinates printed on the recorded
   plan: 0.0098 ft mean residual, 0.0225 ft max.
   ══════════════════════════════════════════════════════════════ */
const M2FT = 3937/1200, FT = 3.280839895;
function toSP(lat, lon){
  const a=6378137.0, f=1/298.257222101, e2=f*(2-f);
  const k0=0.9999666666666667, lat0=42.8333333333*Math.PI/180, lon0=-70.1666666667*Math.PI/180, FE=900000.0;
  const p=lat*Math.PI/180, l=lon*Math.PI/180;
  const ep2=e2/(1-e2), N=a/Math.sqrt(1-e2*Math.sin(p)**2), T=Math.tan(p)**2;
  const C=ep2*Math.cos(p)**2, A=(l-lon0)*Math.cos(p);
  const mm=x=>a*((1-e2/4-3*e2**2/64-5*e2**3/256)*x-(3*e2/8+3*e2**2/32+45*e2**3/1024)*Math.sin(2*x)
    +(15*e2**2/256+45*e2**3/1024)*Math.sin(4*x)-(35*e2**3/3072)*Math.sin(6*x));
  const E=FE+k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120);
  const Nn=k0*(mm(p)-mm(lat0)+N*Math.tan(p)*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720));
  return [E*M2FT, Nn*M2FT];
}
/* The inverse of toSP, same Snyder series and the same constants. Additive:
   toSP is untouched and stays the authority — this is verified BY round-tripping
   against it, so if the two ever disagree the caller finds out immediately.
   Needed to turn a deed call (bearing + distance from a known point) back into a
   position, which is how you stake a corner that is not there any more. */
function fromSP(Eft, Nft){
  const a=6378137.0, f=1/298.257222101, e2=f*(2-f);
  const k0=0.9999666666666667, lat0=42.8333333333*Math.PI/180, lon0=-70.1666666667*Math.PI/180, FE=900000.0;
  const ep2=e2/(1-e2);
  const mm=x=>a*((1-e2/4-3*e2**2/64-5*e2**3/256)*x-(3*e2/8+3*e2**2/32+45*e2**3/1024)*Math.sin(2*x)
    +(15*e2**2/256+45*e2**3/1024)*Math.sin(4*x)-(35*e2**3/3072)*Math.sin(6*x));
  const E=Eft/M2FT, N=Nft/M2FT;
  const M=mm(lat0)+N/k0;
  const mu=M/(a*(1-e2/4-3*e2**2/64-5*e2**3/256));
  const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const p1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*Math.sin(4*mu)
    +(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
  const C1=ep2*Math.cos(p1)**2, T1=Math.tan(p1)**2;
  const N1=a/Math.sqrt(1-e2*Math.sin(p1)**2), R1=a*(1-e2)/Math.pow(1-e2*Math.sin(p1)**2,1.5);
  const D=(E-FE)/(N1*k0);
  const lat=p1-(N1*Math.tan(p1)/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D**4/24
    +(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D**6/720);
  const lon=lon0+(D-(1+2*T1+C1)*D**3/6
    +(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D**5/120)/Math.cos(p1);
  return [lat*180/Math.PI, lon*180/Math.PI];
}
/* A deed call reads "N 34°35'30\" E". Accept that, with or without the symbols,
   and a plain decimal grid azimuth, because both get typed with cold hands. */
function parseBearing(str){
  if(str==null) return null;
  const t=String(str).trim().toUpperCase().replace(/[°'\"]/g,' ').replace(/\s+/g,' ');
  if(!t) return null;
  const q=t.match(/^([NS])\s*([\d.]+)(?:\s+([\d.]+))?(?:\s+([\d.]+))?\s*([EW])$/);
  if(q){
    const d=+q[2], m=+(q[3]||0), sec=+(q[4]||0);
    if(!isFinite(d)||!isFinite(m)||!isFinite(sec)) return null;
    const ang=d+m/60+sec/3600;
    if(ang>90.000001) return null;
    return ((q[1]==='N' ? (q[5]==='E'?ang:360-ang) : (q[5]==='E'?180-ang:180+ang))%360+360)%360;
  }
  const dec=t.match(/^([\d.]+)$/);
  if(dec && isFinite(+dec[1])) return ((+dec[1])%360+360)%360;
  return null;
}
/* Project a grid azimuth and distance from a point, in State Plane feet — the
   same space gridVec measures in, so a projection and a measurement of the same
   line agree exactly. */
function projectSP(lat,lon,az,distFt){
  const p=toSP(lat,lon), r=az*Math.PI/180;
  return fromSP(p[0]+Math.sin(r)*distFt, p[1]+Math.cos(r)*distFt);
}
function gridVec(lat1,lon1,lat2,lon2){
  const a=toSP(lat1,lon1), b=toSP(lat2,lon2), dE=b[0]-a[0], dN=b[1]-a[1];
  return {dE,dN,dist:Math.hypot(dE,dN),az:(Math.atan2(dE,dN)*180/Math.PI+360)%360};
}
function quad(az){
  let ns,ew,ang;
  if(az<=90){ns='N';ew='E';ang=az;} else if(az<=180){ns='S';ew='E';ang=180-az;}
  else if(az<=270){ns='S';ew='W';ang=az-180;} else {ns='N';ew='W';ang=360-az;}
  let d=Math.floor(ang), m=Math.floor((ang-d)*60), s=Math.round((((ang-d)*60)-m)*60);
  if(s===60){s=0;m++;} if(m===60){m=0;d++;}
  return `${ns} ${d}°${String(m).padStart(2,'0')}'${String(s).padStart(2,'0')}" ${ew}`;
}
function dms(v,pos,neg){
  const h=v>=0?pos:neg; v=Math.abs(v);
  /* quad() carries; this did not, so anything within 0.005" of a minute
     boundary printed 60.00" -- and at 59 minutes, the wrong degree. */
  let d=Math.floor(v), m=Math.floor((v-d)*60), s=+(((v-d)*60-m)*60).toFixed(2);
  if(s>=60){ s=0; m++; } if(m===60){ m=0; d++; }
  return `${d}°${String(m).padStart(2,'0')}'${s.toFixed(2).padStart(5,'0')}"${h}`;
}

/* ══════════════════════════════════════════════════════════════
   2. GEOMETRY — all in State Plane feet so answers are in the
   plan's own units and free of latitude scaling artefacts.
   ══════════════════════════════════════════════════════════════ */
function ringInSP(ring){ return ring.map(c => toSP(c[1]+shift.dLat, c[0]+shift.dLon)); }
function pointInRing(p, ring){                       // ray casting
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
    if(((yi>p[1])!==(yj>p[1])) && (p[0] < (xj-xi)*(p[1]-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
function distToRing(p, ring){                        // min perpendicular distance
  let best=Infinity;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const ax=ring[j][0], ay=ring[j][1], bx=ring[i][0], by=ring[i][1];
    const dx=bx-ax, dy=by-ay, L2=dx*dx+dy*dy;
    let t = L2 ? ((p[0]-ax)*dx+(p[1]-ay)*dy)/L2 : 0;
    t = t<0?0:t>1?1:t;
    const d=Math.hypot(p[0]-(ax+t*dx), p[1]-(ay+t*dy));
    if(d<best) best=d;
  }
  return best;
}
let parcelSP=null;                                   // cached, rebuilt only on fit change
function rebuildSP(){
  const f=PARCEL.features.find(x=>x.properties.style==='p1');
  parcelSP = f ? ringInSP(f.geometry.coordinates[0]) : null;
}

/* ══════════════════════════════════════════════════════════════
   3. STORAGE — localStorage for small state, IndexedDB for
   photos and cached map tiles (both far past localStorage's ~5 MB).
   ══════════════════════════════════════════════════════════════ */
const mem={};
let storeBroken=false;
const store={
  /* mem wins once written. After a quota failure localStorage still holds the
     last good value, and preferring it handed back stale data — including to
     paintBackup(), so exporting produced no acknowledgement. All boot reads
     happen before any set(), so this cannot mask a real stored value. */
  get(k){ if(k in mem) return mem[k]; try{ return localStorage.getItem(k); }catch(e){ return undefined; } },
  /* A swallowed write here means marks survive the session and vanish on reload.
     Surface it loudly instead — the data is still in memory, so exporting saves it. */
  set(k,v){
    mem[k]=v;
    try{ localStorage.setItem(k,v); if(storeBroken){ storeBroken=false; $('block').classList.remove('on'); } return true; }
    catch(e){
      if(!storeBroken){
        storeBroken=true;
        $('bTitle').textContent='Marks are not being saved';
        $('bBody').innerHTML='Browser storage is full or blocked, so nothing new will survive a reload. '
          +'Your marks are still here in memory — <b>export them now</b> from the Marks tab, '
          +'then clear the tile cache under Map to free space.';
        $('block').classList.add('on');
      }
      return false;
    }
  }
};
let db=null;
function openDB(){
  return new Promise(res=>{
    if(!window.indexedDB) return res(null);
    const r=indexedDB.open('fieldmap',2);
    r.onupgradeneeded=e=>{ const d=e.target.result;
      if(!d.objectStoreNames.contains('photos')) d.createObjectStore('photos');
      if(!d.objectStoreNames.contains('tiles'))  d.createObjectStore('tiles');
      if(!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks'); };
    r.onsuccess=e=>{ db=e.target.result; res(db); };
    r.onerror=()=>res(null);
  });
}
function idb(storeName, mode, fn){
  return new Promise((res,rej)=>{
    if(!db) return res(null);
    const tx=db.transaction(storeName,mode), st=tx.objectStore(storeName);
    const rq=fn(st);
    if(rq){ rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); }
    else { tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); }
  });
}
const idbGet  = (s,k)   => idb(s,'readonly',  st=>st.get(k));
const idbPut  = (s,k,v) => idb(s,'readwrite', st=>st.put(v,k));
const idbDel  = (s,k)   => idb(s,'readwrite', st=>st.delete(k));
const idbKeys = (s)     => idb(s,'readonly',  st=>st.getAllKeys());
const idbClear= (s)     => idb(s,'readwrite', st=>st.clear());
const idbCount= (s)     => idb(s,'readonly',  st=>st.count());   /* cacheStats wanted only .length */

/* ══════════════════════════════════════════════════════════════
   4. TILES — every tile checked against IndexedDB first, so a
   cached area renders with no signal. All four sources send CORS
   headers; if a fetch fails we fall back to a plain <img> load.
   ══════════════════════════════════════════════════════════════ */
let cacheOn = true;
const CachedTiles = L.TileLayer.extend({
  createTile(coords, done){
    const img=document.createElement('img');
    img.alt=''; img.setAttribute('role','presentation');
    const url=this.getTileUrl(coords);
    const cid=this.getCacheId?this.getCacheId():this.options.cacheId;
    const key=cid+'/'+coords.z+'/'+coords.x+'/'+coords.y;
    const direct=()=>{ img.onload=()=>done(null,img); img.onerror=()=>done(new Error('tile'),img);
                       img.crossOrigin=''; img.src=url; };
    if(!cacheOn || !db) { direct(); return img; }
    idbGet('tiles',key).then(blob=>{
      /* A cached blob that will not decode used to wedge this tile forever: no
         onerror, so done() was never called, the tile stayed blank offline and
         the only cure was wiping every legitimate tile too. Drop it and refetch. */
      if(blob){ img.onload=()=>{ URL.revokeObjectURL(img.src); done(null,img); };
               img.onerror=()=>{ URL.revokeObjectURL(img.src); idbDel('tiles',key).catch(()=>{}); direct(); };
               img.src=URL.createObjectURL(blob); }
      else {
        /* status alone is not enough: a captive portal answers every tile 200
           with an HTML login page, which then lives in the cache as a tile. */
        fetch(url,{mode:'cors'}).then(r=>r.ok&&/^image\//.test(r.headers.get('content-type')||'')?r.blob():Promise.reject()).then(bl=>{
          idbPut('tiles',key,bl).catch(()=>{});
          img.onload=()=>{ URL.revokeObjectURL(img.src); done(null,img); };
          img.onerror=()=>{ URL.revokeObjectURL(img.src); idbDel('tiles',key).catch(()=>{}); direct(); };
          img.src=URL.createObjectURL(bl);
        }).catch(direct);
      }
    }).catch(direct);
    return img;
  }
});
/* The statewide DEM is raw float elevation, so we get to choose the lighting.
   The service default is washed out (values 150-220 of 255) because Maine relief
   is gentle; a low sun with vertical exaggeration spans nearly the full range and
   makes stone walls, cart roads and cellar holes legible. */
/* Persisted: these values are half of every hillshade cache key, so losing them
   on reload orphaned every tile cached under them — the pane goes grey in the
   woods while the Map tab still reports the megabytes. */
const hsOpt=Object.assign({az:45, alt:25, z:3, mode:'hill'},
  (()=>{ try{ return JSON.parse(store.get('fm_hs')||'{}'); }catch(e){ return {}; } })());
const hsSave=()=>store.set('fm_hs',JSON.stringify(hsOpt));
function hsRule(){
  if(hsOpt.mode==='slope') return {rasterFunction:'Slope',rasterFunctionArguments:{ZFactor:hsOpt.z}};
  if(hsOpt.mode==='multi') return {rasterFunction:'Hillshade',
    rasterFunctionArguments:{HillshadeType:1, ZFactor:hsOpt.z}};
  return {rasterFunction:'Hillshade',
    rasterFunctionArguments:{Azimuth:hsOpt.az, Altitude:hsOpt.alt, ZFactor:hsOpt.z}};
}
const MaineHS = CachedTiles.extend({
  getTileUrl(c){
    const R=20037508.342789244, n=Math.pow(2,c.z);
    const x0=c.x/n*2*R-R, x1=(c.x+1)/n*2*R-R, y0=R-(c.y+1)/n*2*R, y1=R-c.y/n*2*R;
    return 'https://gis.maine.gov/image/rest/services/DEM/Maine_Elevation_DEM_Statewide/ImageServer/exportImage'
      +`?bbox=${x0},${y0},${x1},${y1}&bboxSR=3857&imageSR=3857&size=256,256&format=png&f=image`
      +`&renderingRule=${encodeURIComponent(JSON.stringify(hsRule()))}`;
  },
  /* hsRule() only sends Azimuth/Altitude in 'hill' mode, so keying multi and
     slope by azimuth stored identical tiles up to four times over — and made
     them miss after a trip through the sun buttons and back. */
  getCacheId(){ return hsOpt.mode==='hill' ? 'hs_hill_'+hsOpt.az+'_'+hsOpt.alt+'_'+hsOpt.z
                                           : 'hs_'+hsOpt.mode+'_'+hsOpt.z; }
});

/* Maine GeoLibrary republishes the scanned USGS quads and every ortho flight the
   state has paid for, as ImageServer exportImage endpoints with open CORS and no
   key. Each entry below was checked against this parcel's own bbox before it was
   listed -- Maine_Elevation_DEM_2024 and orthoRegional2022 answer but return an
   empty tile here, so they are deliberately absent.

   The two topo sheets are the reason this exists. The monuments in this deed were
   set into a landscape those sheets recorded, and the imagery is a second axis:
   an ortho from before thirty years of regrowth shows stone walls and cart roads
   that today's canopy hides completely.

   nz is maxNativeZoom -- exportImage will happily render any bbox, so without a
   ceiling the app would request and cache tiles far past the resolution the
   source actually holds.

   The three municipal flights over this parcel are the sharpest imagery of the
   lot and are deliberately NOT here: their service paths and credit lines carry
   the town name, and lock.py refuses to publish any file containing it. Adding
   them back means giving the locked build a way to carry those strings encrypted
   rather than in the clear -- not editing TELLTALES. */
const HIST=[
  {label:'1910',      p:'Topo/topoUsgs24k1910',                       nz:17, a:'USGS 1:24k 1910 — Maine GeoLibrary'},
  {label:'1945',      p:'Topo/topoUsgs24k1945',                       nz:17, a:'USGS 1:24k 1945 — Maine GeoLibrary'},
  {label:'1996 DOQ',  p:'Regional/orthoRegionalDoq1996_1998',         nz:17, a:'USGS DOQ 1996–98 — Maine GeoLibrary'},
  {label:'2013 NAIP', p:'NAIP/orthoNaip2013',                         nz:18, a:'NAIP 2013 — Maine GeoLibrary'},
  {label:'2014 topo', p:'Topo/topoUsgs24k2014',                       nz:17, a:'USGS 1:24k 2014 — Maine GeoLibrary'},
  {label:'2018 NAIP', p:'NAIP/orthoNaip2018',                         nz:18, a:'NAIP 2018 — Maine GeoLibrary'}
];
let histIdx=(()=>{ const i=+store.get('fm_hist'); return Number.isInteger(i)&&i>=0&&i<HIST.length?i:0; })();

/* One layer, nine sources. getCacheId() carries the year, so switching years
   never collides in the tile store and each one caches on its own -- which is
   what you want, since you pick a year on wifi and take that one into the woods. */
const MaineImage = CachedTiles.extend({
  getTileUrl(c){
    const R=20037508.342789244, n=Math.pow(2,c.z);
    const x0=c.x/n*2*R-R, x1=(c.x+1)/n*2*R-R, y0=R-(c.y+1)/n*2*R, y1=R-c.y/n*2*R;
    return 'https://gis.maine.gov/image/rest/services/'+HIST[histIdx].p+'/ImageServer/exportImage'
      +`?bbox=${x0},${y0},${x1},${y1}&bboxSR=3857&imageSR=3857&size=256,256&format=png&f=image`;
  },
  getCacheId(){ return 'hist_'+HIST[histIdx].label.replace(/\s+/g,''); }
});

/* L.TileLayer.getTileUrl() fills {z} from the LAYER's current zoom, not from the
   coords you hand it. That is fine for on-screen tiles, where the two always
   agree, and silently wrong for a pre-cache job that walks z0..z0+3 while the map
   sits at z0: every deeper level requested imagery at z0 and filed it under the
   deeper key, so offline you got a real tile of the wrong place. MaineHS builds
   its own bbox from c.z and was always correct. */
function tileUrlAt(layer, c){
  if(layer.getCacheId) return layer.getTileUrl(c);
  return L.Util.template(layer._url, L.extend({s:layer._getSubdomain(c), x:c.x, y:c.y, z:c.z}, layer.options));
}

/* ══════════════════════════════════════════════════════════════
   5. MAP
   ══════════════════════════════════════════════════════════════ */
/* Opening view comes from the parcel, not a literal. A locked copy is published
   to a public URL with the geometry encrypted, and a hardcoded setView would
   hand back the location to about 30 ft regardless. Zoom stays 16. */
function homeView(){
  const f=PARCEL.features.find(x=>x.properties.style==='p1');
  const ring=f&&f.geometry.coordinates[0];
  if(!ring||!ring.length) return [0,0];
  let w=Infinity,e=-Infinity,s=Infinity,n=-Infinity;
  for(const c of ring){ if(c[0]<w)w=c[0]; if(c[0]>e)e=c[0]; if(c[1]<s)s=c[1]; if(c[1]>n)n=c[1]; }
  return [(s+n)/2, (w+e)/2];
}
const map=L.map('map',{zoomControl:false, rotate:true, touchRotate:true, bearing:0, rotateControl:false,
  preferCanvas:true}).setView(homeView(),16);
L.control.scale({imperial:true,metric:false,position:'bottomleft'}).addTo(map);
const canvasR = L.canvas({padding:0.5});   /* 5,762 vertices — canvas, not 17 SVG paths */

const esriAttr='Imagery © Esri, Maxar, USDA FSA';
const bases={
 'Satellite': new CachedTiles('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {maxZoom:21,maxNativeZoom:19,attribution:esriAttr,cacheId:'sat'}),
 'LiDAR hillshade': new MaineHS('',{maxZoom:21,maxNativeZoom:18,opacity:.9,cacheId:'hs',
    attribution:'LiDAR: Maine GeoLibrary / MEGIS'}),
 'USGS topo': new CachedTiles('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    {maxZoom:21,maxNativeZoom:16,attribution:'USGS The National Map',cacheId:'ustopo'}),
 'USGS imagery + topo': new CachedTiles('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',
    {maxZoom:21,maxNativeZoom:16,attribution:'USGS The National Map',cacheId:'usimtopo'}),
 'Topo': new CachedTiles('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    {maxZoom:21,maxNativeZoom:19,attribution:esriAttr,cacheId:'topo'}),
 'Street': new CachedTiles('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    {maxZoom:19,attribution:'© OpenStreetMap',cacheId:'osm'}),
 'Historical': new MaineImage('',{maxZoom:21,maxNativeZoom:HIST[histIdx].nz,
    attribution:HIST[histIdx].a,cacheId:'hist'})
};
let curBase=bases['Satellite']; curBase.addTo(map);

/* ══════════════════════════════════════════════════════════════
   6. PARCEL
   ══════════════════════════════════════════════════════════════ */
const STY={
 p1 :{color:'#FF3B30',weight:3.5,fillColor:'#FF3B30',fillOpacity:.10,label:'Conveyed parcel 10.031 ac'},
 p2 :{color:'#FFB020',weight:2.5,dashArray:'7,5',fillColor:'#FFB020',fillOpacity:.06,label:'Adjoining land'},
 wet:{color:'#34C759',weight:2,fillColor:'#34C759',fillOpacity:.24,label:'Wetland (approx.)'},
 drv:{color:'#5AC8FA',weight:2.5,fillColor:'#5AC8FA',fillOpacity:.30,label:'Gravel drive'},
 crs:{color:'#37D9F0',weight:2.5,label:'Courses 1–9',off:true},
 cor:{color:'#37D9F0',r:5.5,label:'Plan corners'},
 mon:{color:'#FF8A3D',r:7.5,label:'Found monuments'},
 pob:{color:'#5BE58B',r:8,label:'Point of beginning'}
};
const groups={}; Object.keys(STY).forEach(k=>groups[k]=L.layerGroup());

/* Leaflet stroke weight and circleMarker radius are screen-space constants, so
   they never changed as you zoomed. At the zoom this opens at that put a 20 ft
   ribbon on a boundary surveyed to hundredths, and drew a corner known to inches
   as a 62 ft blob — and zooming out only made it worse, because the parcel
   shrank while the symbols did not.

   These are still symbols, not footprints: a corner scaled truly to the ground
   would vanish. So scale with zoom and clamp both ends — readable when zoomed
   out, never swelling past the feature it marks when zoomed in. Reference is
   z18, the zoom you actually stand on a monument at. */
const Z_REF=18, Z_MIN=0.55, Z_MAX=1.6;
function zScale(){ return Math.max(Z_MIN, Math.min(Z_MAX, Math.pow(2,(map.getZoom()-Z_REF)*0.55))); }
function restyleForZoom(){
  const k=zScale();
  const fix=l=>{ if(l._bR!=null) l.setRadius(l._bR*k); else if(l._bW!=null) l.setStyle({weight:l._bW*k}); };
  Object.values(groups).forEach(g=>g.eachLayer(fix));
  mkLayer.eachLayer(fix);
  if(trk.line) trk.line.setStyle({weight:3*k});
}
/* Restored here rather than after drawParcel(), which used to re-run it a second
   time on every boot once a fit was saved: 5,762 vertices built and thrown away
   and 3,716 toSP calls where 1,858 would do, on the path to first paint. */
let shift=(()=>{ try{ const v=JSON.parse(store.get('fm_shift')||'null');
    if(v&&v.tie) return v; }catch(e){} return {dLat:0,dLon:0,tie:null,dE:0,dN:0}; })();
const sh=p=>[p[1]+shift.dLat, p[0]+shift.dLon];

function drawParcel(){
  Object.values(groups).forEach(g=>g.clearLayers());
  PARCEL.features.forEach(f=>{
    const s=STY[f.properties.style]||STY.crs, g=groups[f.properties.style]||groups.crs;
    const nm=f.properties.name, ds=f.properties.desc||'';
    let lyr;
    if(f.geometry.type==='Polygon')
      lyr=L.polygon(f.geometry.coordinates[0].map(sh),{renderer:canvasR,color:s.color,weight:s.weight*zScale(),
        fillColor:s.fillColor,fillOpacity:s.fillOpacity,dashArray:s.dashArray});
    else if(f.geometry.type==='LineString')
      lyr=L.polyline(f.geometry.coordinates.map(sh),{renderer:canvasR,color:s.color,weight:s.weight*zScale()});
    else {
      const ll=sh(f.geometry.coordinates), sp=toSP(ll[0],ll[1]);
      lyr=L.circleMarker(ll,{renderer:canvasR,radius:s.r*zScale(),color:'#0E1116',weight:2,fillColor:s.color,fillOpacity:1});
      lyr.bindPopup(`<b>${nm}</b><br><code>${ll[0].toFixed(7)}, ${ll[1].toFixed(7)}</code><br>`
        +`<code>E ${sp[0].toFixed(2)} N ${sp[1].toFixed(2)}</code>`
        +`<br><br><button class="btn sm" data-navplan="${esc(nm)}">Navigate here</button>`
        +(ds?`<br><br>${ds}`:''));
    }
    if(f.geometry.type!=='Point') lyr.bindPopup(`<b>${nm}</b>${ds?'<br><br>'+ds:''}`);
    if(f.geometry.type==='Point') lyr._bR=s.r; else lyr._bW=s.weight;   /* base size for zoom scaling */
    lyr.addTo(g);
  });
  rebuildSP();
}
drawParcel();
Object.entries(groups).forEach(([k,g])=>{ if(!STY[k].off) g.addTo(map); });

/* leaflet-rotate binds `rotate: this._update` on every renderer (vendor:565).
   For canvas that reallocates the backing store and re-projects and repaints
   every path synchronously, in one task, with no rAF — and it fires once per
   raw input: once per two-finger touchmove, and once per magnetometer sample in
   compass-up. So the imagery, carried by the pane's CSS transform, composites on
   the GPU while the vectors are torn down and repainted 60-120x/s behind it.
   _update also writes this._zoom from the current FRACTIONAL pinch zoom, which
   makes the next _onZoom compute scale~1, so the cheap CSS scale that normally
   lets canvas vectors track a pinch never applies — the reported symptom.

   Coalescing to one rebuild per frame fixes both. Not a longer debounce:
   padding 0.5 inscribes a circle of 412 px against a viewport corner at 451 px,
   so a stale canvas shows blank triangles at two corners mid-rotation. */
map.off('rotate', canvasR._update, canvasR);
let rotRaf=0;
map.on('rotate', ()=>{ if(rotRaf) return;
  rotRaf=requestAnimationFrame(()=>{ rotRaf=0; canvasR._update(); }); });

/* ══════════════════════════════════════════════════════════════
   6b. SUN / GRID / MAGNETIC
   ══════════════════════════════════════════════════════════════ */
/* WMM-2025 at the parcel: 14.552° W, drifting +0.0897°/yr.
   The magnetometer reads magnetic north; everything else here is grid. */
const DEC_EPOCH=2026.6, DEC_VAL=-14.552, DEC_RATE=0.0897;
/* coords.altitude is height above the WGS84 ellipsoid, not orthometric height.
   GEOID18 separation at the parcel is about -28 m, so what was labelled "Elev"
   read ~92 ft below every elevation it can be compared against -- including the
   NAVD88 statewide DEM this app draws as its own hillshade. The parcel is 660 ft
   across, so one constant is exact enough. */
const GEOID_N=-28.0;   /* metres, GEOID18 at the parcel */
function declination(){
  const now=new Date();
  const yr=now.getFullYear()+(now.getMonth()+0.5)/12;
  return DEC_VAL + (yr-DEC_EPOCH)*DEC_RATE;
}
/* NOAA solar position, condensed */
function sunTimes(date,lat,lon){
  const rad=Math.PI/180, dayMs=86400000, J1970=2440588, J2000=2451545;
  const toJ=d=>d.valueOf()/dayMs-0.5+J1970, fromJ=j=>new Date((j+0.5-J1970)*dayMs);
  const e=rad*23.4397, lw=rad*-lon, phi=rad*lat, d=toJ(date)-J2000;
  const n=Math.round(d-0.0009-lw/(2*Math.PI));
  const appr=(Ht)=>0.0009+(Ht+lw)/(2*Math.PI)+n;
  const M=rad*(357.5291+0.98560028*(appr(0)));
  const L=M+rad*(1.9148*Math.sin(M)+0.02*Math.sin(2*M)+0.0003*Math.sin(3*M))+rad*102.9372+Math.PI;
  const dec=Math.asin(Math.sin(0)*Math.cos(e)+Math.cos(0)*Math.sin(e)*Math.sin(L));
  const transit=ds=>J2000+ds+0.0053*Math.sin(M)-0.0069*Math.sin(2*L);
  const Jnoon=transit(appr(0));
  const set=h=>{ const c=(Math.sin(rad*h)-Math.sin(phi)*Math.sin(dec))/(Math.cos(phi)*Math.cos(dec));
    if(c<-1||c>1) return null; return transit(appr(Math.acos(c))); };
  const js=set(-0.833), jc=set(-6);
  return {sunset:js?fromJ(js):null, sunrise:js?fromJ(2*Jnoon-js):null,
          dusk:jc?fromJ(jc):null};
}
/* UTM + MGRS — what a warden or SAR team will ask for over the radio */
function toUTM(lat,lon){
  const a=6378137, f=1/298.257223563, k0=0.9996;
  const zone=Math.floor((lon+180)/6)+1, lon0=(zone-1)*6-180+3;
  const rad=Math.PI/180, e2=f*(2-f), ep2=e2/(1-e2);
  const p=lat*rad, N=a/Math.sqrt(1-e2*Math.sin(p)**2), T=Math.tan(p)**2;
  const C=ep2*Math.cos(p)**2, A=(lon-lon0)*rad*Math.cos(p);
  const M=a*((1-e2/4-3*e2**2/64-5*e2**3/256)*p-(3*e2/8+3*e2**2/32+45*e2**3/1024)*Math.sin(2*p)
    +(15*e2**2/256+45*e2**3/1024)*Math.sin(4*p)-(35*e2**3/3072)*Math.sin(6*p));
  const E=k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120)+500000;
  let Nn=k0*(M+N*Math.tan(p)*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720));
  if(lat<0) Nn+=10000000;
  const bands='CDEFGHJKLMNPQRSTUVWX';
  return {zone, band:bands[Math.floor((lat+80)/8)]||'Z', E, N:Nn};
}
function toMGRS(lat,lon){
  const u=toUTM(lat,lon);
  const set=(u.zone-1)%6;
  const colL='ABCDEFGH'.concat('JKLMNPQR','STUVWXYZ');
  const e100k='ABCDEFGH JKLMNPQR STUVWXYZ'.replace(/ /g,'');
  const col=Math.floor(u.E/100000);
  const colIdx=(set%3)*8+(col-1);
  const colChar=e100k[colIdx];
  const rowSet='ABCDEFGHJKLMNPQRSTUV';
  let row=Math.floor(u.N%2000000/100000);
  if(u.zone%2===0) row=(row+5)%20;
  const rowChar=rowSet[row];
  const ee=String(Math.floor(u.E%100000)).padStart(5,'0');
  const nn=String(Math.floor(u.N%100000)).padStart(5,'0');
  return `${u.zone}${u.band} ${colChar}${rowChar} ${ee} ${nn}`;
}
/* cross-track: how far off a line you are, and how far along it */
function xtrack(A,B,P){
  const dx=B[0]-A[0], dy=B[1]-A[1], L=Math.hypot(dx,dy);
  if(!L) return {along:0,cross:0,togo:0,len:0};
  const ux=dx/L, uy=dy/L, px=P[0]-A[0], py=P[1]-A[1];
  return {along:px*ux+py*uy, cross:px*(-uy)+py*ux, togo:L-(px*ux+py*uy), len:L};
}

/* ══════════════════════════════════════════════════════════════
   7. GPS
   ══════════════════════════════════════════════════════════════ */
let me=null, meMk=null, meAcc=null;
function onPos(p){
  const c=p.coords;
  /* A fix with no usable accuracy is not one you can survey with, and taking it
     anyway fails twice over: Leaflet throws outright on a NaN circle radius, so
     onPos died before painting anything while fixes kept arriving -- dead
     readouts above a live counter -- and a NaN would poison the inverse-variance
     weighting in avg.push(), returning an averaged mark that is quietly NaN.
     Refuse it where it can still be reported.

     Note the typeof: isFinite(null) is true, because Number(null) is 0, so a
     null latitude sails through a bare isFinite check and takes Leaflet down
     one line later instead. */
  const num=v=>typeof v==='number'&&isFinite(v);
  if(!num(c.latitude)||!num(c.longitude)||!num(c.accuracy)||c.accuracy<0){
    onErr({code:2,message:'fix arrived without a usable position or accuracy'}); return;
  }
  me={lat:c.latitude,lon:c.longitude,acc:c.accuracy,alt:c.altitude,spd:c.speed,
      hdg:(c.heading!=null&&!isNaN(c.heading)&&c.speed>0.4)?c.heading:null,t:p.timestamp};
  if(!meMk){
    meAcc=L.circle([me.lat,me.lon],{radius:me.acc,color:'#37D9F0',weight:1.5,fillColor:'#37D9F0',fillOpacity:.13}).addTo(map);
    meMk=L.circleMarker([me.lat,me.lon],{radius:7.5,color:'#37D9F0',weight:4,fillColor:'#fff',fillOpacity:1}).addTo(map);
  } else { meMk.setLatLng([me.lat,me.lon]); meAcc.setLatLng([me.lat,me.lon]); meAcc.setRadius(me.acc); }
  if(avg.on) avg.push(me);
  if(trk.on) trk.push(me);
  if(oMode===1&&me.hdg!=null) applyOrient();
  paintPos(); paintRel(); paintTarget(); paintLine(); scheduleNav();
  if($('t-go').classList.contains('on')){ paintTrip(); paintDaylight(); paintCallout(); paintSensors(); }
}
function onErr(e){
  $('sFix').textContent={1:'Denied',2:'Unavailable',3:'Timed out'}[e.code]||'Error';
  $('sFix').style.color='var(--bad)';
  if(e.code===1) diagnose(true);
}
function diagnose(denied){
  const proto=location.protocol, host=location.hostname, framed=window.self!==window.top;
  const localOK=host==='localhost'||host==='127.0.0.1';
  let t='Location unavailable', b='';
  if(proto==='file:'){ t='Open this over HTTPS';
    b='Chrome refuses GPS to pages loaded from local storage (<code>file://</code>) and never shows a prompt. Serve it over HTTPS.'; }
  else if(proto==='http:'&&!localOK){ t='HTTPS required';
    b='Plain <code>http://</code> is not a secure context, so GPS is blocked without prompting.'; }
  else if(framed&&denied){ t='Preview frame is blocking GPS';
    b='This is running in a sandboxed frame that does not pass the geolocation permission through.'; }
  else if(denied&&window.__FIELDMAP_NATIVE__){ t='Location permission denied';
    b='Open Android <b>Settings → Apps → Field Map → Permissions → Location</b>, '
      +'allow it and choose <b>Precise</b>. Android stops asking after two refusals.'; }
  else if(denied){ t='Location permission denied';
    b='Allow location for this site and turn on <b>Use precise location</b> in Chrome\u2019s site settings, then reload.'; }
  else b='No position reported. Try reloading outdoors with a clear view of the sky.';
  $('bTitle').innerHTML=t; $('bBody').innerHTML=b; $('block').classList.add('on');
}
function paintPos(){
  if(!me) return;
  const a=me.acc*FT;
  $('sFix').textContent=a<15?'Good':a<40?'Fair':'Poor';
  $('sFix').style.color=a<15?'var(--good)':a<40?'var(--warn)':'var(--bad)';
  $('sAcc').textContent=a.toFixed(0)+' ft';
  $('pDD').textContent=me.lat.toFixed(7)+', '+me.lon.toFixed(7);
  $('pDMS').textContent=dms(me.lat,'N','S')+' '+dms(me.lon,'E','W');
  const sp=toSP(me.lat,me.lon);
  $('pSP').textContent='E '+sp[0].toFixed(2)+'  N '+sp[1].toFixed(2);
  $('pAlt').textContent=(me.alt!=null?((me.alt-GEOID_N)*FT).toFixed(0)+' ft':'—')+'  /  '
    +(me.spd>0?(me.spd*2.23694).toFixed(1)+' mph':'still');
}
/* inside/outside + nearest line + nearest corner: the question you
   actually have standing in the woods */
let nearCorner=null;
/* Feet are the right unit for everything on the parcel, and wrong the moment you
   are not on it: standing in Portland the boundary readout said "OUT 125531 ft".
   A function declaration, not a const, because this is reachable from onPos and
   a TDZ here has already cost this project one silent failure. */
function fmtRange(ft){
  return Math.abs(ft)<5280 ? ft.toFixed(0)+' ft' : (ft/5280).toFixed(1)+' mi';
}
function paintRel(){
  if(!me||!parcelSP){ return; }
  const p=toSP(me.lat,me.lon);
  const inside=pointInRing(p,parcelSP), d=distToRing(p,parcelSP);
  $('sBnd').textContent=(inside?'IN ':'OUT ')+fmtRange(d);
  $('sBnd').style.color=inside?'var(--good)':'var(--warn)';
  $('rIn').textContent=inside?'Inside the conveyed parcel':'Outside the conveyed parcel';
  $('rLine').textContent=d<5280?d.toFixed(1)+' ft':fmtRange(d);
  let best=null;
  PARCEL.features.filter(f=>f.geometry.type==='Point').forEach(f=>{
    const ll=sh(f.geometry.coordinates), v=gridVec(me.lat,me.lon,ll[0],ll[1]);
    if(!best||v.dist<best.d) best={d:v.dist,az:v.az,nm:f.properties.name,lat:ll[0],lon:ll[1]};
  });
  nearCorner=best;
  $('rCor').textContent=best?`${best.nm} — ${fmtRange(best.d)} ${quad(best.az)}`:'—';
}
if(!navigator.geolocation){ $('sFix').textContent='Unsupported'; diagnose(false); }
else if(location.protocol==='file:'||(location.protocol==='http:'&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1')){
  $('sFix').textContent='Blocked'; $('sFix').style.color='var(--bad)'; diagnose(false);
} else navigator.geolocation.watchPosition(onPos,onErr,{enableHighAccuracy:true,maximumAge:0,timeout:30000});

/* ══════════════════════════════════════════════════════════════
   8. WAKE LOCK — a 60 s average is useless if the screen sleeps
   ══════════════════════════════════════════════════════════════ */
let wake=null;
async function holdWake(on){
  try{
    if(on && !wake && 'wakeLock' in navigator){ wake=await navigator.wakeLock.request('screen');
      wake.addEventListener('release',()=>{wake=null;}); }
    else if(!on && wake){ await wake.release(); wake=null; }
  }catch(e){}
}
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&(avg.on||trk.on)) holdWake(true); });

/* ══════════════════════════════════════════════════════════════
   9. AVERAGING — discard settle, weight by accuracy, reject outliers
   ══════════════════════════════════════════════════════════════ */
const SETTLE_MS=8000;
const avg={on:false,dur:60000,t0:0,s:[],seen:0,mode:'mark',
  start(mode){ this.on=true;this.mode=mode;this.t0=Date.now();this.s=[];this.seen=0;
    $('avgBox').style.display='block'; $('fApply').disabled=true; holdWake(true); tick();
    toast('Averaging — hold still, phone flat and level'); },
  /* The window is closed by the SAMPLE's own timestamp, not by tick(). Chrome
     throttles timers in a hidden page to about one a minute and freezes them
     outright, while watchPosition keeps delivering: switch apps mid-average,
     pocket the phone and walk to the truck, and every fix along the way used to
     land in this.s and be averaged in. applyFit() reads exactly this mean to
     translate the whole parcel. */
  push(p){ this.seen++;
    const el=(p.t||Date.now())-this.t0;
    if(el>=SETTLE_MS && el<=this.dur) this.s.push(p);
    if(el>=this.dur && this.on) finishAvg(); },
  stop(){ this.on=false; if(!trk.on) holdWake(false); },
  mean(){
    if(!this.s.length) return null;
    const w=p=>1/Math.max(p.acc*p.acc,1);                       // inverse-variance weight
    let W=0,la=0,lo=0; this.s.forEach(p=>{const q=w(p);W+=q;la+=p.lat*q;lo+=p.lon*q;});
    la/=W; lo/=W;
    const dv=this.s.map(p=>gridVec(la,lo,p.lat,p.lon).dist);
    const sd=Math.sqrt(dv.reduce((a,b)=>a+b*b,0)/dv.length) || 0;
    const keep=this.s.filter((p,i)=>sd===0||dv[i]<=2.5*sd);     // drop >2.5σ
    W=0;la=0;lo=0; keep.forEach(p=>{const q=w(p);W+=q;la+=p.lat*q;lo+=p.lon*q;}); la/=W; lo/=W;
    const rms=Math.sqrt(keep.map(p=>gridVec(la,lo,p.lat,p.lon).dist**2).reduce((a,b)=>a+b,0)/keep.length);
    return {lat:la,lon:lo,n:keep.length,seen:this.seen,rms,acc:keep.reduce((a,b)=>a+b.acc,0)/keep.length};
  }};
function tick(){
  if(!avg.on) return;
  const el=Math.min(Date.now()-avg.t0,avg.dur), settling=el<SETTLE_MS;
  $('aBar').style.width=(el/avg.dur*100)+'%';
  $('aProg').textContent=settling?`settling ${((SETTLE_MS-el)/1000).toFixed(0)}s`
    :`${(el/1000).toFixed(0)} / ${avg.dur/1000} s`;
  $('aKept').textContent=avg.s.length+' / '+avg.seen;
  const m=avg.mean();
  if(m){ $('aMean').textContent=m.lat.toFixed(7)+', '+m.lon.toFixed(7);
         $('aRms').textContent=m.rms.toFixed(1)+' ft'; }
  if(el>=avg.dur){ finishAvg(); return; }
  setTimeout(tick,250);
}
function finishAvg(){
  if(!avg.on) return;
  avg.stop();
  if(!avg.s.length){ toast('No fixes collected — check GPS'); return; }
  if(avg.mode==='fit'){ $('fApply').disabled=false; toast(`Averaged ${avg.s.length} fixes — now Apply shift`); }
  else toast(`Averaged ${avg.s.length} fixes — Save as mark`);
}

/* ══════════════════════════════════════════════════════════════
   10. TRACK
   ══════════════════════════════════════════════════════════════ */
/* The track was the one thing here held only in RAM, and "Back to start" -- the
   get-out-of-the-woods feature -- is backed by trk.pts[0]. Android suspends the
   page when the screen sleeps and a suspend can become a discard, which took the
   whole track and the way back with it. IndexedDB rather than localStorage: an
   all-day track is ~120 KB and would compete for the quota that protects marks. */
const TRK_KEY='live';
const trk={on:false,pts:[],line:null,t0:0,dist:0,moving:0,_wr:0,
  persist(force){
    const now=Date.now();
    if(!force && now-this._wr<15000) return;         /* 15 s ceiling, not per fix */
    this._wr=now;
    idbPut('tracks',TRK_KEY,{t0:this.t0,dist:this.dist,moving:this.moving,
      live:this.on,pts:this.pts,saved:now}).catch(()=>{});
  },
  forget(){ this._wr=0; idbDel('tracks',TRK_KEY).catch(()=>{}); },
  /* setLatLngs(pts.map(...)) rebuilt and re-projected the whole array on every
     accepted fix -- O(n) per push, O(n^2) over a track, and ~15,000 short-lived
     objects by the 5,000th point. addLatLng appends. */
  draw(){ const q=this.pts[this.pts.length-1];
    if(this.line) this.line.addLatLng([q.lat,q.lon]); },
  start(){ if(this.line) map.removeLayer(this.line);   /* else each restart strands one on the canvas */
    this.on=true;this.pts=[];this.dist=0;this.moving=0;this.t0=Date.now();this._warned=false;
    this.line=L.polyline([],{renderer:canvasR,color:'#B08CFF',weight:3*zScale(),opacity:.9}).addTo(map);
    this.line._bW=3;
    $('trkBox').style.display='block'; $('bTrk').textContent='Stop track';
    $('bTrk').classList.add('rec'); holdWake(true); toast('Recording track'); },
  push(p){
    /* 3 ft is far below the phone's noise floor under canopy. Standing still at
       40-60 ft accuracy with 1 Hz fixes wandering 5-15 ft, every sample cleared
       the old gate: distance climbed about 8 ft/s and dt=1 counted all of it as
       moving, so twenty minutes of standing still added ~1,900 ft at a plausible
       1.1 mph for a walk that never happened. */
    if(p.acc && p.acc*FT>65){
      if(!this._warned){ this._warned=true; toast('Skipping fixes — accuracy is poor here'); }
      return;
    }
    const last=this.pts[this.pts.length-1];
    if(last){ const d=gridVec(last.lat,last.lon,p.lat,p.lon).dist;
      if(d<Math.max(3, (p.acc||0)*FT*0.5)) return;
      const dt=(p.t-last.t)/1000;
      /* After a ten-minute call the first fix back is hundreds of feet away. The
         old code excluded the TIME but still added the distance, drawing a
         straight line through the swamp you walked around. */
      if(dt>30 || d/Math.max(dt,1)>15){
        this.pts.push({lat:p.lat,lon:p.lon,t:p.t,gap:true});
        this.draw(); this.persist(false);
        return;
      }
      this.dist+=d;
      if(dt>0) this.moving+=dt;   /* only contiguous motion counts as moving time */ }
    this.pts.push({lat:p.lat,lon:p.lon,t:p.t});
    this.draw();
    $('kDist').textContent=this.dist.toFixed(0)+' ft ('+(this.dist/5280).toFixed(2)+' mi)';
    $('kPts').textContent=this.pts.length+' pts / '+((Date.now()-this.t0)/60000).toFixed(0)+' min';
    this.persist(false);
  },
  stop(){ this.on=false; if(!avg.on) holdWake(false); $('bTrk').textContent='Record track';
    $('bTrk').classList.remove('rec'); this.persist(true); }};

/* ══════════════════════════════════════════════════════════════
   11. MARKS
   ══════════════════════════════════════════════════════════════ */
const CATS={'Monument':'#FF8A3D','Rock / ledge':'#B08CFF','Tree':'#5BE58B','Water':'#37D9F0',
            'Structure':'#FFC53D','Hazard':'#FF5C5C','Other':'#9AA7B8'};
let marks=[], mkLayer=L.layerGroup().addTo(map), lastDeleted=null, showLabels=true, filterTxt='';
const liveURLs=[];   /* object URLs owned by the current list render */
let marksLoaded=false;
try{ marks=JSON.parse(store.get('fm_marks')||'[]'); marksLoaded=true; }catch(e){ marks=[]; }

/* A phone that goes flat in the cold and restarts off a battery pack comes up
   with whatever the RTC held, and there is no signal at the parcel for NTP to
   correct it. The merge is last-writer-wins on this number, so a morning stamped
   in the past loses every contest it enters the moment you drive into coverage --
   including against tombstones, which silently deletes it. The toast still says
   "Synced 34 marks".

   Stamp monotonically instead: never issue a timestamp older than one already
   issued, so today's work cannot be older than yesterday's whatever the clock
   says. Seeded from the newest record we hold. */
let lastStamp=marks.reduce((a,m)=>Math.max(a, m.updated||m.t||0), 0);
function stamp(){ lastStamp=Math.max(Date.now(), lastStamp+1); return lastStamp; }
/* Only reports a clock that is BEHIND our own records; a fast clock still
   orders correctly, it just makes daylight and export dates wrong. */
const clockBehind=()=>lastStamp>0 && Date.now()<lastStamp-60000;
const saveMarks=()=>{ const r=store.set('fm_marks',JSON.stringify(marks)); paintBackup(); syQueue(); return r; };
function paintBackup(){
  const le=+(store.get('fm_exported_at')||0);
  const el=$('bUnsaved'); if(!el) return;
  /* was marks.length - fm_exported_n: delete two stumps, record two bounds, and
     the count is unchanged so it read "all exported" while the exported file held
     the stumps and neither monument. Edits never moved it at all. */
  const pending=marks.filter(m=>(m.updated||m.t||0)>le).length;
  if(storeBroken){ el.textContent='NOT SAVING — export now'; el.style.color='var(--bad)'; }
  else {
    el.textContent = marks.length===0 ? 'none' : (pending>0? pending+' since last export' : 'all exported');
    el.style.color = pending>0 && marks.length ? 'var(--warn)' : 'var(--good)';
  }
  const pe=$('bPersist');
  if(pe){ pe.textContent = persistOK===null?'checking…':persistOK?'persistent':'evictable — export often';
          pe.style.color = persistOK===null?'var(--muted)':persistOK?'var(--good)':'var(--warn)'; }
  $('bLast').textContent = le? new Date(le).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'never';
}
/* Dismiss used to be inline HTML that only hid the banner. storeBroken stayed
   true, and store.set() only raises the banner when it is false — so one gloved
   tap made every subsequent failed save silent for the rest of the day. */
$('bDismiss').onclick=()=>{ $('block').classList.remove('on'); storeBroken=false; };

/* Nothing anywhere cleared fm_pass, and the same string is silently promoted to
   the sync encryption key and written a second time inside fm_sync beside the
   GitHub token. Storing it is defensible on a screen-locked phone -- if someone
   can read localStorage the app auto-unlocks for them anyway -- but being
   irreversible is not: hand the phone to a contractor, sell it, or send it for
   warranty, and the only remedy was Chrome's Clear data, which also destroys
   every mark, the fit and an evening's tile cache. */
$('lkForget').onclick=()=>{
  let had=false;
  try{ had=localStorage.getItem('fm_pass')!=null; localStorage.removeItem('fm_pass'); }catch(e){}
  delete mem['fm_pass'];
  window.__PASS__=null;
  if(SY&&SY.pass) SY.pass='';
  try{ store.set('fm_sync', JSON.stringify(Object.assign({}, SY, {pass:''}))); }catch(e){}
  toast(had?'Passphrase forgotten — you will be asked next launch':'No saved passphrase');
};

/* Chrome may evict IndexedDB and localStorage under storage pressure, and this
   app's own tile cache is what creates that pressure. Ask once; an installed
   PWA is normally granted silently, a plain tab can be refused — either way the
   Backup panel now says which regime the day's marks are living in. */
let persistOK=null;
if(navigator.storage&&navigator.storage.persist){
  navigator.storage.persisted()
    .then(p=>p||navigator.storage.persist())
    .then(ok=>{ persistOK=!!ok; paintBackup(); })
    .catch(()=>{ persistOK=false; paintBackup(); });
}

const markExported=()=>{ store.set('fm_exported_at',String(Date.now())); paintBackup(); };
/* imported text is untrusted: strip markup and cap length before it is stored */
/* a sub-foot accuracy rounded to whole feet reads as ±0 ft, which is the same
   false precision this readout exists to avoid */
const fmtFt=v=>(v<10?v.toFixed(1):v.toFixed(0))+' ft';
function clean(s){ return s==null?'':String(s).replace(/<[^>]*>/g,'').replace(/[\u0000-\u001F]/g,' ').trim().slice(0,300); }
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function addMark(lat,lon,extra={}){
  const m={id:'m'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),
    name:extra.name||('Mark '+(marks.length+1)),note:extra.note||'',cat:extra.cat||'Other',lat,lon,
    acc:extra.acc??(me?me.acc:null),n:extra.n||1,rms:extra.rms??null,photos:[],t:stamp(),updated:lastStamp};
  marks.push(m); saveMarks(); drawMarks(); renderList(); openSheet(m.id); return m;
}
function drawMarks(){
  mkLayer.clearLayers();
  marks.forEach(m=>{
    const mk=L.circleMarker([m.lat,m.lon],{renderer:canvasR,radius:7*zScale(),color:'#0E1116',weight:2.5,
      fillColor:CATS[m.cat]||CATS.Other,fillOpacity:1}).on('click',()=>openSheet(m.id));
    mk._bR=7;
    if(showLabels) mk.bindTooltip(esc(m.name),{permanent:true,direction:'right',className:'mkLbl',offset:[8,0]});
    mk.addTo(mkLayer);
  });
}
/* Split rendering: the list DOM is rebuilt only when marks change.
   Distance/bearing text is patched in place — the old build rebuilt
   the whole list on every GPS fix (400 ms at 250 marks). */
function visible(){
  if(!filterTxt) return marks;
  const q=filterTxt.toLowerCase();
  return marks.filter(m=>(m.name+' '+m.note+' '+m.cat).toLowerCase().includes(q));
}
function renderList(){
  fillPointSelects();
  const L1=$('mList'), vis=visible();
  if(!vis.length){ L1.innerHTML=`<div class="empty">${marks.length?'Nothing matches that search.'
    :'No marks yet.<br>Use <b>Mark here</b> for your position, or <b>Tap to mark</b> to place one by eye.'}</div>`; return; }
  L1.innerHTML=vis.map(m=>{
    const sp=toSP(m.lat,m.lon);
    return `<div class="item${navT&&navT.id===m.id?' tgt':''}" data-id="${esc(m.id)}">
      ${m.photos&&m.photos.length?`<img class="th" data-ph="${esc(m.photos[0])}" alt="">`:''}
      <div class="bd">
        <div class="top"><div class="nm"><span class="dot" style="background:${CATS[m.cat]||CATS.Other}"></span>${esc(m.name)}</div>
          <div class="nav" data-nav="${esc(m.id)}">—</div></div>
        <div class="sub">${m.lat.toFixed(7)}, ${m.lon.toFixed(7)}</div>
        <div class="sub">E ${sp[0].toFixed(2)} N ${sp[1].toFixed(2)}${m.n>1?'  ·  avg '+m.n+' · scatter '+(m.rms||0).toFixed(1)+' ft'+(m.acc?' · fix ±'+fmtFt(m.acc*FT):''):''}</div>
        ${m.note?`<div class="nt">${esc(m.note)}</div>`:''}
        <div class="acts">
          <button class="btn sm" data-act="go" data-id="${esc(m.id)}">Show</button>
          <button class="btn sm" data-act="nav" data-id="${esc(m.id)}">Navigate</button>
          <button class="btn sm" data-act="ed" data-id="${esc(m.id)}">Edit</button>
        </div></div></div>`;
  }).join('');
  liveURLs.forEach(u=>URL.revokeObjectURL(u)); liveURLs.length=0;
  L1.querySelectorAll('img[data-ph]').forEach(img=>{
    idbGet('photos',img.dataset.ph).then(r=>{ if(r&&r.thumb){
      const u=URL.createObjectURL(r.thumb); liveURLs.push(u); img.src=u; } });
  });
  updateNav();
}
let navRaf=0;
function scheduleNav(){ if(navRaf) return; navRaf=setTimeout(()=>{navRaf=0;updateNav();},900); }
function updateNav(){
  if(!me || !$('t-mrk').classList.contains('on')) return;
  const byId=new Map(marks.map(m=>[m.id,m]));
  $('mList').querySelectorAll('[data-nav]').forEach(el=>{
    const m=marks.find(x=>x.id===el.dataset.nav); if(!m) return;
    const v=gridVec(me.lat,me.lon,m.lat,m.lon);
    el.textContent=v.dist.toFixed(0)+' ft '+quad(v.az);
  });
}
$('mList').onclick=e=>{
  const b=e.target.closest('[data-act]'); if(!b) return;
  const m=marks.find(x=>x.id===b.dataset.id); if(!m) return;
  if(b.dataset.act==='go') map.setView([m.lat,m.lon],19);
  else if(b.dataset.act==='nav') setNav(m.id,m.name,m.lat,m.lon);
  else openSheet(m.id);
};
$('mFind').oninput=e=>{ filterTxt=e.target.value.trim(); renderList(); };
/* rare actions live behind a disclosure so the list starts at the top of the tab */
$('xTog').onclick=()=>{ const b=$('xBox'), on=b.style.display==='none';
  b.style.display=on?'block':'none'; $('xTog').innerHTML='Export &amp; import '+(on?'▴':'▾'); };

/* ══════════════════════════════════════════════════════════════
   12. EDIT SHEET — replaces three stacked window.prompt() calls
   ══════════════════════════════════════════════════════════════ */
let shId=null, shPhotos=[], pendingPurge=null;
$('shCats').innerHTML=Object.keys(CATS).map(c=>`<button data-c="${c}">${c}</button>`).join('');
function openSheet(id){
  const m=marks.find(x=>x.id===id); if(!m) return;
  shId=id; shPhotos=(m.photos||[]).slice();
  $('shName').value=m.name; $('shNote').value=m.note;
  $('shCats').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.c===m.cat));
  paintSheetPhotos();
  $('veil').classList.add('on'); $('sheet').classList.add('on');
  try{ history.pushState({sheet:1},''); sheetPushed=true; }catch(e){}
}
/* Nothing pushed a history entry, so Back left the page. The documented escape
   from a keyboard covering Save is one Back press to drop the IME -- and the
   second, reaching for "close the sheet", exited the app instead, taking the
   live track, the active target and the note being typed with it.

   fromPop distinguishes "the user pressed Back" (the entry is already gone) from
   "the user tapped Cancel" (we still owe history a pop). Getting that wrong
   double-pops and leaves the app anyway. */
let sheetPushed=false;
function closeSheet(fromPop){
  $('veil').classList.remove('on'); $('sheet').classList.remove('on'); shId=null;
  const owed=sheetPushed && !fromPop;
  sheetPushed=false;
  if(owed){ try{ history.back(); }catch(e){} }
}
addEventListener('popstate',()=>{
  if($('sheet').classList.contains('on')){ closeSheet(true); return; }
  if($('block').classList.contains('on')){ $('block').classList.remove('on'); storeBroken=false; return; }
  if(tapMode) setTap(false);
  /* nothing of ours was open: the pop already happened, so do nothing */
});
$('shCats').onclick=e=>{ const b=e.target.closest('[data-c]'); if(!b) return;
  $('shCats').querySelectorAll('button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); };
$('shX').onclick=()=>closeSheet(); $('veil').onclick=()=>closeSheet();
$('shOK').onclick=()=>{
  const m=marks.find(x=>x.id===shId); if(!m) return closeSheet();
  m.name=$('shName').value.trim()||m.name; m.note=$('shNote').value.trim();
  const sel=$('shCats').querySelector('button.on'); if(sel) m.cat=sel.dataset.c;
  (m.photos||[]).forEach(pid=>{ if(shPhotos.indexOf(pid)<0) idbDel('photos',pid).catch(()=>{}); });
  m.photos=shPhotos.slice(); m.updated=stamp();
  saveMarks(); drawMarks(); renderList(); closeSheet(); toast('Saved');
};
$('shDel').onclick=()=>{
  const m=marks.find(x=>x.id===shId); if(!m) return;
  lastDeleted=JSON.parse(JSON.stringify(m));
  /* Blobs used to go here, one line before a toast offering Undo. Undo restored
     the mark JSON pointing at dead keys: blank thumbnails, and an export
     claiming "photos: 2" for a mark with none. Photos never sync, so the device
     held the only copy. Purge the PREVIOUS deletion instead, and let the boot
     sweep reclaim whatever the session leaves behind. */
  if(pendingPurge) pendingPurge.forEach(pid=>idbDel('photos',pid).catch(()=>{}));
  pendingPurge=(m.photos||[]).slice();
  graveyard.push({id:shId, updated:stamp()}); saveGrave();        /* tombstone so the delete syncs */
  marks=marks.filter(x=>x.id!==shId);
  if(navT&&navT.id===shId) clearNav();
  saveMarks(); drawMarks(); renderList(); closeSheet(); toast('Deleted — Undo in Marks tab');
};
$('xUndo').onclick=()=>{ if(!lastDeleted) return toast('Nothing to undo');
  pendingPurge=null;                       /* its blobs are wanted again */
  graveyard=graveyard.filter(t=>t.id!==lastDeleted.id); saveGrave();
  lastDeleted.updated=stamp(); marks.push(lastDeleted); lastDeleted=null; saveMarks(); drawMarks(); renderList(); toast('Restored'); };

/* photos: resized on device, stored as blobs in IndexedDB */
function resize(file,max,q){
  return new Promise(res=>{
    const img=new Image(), u=URL.createObjectURL(file);
    img.onload=()=>{
      const sc=Math.min(1,max/Math.max(img.width,img.height));
      const cv=document.createElement('canvas');
      cv.width=Math.round(img.width*sc); cv.height=Math.round(img.height*sc);
      cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
      URL.revokeObjectURL(u);
      cv.toBlob(b=>res(b),'image/jpeg',q);
    };
    img.onerror=()=>res(null); img.src=u;
  });
}
$('shCam').onclick=()=>$('shFile').click();
$('shFile').onchange=async e=>{
  for(const f of e.target.files){
    const full=await resize(f,1600,.8), thumb=await resize(f,240,.6);
    if(!full) continue;
    const pid='p'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
    const hd=magHeading!=null?((magHeading+declination())%360+360)%360:null;
    try{ await idbPut('photos',pid,{mark:shId,full,thumb,t:Date.now(),heading:hd}); }
    catch(err){ toast('Photo could not be saved — storage may be full'); continue; }
    /* Appended to the textarea, not to the live mark. It used to mutate mm.note
       directly, and then Save assigned m.note from a textarea populated before
       the photo was taken -- so saving wiped the heading note and cancelling
       kept it. Exactly backwards. */
    if(hd!=null && !/looking/i.test($('shNote').value))
      $('shNote').value=($('shNote').value?$('shNote').value+' ':'')+'[photo looking '+quad(hd)+']';
    shPhotos.push(pid);
  }
  e.target.value=''; paintSheetPhotos(); toast('Photo added');
};
function paintSheetPhotos(){
  const box=$('shPhs'); box.innerHTML='';
  shPhotos.forEach(pid=>{
    const d=document.createElement('div'); d.className='p';
    const im=document.createElement('img'); const rm=document.createElement('button');
    rm.className='rm'; rm.textContent='×';
    /* Staged, not immediate. Fat-finger the wrong X, hit Cancel, and the blob
       used to be gone anyway while the mark still listed it. Two taps, because
       there is no undo for a photo. */
    rm.onclick=()=>{
      if(!rm.classList.contains('armed')){
        rm.classList.add('armed'); rm.textContent='Delete?';
        setTimeout(()=>{ rm.classList.remove('armed'); rm.textContent='×'; },3000);
        return;
      }
      shPhotos=shPhotos.filter(x=>x!==pid); paintSheetPhotos();
    };
    idbGet('photos',pid).then(r=>{ if(r&&r.thumb){ const u=URL.createObjectURL(r.thumb); liveURLs.push(u); im.src=u; } });
    im.onclick=()=>idbGet('photos',pid).then(r=>{ if(r&&r.full){ const u=URL.createObjectURL(r.full);
      window.open(u); setTimeout(()=>URL.revokeObjectURL(u),60000); } });
    d.appendChild(im); d.appendChild(rm); box.appendChild(d);
  });
}

/* ══════════════════════════════════════════════════════════════
   13. NAVIGATE TO — the "find it again" mode
   ══════════════════════════════════════════════════════════════ */
let navT=null;
/* Exactly one navigation mode at a time; otherwise both write #tDist each fix. */
function setNav(id,name,lat,lon){ navLine=null; navT={id,name,lat,lon}; $('target').classList.add('on');
  $('compass').classList.add('low'); $('fitbar').classList.add('low');
  $('tName').textContent=name; paintTarget(); renderList(); }
function clearNav(){ navT=null; navLine=null; $('target').classList.remove('on');
  $('compass').classList.remove('low'); $('fitbar').classList.remove('low'); renderList(); }
/* delegated, so a name containing a quote can never terminate a JS string */
map.on('popupopen',e=>{
  const b=e.popup.getElement()&&e.popup.getElement().querySelector('[data-navplan]');
  if(b) b.onclick=()=>navToPlan(b.getAttribute('data-navplan'));
});
window.navToPlan=nm=>{
  const f=PARCEL.features.find(x=>x.geometry.type==='Point'&&x.properties.name===nm);
  if(!f) return; const ll=sh(f.geometry.coordinates);
  setNav('plan:'+nm,nm,ll[0],ll[1]); map.closePopup(); toast('Navigating to '+nm);
};
function paintTarget(){
  if(!navT||!me) return;
  const v=gridVec(me.lat,me.lon,navT.lat,navT.lon);
  $('tDist').textContent=v.dist<1000?v.dist.toFixed(0)+' ft   '+quad(v.az)
    :(v.dist/5280).toFixed(2)+' mi   '+quad(v.az);
  const b=map.getBearing?map.getBearing():0;
  setArrow(v.az+b);   /* arrow is relative to the rotated map */
  if(v.dist<12 && !navT.hit){ navT.hit=true; toast('Within 12 ft of '+navT.name);
    if(navigator.vibrate) navigator.vibrate([120,60,120]); }
  if(v.dist>25) navT.hit=false;
}
$('tStop').onclick=()=>{ clearNav(); navLine=null; };

/* ══════════════════════════════════════════════════════════════
   13b. WALK A LINE / TRIP / DAYLIGHT / CALLOUT
   ══════════════════════════════════════════════════════════════ */
let navLine=null;
const LINES=(()=>{
  const out=[], pts=PARCEL.features.filter(f=>f.geometry.type==='Point');
  PARCEL.features.filter(f=>f.geometry.type==='LineString').forEach(f=>{
    const c=f.geometry.coordinates;
    out.push({name:f.properties.name+' — '+(f.properties.desc||'').slice(0,34),
              a:[c[0][1],c[0][0]], b:[c[c.length-1][1],c[c.length-1][0]]});
  });
  for(let i=0;i<pts.length-1;i++) out.push({name:pts[i].properties.name+' → '+pts[i+1].properties.name,
    a:[pts[i].geometry.coordinates[1],pts[i].geometry.coordinates[0]],
    b:[pts[i+1].geometry.coordinates[1],pts[i+1].geometry.coordinates[0]]});
  return out;
})();
$('lSel').innerHTML=LINES.map((l,i)=>`<option value="${i}">${esc(l.name)}</option>`).join('');
$('lGo').onclick=()=>{
  const l=LINES[+$('lSel').value];
  clearNav();
  navT=null;
  navLine={name:l.name, idx:+$('lSel').value,
           a:[l.a[0]+shift.dLat,l.a[1]+shift.dLon], b:[l.b[0]+shift.dLat,l.b[1]+shift.dLon]}; $('target').classList.add('on'); $('compass').classList.add('low'); $('fitbar').classList.add('low');
  $('tName').textContent=l.name; buzz(12); paintLine(); toast('Following line');
};
function paintLine(){
  if(!navLine||!me) return;
  const A=toSP(navLine.a[0],navLine.a[1]), B=toSP(navLine.b[0],navLine.b[1]), P=toSP(me.lat,me.lon);
  const x=xtrack(A,B,P);
  const side=x.cross>0?'L':'R', steer=x.cross>0?'steer right':'steer left';
  $('lOff').textContent=Math.abs(x.cross).toFixed(1)+' ft '+side;
  $('lTogo').textContent=x.togo.toFixed(0)+' ft of '+x.len.toFixed(0);
  const az=(Math.atan2(B[0]-A[0],B[1]-A[1])*180/Math.PI+360)%360;
  $('lBrg').textContent=quad(az);
  $('tDist').textContent=x.togo.toFixed(0)+' ft to go  ·  '+Math.abs(x.cross).toFixed(1)+' ft '+side;
  $('tName').textContent=navLine.name.slice(0,40)+'  ·  '+(Math.abs(x.cross)<3?'on line':steer);
  const b=map.getBearing?map.getBearing():0;
  setArrow(az+b);
}
/* trip computer, driven off the recorded track */
function paintTrip(){
  const moving=trk.moving/60, elapsed=trk.pts.length>1?(trk.pts[trk.pts.length-1].t-trk.pts[0].t)/60000:0;
  $('gDist').textContent=trk.dist?trk.dist.toFixed(0)+' ft ('+(trk.dist/5280).toFixed(2)+' mi)':'—';
  $('gTime').textContent=moving?moving.toFixed(0)+' min moving / '+elapsed.toFixed(0)+' out':'—';
  const fps=moving>0?trk.dist/(moving*60):0;
  $('gPace').textContent=fps>0.1?(fps*0.681818).toFixed(1)+' mph':'—';
  let togo=null;
  if(navT&&me) togo=gridVec(me.lat,me.lon,navT.lat,navT.lon).dist;
  else if(navLine&&me){ const A=toSP(navLine.a[0],navLine.a[1]),B=toSP(navLine.b[0],navLine.b[1]);
    togo=xtrack(A,B,toSP(me.lat,me.lon)).togo; }
  $('gEta').textContent=(togo!=null&&fps>0.3)?(togo/fps/60).toFixed(0)+' min':'—';
}
$('gBack').onclick=()=>{
  if(!trk.pts.length) return toast('No track recorded — start one when you set out');
  const s=trk.pts[0]; navLine=null; setNav('trk:start','Back to start',s.lat,s.lon); buzz(12);
};
function paintDaylight(){
  if(!me) return;
  const s=sunTimes(new Date(),me.lat,me.lon), now=Date.now();
  const fmt=d=>d?d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'—';
  $('dSet').textContent=fmt(s.sunset); $('dDark').textContent=fmt(s.dusk);
  if(s.sunset){
    const min=Math.round((s.sunset-now)/60000);
    $('dLeft').textContent = min>0 ? Math.floor(min/60)+'h '+(min%60)+'m' : 'after sunset';
    $('dLeft').style.color = min<45&&min>0 ? 'var(--warn)' : min<=0 ? 'var(--bad)' : '';
  }
}
function paintCallout(){
  if(!me) return;
  const u=toUTM(me.lat,me.lon);
  $('gMgrs').textContent=toMGRS(me.lat,me.lon);
  $('gUtm').textContent=`${u.zone}${u.band} ${Math.round(u.E)}E ${Math.round(u.N)}N`;
  $('gLL').textContent=dms(me.lat,'N','S')+' '+dms(me.lon,'E','W');
  $('sDec').textContent=declination().toFixed(2)+'° ('+(declination()<0?'W':'E')+')';
  $('sMag').textContent=magHeading!=null?magHeading.toFixed(0)+'° mag / '
    +(((magHeading+declination())%360+360)%360).toFixed(0)+'° true':'not started';
}
const calloutText=()=>me?`Position: ${toMGRS(me.lat,me.lon)}\n${me.lat.toFixed(6)}, ${me.lon.toFixed(6)}`:'';
$('gCopy').onclick=()=>{ if(!me) return toast('No fix');
  navigator.clipboard.writeText(calloutText()).then(()=>toast('Copied')).catch(()=>toast('Copy failed')); };
$('gShare').onclick=()=>{ if(!me) return toast('No fix');
  if(navigator.share) navigator.share({title:'My position',text:calloutText()}).catch(()=>{});
  else { navigator.clipboard.writeText(calloutText()); toast('Copied — no share sheet here'); } };
async function paintSensors(){
  try{ if(navigator.getBattery){ const b=await navigator.getBattery();
    $('sBat').textContent=Math.round(b.level*100)+'%'+(b.charging?' charging':''); } }catch(e){}
  const c=navigator.connection;
  $('sNet').textContent=navigator.onLine?(c&&c.effectiveType?c.effectiveType:'online'):'offline';
}
$('rGo').onclick=()=>{ if(nearCorner) setNav('plan:'+nearCorner.nm,nearCorner.nm,nearCorner.lat,nearCorner.lon); };

/* ══════════════════════════════════════════════════════════════
   13c. STAKE AND MEASURE
   Two things the plan gives you that the app could not do: project a recorded
   call from a corner you can find, to stand where a lost one should be; and
   measure between two things you have found, to check them against the record.
   Both work in State Plane feet, so a projection and a measurement of the same
   line agree exactly, and both agree with the deed.
   ══════════════════════════════════════════════════════════════ */
/* One list for every selectable point: where you are, the plan, and your marks. */
function pointList(withMe){
  const out=[];
  if(withMe) out.push({k:'me', label:'My position'});
  PARCEL.features.filter(f=>f.geometry.type==='Point')
    .forEach((f,i)=>out.push({k:'plan:'+i, label:f.properties.name}));
  marks.forEach(m=>out.push({k:'mark:'+m.id, label:m.name}));
  return out;
}
function resolvePoint(key){
  if(key==='me') return me?[me.lat,me.lon]:null;
  if(key.indexOf('plan:')===0){
    const f=PARCEL.features.filter(x=>x.geometry.type==='Point')[+key.slice(5)];
    return f?sh(f.geometry.coordinates):null;                 /* shifted, like the drawing */
  }
  if(key.indexOf('mark:')===0){ const m=marks.find(x=>x.id===key.slice(5)); return m?[m.lat,m.lon]:null; }
  return null;
}
function fillPointSelects(){
  const opts=list=>list.map(o=>'<option value="'+esc(o.k)+'">'+esc(o.label)+'</option>').join('');
  const a=$('pjFrom').value, b=$('pjA').value, c=$('pjB').value;
  const html=opts(pointList(true));
  $('pjFrom').innerHTML=html; $('pjA').innerHTML=html; $('pjB').innerHTML=html;
  if(a) $('pjFrom').value=a;
  if(b) $('pjA').value=b;
  if(c) $('pjB').value=c;
  if(!$('pjB').value && $('pjB').options.length>1) $('pjB').selectedIndex=1;
}
$('pjGo').onclick=()=>{
  const from=resolvePoint($('pjFrom').value);
  if(!from) return toast('No GPS fix yet');
  const az=parseBearing($('pjBrg').value);
  if(az==null) return toast('Bearing must read like N 34 35 30 E, or a grid azimuth');
  const d=parseFloat(String($('pjDist').value).replace(/[^0-9.]/g,''));
  if(!isFinite(d)||d<=0) return toast('Enter a distance in feet');
  const ll=projectSP(from[0],from[1],az,d);
  const label=$('pjFrom').selectedOptions[0].textContent;
  $('pjOut').textContent=ll[0].toFixed(7)+', '+ll[1].toFixed(7);
  addMark(ll[0],ll[1],{ name:'Staked '+quad(az)+' '+d.toFixed(2)+' ft',
    note:'Projected from '+label+' — '+quad(az)+' '+d.toFixed(2)+' ft (grid)',
    cat:'Monument', acc:null });
  toast('Staked — navigate to it from the Marks tab');
};
function paintMeasure(){
  const A=resolvePoint($('pjA').value), B=resolvePoint($('pjB').value);
  if(!A||!B){ $('pjD').textContent=$('pjB2').textContent=$('pjDEN').textContent='—'; return; }
  const v=gridVec(A[0],A[1],B[0],B[1]);
  $('pjD').textContent=v.dist.toFixed(2)+' ft'+(v.dist>=1000?'  ('+(v.dist/5280).toFixed(3)+' mi)':'');
  $('pjB2').textContent=quad(v.az);
  $('pjDEN').textContent=v.dE.toFixed(2)+' E / '+v.dN.toFixed(2)+' N';
}
$('pjA').onchange=paintMeasure; $('pjB').onchange=paintMeasure;


/* ══════════════════════════════════════════════════════════════
   14. FIT
   ══════════════════════════════════════════════════════════════ */
const fitPts=PARCEL.features.filter(f=>f.geometry.type==='Point');
const optHTML=fitPts.map((f,i)=>`<option value="${i}">${esc(f.properties.name)}</option>`).join('');
$('fSel').innerHTML=optHTML; $('fSel2').innerHTML=optHTML;
/* A fit translates the whole parcel, but navT and navLine hold absolute lat/lon
   resolved through sh() at the moment navigation started. Without re-anchoring,
   applying a shift moved the polygon and the corner dots under your feet while
   the arrow kept steering to the pre-shift position: you walk until the distance
   zeroes, get the within-12-ft buzz, and dig a shift-length — normally 10-20 ft —
   from the corner the app is simultaneously drawing. Walk-a-line had it worse,
   reporting 0.0 ft "on line" while you stood a shift off the line under you.
   Clearing a shift had the same bug in reverse.

   Only plan-derived targets move. Marks and 'trk:start' are true absolute
   positions and must be left exactly where they are. */
function reanchorNav(){
  if(navT && navT.id.indexOf('plan:')===0){
    const f=PARCEL.features.find(x=>x.geometry.type==='Point'&&x.properties.name===navT.name);
    if(f){ const ll=sh(f.geometry.coordinates); navT.lat=ll[0]; navT.lon=ll[1]; navT.hit=false; }
  }
  if(navLine && navLine.idx!=null && LINES[navLine.idx]){
    const l=LINES[navLine.idx];
    navLine.a=[l.a[0]+shift.dLat, l.a[1]+shift.dLon];
    navLine.b=[l.b[0]+shift.dLat, l.b[1]+shift.dLon];
  }
  paintTarget(); paintLine(); paintMeasure();
}
function applyFit(){
  const m=avg.mean(); if(!m) return toast('No averaged position yet');
  const plan=fitPts[+$('fSel').value].geometry.coordinates;
  shift.dLat=m.lat-plan[1]; shift.dLon=m.lon-plan[0];
  shift.tie=fitPts[+$('fSel').value].properties.name;
  const v=gridVec(plan[1],plan[0],m.lat,m.lon); shift.dE=v.dE; shift.dN=v.dN;
  store.set('fm_shift',JSON.stringify(shift));
  drawParcel(); paintFit(); paintRel(); reanchorNav();
  /* Apply stayed enabled and avg.s was never cleared, so an hour later at a
     different monument you could change the corner and press Apply again,
     translating by the distance between two monuments. */
  avg.s=[]; $('fApply').disabled=true;
  toast('Parcel shifted '+v.dist.toFixed(1)+' ft');
}
function paintFit(){
  const b=$('fitbar');
  if(!shift.tie){ $('fDist').textContent='none'; $('fBrg').textContent='—';
    $('fDen').textContent='—'; $('fTie').textContent='—'; b.classList.remove('on'); return; }
  const d=Math.hypot(shift.dE,shift.dN), az=(Math.atan2(shift.dE,shift.dN)*180/Math.PI+360)%360;
  $('fDist').textContent=d.toFixed(2)+' ft'; $('fBrg').textContent=quad(az);
  $('fDen').textContent=shift.dE.toFixed(2)+' E / '+shift.dN.toFixed(2)+' N';
  $('fTie').textContent=shift.tie;
  b.textContent='SHIFTED '+d.toFixed(1)+' ft '+quad(az)+' · tied to '+shift.tie;
  b.classList.add('on');
}
$('fCheck').onclick=()=>{
  if(!me) return toast('No GPS fix');
  const ll=sh(fitPts[+$('fSel2').value].geometry.coordinates);
  const v=gridVec(ll[0],ll[1],me.lat,me.lon);
  $('fChk').textContent=v.dist.toFixed(1)+' ft '+quad(v.az);
  toast(v.dist<15?'Check residual '+v.dist.toFixed(1)+' ft — fit looks good'
                 :'Check residual '+v.dist.toFixed(1)+' ft — verify the corner');
};
paintFit();

/* ══════════════════════════════════════════════════════════════
   14b. SYNC VIA THE GITHUB CONTENTS API
   No backend. The repo is the database and git is the history. Credentials
   live in this device's localStorage and never enter the published file.
   Payload is AES-GCM encrypted before it leaves the phone, so a leaked
   branch or a mis-scoped Pages config still exposes nothing.
   ══════════════════════════════════════════════════════════════ */
/* The app is served from the very repo it can sync to, so owner and repo are
   already in the URL. Combined with reusing the unlock passphrase, the whole
   setup collapses to pasting one token. */
function detectRepo(){
  const m=location.hostname.match(/^([^.]+)\.github\.io$/);
  if(!m) return null;
  const owner=m[1], seg=location.pathname.split('/').filter(Boolean);
  const repo=(seg.length && !/\.html?$/i.test(seg[0])) ? seg[0] : owner+'.github.io';
  return {owner, repo};
}
const det=detectRepo();
const SY={backend:'auto', owner:det?det.owner:'', repo:det?det.repo:'', branch:'data',
          path:'field/marks.json', tok:'', pass:'', auto:true};
/* Served by the Home Assistant add-on? Then Home Assistant already
   authenticated this request through ingress. Nothing to configure: no token,
   no passphrase, no CORS — the API is same-origin and the data lands in /data,
   which HA includes in its backups. */
let HASS=false;
async function detectHass(){
  try{
    const r=await fetch('api/health',{headers:{'Accept':'application/json'}});
    if(!r.ok) return false;
    const j=await r.json();
    return j && j.backend==='hass-addon';
  }catch(e){ return false; }
}
let graveyard=[], syBusy=false, syTimer=0;
try{ const s=JSON.parse(store.get('fm_sync')||'{}');
  Object.keys(s).forEach(k=>{ if(s[k]!=='' && s[k]!=null) SY[k]=s[k]; }); }catch(e){}
/* a locked build already asked for a passphrase — don't ask twice */
if(!SY.pass && window.__PASS__) SY.pass=window.__PASS__;
try{ graveyard=JSON.parse(store.get('fm_graveyard')||'[]'); }catch(e){}
const syReady=()=>HASS ? true : !!(SY.owner&&SY.repo&&SY.tok&&SY.pass);
const saveGrave=()=>store.set('fm_graveyard',JSON.stringify(graveyard));

function gh(path,opt){
  return fetch('https://api.github.com/repos/'+SY.owner+'/'+SY.repo+path, Object.assign({
    headers:{'Authorization':'Bearer '+SY.tok,'Accept':'application/vnd.github+json',
             'X-GitHub-Api-Version':'2022-11-28'}}, opt||{}));
}
/* Pages publishes whatever is on its branch, so keep data on its own. */
async function ensureBranch(){
  let r=await gh('/git/ref/heads/'+encodeURIComponent(SY.branch));
  if(r.ok) return true;
  const meta=await gh(''); if(!meta.ok) return false;
  const def=(await meta.json()).default_branch;
  const base=await gh('/git/ref/heads/'+encodeURIComponent(def)); if(!base.ok) return false;
  const sha=(await base.json()).object.sha;
  r=await gh('/git/refs',{method:'POST',body:JSON.stringify({ref:'refs/heads/'+SY.branch,sha})});
  return r.ok;
}
async function syGet(){
  if(HASS){
    const r=await fetch('api/marks'); if(!r.ok) throw new Error('read '+r.status);
    return {sha:null, data:await r.json()};
  }
  const r=await gh('/contents/'+encodeURI(SY.path)+'?ref='+encodeURIComponent(SY.branch));
  if(r.status===404) return {sha:null,data:null};
  if(!r.ok) throw new Error('read '+r.status);
  const j=await r.json();
  const txt=new TextDecoder().decode(b64d(j.content.replace(/\n/g,'')));
  let data=null;
  try{ data=await decryptParcel(JSON.parse(txt), SY.pass); }
  catch(e){ throw new Error('wrong sync passphrase'); }
  return {sha:j.sha, data};
}
async function syPut(payload, sha){
  if(HASS){
    /* the add-on merges server-side too, so two phones at once can't clobber */
    const r=await fetch('api/marks',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)});
    if(!r.ok) throw new Error('write '+r.status);
    const merged=await r.json();
    marks=merged.marks||marks; graveyard=merged.graveyard||graveyard;
    return true;
  }
  const env=await encryptParcel(payload, SY.pass);
  const body={message:'field marks '+new Date().toISOString(),
    content:b64e(new TextEncoder().encode(JSON.stringify(env))), branch:SY.branch};
  if(sha) body.sha=sha;
  const r=await gh('/contents/'+encodeURI(SY.path),{method:'PUT',body:JSON.stringify(body)});
  if(!r.ok) throw new Error('write '+r.status);
  return true;
}
/* last write wins per mark id; a delete only wins if it is newer than the
   mark's own last edit, so editing on one phone beats an older delete */
/* Import range-checks coordinates and strips markup; sync did none of it, and a
   remote store is no more trustworthy than a file — same GitHub repo, edited by
   hand, restored from a stale backup, or written by an older build. A NaN
   coordinate corrupts the Leaflet layer and a mark with no id silently collides
   with every other id-less mark in the merge Map. */
function syClean(x){
  if(!x || typeof x!=='object') return null;
  const lat=Number(x.lat), lon=Number(x.lon);
  if(!isFinite(lat)||!isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) return null;
  const id=typeof x.id==='string'&&x.id?x.id.replace(/[^\w:.-]/g,'').slice(0,64):'';
  if(!id) return null;
  return {...x, id, lat, lon, name:clean(x.name)||'Unnamed', note:clean(x.note),
          cat:CATS[x.cat]?x.cat:'Other',
          updated:Number(x.updated)||Number(x.t)||0, t:Number(x.t)||Date.now()};
}
function syMerge(lm,lg,rm,rg){
  rm=(rm||[]).map(syClean).filter(Boolean);
  rm.forEach(x=>{ lastStamp=Math.max(lastStamp, x.updated||x.t||0); });
  rg=(rg||[]).filter(t=>t&&typeof t.id==='string'&&isFinite(Number(t.updated)));
  const g=new Map();
  [...(lg||[]),...(rg||[])].forEach(t=>{ const c=g.get(t.id); if(!c||t.updated>c.updated) g.set(t.id,t); });
  const m=new Map();
  [...(rm||[]),...(lm||[])].forEach(x=>{ const c=m.get(x.id);
    if(!c||(x.updated||x.t||0)>(c.updated||c.t||0)) m.set(x.id,x); });
  const out=[];
  m.forEach(x=>{ const t=g.get(x.id); if(t&&t.updated>=(x.updated||x.t||0)) return; out.push(x); });
  const cutoff=Date.now()-90*864e5;
  return {marks:out, graveyard:[...g.values()].filter(t=>t.updated>cutoff)};
}
async function syncNow(quiet){
  if(syBusy) return; if(!syReady()){ if(!quiet) toast('Fill in sync settings first'); return; }
  if(!navigator.onLine){ if(!quiet) toast('Offline — will sync when you have signal'); syPaint('offline'); return; }
  syBusy=true; syPaint('syncing');
  try{
    if(!HASS) await ensureBranch();
    let {sha,data}=await syGet();
    const merged=syMerge(marks,graveyard,data&&data.marks,data&&data.graveyard);
    marks=merged.marks; graveyard=merged.graveyard;
    await syPut({v:1,marks,graveyard,updated:stamp()}, sha);
    syApplying=true;                       /* these writes are the sync's own, do not re-arm it */
    try{ saveMarks(); saveGrave(); } finally { syApplying=false; }
    drawMarks(); renderList();
    store.set('fm_sync_at',String(Date.now()));
    syPaint('ok'); if(!quiet) toast('Synced '+marks.length+' marks');
  }catch(e){
    syPaint('err:'+e.message);
    if(!quiet) toast('Sync failed: '+e.message);
  }finally{ syBusy=false; }
}
function syPaint(state){
  const el=$('syState'); if(!el) return;
  const at=+(store.get('fm_sync_at')||0);
  const map_={syncing:['syncing…','var(--warn)'],ok:['up to date','var(--good)'],
    offline:['offline — queued','var(--muted)'],ready:['ready','var(--muted)']};
  if(state&&state.startsWith('err:')){ el.textContent=state.slice(4); el.style.color='var(--bad)'; }
  else { const s=map_[state||(syReady()?'ready':'')]||['not set up','var(--muted)'];
         el.textContent=s[0]; el.style.color=s[1]; }
  $('syWhen').textContent=at?new Date(at).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'never';
}
/* syncNow() calls saveMarks() to persist what it merged, saveMarks() calls
   syQueue(), and syQueue() schedules the next syncNow. The debounce that was
   meant to batch edits became a permanent 20 s poll — GitHub API calls all day
   on a battery-critical device, and renderList() throwing away the mark list
   you were scrolling every 20 s. Writes made BY a sync must not re-arm it. */
let syApplying=false;
const syQueue=()=>{ if(syApplying||!SY.auto||!syReady()) return;
  clearTimeout(syTimer); syTimer=setTimeout(()=>syncNow(true), 20000); };
addEventListener('online', ()=>{ syPaint(); if(SY.auto&&syReady()) syncNow(true); });
addEventListener('offline', ()=>syPaint('offline'));

/* ══════════════════════════════════════════════════════════════
   15. EXPORT
   ══════════════════════════════════════════════════════════════ */
/* Resolves true when the file is really on disk. In a browser the anchor click
   is the whole operation, so that is immediate; in the APK native.js replaces
   this wholesale, because a WebView ignores <a download> and every export here
   silently did nothing at all. Takes a Blob as well as text, so the photo zip
   goes through the same door instead of building its own anchor. */
function dl(name,data,mime){
  const u=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type:mime}));
  const a=document.createElement('a'); a.href=u; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(u),8000);
  return Promise.resolve(true);
}
function bundle(){
  const fs=marks.map(m=>{ const sp=toSP(m.lat,m.lon);
    return {type:'Feature',geometry:{type:'Point',coordinates:[m.lon,m.lat]},
      properties:{id:m.id,name:m.name,type:m.cat,note:m.note,accuracy_ft:m.acc?+(m.acc*FT).toFixed(1):null,
        fixes:m.n,scatter_ft:m.rms?+m.rms.toFixed(2):null,photos:(m.photos||[]).length,
        sp_east_ftus:+sp[0].toFixed(2),sp_north_ftus:+sp[1].toFixed(2),
        recorded:new Date(m.t).toISOString(),updated:new Date(m.updated||m.t).toISOString()}};});
  if(trk.pts.length>1) fs.push({type:'Feature',geometry:{type:'LineString',
    coordinates:trk.pts.map(p=>[p.lon,p.lat])},properties:{name:'Recorded track',
    distance_ft:+trk.dist.toFixed(0),points:trk.pts.length}});
  if(shift.tie){ const f=PARCEL.features.find(x=>x.properties.style==='p1');
    fs.push({type:'Feature',geometry:{type:'Polygon',coordinates:[f.geometry.coordinates[0].map(c=>[c[0]+shift.dLon,c[1]+shift.dLat])]},
      properties:{name:'Conveyed parcel (fitted)',tied_to:shift.tie,
        shift_ft:+Math.hypot(shift.dE,shift.dN).toFixed(2)}}); }
  return {type:'FeatureCollection',features:fs};
}
$('xGeo').onclick=()=>{ dl('field-data.geojson',JSON.stringify(bundle(),null,2),'application/geo+json').then(ok=>{ if(ok) markExported(); }); };
$('xCsv').onclick=()=>{
  const r=[['name','type','note','lat','lon','sp_east_ftus','sp_north_ftus','accuracy_ft','fixes','scatter_ft','photos','recorded']];
  marks.forEach(m=>{const sp=toSP(m.lat,m.lon);
    r.push([m.name,m.cat,m.note,m.lat.toFixed(7),m.lon.toFixed(7),sp[0].toFixed(2),sp[1].toFixed(2),
      m.acc?(m.acc*FT).toFixed(1):'',m.n,m.rms?m.rms.toFixed(2):'',(m.photos||[]).length,new Date(m.t).toISOString()]);});
  /* Excel and Sheets evaluate a cell beginning = + - @ as a formula, quoted or
     not. A monument note is user text and lands in a spreadsheet by design. */
  const csvCell=c=>{ let v=String(c); if(v && '=+@-'.indexOf(v.charAt(0))>=0) v="'"+v; return '"'+v.replace(/"/g,'""')+'"'; };
  dl('field-marks.csv',r.map(x=>x.map(csvCell).join(',')).join('\n'),'text/csv').then(ok=>{ if(ok) markExported(); });
};
$('xKml').onclick=()=>{
  /* ]]> is the one sequence CDATA cannot carry, and esc() does not apply inside it */
  const cd=t=>String(t==null?'':t).split(']]>').join(']]&gt;');
  let k=marks.map(m=>`<Placemark><name>${esc(m.name)}</name><description><![CDATA[${cd(m.cat)}${m.note?' — '+cd(m.note):''}]]></description>`
    +`<Point><coordinates>${m.lon},${m.lat},0</coordinates></Point></Placemark>`).join('\n');
  if(trk.pts.length>1) k+=`\n<Placemark><name>Recorded track</name><LineString><tessellate>1</tessellate>`
    +`<coordinates>${trk.pts.map(p=>p.lon+','+p.lat+',0').join(' ')}</coordinates></LineString></Placemark>`;
  dl('field-data.kml',`<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">`
    +`<Document><name>Field data</name>\n${k}\n</Document></kml>`,
    'application/vnd.google-earth.kml+xml').then(ok=>{ if(ok) markExported(); });
};
/* Photos never sync, so this is the only way the photographic record of a
   monument ever leaves the phone — and it used to fire one programmatic download
   per photo on a 320 ms timer. Chrome allows a burst inside the originating
   gesture, but transient activation lasts about 5 s: from roughly the sixteenth
   photo the downloads were simply dropped on Android, with no prompt, while the
   counter counted attempts and reported every one as a success. Every object URL
   was also created and never revoked.

   One archive, one download, one activation. Stored mode (no compression) — JPEG
   does not deflate usefully anyway, and it keeps this to arithmetic with no
   dependency. */
const CRC=(()=>{ const t=new Uint32Array(256);
  for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0; }
  return t; })();
function crc32(u8){ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c=CRC[(c^u8[i])&0xFF]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0; }
function zipStore(files){                       /* [{name, data:Uint8Array}] */
  const enc=new TextEncoder(), parts=[], central=[]; let off=0;
  const u32=v=>[v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255];
  const u16=v=>[v&255,(v>>>8)&255];
  files.forEach(f=>{
    const nm=enc.encode(f.name), c=crc32(f.data), n=f.data.length;
    const lh=new Uint8Array([80,75,3,4, 20,0, 0,0, 0,0, 0,0, 0,0, ...u32(c), ...u32(n), ...u32(n),
                             ...u16(nm.length), 0,0]);
    parts.push(lh, nm, f.data);
    central.push(new Uint8Array([80,75,1,2, 20,0, 20,0, 0,0, 0,0, 0,0, 0,0, ...u32(c), ...u32(n), ...u32(n),
                                 ...u16(nm.length), 0,0, 0,0, 0,0, 0,0, 0,0,0,0, ...u32(off)]), nm);
    off += lh.length + nm.length + n;
  });
  const cdOff=off; let cdLen=0; central.forEach(b=>cdLen+=b.length);
  const eocd=new Uint8Array([80,75,5,6, 0,0, 0,0, ...u16(files.length), ...u16(files.length),
                             ...u32(cdLen), ...u32(cdOff), 0,0]);
  return new Blob([...parts, ...central, eocd], {type:'application/zip'});
}
$('xPho').onclick=async()=>{
  const keys=await idbKeys('photos')||[];
  if(!keys.length) return toast('No photos yet');
  toast('Packing photos…');
  const files=[], used={};
  for(const k of keys){
    const r=await idbGet('photos',k); if(!r||!r.full) continue;
    const m=marks.find(x=>(x.photos||[]).includes(k));
    let base=((m?m.name:'photo').replace(/[^\w\-]+/g,'_')).slice(0,48)||'photo';
    used[base]=(used[base]||0)+1;
    files.push({ name:base+'_'+used[base]+'.jpg', data:new Uint8Array(await r.full.arrayBuffer()) });
  }
  if(!files.length) return toast('No photos yet');
  dl('field-photos.zip',zipStore(files),'application/zip')
    .then(ok=>{ if(ok) toast('Exported '+files.length+' photos'); });
};
$('xImp').onclick=()=>$('fImp').click();
$('fImp').onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{ try{
    const g=JSON.parse(rd.result);
    const feats=(g.features||[]).filter(ft=>ft&&ft.geometry&&ft.geometry.type==='Point');
    /* a statewide monument layer off the GeoLibrary would push unboundedly, blow
       the quota, then build that many canvas markers and one innerHTML string */
    if(feats.length>5000) return toast('That file has '+feats.length+' points — too many to import');
    let k=0, bad=0, upd=0;
    feats.forEach(ft=>{
      const lon=Number(ft.geometry.coordinates[0]), lat=Number(ft.geometry.coordinates[1]);
      /* never let an unusable coordinate into the map */
      if(!isFinite(lat)||!isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180){ bad++; return; }
      const p=ft.properties||{};
      const when=Date.parse(p.recorded), touched=Date.parse(p.updated);
      const rec={ name:clean(p.name)||'Imported', note:clean(p.note), cat:CATS[p.type]?p.type:'Other',
        lat, lon, acc:isFinite(Number(p.accuracy_ft))?Number(p.accuracy_ft)/FT:null,
        n:Number(p.fixes)||1, rms:isFinite(Number(p.scatter_ft))?Number(p.scatter_ft):null,
        t:isFinite(when)?when:Date.now(), updated:isFinite(touched)?touched:Date.now() };
      /* Restoring your own export used to mint a fresh id per feature and push
         blind: 40 duplicates stacked pixel-on-pixel with identical names, which
         saveMarks() then pushed to sync where they cannot be de-duplicated
         because the ids differ, and on to every other device. */
      const id=typeof p.id==='string'&&p.id?p.id.replace(/[^\w:.-]/g,'').slice(0,64):'';
      const ex=id?marks.findIndex(x=>x.id===id):-1;
      if(ex>=0){
        if(rec.updated>(marks[ex].updated||marks[ex].t||0)){
          marks[ex]=Object.assign({}, marks[ex], rec, {photos:marks[ex].photos||[]}); upd++;
        }
        return;
      }
      marks.push(Object.assign({id:id||('m'+Date.now().toString(36)+Math.random().toString(36).slice(2,5)),
        photos:[]}, rec)); k++; });
    saveMarks(); drawMarks(); renderList();
    toast('Imported '+k+' marks'+(upd?', updated '+upd:'')+(bad?', skipped '+bad+' bad':''));
  }catch(err){ toast('Could not read that file'); } };
  rd.readAsText(f); e.target.value='';
};

/* ══════════════════════════════════════════════════════════════
   16. OFFLINE TILE CACHE
   ══════════════════════════════════════════════════════════════ */
async function cacheStats(){
  $('cCnt').textContent=((await idbCount('tiles'))||0)+' tiles';
  if(navigator.storage&&navigator.storage.estimate){
    const e=await navigator.storage.estimate();
    $('cSize').textContent=(e.usage/1048576).toFixed(1)+' MB used';
  } else $('cSize').textContent='—';
}
$('cSave').onclick=async()=>{
  if(!db) return toast('Storage unavailable');
  /* Anchor the range to what this layer can actually serve. USGS tops out at
     z16, so standing at z18 the old range was for(z=18; z<=16) — it never ran,
     and reported "Cached 0 tiles" behind a full progress bar. */
  const b=map.getBounds();
  const nat=curBase.options.maxNativeZoom||curBase.options.maxZoom||19;
  const z0=Math.min(Math.max(map.getZoom(),14), nat);
  const zmax=Math.min(z0+3, nat);
  const jobs=[];
  for(let z=z0; z<=zmax; z++){
    const n=Math.pow(2,z);
    const x1=Math.floor((b.getWest()+180)/360*n), x2=Math.floor((b.getEast()+180)/360*n);
    const yOf=la=>Math.floor((1-Math.log(Math.tan(la*Math.PI/180)+1/Math.cos(la*Math.PI/180))/Math.PI)/2*n);
    const y1=yOf(b.getNorth()), y2=yOf(b.getSouth());
    for(let x=x1;x<=x2;x++) for(let y=y1;y<=y2;y++) jobs.push({x,y,z});
  }
  if(jobs.length>3000) return toast('Zoom in — that area is too large ('+jobs.length+' tiles)');
  toast('Caching '+jobs.length+' tiles…');
  /* Serial fetches for up to 3,000 tiles run for minutes; Android's screen
     timeout is 30-120 s, and a frozen page stalls the job. holdWake is shared
     with avg and trk, so release only when neither still needs it -- AUDIT.md
     records dropping a lock a live track needed. */
  holdWake(true);
  let done=0, failed=0;
  try{
  for(const j of jobs){
    const key=(curBase.getCacheId?curBase.getCacheId():curBase.options.cacheId)+'/'+j.z+'/'+j.x+'/'+j.y;
    try{
      const have=await idbGet('tiles',key);
      if(!have){
        const r=await fetch(tileUrlAt(curBase,j),{mode:'cors'});
        if(r.ok) await idbPut('tiles',key,await r.blob()); else failed++;
      }
    }catch(e){ failed++; }
    done++;
    if(done%10===0){ $('cBar').style.width=(done/jobs.length*100)+'%'; await new Promise(r=>setTimeout(r,0)); }
  }
  } finally { if(!avg.on&&!trk.on) holdWake(false); }
  $('cBar').style.width='100%'; cacheStats();
  toast('Cached '+(done-failed)+' tiles'+(failed?' ('+failed+' failed)':''));
  setTimeout(()=>{$('cBar').style.width='0';},1500);
};
$('cWipe').onclick=async()=>{ await idbClear('tiles'); cacheStats(); toast('Tile cache cleared'); };

/* ══════════════════════════════════════════════════════════════
   17. LAYERS + ORIENTATION + UI
   ══════════════════════════════════════════════════════════════ */
const swatch={'Satellite':'#3a5a3a','LiDAR hillshade':'#9aa0a6','USGS topo':'#d8cba8','USGS imagery + topo':'#7d8f6a','Topo':'#c8b48a','Street':'#8fa9c8','Historical':'#b08968'};
$('baseList').innerHTML=Object.keys(bases).map(k=>
  `<div class="lyr${bases[k]===curBase?' on':''}" data-b="${k}"><span class="sw" style="background:${swatch[k]}"></span>
   <span class="tx">${k}</span><span class="ck">${bases[k]===curBase?'ON':''}</span></div>`).join('');
$('baseList').onclick=e=>{
  const el=e.target.closest('[data-b]'); if(!el) return;
  map.removeLayer(curBase); curBase=bases[el.dataset.b]; curBase.addTo(map); curBase.bringToBack();
  [...$('baseList').children].forEach(c=>{const on=c.dataset.b===el.dataset.b;
    c.classList.toggle('on',on); c.querySelector('.ck').textContent=on?'ON':'';});
};
/* Year picker for the Historical basemap. Selecting a year also selects the
   layer, because wanting 1945 and not wanting to look at it is not a state worth
   supporting. The layer is removed and re-added rather than redrawn: that is what
   makes Leaflet's attribution control pick up the new credit line, and every one
   of these sources has a different one. */
function paintHist(){
  const h=HIST[histIdx];
  $('histNow').textContent=h.a;
  [...$('histRow').children].forEach(b=>b.classList.toggle('sel',+b.dataset.hy===histIdx));
}
function setHist(i){
  if(!(i>=0&&i<HIST.length)) return;
  histIdx=i; store.set('fm_hist',String(i));
  const L=bases['Historical'], h=HIST[i];
  L.options.maxNativeZoom=h.nz; L.options.attribution=h.a;
  if(map.hasLayer(L)) map.removeLayer(L);
  map.removeLayer(curBase); curBase=L; L.addTo(map); L.bringToBack();
  [...$('baseList').children].forEach(c=>{const on=c.dataset.b==='Historical';
    c.classList.toggle('on',on); c.querySelector('.ck').textContent=on?'ON':'';});
  paintHist();
}
$('histRow').innerHTML=HIST.map((h,i)=>`<button class="btn sm" data-hy="${i}">${esc(h.label)}</button>`).join('');
$('histRow').onclick=e=>{ const b=e.target.closest('[data-hy]'); if(b) setHist(+b.dataset.hy); };
paintHist();

$('ovList').innerHTML=Object.entries(STY).map(([k,s])=>
  `<div class="lyr${s.off?'':' on'}" data-o="${k}"><span class="sw" style="background:${s.color}"></span>
   <span class="tx">${s.label}</span><span class="ck">${s.off?'':'ON'}</span></div>`).join('');
$('ovList').onclick=e=>{
  const el=e.target.closest('[data-o]'); if(!el) return;
  const k=el.dataset.o, on=map.hasLayer(groups[k]);
  if(on) map.removeLayer(groups[k]); else groups[k].addTo(map);
  el.classList.toggle('on',!on); el.querySelector('.ck').textContent=on?'':'ON';
};
function relight(){
  const hs=bases['LiDAR hillshade'];
  if(map.hasLayer(hs)){ map.removeLayer(hs); hs.addTo(map); hs.bringToBack(); }
  hs.redraw();
}
document.querySelectorAll('[data-az]').forEach(b=>b.onclick=()=>{
  hsOpt.az=+b.dataset.az; hsOpt.mode='hill'; hsSave();
  if(!map.hasLayer(bases['LiDAR hillshade'])){
    map.removeLayer(curBase); curBase=bases['LiDAR hillshade']; curBase.addTo(map); curBase.bringToBack();
    [...$('baseList').children].forEach(c=>{const on=c.dataset.b==='LiDAR hillshade';
      c.classList.toggle('on',on); c.querySelector('.ck').textContent=on?'ON':'';});
  } else relight();
  toast('Sun from '+hsOpt.az+'°');
});
document.querySelectorAll('[data-hs]').forEach(b=>b.onclick=()=>{
  hsOpt.mode=b.dataset.hs; hsSave();
  if(!map.hasLayer(bases['LiDAR hillshade'])){
    map.removeLayer(curBase); curBase=bases['LiDAR hillshade']; curBase.addTo(map); curBase.bringToBack();
    [...$('baseList').children].forEach(c=>{const on=c.dataset.b==='LiDAR hillshade';
      c.classList.toggle('on',on); c.querySelector('.ck').textContent=on?'ON':'';});
  } else relight();
  toast(b.dataset.hs==='slope'?'Slope shading':'Multi-directional light');
});
$('zEx').oninput=e=>{ hsOpt.z=+e.target.value; $('zVal').textContent=hsOpt.z+'×'; };
$('zEx').onchange=()=>{ hsSave(); if(map.hasLayer(bases['LiDAR hillshade'])) relight(); };
[['syOwner','owner'],['syRepo','repo'],['syBranch','branch'],['syPath','path'],
 ['syTok','tok'],['syPass','pass']].forEach(([id,k])=>{ if($(id)) $(id).value=SY[k]||''; });
if($('syAuto')) $('syAuto').checked=SY.auto!==false;
function syLabel(){
  $('syRepoLbl').textContent = HASS ? 'Home Assistant add-on · /data'
    : (SY.owner&&SY.repo ? SY.owner+'/'+SY.repo+' · '+SY.branch : 'not detected — open Advanced');
  if(HASS){
    const t=$('syTok'); if(t) t.closest('.fld').style.display='none';
    const s=$('sySave'); if(s) s.style.display='none';
    const a=$('syAdvTog'); if(a) a.style.display='none';
    const hint=$('syBox').querySelector('.hint');
    if(hint) hint.innerHTML='Running inside your Home Assistant add-on. Home Assistant '
      +'already authenticated you, so there is nothing to set up. Marks are stored in the '
      +'add-on\u2019s <b>/data</b> volume and travel with your HA backups.';
  }
}
syLabel();
$('syTog').onclick=()=>{ const b=$('syBox'), on=b.style.display==='none';
  b.style.display=on?'block':'none'; $('syTog').textContent='Settings '+(on?'▴':'▾'); syLabel(); };
$('syAdvTog').onclick=()=>{ const b=$('syAdv'), on=b.style.display==='none';
  b.style.display=on?'block':'none'; $('syAdvTog').textContent='Advanced '+(on?'▴':'▾'); };
$('sySave').onclick=async()=>{
  if($('syOwner').value.trim()) SY.owner=$('syOwner').value.trim();
  if($('syRepo').value.trim())  SY.repo=$('syRepo').value.trim();
  SY.branch=($('syBranch').value.trim())||SY.branch||'data';
  SY.path=($('syPath').value.trim())||SY.path||'field/marks.json';
  SY.tok=$('syTok').value.trim();
  SY.pass=$('syPass').value || SY.pass || window.__PASS__ || '';
  SY.auto=$('syAuto').checked;
  if(!SY.owner||!SY.repo) return toast('Could not work out the repo — open Advanced');
  if(!SY.tok) return toast('Paste a token first');
  if(!SY.pass) return toast('Set an encryption passphrase under Advanced');
  store.set('fm_sync',JSON.stringify(SY)); syLabel(); syPaint();
  toast('Checking…');
  try{
    const r=await gh(''); if(!r.ok) throw new Error('repo '+r.status);
    const j=await r.json();
    await ensureBranch();
    toast(j.private?'Sync on — '+j.full_name:'Sync on, but '+j.full_name+' is PUBLIC');
    syncNow(true);
  }catch(e){ toast('Token rejected: '+e.message); }
};
$('syTest').onclick=async()=>{
  if(!syReady()) return toast('Fill in every field first');
  try{
    const r=await gh(''); if(!r.ok) throw new Error('repo '+r.status);
    const j=await r.json();
    const ok=await ensureBranch();
    toast(ok?'Connected to '+j.full_name+(j.private?' (private)':' (PUBLIC repo)')
            :'Repo reachable but branch failed');
  }catch(e){ toast('Failed: '+e.message); }
};
$('sySync').onclick=()=>syncNow(false);
$('lkMake').onclick=async()=>{
  const p=$('lkNew').value;
  if(!p||p.length<8) return toast('Use at least 8 characters — this file can be attacked offline');
  try{ await window.lockFile(p); $('lkNew').value='';
       toast('Locked copy downloaded — upload that one'); }
  catch(e){ toast('Could not build locked copy'); }
};
$('mLbl').onclick=()=>{ showLabels=!showLabels; drawMarks();
  $('mLbl').textContent=showLabels?'Hide mark labels':'Show mark labels'; };

let oMode=0, magHeading=null;
const O_NAMES=['NORTH UP','HEADING UP','COMPASS UP'];
/* getBearing() returns [0,360), so a 359.4 -> 0.3 step is a 359 degree CSS
   change under transition:transform .12s — the rose and the target arrow visibly
   spin the wrong way through north, exactly when you are reading north. Unwrap
   to the nearest equivalent angle and keep a running value per element. */
function unwrap(prev,deg){ return prev + (((deg-prev)%360+540)%360-180); }
let roseDeg=0, arwDeg=0;
function setArrow(deg){ arwDeg=unwrap(arwDeg,deg); $('tArw').style.transform='rotate('+arwDeg+'deg)'; }

/* Rotation is driven by raw input — one setBearing per touchmove, one per
   magnetometer sample. Coalesce to one per frame, and ignore anything under
   0.6 degrees so magnetometer jitter cannot drive the map at all. */
let wantBearing=null, brRaf=0;
const setBearing=d=>{
  if(!map.setBearing) return;
  if(wantBearing==null){
    const cur=map.getBearing?map.getBearing():0;
    if(Math.abs(((d-cur)%360+540)%360-180)<0.6) return;
  }
  wantBearing=d;
  if(brRaf) return;
  brRaf=requestAnimationFrame(()=>{ brRaf=0;
    const b=wantBearing; wantBearing=null; if(b!=null) map.setBearing(b); });
};
function paintRose(){
  const b=map.getBearing?map.getBearing():0, off=Math.abs(((b%360)+360)%360)>0.5;
  roseDeg=unwrap(roseDeg,b);
  $('cRose').style.transform=`rotate(${roseDeg}deg)`;
  $('cMode').textContent=(oMode===0&&off)?String(Math.round(((-b%360)+360)%360)).padStart(3,'0')+'°':O_NAMES[oMode];
  $('compass').classList.toggle('track',oMode!==0||off);
  /* both guard on their own state, so exactly one does work. paintLine() was
     missing: $('lGo') nulls navT, so while walking a line the arrow refreshed
     only once per GPS fix and could be 90 degrees stale through a turn. */
  paintTarget(); paintLine();
}
map.on('rotate',paintRose);
map.on('zoomend',restyleForZoom);
function applyOrient(){
  if(oMode===1&&me&&me.hdg!=null) setBearing(-me.hdg);
  else if(oMode===2&&magHeading!=null) setBearing(-(magHeading+declination()));  /* mag -> true */
  paintRose();
}
$('compass').onclick=()=>{
  const b=map.getBearing?map.getBearing():0;
  if(oMode===0&&Math.abs(((b%360)+360)%360)>0.5){ setBearing(0); paintRose(); return toast('North up'); }
  oMode=(oMode+1)%3;
  if(oMode!==2) stopCompass();          /* release the magnetometer on the way out */
  if(oMode===0){ setBearing(0); toast('North up'); }
  else if(oMode===1) toast(me&&me.hdg!=null?'Heading up':'Heading up — start walking for a course');
  else startCompass();
  applyOrient();
};
/* One handler for the life of the page. startCompass() used to close over a
   fresh function on every call, so addEventListener could never dedupe it, and
   there was no removeEventListener anywhere in the file: each visit to COMPASS
   UP added two more permanently-live listeners and the magnetometer was never
   released on the way out. */
let magOn=false;
/* alpha is referenced to the device's NATIVE (portrait) frame, not to however
   the screen is currently rotated. Without the screen angle added back, turning
   the phone sideways -- which this app has a wide layout for -- puts the map,
   the rose and the navigate arrow 90 degrees out. That is four times the
   declination error AUDIT.md records as 128 ft over 500 ft. */
const screenAngle=()=>(screen.orientation&&screen.orientation.angle)||window.orientation||0;
function onOrient(e){
  let hd=null;
  if(e.webkitCompassHeading!=null) hd=e.webkitCompassHeading;
  else if(e.alpha!=null&&(e.absolute||e.type==='deviceorientationabsolute')) hd=360-e.alpha;
  if(hd!=null){ magHeading=((hd+screenAngle())%360+360)%360; if(oMode===2) applyOrient(); }
}
if(screen.orientation&&screen.orientation.addEventListener)
  screen.orientation.addEventListener('change',()=>{ if(oMode===2) applyOrient(); });
const iosOrient=()=>typeof DeviceOrientationEvent!=='undefined'&&DeviceOrientationEvent.requestPermission;
/* A handset with no magnetometer used to sit in COMPASS UP forever: no event
   ever fires, magHeading stays null, applyOrient does nothing, and #cMode still
   reads COMPASS UP over a map left at bearing 0. You sight along the screen and
   walk grid north believing it is your heading. */
let magProbe=0;
function attachCompass(){
  if(magOn) return; magOn=true;
  clearTimeout(magProbe);
  magProbe=setTimeout(()=>{
    if(oMode===2 && magHeading==null){
      oMode=0; stopCompass(); setBearing(0); paintRose();
      toast('No compass on this phone — staying north up');
    }
  },4000);
  window.addEventListener('deviceorientationabsolute',onOrient,true);
  /* plain 'deviceorientation' is relative on Android and every one of its events
     is discarded by the guard above; it is only useful on iOS, which reports an
     absolute webkitCompassHeading through it. */
  if(iosOrient()) window.addEventListener('deviceorientation',onOrient,true);
  toast('Compass up — figure-eight the phone to calibrate');
}
function stopCompass(){
  clearTimeout(magProbe);
  if(!magOn) return; magOn=false;
  window.removeEventListener('deviceorientationabsolute',onOrient,true);
  window.removeEventListener('deviceorientation',onOrient,true);
  magHeading=null;
}
function startCompass(){
  if(iosOrient())
    DeviceOrientationEvent.requestPermission().then(r=>{ if(r==='granted') attachCompass();
      else { oMode=0; setBearing(0); paintRose(); toast('Compass permission denied'); } })
      .catch(()=>{ oMode=0; setBearing(0); paintRose(); toast('Compass unavailable'); });
  else attachCompass();
}
paintRose();

function toast(t){ const el=$('toast'); el.textContent=t; el.classList.add('on');
  clearTimeout(el._h); el._h=setTimeout(()=>el.classList.remove('on'),2600); }
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('on'));
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); $('t-'+b.dataset.t).classList.add('on');
  expand();
  if(b.dataset.t==='mrk') updateNav();
  if(b.dataset.t==='map'){ cacheStats(); paintBackup(); syPaint(); }
  if(b.dataset.t==='go'){ paintTrip(); paintDaylight(); paintCallout(); paintSensors(); }
});
const buzz=ms=>{ if(navigator.vibrate) navigator.vibrate(ms); };
$('bMark').onclick=()=>{ if(!me) return toast('No GPS fix yet'); buzz(14); addMark(me.lat,me.lon); };
$('fAdd').onclick=()=>{                       /* floating primary: mark, or place crosshair */
  if(tapMode){ const c=map.getCenter(); buzz(14); addMark(c.lat,c.lng,{acc:null}); return setTap(false); }
  if(!me) return toast('No GPS fix yet');
  buzz(14); addMark(me.lat,me.lon);
};
$('fCen').onclick=()=>{ buzz(8); me?map.setView([me.lat,me.lon],19):toast('No GPS fix yet'); };
$('bAvg').onclick=()=>avg.start('mark');
$('aStop').onclick=()=>{ avg.stop(); $('avgBox').style.display='none'; toast('Cancelled'); };
$('aSave').onclick=()=>{ const m=avg.mean(); if(!m) return toast('No samples');
  addMark(m.lat,m.lon,{n:m.n,rms:m.rms,acc:m.acc}); $('avgBox').style.display='none'; };
$('bCenter').onclick=()=>{ me?map.setView([me.lat,me.lon],19):toast('No GPS fix yet'); };
$('fAvg').onclick=()=>avg.start('fit');
$('fApply').onclick=applyFit;
$('fClear').onclick=()=>{ shift={dLat:0,dLon:0,tie:null,dE:0,dN:0}; store.set('fm_shift','null');
  drawParcel(); paintFit(); paintRel(); reanchorNav(); toast('Shift cleared'); };
$('bTrk').onclick=()=>{
  if(trk.on){ trk.stop(); toast('Track stopped — save or discard'); return; }
  /* the old build zeroed pts unconditionally: one tap and the morning was gone */
  if(trk.pts.length>1 && !confirm('Discard the unsaved track ('+trk.pts.length+' points)?')) return;
  trk.start();
};
$('kSave').onclick=()=>{ if(trk.pts.length<2) return toast('Track too short');
  dl('field-track.geojson',JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',
    geometry:{type:'LineString',coordinates:trk.pts.map(p=>[p.lon,p.lat])},
    properties:{distance_ft:+trk.dist.toFixed(0),points:trk.pts.length,
      started:new Date(trk.t0).toISOString()}}]},null,2),'application/geo+json');
  trk.forget(); };
$('kDrop').onclick=()=>{
  if(trk.pts.length>1 && !confirm('Discard this track ('+trk.pts.length+' points)? There is no undo.')) return;
  trk.stop(); if(trk.line) map.removeLayer(trk.line);
  trk.pts=[]; trk.dist=0; trk.moving=0;   /* moving was left set, so Trip reported minutes against no distance */
  trk.forget(); $('trkBox').style.display='none'; toast('Track discarded'); };

let tapMode=false;
function setTap(on){
  tapMode=on;
  $('xh').classList.toggle('on',on);
  $('bTap').textContent=on?'Cancel placing':'Tap to mark';
  $('bTap').classList.toggle('pri',on);
  $('fAdd').classList.toggle('on',on);
  if(on){ setSheet(PEEK,true); toast('Pan the map, then press the orange button'); }
}
$('bTap').onclick=()=>setTap(!tapMode);

/* ══════════════════════════════════════════════════════════════
   BOTTOM SHEET — three snap points, velocity aware. Drag the whole
   header, or pull down from the top of any scrolled tab. Starts
   collapsed so the map gets the screen.
   ══════════════════════════════════════════════════════════════ */
/* peek == exactly the header, measured rather than guessed, so the collapsed
   sheet ends cleanly on the tab underline instead of slicing a button in half */
let PEEK=112;
function measurePeek(){
  const hd=$('head'); if(!hd) return;
  const sa=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab'))||0;
  PEEK=Math.round(hd.getBoundingClientRect().height + sa);
}
const snaps=()=>[PEEK, Math.round(innerHeight*0.52), Math.round(innerHeight*0.88)];
let sheetH=PEEK, sheetAnim=null;
function setSheet(px,anim){
  const s=snaps();
  sheetH=Math.min(Math.max(px,PEEK), s[2]);
  const p=$('panel');
  p.style.transition = anim?'height .24s cubic-bezier(.22,.61,.36,1)':'none';
  document.documentElement.style.setProperty('--panelH', sheetH+'px');
  document.documentElement.style.setProperty('--fabB', (sheetH+16)+'px');
  clearTimeout(sheetAnim);
  sheetAnim=setTimeout(()=>map.invalidateSize(), anim?260:0);
}
function snapTo(h,v){
  const s=snaps();
  let t;
  if(Math.abs(v)>0.45){                       // flick: go one stop in that direction
    t = v<0 ? (s.find(x=>x>h+6) ?? s[2]) : ([...s].reverse().find(x=>x<h-6) ?? s[0]);
  } else {                                    // slow drag: nearest stop
    t = s.reduce((a,b)=>Math.abs(b-h)<Math.abs(a-h)?b:a);
  }
  setSheet(t,true);
  if(navigator.vibrate) navigator.vibrate(8);
}
const expand=()=>{ if(sheetH<snaps()[1]-10) setSheet(snaps()[1],true); };

(function(){
  let sy=0, sh0=0, lastY=0, lastT=0, vel=0, dragging=false, armed=false, tabEl=null, pending=false;
  const yOf=e=>e.touches?e.touches[0].clientY:e.clientY;

  /* A tap is not a drag. Claiming the gesture on touchstart meant the very first
     touchmove -- and a finger always produces one, nobody lands perfectly still --
     called preventDefault(), which cancels the click the tab buttons are wired to.
     The tabs live inside #head, so on a phone the whole tray took no taps at all
     while testing fine under a mouse, which never sends touchmove. Wait for real
     movement before claiming the gesture. */
  const SLOP=6;
  function begin(e){ sy=lastY=yOf(e); lastT=Date.now(); sh0=sheetH; vel=0;
                     pending=true; dragging=false; }
  function move(e){
    if(!dragging){
      if(!pending) return;
      if(Math.abs(yOf(e)-sy)<SLOP) return;   // still a tap; leave the click alone
      dragging=true; $('panel').style.transition='none';
    }
    const y=yOf(e), now=Date.now(), dt=Math.max(now-lastT,1);
    vel=(y-lastY)/dt; lastY=y; lastT=now;
    setSheet(sh0+(sy-y), false);
    if(e.cancelable) e.preventDefault();
  }
  function end(){ pending=false; if(!dragging) return; dragging=false; snapTo(sheetH, vel); }

  const head=$('head');
  head.addEventListener('touchstart', begin, {passive:true});
  head.addEventListener('touchmove',  move,  {passive:false});
  head.addEventListener('touchend',   end);
  head.addEventListener('mousedown',  e=>{begin(e); e.preventDefault();});
  window.addEventListener('mousemove', e=>{ if(dragging) move(e); });
  window.addEventListener('mouseup',   end);

  /* pull-down-to-collapse from content, but only when it's already at the top
     so normal scrolling is never hijacked */
  document.querySelectorAll('.tab').forEach(t=>{
    t.addEventListener('touchstart', e=>{ armed = t.scrollTop<=0; tabEl=t; sy=lastY=yOf(e);
      lastT=Date.now(); sh0=sheetH; }, {passive:true});
    t.addEventListener('touchmove', e=>{
      if(!armed) return;
      const y=yOf(e);
      if(!dragging){
        if(y-sy > 12 && tabEl.scrollTop<=0){ dragging=true; $('panel').style.transition='none'; }
        else if(y-sy < -4){ armed=false; }
        return;
      }
      move(e);
    }, {passive:false});
    t.addEventListener('touchend', ()=>{ armed=false; end(); });
  });
})();
measurePeek(); setSheet(PEEK,false);
addEventListener('resize',()=>{ const wasPeek=sheetH<=PEEK+4; measurePeek();
  setSheet(wasPeek?PEEK:Math.min(sheetH,snaps()[2]),false); });

fillPointSelects(); paintMeasure();
openDB().then(async()=>{
  /* Caches written before the getTileUrl zoom fix hold real imagery of the wrong
     place under every key deeper than the zoom it was cached at. There is no way
     to tell a poisoned tile from a good one, so drop the store once. */
  if(store.get('fm_tilez')!=='2'){
    try{ await idbClear('tiles'); }catch(e){}
    store.set('fm_tilez','2');
  }
  if(clockBehind()){
    $('bTitle').textContent='This phone’s clock is wrong';
    $('bBody').innerHTML='The clock reads earlier than marks you already have — usually a flat '
      +'battery in the cold. Marks are still recorded in the right order, but <b>sunset and export '
      +'dates will be wrong</b> until it corrects itself in coverage.';
    $('block').classList.add('on');
  }
  drawMarks(); renderList(); cacheStats(); paintBackup();

  /* Recover a track the browser was killed in the middle of. Restored stopped,
     not resumed: the points and the way back are what matter, and silently
     re-arming a recording the user did not ask for is worse than a toast.
     18 hours so yesterday's forgotten track cannot reappear on a new trip. */
  try{
    const t=await idbGet('tracks',TRK_KEY);
    if(t && t.pts && t.pts.length>1 && Date.now()-t.t0 < 18*3600e3){
      trk.pts=t.pts; trk.dist=t.dist||0; trk.moving=t.moving||0; trk.t0=t.t0; trk.on=false;
      if(trk.line) map.removeLayer(trk.line);
      trk.line=L.polyline(trk.pts.map(q=>[q.lat,q.lon]),
        {renderer:canvasR,color:'#B08CFF',weight:3*zScale(),opacity:.9}).addTo(map);
      trk.line._bW=3;
      $('trkBox').style.display='block';
      $('kDist').textContent=trk.dist.toFixed(0)+' ft ('+(trk.dist/5280).toFixed(2)+' mi)';
      $('kPts').textContent=trk.pts.length+' pts / '+((Date.now()-trk.t0)/60000).toFixed(0)+' min';
      toast('Recovered an unsaved track — '+trk.pts.length+' points');
    } else if(t) { trk.forget(); }
  }catch(e){}
  HASS = await detectHass();
  if(HASS){ SY.auto=true; }
  syPaint(); syLabel();
  if(SY.auto&&syReady()&&navigator.onLine) setTimeout(()=>syncNow(true),1500);
  /* Reclaim blobs left behind by earlier deletes. Gated on the mark list having
     actually parsed: an unreadable fm_marks used to mean "every photo is
     orphaned", escalating "marks are missing" into "marks are missing and every
     photo is destroyed" — and photos never sync, so that is terminal. */
  try{
    if(marksLoaded && marks.length){
      const keys=await idbKeys('photos')||[];
      const used=new Set(marks.flatMap(m=>m.photos||[]));
      let freed=0;
      for(const k of keys) if(!used.has(k)){ await idbDel('photos',k); freed++; }
      if(freed) console.info('reclaimed '+freed+' orphaned photos');
    }
  }catch(e){}
});
setTimeout(()=>{ try{ map.fitBounds(groups.p1.getLayers()[0].getBounds().pad(0.18)); }catch(e){} },300);
