/* Small, code-built low-poly vehicles. No external model download or tracking changes. */
(() => {
  'use strict';
  const geo=window.lampskeneGeo;
  function vehicle(v,info,heading,detailed=false){
    const type=info.type,length={bus:12,subway:48,train:58,tram:30,light_rail:30,ferry:25}[type]||10;
    const width=type==='ferry'?7:2.8,color=info.color?(/^[0-9a-f]{6}$/i.test(info.color)?'#'+info.color:info.color):type==='bus'?'#df4244':'#4389c6';
    const features=[];
    function box(center,len,w,base,height,fill,label=''){
      features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[geo.vehicleFootprint(center,heading,len,w)]},properties:{id:v.id,line:label,base,height,color:fill}});
    }
    if(!detailed){box(v,length,width,0,type==='ferry'?6:3.4,color,info.line||'');return features;}
    const rail=['subway','train','tram','light_rail'].includes(type),cars=rail?3:1,carLength=length/cars-.6;
    for(let car=0;car<cars;car++){
      const offset=(car-(cars-1)/2)*(length/cars),center=geo.destination(v,Math.abs(offset),heading+(offset<0?180:0));
      box(center,carLength,width,.3,3.2,color,car===cars-1?info.line||'':'');
      box(center,carLength-.4,width-.1,3.2,3.5,'#f0eee5');
      // Dark glazing on both sides, with solid pillars between the windows.
      for(const side of [-1,1])for(let i=0;i<(rail?5:4);i++){
        const along=(i-((rail?5:4)-1)/2)*(carLength/(rail?6:5));
        const p=geo.destination(geo.destination(center,Math.abs(along),heading+(along<0?180:0)),width/2,heading+side*90);
        box(p,carLength/(rail?7:6),.10,1.5,2.85,'#254857');
      }
      const front=geo.destination(center,carLength/2-.15,heading);box(front,.22,width-.25,1.25,2.9,'#254857');
      if(!rail&&type!=='ferry')for(const along of [-carLength*.32,carLength*.32])for(const side of [-1,1]){
        const p=geo.destination(geo.destination(center,Math.abs(along),heading+(along<0?180:0)),width/2,heading+side*90);box(p,.85,.3,.05,.85,'#252b30');
      }
    }
    if(type==='ferry'){box(geo.destination(v,3,heading+180),12,4,3.2,6,'#fff8e5');box(geo.destination(v,2,heading),3,4.2,3.5,5.5,'#214b64');}
    return features;
  }
  window.lampskeneModels={vehicle};
})();
