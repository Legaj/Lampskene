self.window=self;
importScripts('map-utils.js?v=9','vendor/polygon-clipping-0.15.7.js','landmark-replacements.js?v=9');
let footprints=null;
self.onmessage=event=>{
  const {id,groups}=event.data;if(event.data.footprints)footprints=event.data.footprints;
  try{self.postMessage({id,results:groups.map(features=>lampskeneLandmarkReplacements.build(features,footprints))});}
  catch(error){self.postMessage({id,error:error.message});}
};
