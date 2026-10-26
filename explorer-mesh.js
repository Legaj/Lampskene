/* One small GPU mesh moves with the player. No per-frame GeoJSON retiling. */
(() => {
  'use strict';
  function multiply(a,b){const out=new Float32Array(16);for(let col=0;col<4;col++)for(let row=0;row<4;row++){let sum=0;for(let k=0;k<4;k++)sum+=a[k*4+row]*b[col*4+k];out[col*4+row]=sum;}return out;}
  function vertices(mode,variant){
    const origin=maplibregl.MercatorCoordinate.fromLngLat([0,0]),scale=origin.meterInMercatorCoordinateUnits(),result=[];
    const parts=window.lampskeneModels.explorer({lat:0,lng:0},mode,variant,0).features;
    for(const part of parts){
      const color=part.properties.color.match(/[a-f0-9]{2}/gi).map(v=>parseInt(v,16)/255),ring=part.geometry.coordinates[0].slice(0,-1).map(p=>{const c=maplibregl.MercatorCoordinate.fromLngLat(p);return[(c.x-origin.x)/scale,(c.y-origin.y)/scale];}),{base,height}=part.properties;
      const point=(p,z,shade)=>result.push(p[0],p[1],z,...color.map(c=>c*shade));
      for(let i=1;i<ring.length-1;i++)for(const p of [ring[0],ring[i],ring[i+1]])point(p,height,1);
      for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length],shade=i%2?.70:.86;
        for(const [p,z] of [[a,base],[b,base],[a,height],[a,height],[b,base],[b,height]])point(p,z,shade);
      }
    }
    return new Float32Array(result);
  }
  function create(map){
    let position=null,heading=0,ground=0,key='',bufferData=null,draws=0,uploads=0;
    const layer={id:'field-explorer-mesh',type:'custom',renderingMode:'3d',
      onAdd(_map,gl){
        const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
        const vs=shader(gl.VERTEX_SHADER,'#version 300 es\nprecision highp float;layout(location=0) in vec3 a_position;layout(location=1) in vec3 a_color;uniform mat4 u_matrix;out vec3 v_color;void main(){v_color=a_color;gl_Position=u_matrix*vec4(a_position,1.0);}');
        const fs=shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;in vec3 v_color;out vec4 fragColor;void main(){fragColor=vec4(v_color,1.0);}');
        this.program=gl.createProgram();gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);gl.deleteShader(vs);gl.deleteShader(fs);
        if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));
        this.matrix=gl.getUniformLocation(this.program,'u_matrix');this.buffer=gl.createBuffer();this.vao=gl.createVertexArray();gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
        gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);gl.bindVertexArray(null);
      },
      render(gl,args){
        if(!position||!bufferData)return;
        gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
        if(this.pending){gl.bufferData(gl.ARRAY_BUFFER,bufferData,gl.STATIC_DRAW);this.pending=false;uploads++;}
        const p=maplibregl.MercatorCoordinate.fromLngLat([position.lng,position.lat],ground),s=p.meterInMercatorCoordinateUnits(),a=heading*Math.PI/180,c=Math.cos(a),n=Math.sin(a);
        const model=[s*c,s*n,0,0,-s*n,s*c,0,0,0,0,s,0,p.x,p.y,p.z,1];
        gl.useProgram(this.program);gl.uniformMatrix4fv(this.matrix,false,multiply(args.defaultProjectionData.mainMatrix,model));
        gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.drawArrays(gl.TRIANGLES,0,bufferData.length/6);gl.bindVertexArray(null);draws++;
      },
      onRemove(_map,gl){gl.deleteBuffer(this.buffer);gl.deleteVertexArray(this.vao);gl.deleteProgram(this.program);}
    };
    map.addLayer(layer);
    return {set(point,mode,variant,bearing,elevation){position={...point};heading=bearing;ground=elevation;const next=mode+'/'+variant;if(key!==next){key=next;bufferData=vertices(mode,variant);layer.pending=true;}},clear(){position=null;map.triggerRepaint();},get stats(){return {draws,uploads,vertices:(bufferData?.length||0)/6};}};
  }
  window.lampskeneExplorerMesh={create};
})();
