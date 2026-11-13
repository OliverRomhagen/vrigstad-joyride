import assert from 'node:assert/strict';
import {solarPosition,daylightState,weatherCoverage,createSolarClock,VRIGSTAD} from '../src/game/render/solar-clock.ts';
const deg=x=>x*180/Math.PI;
const summer=solarPosition(13,'2026-06-21'),winter=solarPosition(12,'2026-12-21');
assert.ok(Math.abs(VRIGSTAD.latitude-57.3555)<.00001);
assert.ok(deg(summer.altitude)>54&&deg(summer.altitude)<58,'summer noon around 56 degrees');
assert.ok(deg(winter.altitude)>8&&deg(winter.altitude)<11,'winter noon around 9 degrees');
assert.ok(summer.dz>0,'noon sun south (+Z)');
assert.ok(solarPosition(8,'2026-08-15').dx>0,'morning sun east (+X)');
assert.ok(solarPosition(19,'2026-08-15').dx<0,'evening sun west (-X)');
assert.ok(solarPosition(13,'2026-06-21').altitude>solarPosition(13,'2026-12-21').altitude);
const midday=daylightState(13),dusk=daylightState(20.5),night=daylightState(23);
assert.ok(midday.strength>dusk.strength);
assert.ok(midday.exposure>dusk.exposure);
assert.ok(midday.skyBrightness>dusk.skyBrightness);
assert.equal(night.strength,0);
for(let h=0;h<24;h+=.5){
  const s=daylightState(h,h*10,.5,'2026-08-15');
  for(const k of ['dx','dy','dz','altitude','azimuth','cover','strength','exposure','skyBrightness','twilight'])
    assert.ok(Number.isFinite(s[k]),k);
}
console.log('Geographic solar checks passed');

for(let h=0;h<24;h+=.5){
  const a=weatherCoverage(h,'2026-08-15');
  assert.ok(a>=0&&a<=1,'coverage bounded');
}
assert.ok(Math.abs(weatherCoverage(23.999,'2026-08-15')-weatherCoverage(0,'2026-08-16'))<.002,'weather continuous at midnight');
assert.ok(Math.abs(weatherCoverage(12,'2026-08-15')-weatherCoverage(12,'2026-08-18'))>.001,'weather changes between days');

const spring=createSolarClock('2026-03-29',1.99);
const before=spring.getInstant();spring.advanceHours(.02);
assert.ok(spring.getHour()>3&&spring.getHour()<3.02,'skip nonexistent spring civil hour');
assert.ok(Math.abs(spring.getInstant()-before-72000)<1);
const autumn=createSolarClock('2026-10-25',2.99);autumn.advanceHours(.02);
assert.ok(autumn.getHour()>2&&autumn.getHour()<2.02,'repeat autumn civil hour with continuous instant');
const midnight=createSolarClock('2026-12-31',23.99);midnight.advanceHours(.02);
assert.equal(midnight.getDate(),'2027-01-01');
const bad=createSolarClock('2026-02-30',13);assert.equal(bad.getDate(),'2026-08-15');
console.log('Calendar rollover, invalid date and Stockholm DST checks passed');
