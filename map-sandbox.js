/* Optional cartoon effects. They never edit the game, buildings or saved data. */
(() => {
  'use strict';
  const geo=window.lampskeneGeo,empty=()=>({type:'FeatureCollection',features:[]});
  let frame=null,target=null,last=0;
  function clear(){
    if(frame!==null)cancelAnimationFrame(frame);frame=null;
    if(target===window.lampskene3D?.map)target?.getSource('field-playground')?.setData(empty());
    target=null;
  }
  function shapes(center,kind,t){
    const features=[];
    function disk(radius,base,height,color,offset=0,bearing=0){
      const p=geo.destination(center,offset,bearing),ring=Array.from({length:24},(_,i)=>{const q=geo.destination(p,radius,i*15);return[q.lng,q.lat];});ring.push(ring[0]);
      features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties:{base,height,color}});
    }
    if(t<.9){disk(2,125*(1-t/.9)+3,125*(1-t/.9)+7,'#363640');return{type:'FeatureCollection',features};}
    const age=t-.9,growth=Math.min(1,age/1.5),fade=Math.max(.05,1-Math.max(0,age-4)/3),size=kind==='nuke'?80:kind==='fireworks'?35:20;
    if(kind==='fireworks'){
      for(let i=0;i<18;i++)disk(1.5*fade,10+Math.sin(i)*7+growth*50,13+Math.sin(i)*7+growth*50,['#f56c7c','#ffd661','#74d5d1','#b18bff'][i%4],growth*size,i*137.5);
    }else{
      const radius=size*growth*fade;
      if(age<1.3)disk(Math.max(1,radius*1.2),0,3,'#ffe190');
      for(let i=0;i<7;i++){
        const fraction=(i+.5)/7,r=Math.sqrt(1-(fraction*2-1)**2)*radius;
        disk(Math.max(.7,r),growth*size*.35+i*radius*2/7,growth*size*.35+(i+1)*radius*2/7,i<3?'#ff8d32':'#f9c563');
      }
      if(kind==='nuke'){
        for(let i=0;i<5;i++)disk(Math.max(1,size*.13*growth*fade),i*size*.14*growth,(i+1)*size*.14*growth,'#d9b199');
        for(let i=0;i<8;i++)disk(size*.3*growth*fade,size*.7*growth,size*.98*growth,'#f1c985',size*.65*growth*fade,i*45);
      }
    }
    return{type:'FeatureCollection',features};
  }
  function drop(){
    clear();const gl=window.lampskene3D?.map;if(!gl?.getSource('field-vehicles'))return;
    if(!gl.getSource('field-playground')){
      gl.addSource('field-playground',{type:'geojson',data:empty()});
      gl.addLayer({id:'field-playground-shapes',type:'fill-extrusion',source:'field-playground',paint:{'fill-extrusion-color':['get','color'],'fill-extrusion-base':['get','base'],'fill-extrusion-height':['get','height'],'fill-extrusion-opacity':.88,'fill-extrusion-vertical-gradient':false}});
    }
    window.lampskene3D.stopExploring();if(gl.getZoom()<16.5)gl.easeTo({zoom:16.5,pitch:55,duration:650});
    target=gl;const point=gl.getCenter(),center={lat:point.lat,lng:point.lng},kind=document.getElementById('map3d-effect-kind').value;
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,start=performance.now();last=0;
    const draw=now=>{
      frame=null;if(target!==gl||window.lampskene3D?.map!==gl){target=null;return;}
      const t=(now-start)/1000;if(t>8||document.hidden){clear();return;}
      if(now-last>=80){last=now;gl.getSource('field-playground').setData(shapes(center,kind,reduced?2.5:t));}
      frame=requestAnimationFrame(draw);
    };frame=requestAnimationFrame(draw);
    document.querySelector('#map3d-explorer .map3d-options').open=false;
  }
  const panel=document.createElement('details');panel.className='map3d-playground';
  panel.innerHTML='<summary>Visual playground</summary><label for="map3d-effect-kind">Effect</label><select id="map3d-effect-kind"><option value="bomb">Cartoon bomb</option><option value="nuke">Cartoon nuke</option><option value="fireworks">Fireworks</option></select><div><button type="button" id="map3d-effect-drop">Drop at map center</button><button type="button" id="map3d-effect-clear">Clear</button></div><small>Temporary cartoon effects. Saved games stay as they are.</small>';
  document.querySelector('.map3d-layer-content')?.append(panel);
  document.getElementById('map3d-effect-drop')?.addEventListener('click',drop);document.getElementById('map3d-effect-clear')?.addEventListener('click',clear);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});
  window.lampskenePlayground={drop,clear,shapes};
})();
