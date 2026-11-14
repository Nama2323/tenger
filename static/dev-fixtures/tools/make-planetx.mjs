// Writes the EXAMPLE files for task B5 until Session A publishes the real ones (shapes: DATA-CONTRACT V12):
//   dev-fixtures/planetx/depth.json          (invented recovery curves, depths, markers and verdicts)
//   dev-fixtures/planetx/hidden-planet.json  (+ two synthetic PNG frames with an artificial moving source)
// Every number and pixel here is invented and every file says "example": true. Never real data.
// Usage: node static/dev-fixtures/tools/make-planetx.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const write = (path, data) => {
  mkdirSync(dirname(join(ROOT, path)), { recursive: true });
  writeFileSync(join(ROOT, path), data);
};

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------- depth.json (invented) ----------
const random = seeded(2026);
const logistic = (mag, m50, width) => 1 / (1 + Math.exp((mag - m50) / width));
const curve = (m50, width) => Array.from({ length: 13 }, (_, index) => {
  const mag = 16 + index * 0.5;
  const injected = 100;
  const recovered = Math.max(0, Math.min(injected, Math.round(logistic(mag, m50, width) * injected + (random() - 0.5) * 6)));
  return { mag_ab: mag, injected, recovered, fraction: recovered / injected };
});
const band = (id, detector, wavelength, published, m50, width) => ({
  id,
  detector,
  wavelength_um: wavelength,
  published_band: published,
  pooled: { curve: curve(m50, width), depth_50_ab: null, depth_90_ab: null },
  fields: [
    { field_key: 'example-field-a', n_exposures: 40, zodi_mjy_sr: 0.3, curve: curve(m50 + 0.2, width), false_detection: { blanks: 200, false: 1, rate: 0.005 } },
    { field_key: 'example-field-b', n_exposures: 40, zodi_mjy_sr: 0.6, curve: curve(m50 - 0.2, width), false_detection: { blanks: 200, false: 2, rate: 0.01 } },
  ],
});
const depth = {
  schema_version: 'tenger.planetx_depth/1',
  example: true,
  artificial: true,
  counts: false,
  note: 'EXAMPLE ONLY: invented numbers for building the page. Not a measurement.',
  method: { single_exposure: true, injections_per_point: 100, mag_step: 0.5, interval_method: 'wilson', confidence: 0.95, detection_rule: { snr_min: 5, max_offset_px: 1 } },
  bands: [band('i', 1, [0.75, 1.09], 'Johnson I (example)', 19.6, 0.32), band('w1', 4, [2.42, 3.82], 'WISE W1 (example)', 19.2, 0.3), band('w2', 6, [4.42, 5.0], 'WISE W2 (example)', 18.3, 0.35)],
  models: [
    { id: 'example-a', reference: 'Example model A (invented)', band_id: 'w2', mag_published: { value: 20.9, system: 'AB' }, vega_to_ab: null, mag_ab: 20.9, note_key: 'planetx.example.model' },
    { id: 'example-b', reference: 'Example model B (invented)', band_id: 'i', mag_published: { value: 21.6, system: 'Vega' }, vega_to_ab: { offset: 0.45, reference: 'example' }, mag_ab: 22.05, note_key: 'planetx.example.model' },
    { id: 'example-c', reference: 'Example model C (invented, qualitative)', band_id: 'w1', mag_ab: null, note_key: 'planetx.example.qualitative' },
  ],
  wise_limit: { band_id: 'w1', mag_vega: 16.0, mag_ab: 18.7, completeness: 0.9, reference: 'Example survey limit (invented)', note_key: 'planetx.example.wise' },
  verdicts: [{ band_id: 'w2', model_id: 'example-a', gap_mag: { value: 2.6, sigma: 0.2 }, verdict_key: 'planetx.example.verdict' }],
  verdict_key: 'planetx.example.verdict',
  mission_sensitivity: { statement_key: 'planetx.example.mission' },
  assumption_keys: ['planetx.example.assume1', 'planetx.example.assume2'],
};
write('planetx/depth.json', `${JSON.stringify(depth, null, 2)}\n`);

// ---------- hidden-planet.json + two synthetic frames (invented) ----------
function png(width, height, grey) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x += 1) raw[y * (width + 1) + 1 + x] = grey[y * width + x];
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const SIZE = 96;
const pixels = seeded(77);
const stars = Array.from({ length: 22 }, () => ({ x: pixels() * SIZE, y: pixels() * SIZE, flux: 40 + pixels() * 200, width: 1.1 + pixels() * 0.6 }));
const planet = [{ frame: 0, x: 38.4, y: 55.2 }, { frame: 1, x: 44.1, y: 52.6 }];
function frame(index) {
  const noise = seeded(100 + index);
  const grey = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let value = 14 + noise() * 10;
      for (const star of stars) value += star.flux * Math.exp(-((x - star.x) ** 2 + (y - star.y) ** 2) / (2 * star.width ** 2));
      const source = planet[index];
      value += 70 * Math.exp(-((x - source.x) ** 2 + (y - source.y) ** 2) / (2 * 1.3 ** 2));
      grey[y * SIZE + x] = Math.min(255, Math.round(value));
    }
  }
  return png(SIZE, SIZE, grey);
}
write('planetx/hidden/example-pair-0.png', frame(0));
write('planetx/hidden/example-pair-1.png', frame(1));
const hidden = {
  schema_version: 'tenger.hidden_planet/1',
  example: true,
  artificial: true,
  counts: false,
  note: 'EXAMPLE ONLY: synthetic frames and an invented artificial source for building the page.',
  pairs: [{
    id: 'example-pair',
    field_key: 'example-field-a',
    band_id: 'w2',
    frames: [
      { path: 'planetx/hidden/example-pair-0.png', t_mjd: 61000.0, pixel_arcsec: 3, width: SIZE, height: SIZE, north_up: true },
      { path: 'planetx/hidden/example-pair-1.png', t_mjd: 61001.0, pixel_arcsec: 3, width: SIZE, height: SIZE, north_up: true },
    ],
    injected: planet,
    injected_mag_ab: 18.0,
    motion_arcsec: 18.8,
    pipeline: { found: true, positions: [{ frame: 0, x: 38.6, y: 55.0, snr: 9.1 }, { frame: 1, x: 44.0, y: 52.9, snr: 8.4 }], rule_key: 'planetx.example.rule' },
    tolerance_px: 3,
  }],
};
write('planetx/hidden-planet.json', `${JSON.stringify(hidden, null, 2)}\n`);
console.log('wrote example planetx/depth.json and planetx/hidden-planet.json');
