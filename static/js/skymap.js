// Task B36: the all-sky "Sky map" (our own view, opened from Home). Aladin Lite (CDS) shows IRSA's official SPHEREx
// DR1 all-sky survey, live; if that cannot be reached, 2MASS, labelled as such. Markers for the Famous targets (their
// colours) and the "More to explore" objects open Investigate; an empty-sky click says what the public site can do.
// Constellation lines (d3-celestial, BSD-3) are an optional guide. Loaded only when opened: Home's speed is unchanged.
import { $ } from './dom.js';
import { t } from './i18n.js';

const ALADIN_URL = 'https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js';
/** IRSA's SPHEREx DR1 all-sky data cube (ivo://IPAC/P/SPHEREx/DR1/cube), served with cross-origin access. */
export const SPHEREX_HIPS = 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube';
/** The CDS 2MASS colour survey as mirrored by IRSA: the fallback, labelled "2MASS, not SPHEREx". */
export const TWOMASS_HIPS = 'https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/Color';
const LINES_URL = 'https://cdn.jsdelivr.net/npm/d3-celestial@0.7.35/data/constellations.lines.json';
const NAMES_URL = 'https://cdn.jsdelivr.net/npm/d3-celestial@0.7.35/data/constellations.json';
/** Task B40: the map opens on the chosen target with about a 60° field, like a planetarium. */
export const OPEN_FOV = 60;
const FLY_SECONDS = 1.5;
/** The Fly to chips, in this order (the 3D-less targets that have a sky position). */
export const FLY_KEYS = ['barnard', 'epsindib', 'wise0855', 'rwaur', 'rdra', 'pluto'];
const PROBE_MS = 3000;
const FIRST_SLICE = 1;
const COLOURS = { star: '#ffe08a', variable: '#c9a0ff', solar: '#5cc8ff', hypothetical: '#ffa94d', other: '#e6edf7' };

/** Right ascension 0–360° from a d3-celestial longitude (−180…180). Pure. */
export const raOf = (lon) => ((lon % 360) + 360) % 360;

/** "RA 266.4167°, Dec −29.0078°" for the empty-sky note. Pure. */
export function formatRaDec(ra, dec) {
  const fixed = (value) => value.toFixed(4);
  return { ra: fixed(raOf(ra)), dec: `${dec < 0 ? '−' : '+'}${fixed(Math.abs(dec))}` };
}

async function reachable(url) {
  try {
    const response = await fetch(`${url}/properties`, { signal: AbortSignal.timeout(PROBE_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

let state = null;

/**
 * Opens the map. markers: [{ key, name, ra, dec, colour }]; onOpen(key) opens Investigate for a marker; onClose()
 * when the map closes. Returns once the map is drawn (or says why it cannot be).
 */
export async function openSkyMap({ markers, onOpen, onClose, focus = 'barnard' }) {
  const panel = $('skymap');
  panel.hidden = false;
  const centreOf = (key) => markers.find((marker) => marker.key === key) ?? markers.find((marker) => marker.key === 'barnard') ?? markers[0];
  if (state?.map) {
    const at = centreOf(focus);
    if (at) { state.map.gotoRaDec(at.ra, at.dec); state.map.setFoV(OPEN_FOV); }
  }
  document.body.classList.add('skymap-open');
  $('skymap-close').focus({ preventScroll: true });
  if (state) return state.ready;
  state = { onOpen, onClose, lines: null, linesOn: false };
  const close = () => {
    panel.hidden = true;
    document.body.classList.remove('skymap-open');
    $('skymap-note').hidden = true;
    state.onClose?.();
  };
  $('skymap-close').addEventListener('click', close);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });
  state.ready = (async () => {
    $('skymap-status').textContent = t('skymap.loading');
    // The survey check runs while the library loads, so the map opens within a few seconds either way.
    const probe = reachable(SPHEREX_HIPS);
    let A;
    try {
      A = (await import(ALADIN_URL)).default;
      await A.init;
    } catch (error) {
      console.warn('The sky map library could not load:', error);
      $('skymap-status').textContent = t('skymap.unavailable');
      return;
    }
    const spherex = await probe;
    $('skymap-source').textContent = t(spherex ? 'skymap.sourceSpherex' : 'skymap.source2mass');
    // The SPHEREx survey is a cube of 102 wavelengths; IRSA serves its tiles from the first slice, so the layer
    // starts there (Aladin would ask for the middle slice, which IRSA does not serve).
    const base = A.imageHiPS(spherex ? SPHEREX_HIPS : TWOMASS_HIPS, { name: spherex ? 'SPHEREx DR1' : '2MASS' });
    if (spherex) base.setSliceNumber?.(FIRST_SLICE);
    const map = A.aladin('#skymap-view', {
      survey: base, fov: OPEN_FOV, projection: 'SIN', cooFrame: 'ICRSd', target: `${centreOf(focus)?.ra ?? 0} ${centreOf(focus)?.dec ?? 0}`, log: false,
      showReticle: false, showCooLocation: false, showFov: false, showContextMenu: false, showStatusBar: false,
      showCooGrid: false, showFullscreenControl: false, showLayersControl: false, showGotoControl: false,
      showSimbadPointerControl: false, showShareControl: false, showProjectionControl: false, showFrame: false,
      showZoomControl: true,
    });
    state.map = map;
    if (spherex) {
      for (let tries = 0; tries < 60 && !base.added; tries += 1) await new Promise((resolve) => setTimeout(resolve, 50));
      base.setSliceNumber?.(FIRST_SLICE);
    }
    // Markers: one catalogue per colour, each source carrying its key; labels in the target's colour.
    const byColour = new Map();
    for (const marker of markers) byColour.set(marker.colour, [...(byColour.get(marker.colour) ?? []), marker]);
    for (const [colour, members] of byColour) {
      const hex = COLOURS[colour] ?? COLOURS.other;
      const catalog = A.catalog({ name: colour, color: hex, sourceSize: 14, shape: 'circle', displayLabel: true, labelColumn: 'name', labelColor: hex, labelFont: '600 13px sans-serif' });
      map.addCatalog(catalog);
      catalog.addSources(members.map((marker) => A.source(marker.ra, marker.dec, { key: marker.key, name: marker.name })));
    }
    let objectAt = 0;
    map.on('objectClicked', (object) => {
      const key = object?.data?.key;
      if (!key) return;
      objectAt = performance.now();
      close();
      state.onOpen(key);
    });
    map.on('click', (event) => {
      if (event?.ra === undefined || event.isDragging) return;
      // A click on a marker also reaches here: give the marker a moment to claim it.
      setTimeout(() => {
        if (performance.now() - objectAt < 400) return;
        const where = formatRaDec(event.ra, event.dec);
        $('skymap-note').textContent = t('skymap.empty', where);
        $('skymap-note').hidden = false;
      }, 60);
    });
    $('skymap-status').textContent = '';
    state.A = A;
    // Where the view points and how wide, bottom-left (task B40).
    const readout = () => {
      const [ra, dec] = map.getRaDec();
      const where = formatRaDec(ra, dec);
      $('skymap-readout').textContent = t('skymap.readout', { ...where, fov: String(Math.round(map.getFov()[0])) });
    };
    map.on('positionChanged', readout);
    map.on('zoomChanged', readout);
    readout();
    // Fly to chips: a smooth pan to each target.
    $('skymap-fly').replaceChildren(...FLY_KEYS.map((key) => markers.find((marker) => marker.key === key)).filter(Boolean).map((marker) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'filter-chip skymap-chip-fly';
      chip.dataset.key = marker.key;
      chip.textContent = marker.name;
      chip.addEventListener('click', () => {
        map.animateToRaDec(marker.ra, marker.dec, FLY_SECONDS);
        $('skymap-note').hidden = true;
      });
      return chip;
    }));
    // Constellation lines and names on by default (the switch turns both off and on).
    await setConstellationLines(true);
  })();
  return state.ready;
}

/** Where a sky position is drawn in the map, in page pixels (null before the map is ready). */
export function skyMapPixel(ra, dec) {
  const at = state?.map?.world2pix?.(ra, dec);
  if (!at) return null;
  const box = $('skymap-view').getBoundingClientRect();
  return [box.left + at[0], box.top + at[1]];
}

/** Turns the view to a position and field of view (degrees). */
export function skyMapGoTo(ra, dec, fov) {
  state?.map?.gotoRaDec(ra, dec);
  if (fov) state?.map?.setFoV(fov);
}

/** Constellation lines on or off (fetched the first time they are switched on). */
export async function setConstellationLines(on) {
  if (!state?.map || !state.A) return false;
  state.linesOn = on;
  if (on && !state.lines) {
    try {
      const response = await fetch(LINES_URL);
      const doc = response.ok ? await response.json() : null;
      const overlay = state.A.graphicOverlay({ color: 'rgba(200, 220, 255, 0.55)', lineWidth: 1 });
      state.map.addOverlay(overlay);
      for (const feature of doc?.features ?? []) {
        for (const line of feature.geometry?.coordinates ?? []) overlay.add(state.A.polyline(line.map(([lon, lat]) => [raOf(lon), lat])));
      }
      state.lines = overlay;
      // Names at each constellation's label point, small and faint (task B40).
      const names = await fetch(NAMES_URL).then((answer) => (answer.ok ? answer.json() : null)).catch(() => null);
      if (names?.features?.length) {
        const catalog = state.A.catalog({ name: 'constellations', color: 'rgba(0, 0, 0, 0)', sourceSize: 1, displayLabel: true, labelColumn: 'name', labelColor: 'rgba(200, 220, 255, 0.7)', labelFont: 'italic 12px sans-serif' });
        state.map.addCatalog(catalog);
        catalog.addSources(names.features.map((feature) => state.A.source(raOf(feature.geometry.coordinates[0]), feature.geometry.coordinates[1], { name: feature.properties.name })));
        state.names = catalog;
      }
    } catch (error) {
      console.warn('Constellation lines could not load:', error);
      return false;
    }
  }
  if (state.lines) (on ? state.lines.show() : state.lines.hide());
  if (state.names) (on ? state.names.show() : state.names.hide());
  return true;
}
