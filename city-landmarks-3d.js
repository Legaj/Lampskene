/* Original low-poly landmark interpretations over attributed OSM footprints. */
(() => {
  'use strict';
  const geo=window.lampskeneGeo;
  function build(collection){
    const features=[],labels=[];
    for(const f of collection.features){
      const p=f.properties;if(!p.color)continue;
      const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates,center={lng:p.center[0],lat:p.center[1]},tower={lng:p.tower[0],lat:p.tower[1]},h=p.body_height,roof=p.roof_color,cream='#e8d6b5',glass='#345665',bearing=p.bearing||0;
      const common={name:p.name,model:p.model,osm_id:p.osm_id};
      const polygon=(rings,base,height,color)=>features.push({type:'Feature',geometry:{type:'Polygon',coordinates:rings},properties:{...common,base,height,color}});
      const box=(point,len,width,base,height,color,angle=bearing)=>polygon([geo.vehicleFootprint(point,angle,len,width)],base,height,color);
      const offset=(point,d,angle)=>geo.destination(point,d,angle);
      function disk(point,r,base,top,color,sides=16,angle=0){const ring=Array.from({length:sides},(_,i)=>{const q=offset(point,Math.max(.12,r),i*360/sides+angle);return[q.lng,q.lat];});ring.push(ring[0]);polygon([ring],base,top,color);}
      function scaled(poly,factor){return poly.map((ring,i)=>ring.map(([lng,lat])=>[center.lng+(lng-center.lng)*(i?2-factor:factor),center.lat+(lat-center.lat)*(i?2-factor:factor)]));}
      const body=(base,top,color,scale=1)=>polys.forEach(poly=>polygon(scaled(poly,scale),base,top,color));
      function pyramid(point,width,base,top,color,sides=4){for(let i=0;i<8;i++)disk(point,width*(1-i/8)/2,base+(top-base)*i/8,base+(top-base)*(i+1)/8,color,sides,bearing+45);}
      function dome(point,r,base,top,color){for(let i=0;i<9;i++)disk(point,r*Math.sqrt(1-((i+.5)/9)**2),base+(top-base)*i/9,base+(top-base)*(i+1)/9,color);}
      function cross(point,top){box(point,.35,.35,top,top+2.4,'#c5ac65');box(point,.3,2.0,top+1.3,top+1.6,'#c5ac65');}
      function colonnade(side,count,top){
        const ring=polys[0][0],edges=[];
        const signed=ring.slice(0,-1).reduce((sum,a,i)=>{const b=ring[i+1];return sum+a[0]*b[1]-b[0]*a[1];},0);
        for(let i=1;i<ring.length;i++){const a={lng:ring[i-1][0],lat:ring[i-1][1]},b={lng:ring[i][0],lat:ring[i][1]},length=geo.distance(a,b);if(length>=18)edges.push({a,length,angle:geo.bearing(a,b),lng:(a.lng+b.lng)/2});}
        edges.sort((a,b)=>side==='west'?a.lng-b.lng:b.lng-a.lng);const edge=edges[0];if(!edge)return;
        const length=Math.min(40,edge.length-3),start=(edge.length-length)/2,outward=edge.angle+(signed>0?90:-90),middle=offset(offset(edge.a,edge.length/2,edge.angle),.65,outward);
        for(let i=0;i<count;i++){const q=offset(offset(edge.a,start+length*(i+.5)/count,edge.angle),.65,outward);disk(q,.62,2,top,cream,8);}
        box(middle,length+1.4,2.4,top,top+2.2,cream,edge.angle);
      }
      if(p.model==='globe'){
        for(let i=0;i<18;i++){const z=i*85/18,mid=z+85/36,r=Math.sqrt(Math.max(.2,55**2-(mid-30)**2));disk(center,r,z,z+85/18,i%4===0?'#dfe5e6':'#f2f2ed',40);}
        disk(center,6,84,85.3,'#d0dadd');
      }else{
        body(0,h,p.color);body(0,1.8,cream,1.001);body(h-.5,h+.3,cream,1.003);
        const floorCount=Math.min(6,p.floors||3),floorHeight=(h-2)/floorCount;
        for(let i=1;i<floorCount;i++)body(i*floorHeight+1,i*floorHeight+1.35,cream,1.002);
        // Keep facade detail bounded, including at city-wide zoom levels.
        let windows=0;
        for(const poly of polys)for(const ring of poly){
          const signed=ring.slice(0,-1).reduce((s,a,i)=>{const b=ring[i+1];return s+a[0]*b[1]-b[0]*a[1];},0);
          for(let i=1;i<ring.length&&windows<150;i++){
            const a={lng:ring[i-1][0],lat:ring[i-1][1]},b={lng:ring[i][0],lat:ring[i][1]},length=geo.distance(a,b);if(length<7)continue;
            const angle=geo.bearing(a,b),count=Math.min(10,Math.floor(length/7));
            for(let j=0;j<count&&windows<150;j++){
              const point=offset(offset(a,length*(j+.5)/count,angle),.12,angle+(signed>0?90:-90));
              for(let level=0;level<floorCount&&windows<150;level++,windows++)box(point,Math.min(2.2,length/count*.4),.32,2+level*floorHeight,Math.min(h-.7,4.3+level*floorHeight),glass,angle);
            }
          }
        }
        body(h+.3,h+2.1,roof,.99);body(h+2.1,h+3.3,roof,.96);
        if(['palace','parliament','opera','nobility'].includes(p.model)){
          body(h+.1,h+1.0,cream,1.006);body(h+3.3,h+4.1,roof,.90);
          for(const poly of polys){const ring=poly[0];for(let i=1;i<ring.length;i+=Math.max(1,Math.floor(ring.length/8))){const q={lng:ring[i][0],lat:ring[i][1]};box(q,2,2,h+.5,h+3.5,cream);}}
        }
        if(p.model==='cityhall'){
          box(tower,16,16,0,73,p.color);box(tower,18,18,72.4,75,cream);box(tower,13,13,75,87,'#536d62');
          for(const side of [0,90,180,270]){const q=offset(tower,6.55,bearing+side);box(q,4,.35,77,84,'#233d38',bearing+side+90);}
          pyramid(tower,19,87,101,'#5f8172',4);disk(tower,.4,99,106,'#cbb46a',8);
          for(const angle of [0,120,240]){const q=offset(tower,2.8,angle);disk(q,1.6,103,103.5,'#e9c85d',10);for(let j=0;j<5;j++){const tip=offset(q,1.25,j*72);box(tip,.35,.35,103.5,105.2,'#e9c85d');}}
          const moon={lng:18.0544367,lat:59.3271253};disk(moon,4.3,0,29,p.color);dome(moon,5.2,29,46,roof);disk(moon,.35,46,50,'#d0b16e',8);
        }else if(['church','dome','lattice'].includes(p.model)){
          const top=p.height,base=Math.max(h+5,top*.55),width=p.model==='dome'?13:11;
          if(p.model==='dome'){
            disk(tower,width/2,h,base,p.color,12);dome(tower,width*.65,base,top-7,roof);disk(tower,1.5,top-7,top-2,roof,8);cross(tower,top-2);
          }else{
            box(tower,width,width,0,base,p.color);box(tower,width+1,width+1,base-1,base+.4,cream);
            for(const angle of [0,90,180,270])box(offset(tower,width/2+.1,bearing+angle),2,.3,base-9,base-2,glass,bearing+angle+90);
            if(p.model==='lattice'){
              for(let i=0;i<9;i++){const z=base+(top-base-2)*i/9,r=width*.55*(1-i/9);for(const a of [45,135,225,315])box(offset(tower,r,a),.45,.45,z,z+(top-base)/9,roof);disk(tower,r,z,z+.4,roof,4,45);}
            }else pyramid(tower,width+3,base+.4,top-2,roof,8);
            cross(tower,top-2);
          }
        }else if(p.model==='library'){
          disk(center,16.5,h,24,p.color,40);disk(center,17,23.5,24.2,cream,40);disk(center,16,24.2,25,roof,40);
          for(let i=0;i<18;i++)box(offset(center,16.5,i*20),1.4,.3,19.8,22.1,glass,i*20+90);
        }else if(p.model==='concert'){
          colonnade('west',10,22);
        }else if(p.model==='nordic'){
          box(tower,18,19,h,44,p.color);pyramid(tower,22,44,59,roof,4);disk(tower,.6,59,64,'#aa9763',8);
          for(const side of [-1,1]){const q=offset(tower,26,bearing+side*90);disk(q,5,h,35,p.color,8);pyramid(q,13,35,48,roof,8);}
        }else if(p.model==='vasa'){
          for(const distance of [-18,0,18]){const q=offset(center,Math.abs(distance),bearing+(distance<0?180:0));disk(q,.36,h,43,'#8b7460',8);box(q,1,20,34,34.4,'#987e61',bearing);box(q,1,14,39,39.4,'#987e61',bearing);}
        }else if(p.model==='kungstorn'){
          for(let i=0;i<5;i++)body(45+i*2.3,47.3+i*2.3,i<3?p.color:roof,1-i*.12);box(center,9,9,56,p.height,roof);
        }else if(p.model==='opera'){
          dome(center,12,h+3,p.height,roof);disk(center,.8,p.height,p.height+1.3,'#ceb779',8);
        }else if(p.model==='latin'){
          for(const side of [-1,1]){const q=offset(center,24,bearing+side*90);box(q,12,12,h-2,30,p.color);pyramid(q,16,30,34,roof,4);}
        }else if(p.model==='parliament'){
          colonnade('east',8,20);
        }
      }
      labels.push({type:'Feature',geometry:{type:'Point',coordinates:p.center},properties:{...common,label:p.name}});
    }
    return{parts:{type:'FeatureCollection',features},labels:{type:'FeatureCollection',features:labels}};
  }
  window.lampskeneCityLandmarks={build};
})();
