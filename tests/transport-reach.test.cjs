const {test}=require('node:test'),assert=require('node:assert/strict');
const reach=require('../transport-reach.js'),geo=require('../map-utils.js');
const start=Date.parse('2026-10-26T08:00:00Z');
const stop=(id,minutes,extra={})=>({id,name:id,coord:[59.34,18.05],arrivalTimePlanned:new Date(start+minutes*60000).toISOString(),...extra});
const journey=(stops,extra={})=>({legs:[{origin:{departureTimePlanned:new Date(start+5*60000).toISOString()},transportation:{product:{class:2},disassembledName:'18'},stopSequence:stops}],...extra});

test('SL query keeps coordinates, selected Stockholm clock time and local traffic restrictions',()=>{
  const url=new URL(reach.slQuery({lat:59.34,lng:18.05},{lat:59.32,lng:18.06},'2026-10-26','09:00'));
  assert.equal(url.hostname,'journeyplanner.integration.sl.se');
  assert.equal(url.searchParams.get('name_origin'),'18.050000:59.340000:WGS84[dd.ddddd]');
  assert.equal(url.searchParams.get('itd_date'),'20261026');assert.equal(url.searchParams.get('itd_time'),'0900');
  assert.equal(url.searchParams.get('calc_one_direction'),'true');assert.equal(url.searchParams.get('incl_mot_14'),'false');
  assert.throws(()=>reach.slQuery({lat:91,lng:18},{lat:59,lng:18},'2026-10-26','09:00'));
});
test('SL reach counts the initial wait, excludes late stops and deduplicates earliest arrival',()=>{
  const result=reach.slReachStops({journeys:[journey([stop('A',25),stop('B',31)]),journey([stop('A',20)])]},start,30);
  assert.equal(result.length,1);assert.equal(result[0].minutes,20);assert.equal(result[0].line,'18');
});
test('SL reach rejects invalid coordinates, cancelled trips and trips that depart before the chosen time',()=>{
  const early=journey([stop('early',5)]);early.legs[0].origin.departureTimePlanned=new Date(start-60000).toISOString();
  const data={journeys:[early,journey([stop('cancelled',10)],{cancelled:true}),journey([stop('invalid',10,{coord:[18,590]})]),journey([stop('valid',30)])]};
  assert.deepEqual(reach.slReachStops(data,start,30).map(s=>s.id),['valid']);
  assert.throws(()=>reach.slReachStops({},start,30));
});
test('reach uses absolute timestamps over midnight and prefers updated arrival predictions',()=>{
  const midnight=Date.parse('2026-10-25T22:50:00Z'),trip=journey([stop('A',10)]);
  trip.legs[0].origin.departureTimePlanned='2026-10-25T22:55:00Z';
  trip.legs[0].stopSequence=[stop('A',10,{arrivalTimePlanned:'2026-10-25T23:10:00Z',arrivalTimeEstimated:'2026-10-25T23:15:00Z'})];
  assert.equal(reach.slReachStops({journeys:[trip]},midnight,30)[0].minutes,25);
});
test('sampled targets cover every direction without querying a full station matrix',()=>{
  const origin={lat:59.34,lng:18.05},places=Array.from({length:32},(_,i)=>({...geo.destination(origin,10000+i*500,i*360/32),name:'Stop '+i}));
  const targets=reach.selectTargets(origin,30,places);assert.equal(targets.length,8);assert.ok(targets.every(geo.validPoint));
  assert.equal(new Set(targets.map(p=>Math.floor((geo.bearing(origin,p)+22.5)%360/45))).size,8);
});
test('TravelTime request asks for a dated public transport area with an explicit limit',()=>{
  const data=reach.timeMapRequest({lat:59.34,lng:18.05},start,30);
  const search=data.departure_searches[0];assert.equal(search.departure_time,'2026-10-26T08:00:00.000Z');
  assert.equal(search.travel_time,1800);assert.equal(search.transportation.type,'public_transport');
  assert.throws(()=>reach.timeMapRequest({lat:59.34,lng:18.05},NaN,30));
});
test('TravelTime areas preserve holes and reject non-map and invalid responses',()=>{
  const outer=[[18,59],[19,59],[19,60],[18,60],[18,59]],hole=[[18.2,59.2],[18.4,59.2],[18.4,59.4],[18.2,59.4],[18.2,59.2]];
  const raw={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[outer,hole]},properties:{html:'<script>'}}]};
  const normalized=reach.normalizeArea(raw);assert.deepEqual(normalized.features[0].geometry.coordinates,[outer,hole]);assert.equal(normalized.features[0].properties.html,undefined);
  assert.throws(()=>reach.normalizeArea({results:[]}));
  assert.throws(()=>reach.normalizeArea({type:'FeatureCollection',features:[{geometry:{type:'Polygon',coordinates:[[[18,999],[19,59],[19,60],[18,999]]]}}]}));
});
