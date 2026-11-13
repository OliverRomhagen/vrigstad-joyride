import assert from 'node:assert/strict';
import {streetlightLevel,placeStreetlights} from '../src/game/render/street-lighting.ts';
import {daylightState} from '../src/game/render/solar-clock.ts';
assert.equal(streetlightLevel(13),0);assert.equal(streetlightLevel(18.99),0);
assert.ok(streetlightLevel(19.04)>0);assert.equal(streetlightLevel(22),1);assert.equal(streetlightLevel(4),1);assert.equal(streetlightLevel(6),0);
assert.equal(streetlightLevel(13,2),0,'lights off above horizon');
assert.equal(streetlightLevel(23,-7),1,'lights on below civil twilight');
assert.ok(Math.abs(streetlightLevel(19,-3)-.5)<.0001,'smooth twilight transition');
const roads=[{c:0,p:[[0,0],[200,0]]}],h=()=>0;
const a=placeStreetlights(roads,[8],h,()=>false);
assert.ok(a.length>=3);assert.deepEqual(a,placeStreetlights(roads,[8],h,()=>false));
for(const p of a)assert.ok(Math.abs(p[1])>5);
assert.deepEqual(placeStreetlights(roads,[8],h,()=>true),[]);
assert.deepEqual(placeStreetlights(roads,[8],x=>x*2,()=>false),[]);
for(const time of [13,17,19,20.5,22]){
 const clear=daylightState(time,0,0),cloud=daylightState(time,0,1);
 assert.ok(cloud.strength<=clear.strength);assert.ok(clear.exposure<1.1);
}
console.log('Lighting schedule, placement, slope, cloud and exposure checks passed');
