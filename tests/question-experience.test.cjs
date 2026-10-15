const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadQuestions(questions) {
  const context = vm.createContext({
    questions,
    window: {},
    document: { getElementById() { return null; }, addEventListener() {} },
    requestAnimationFrame() { return 1; },
    validQuestionPoint(lat, lng) { return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180; },
    // Any access to the private location is a regression, even when no marker
    // would ultimately be returned by the public export.
    getActiveHiderPin() { throw new Error('Private hiding location was accessed'); },
    hiderPin: { getLatLng() { throw new Error('Private hiding location was accessed'); } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'question-experience.js'), 'utf8'), context);
  return context.window.lampskeneQuestions;
}

test('public question pins export all five geometries without exporting hiding positions', () => {
  const api = loadQuestions([
    { id: 1, type: 'radar', lat: 59.31, lng: 18.01 },
    { id: 2, type: 'thermo', latA: 59.32, lngA: 18.02, latB: 59.33, lngB: 18.03 },
    { id: 3, type: 'matching', hiderMode: true, seekerLat: 59.34, seekerLng: 18.04, lat: 60.123456, lng: 19.654321 },
    { id: 4, type: 'measuring', hiderMode: true, seekerLat: 59.35, seekerLng: 18.05, lat: 60.123456, lng: 19.654321 },
    { id: 5, type: 'angle', center: { lat: 59.36, lng: 18.06 }, direction: { lat: 59.37, lng: 18.07 } },
    { id: 6, type: 'hider', lat: 60.123456, lng: 19.654321 },
    { id: 7, type: 'endgame', lat: 60.123456, lng: 19.654321 },
  ]);
  const pins = JSON.parse(JSON.stringify(api.publicPins()));
  assert.equal(pins.length, 7);
  assert.deepEqual(pins.map(pin => pin.pin), ['radar', 'thermoA', 'thermoB', 'matching', 'measuring', 'angleCenter', 'angleDirection']);
  assert.equal(pins.find(pin => pin.id === 3).lat, 59.34);
  assert.equal(pins.find(pin => pin.id === 4).lng, 18.05);
  assert.ok(pins.every(pin => /^#[a-f\d]{6}$/i.test(pin.color)));
  assert.ok(!JSON.stringify(pins).includes('60.123456'));
  assert.ok(!JSON.stringify(pins).includes('19.654321'));
});

test('public pin export rejects invalid coordinates and never falls back to private legacy fields', () => {
  const api = loadQuestions([
    { id: 1, type: 'radar', lat: 91, lng: 18 },
    { id: 2, type: 'matching', hiderMode: true, lat: 60.123456, lng: 19.654321 },
    { id: 3, type: 'measuring', hiderMode: true, seekerLat: null, seekerLng: null, lat: 60.123456, lng: 19.654321 },
    { id: 4, type: 'angle', center: { lat: NaN, lng: 18 }, direction: { lat: 59.3, lng: 181 } },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(api.publicPins())), []);
});
