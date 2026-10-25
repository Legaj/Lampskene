/* Decode and trace elevation contours off the game UI thread. */
importScripts('vendor/maplibre-contour-0.1.0.js');
const cache=new Map();
const coordinate=(x,y,z)=>[x/2**z*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI];
function simplify(points,tolerance=5){
  if(points.length<=4)return points;
  const last=points.length-2,keep=new Set([0,last]),stack=[[0,last]];
  while(stack.length){const [a,b]=stack.pop(),dx=points[b]-points[a],dy=points[b+1]-points[a+1],length=dx*dx+dy*dy;let max=tolerance*tolerance,index=-1;
    for(let i=a+2;i<b;i+=2){const t=length?Math.max(0,Math.min(1,((points[i]-points[a])*dx+(points[i+1]-points[a+1])*dy)/length)):0;const d=(points[i]-points[a]-t*dx)**2+(points[i+1]-points[a+1]-t*dy)**2;if(d>max){max=d;index=i;}}
    if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}
  }
  return [...keep].sort((a,b)=>a-b).flatMap(i=>[points[i],points[i+1]]);
}
async function tile(x,y,z){
  const key=[z,x,y].join('/');if(cache.has(key))return cache.get(key);
  let response;
  for(const url of [`https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`,`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`]){
    try{response=await fetch(url,{signal:AbortSignal.timeout(6500)});if(response.ok)break;}catch(_){}
  }
  if(!response?.ok)throw Error('Elevation tiles unavailable');
  const bitmap=await createImageBitmap(await response.blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'}),width=bitmap.width,height=bitmap.height;
  const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();
  const rgba=ctx.getImageData(0,0,width,height).data,heights=new Float32Array(width*height);
  for(let i=0;i<heights.length;i++){const n=i*4,value=rgba[n]*256+rgba[n+1]+rgba[n+2]/256-32768;heights[i]=rgba[n+3]&&value>-12000&&value<9000?value:NaN;}
  const dem=mlcontour.HeightTile.fromRawDem({width,height,data:heights}),lines=mlcontour.generateIsolines(5,dem,4096,0),features=[];
  for(const [elevation,paths] of Object.entries(lines)){
    const coordinates=paths.filter(p=>p.length>=4).map(p=>{
      const points=simplify(p),coords=[];
      // Traced coordinates span sample centres, rather than the tile edges.
      for(let i=0;i<points.length;i+=2)coords.push(coordinate(x+(points[i]/4096*(width-1)+.5)/width,y+(points[i+1]/4096*(height-1)+.5)/height,z));
      return coords;
    });
    if(coordinates.length)features.push({type:'Feature',geometry:{type:'MultiLineString',coordinates},properties:{ele:Number(elevation),label:elevation+' m',major:Number(elevation)%25===0}});
  }
  cache.set(key,features);if(cache.size>24)cache.delete(cache.keys().next().value);return features;
}
self.onmessage=async event=>{const {id,tiles}=event.data;try{
  const results=[];for(let i=0;i<tiles.length;i+=2)results.push(...await Promise.allSettled(tiles.slice(i,i+2).map(t=>tile(...t))));
  self.postMessage({id,features:results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value),failed:results.filter(r=>r.status==='rejected').length});
}catch(error){self.postMessage({id,error:error.message});}};
