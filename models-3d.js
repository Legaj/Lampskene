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
  function explorer(point,mode,variant,heading){
    const features=[];
    const box=(p,length,width,base,height,color)=>features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[geo.vehicleFootprint(p,heading,length,width)]},properties:{base,height,color}});
    const offset=(along,side=0)=>geo.destination(geo.destination(point,Math.abs(along),heading+(along<0?180:0)),Math.abs(side),heading+(side<0?-90:90));
    if(mode==='walk'){
      for(const side of [-.17,.17]){box(offset(0,side),.28,.22,0,.12,'#27313b');box(offset(0,side),.20,.18,.12,.85,'#385d9b');}
      box(point,.35,.60,.80,1.4,'#f2b51d');box(offset(0,.4),.20,.17,.9,1.35,'#efbf94');box(offset(0,-.4),.20,.17,.9,1.35,'#efbf94');
      box(point,.32,.34,1.42,1.76,'#efbf94');box(offset(-.03),.34,.36,1.70,1.81,'#4a3431');
    }else if(mode==='boat'){
      box(point,7,2.6,.1,.75,'#f6f1df');box(point,6.6,2.3,.75,.9,'#255b85');box(offset(-1),2.8,1.9,.9,1.8,'#fff9e9');box(offset(.45),.12,1.8,1,1.7,'#244b60');box(offset(-1),2.9,2.0,1.8,1.95,'#cf7350');
    }else{
      const van=variant==='van',sport=variant==='sport',length=van?5.4:sport?4.5:4,width=van?2:1.85,top=van?2.3:sport?1.2:1.55,color=van?'#f1d16c':sport?'#e34a42':'#368fd3';
      box(point,length,width,.30,.9,color);box(offset(van?-.7:-.2),length*(van?.6:.52),width-.13,.9,top,'#244755');box(offset(van?-.7:-.2),length*(van?.59:.5),width-.14,top,top+.09,color);
      for(const along of [-length*.31,length*.31])for(const side of [-1,1])box(offset(along,side*width/2),.65,.23,.08,.65,'#242a32');
      for(const side of [-1,1]){box(offset(length/2-.05,side*width*.32),.15,.35,.5,.72,'#fff2b0');box(offset(-length/2+.05,side*width*.32),.15,.35,.5,.72,'#ba272c');}
    }
    return {type:'FeatureCollection',features};
  }
  window.lampskeneModels={vehicle,explorer};
})();
