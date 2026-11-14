// The 3D home scene (three.js, loaded lazily by main.js after the page is usable). Positions come from orbits.js
// (planets today, JPL approximate elements) and from static/data/scene3d.json (Pluto and Makemake from JPL
// Horizons and SBDB, star directions from Gaia/SIMBAD, Planet Nine ranges from the papers). Distances use the
// labelled log scale of orbits.js; object sizes are exaggerated. The canvas is decoration for sighted mouse,
// touch and keyboard-on-canvas users: the Targets list stays the accessible path, so the canvas is aria-hidden.
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, CSS2DObject, CSS2DRenderer, DoubleSide, Float32BufferAttribute,
  Line, LineBasicMaterial, LineDashedMaterial, LineLoop, Mesh, MeshBasicMaterial, OrbitControls, PerspectiveCamera,
  Points, PointsMaterial, Raycaster, RingGeometry, Scene, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderer,
} from '../vendor/three/three-tenger.min.js';
import {
  equatorialToEcliptic, julianDate, kuiperBelt, orbitPoints, planetNineRanges, planetPosition, PLANETS,
  scalePosition, scaledRadius,
} from './orbits.js';

const FLIGHT_MS = 1400;
const INTRO_MS = 1200;
const SLOW_FRAME_MS = 60;
const MIN_FRAMES_TO_JUDGE = 10;
const CLICK_SLOP_PX = 6;
const MAX_PIXEL_RATIO = 2;
const REFERENCE_RINGS_AU = [1, 10, 100, 1000];
// Stars sit on a shell the camera never leaves, so they read as the sky seen from the Solar System.
const STAR_SHELL = 150;
const END_ON_COSINE = Math.cos((20 * Math.PI) / 180);
const SIGHTLINE_START = scaledRadius(1000) + 2;
const SIGHTLINE_LABEL = scaledRadius(1000) + 4;
const MAX_CAMERA_DISTANCE = 115;
/**
 * The opening viewpoint, in ecliptic longitude/latitude (degrees) and scene units. Chosen (for the 14 Nov 2026
 * scene file) so that no target star's direction points at or away from the camera (all at least 57° off the line
 * of sight) and neither Pluto nor Makemake sits between the camera and the Sun (both more than 85° off).
 */
const HOME_VIEW = { longitude: 25, latitude: 40, distance: 86 };
const BACKGROUND_STARS = 1600;
const BELT_POINTS = 1400;
/** Exaggerated radii in scene units (the scene's 10 units are one decade of distance). */
const SIZE = {
  sun: 0.9, mercury: 0.17, venus: 0.27, earth: 0.29, mars: 0.21, jupiter: 0.6, saturn: 0.52, uranus: 0.38, neptune: 0.38, dwarf: 0.24,
};
/** Planet tints (display only). Orbit lines, labels and targets use the design tokens. */
const PLANET_TINT = {
  mercury: '#b9bec8', venus: '#e9dbb4', earth: '#5cc8ff', mars: '#e48d6c', jupiter: '#e4caa2', saturn: '#e9d7aa', uranus: '#a9e2e7', neptune: '#7ea9ff',
};

/** Ecliptic (x toward the equinox, z to ecliptic north) → three.js (y up). */
const toScene = ([x, y, z]) => new Vector3(x, z, -y);
const sceneAt = (au) => toScene(scalePosition(au));
const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const fromEcliptic = ({ longitude, latitude, distance }) => {
  const [l, b] = [longitude * Math.PI / 180, latitude * Math.PI / 180];
  return toScene([Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)]).multiplyScalar(distance);
};
const easeInOut = (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);

function rendererName(renderer) {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    return '';
  }
}

function glowTexture(color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.18, color);
  gradient.addColorStop(0.42, `${color}66`);
  gradient.addColorStop(1, `${color}00`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function glow(color, scale, opacity = 1) {
  const sprite = new Sprite(new SpriteMaterial({ map: glowTexture(color), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  sprite.scale.set(scale, scale, 1);
  return sprite;
}

function ball(radius, color) {
  return new Mesh(new SphereGeometry(radius, 24, 16), new MeshBasicMaterial({ color }));
}

function loop(points, material) {
  const geometry = new BufferGeometry().setFromPoints(points);
  const line = new LineLoop(geometry, material);
  if (material.isLineDashedMaterial) line.computeLineDistances();
  return line;
}

function circle(radius, material, segments = 256) {
  return loop(Array.from({ length: segments }, (_, index) => {
    const angle = (2 * Math.PI * index) / segments;
    return new Vector3(radius * Math.cos(angle), 0, -radius * Math.sin(angle));
  }), material);
}

function pointCloud(positions, material) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions.flatMap((vector) => [vector.x, vector.y, vector.z]), 3));
  return new Points(geometry, material);
}

/**
 * Builds the scene into `host`. Options: scene (scene3d.json or null), date, nameOf(key), labelOf(kind, values),
 * reducedMotion, insetLeft() (px of the host covered on the left, so the Sun sits in the free area),
 * onPick(key), onHud({ target }), onSlow(). Returns the controller, or { unavailable } when WebGL fails.
 */
export function createSpace(host, options) {
  const { scene: data, date = new Date(), nameOf, labelOf, reducedMotion = false } = options;
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return { unavailable: 'webgl' };
  }
  // Software WebGL (SwiftShader, llvmpipe) draws this scene too slowly for a phone-class CPU: 2D map instead,
  // unless the visitor switched 3D on themselves.
  if (!options.allowSoftware && /swiftshader|llvmpipe|software/i.test(rendererName(renderer))) {
    renderer.dispose();
    return { unavailable: 'slow' };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.classList.add('space-canvas');
  const labels = new CSS2DRenderer();
  labels.domElement.classList.add('space-labels');
  labels.domElement.setAttribute('aria-hidden', 'true');
  host.append(renderer.domElement, labels.domElement);

  const accent = token('--accent', '#5cc8ff');
  const colours = {
    star: token('--star', '#ffe08a'), variable: token('--variable', '#c9a0ff'), solar: token('--solar', '#5cc8ff'),
    hypothetical: token('--hypothetical', '#ffa94d'), other: token('--other', '#c8d2e3'), muted: token('--muted', '#8d9bb0'),
  };
  const world = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.05, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.2;
  controls.maxDistance = MAX_CAMERA_DISTANCE;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.9;
  const pickable = [];
  const starLabels = [];
  const places = new Map();

  function label(text, className, position, { key = null } = {}) {
    const node = document.createElement('div');
    node.className = `space-label ${className}`;
    node.textContent = text;
    if (key) {
      node.dataset.key = key;
      node.addEventListener('click', () => options.onPick?.(key));
    }
    const object = new CSS2DObject(node);
    object.position.copy(position);
    object.center.set(-0.08, 0.5);
    world.add(object);
    return object;
  }

  function place(key, position, { reach, name, pick = true, star = false }) {
    places.set(key, { position, reach, name, star });
    if (!pick) return;
    const hit = new Mesh(new SphereGeometry(1, 8, 6), new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.copy(position);
    hit.scale.setScalar(Math.max(reach * 0.5, 0.9));
    hit.userData.key = key;
    world.add(hit);
    pickable.push(hit);
  }

  // ---------- Background stars (decoration) ----------
  const random = (() => {
    let seed = 7;
    return () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
  })();
  const sky = Array.from({ length: BACKGROUND_STARS }, () => {
    const z = 2 * random() - 1;
    const angle = 2 * Math.PI * random();
    const radius = Math.sqrt(1 - z * z);
    return new Vector3(radius * Math.cos(angle), z, radius * Math.sin(angle)).multiplyScalar(900);
  });
  world.add(pointCloud(sky, new PointsMaterial({ color: colours.other, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.5, depthWrite: false })));

  // ---------- Sun ----------
  world.add(ball(SIZE.sun, '#fff3c4'), glow('#ffd77a', 9, 0.9), glow('#fff3c4', 3.2));
  places.set('sun', { position: new Vector3(), reach: 6, name: labelOf('sun') });
  label(labelOf('sun'), 'is-sun', new Vector3(0, -1.6, 0));

  // ---------- Reference rings for the log scale ----------
  const ringMaterial = new LineBasicMaterial({ color: accent, transparent: true, opacity: 0.12 });
  for (const au of REFERENCE_RINGS_AU) {
    const radius = scaledRadius(au);
    world.add(circle(radius, ringMaterial));
    label(labelOf('ring', { value: new Intl.NumberFormat('en').format(au) }), 'is-ring', new Vector3(radius * Math.cos(5.2), 0, -radius * Math.sin(5.2)));
  }

  // ---------- Planets today ----------
  const jd = julianDate(date);
  const orbitMaterial = new LineBasicMaterial({ color: accent, transparent: true, opacity: 0.32 });
  for (const planet of PLANETS) {
    world.add(loop(orbitPoints(planet, jd, 256).map(sceneAt), orbitMaterial));
    const position = sceneAt(planetPosition(planet, jd));
    const body = ball(SIZE[planet], PLANET_TINT[planet]);
    body.position.copy(position);
    world.add(body);
    if (planet === 'saturn') {
      const rings = new Mesh(new RingGeometry(SIZE.saturn * 1.35, SIZE.saturn * 2.1, 48), new MeshBasicMaterial({ color: PLANET_TINT.saturn, side: DoubleSide, transparent: true, opacity: 0.55 }));
      rings.position.copy(position);
      rings.rotation.x = -Math.PI / 2 + 0.47;
      world.add(rings);
    }
    if (planet === 'earth') {
      const halo = glow(accent, 1.4, 0.8);
      halo.position.copy(position);
      world.add(halo);
    }
    const name = labelOf(`planet.${planet}`);
    label(name, planet === 'earth' ? 'is-earth' : 'is-planet', position);
    place(planet, position, { reach: 2.5, name, pick: false });
  }

  // ---------- Kuiper Belt (illustration) ----------
  world.add(pointCloud(kuiperBelt(BELT_POINTS).map(sceneAt), new PointsMaterial({ color: colours.solar, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.32, depthWrite: false })));
  const beltLabelRadius = scaledRadius(40);
  label(labelOf('kuiper'), 'is-note', new Vector3(beltLabelRadius * Math.cos(2.4), 0.8, -beltLabelRadius * Math.sin(2.4)));

  // ---------- Pluto and Makemake (scene3d.json) ----------
  for (const key of ['pluto', 'makemake']) {
    const body = data?.bodies?.[key];
    const now = body?.position_now?.position_au;
    if (!Array.isArray(now)) continue;
    const orbit = body.catalogue_orbit?.orbit_points_au;
    if (Array.isArray(orbit) && orbit.length > 8) {
      world.add(loop(orbit.map(sceneAt), new LineBasicMaterial({ color: colours.solar, transparent: true, opacity: 0.55 })));
    }
    const position = sceneAt(now);
    const dot = ball(SIZE.dwarf, colours.solar);
    dot.position.copy(position);
    const halo = glow(colours.solar, 1.5, 0.9);
    halo.position.copy(position);
    world.add(dot, halo);
    const name = nameOf(key) ?? key;
    label(name, 'is-target colour-solar', position, { key });
    place(key, position, { reach: 3.2, name });
  }

  // ---------- Planet Nine: faint shaded rings for the published ranges; no point, no orbit line ----------
  const ranges = planetNineRanges(data?.planet_nine);
  const orange = colours.hypothetical;
  for (const range of ranges) {
    const ring = new Mesh(
      new RingGeometry(scaledRadius(range.low), scaledRadius(range.high), 192, 1),
      new MeshBasicMaterial({ color: orange, transparent: true, opacity: 0.045, side: DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    world.add(ring);
  }
  const ninePlace = scaledRadius(ranges.length ? Math.max(...ranges.map((range) => range.high)) : 500);
  const cited = ranges.map((range) => labelOf('planetNineRange', { low: String(range.low), high: String(range.high), reference: range.reference })).join('; ');
  label(ranges.length ? labelOf('planetNineRanges', { ranges: cited }) : labelOf('planetNine'), 'is-hypothetical', new Vector3(ninePlace * Math.cos(3.6), 0, -ninePlace * Math.sin(3.6)));

  // ---------- Target stars: real directions, on an outer shell ----------
  // A dashed sightline runs from just outside the drawn Solar System toward each star, with the label on its
  // near part, so every direction shows from the default view; the star itself glows where the line ends.
  for (const star of data?.stars ?? []) {
    if (!Array.isArray(star.direction_icrs)) continue;
    const direction = toScene(equatorialToEcliptic(star.direction_icrs)).normalize();
    const position = direction.clone().multiplyScalar(STAR_SHELL);
    const variable = ['rwaur', 'rdra'].includes(star.key);
    const colour = variable ? colours.variable : colours.star;
    const sprite = glow(colour, 5.5);
    sprite.position.copy(position);
    const line = new Line(
      new BufferGeometry().setFromPoints([direction.clone().multiplyScalar(SIGHTLINE_START), position]),
      new LineDashedMaterial({ color: colour, dashSize: 1.2, gapSize: 1.6, transparent: true, opacity: 0.4 }),
    );
    line.computeLineDistances();
    world.add(sprite, line);
    const name = nameOf(star.key) ?? star.key;
    const tag = label(labelOf('star', { name, distance: options.distanceOf?.(star) ?? '' }), `is-target colour-${variable ? 'variable' : 'star'}`, direction.clone().multiplyScalar(SIGHTLINE_LABEL), { key: star.key });
    starLabels.push({ tag, direction: direction.clone() });
    place(star.key, position, { reach: 6, name, star: true });
  }

  // ---------- Camera, views and flights ----------
  const views = {
    // Portrait screens need more distance to fit the same width of the Solar System.
    get home() {
      const distance = Math.min(MAX_CAMERA_DISTANCE - 3, HOME_VIEW.distance * Math.max(1, 1.2 / (camera.aspect || 1)));
      return { position: fromEcliptic({ ...HOME_VIEW, distance }), target: new Vector3(0, 0, 0), name: labelOf('sun') };
    },
    top: { position: new Vector3(0, 96, 0.001), target: new Vector3(0, 0, 0), name: labelOf('sun') },
  };
  controls.target.set(0, 0, 0);
  let frame = 0;
  let flight = null;
  let currentName = views.home.name;
  const frameTimes = [];
  let judging = !reducedMotion;
  let alive = true;

  function viewFor(key) {
    const spot = places.get(key);
    if (!spot) return null;
    if (spot.star) {
      // Look from behind the Sun toward the star: the Solar System in front, the star's direction ahead.
      const direction = spot.position.clone().normalize();
      // The target is on the line to the star (closer than the shell), so the controls' distance limit holds.
      const position = direction.clone().multiplyScalar(-34).add(new Vector3(0, 9, 0));
      return { position, target: direction.clone().multiplyScalar(24), name: spot.name };
    }
    // Outside the body's orbit, off to one side and above, so the Sun and the orbit stay in view beside it.
    const outward = spot.position.lengthSq() ? spot.position.clone().normalize() : new Vector3(0, 0, 1);
    // The side offset puts the Sun to the right of the body (the left of the scene sits under the search console).
    const side = outward.clone().cross(new Vector3(0, 1, 0)).normalize();
    const distance = spot.reach * 3.4;
    const position = spot.position.clone()
      .add(outward.multiplyScalar(distance))
      .add(side.multiplyScalar(distance * 0.35))
      .add(new Vector3(0, distance * 0.45, 0));
    return { position, target: spot.position.clone(), name: spot.name };
  }

  const viewDirection = new Vector3();
  function render() {
    // A star whose direction points (almost) straight at or away from the camera would put its label on the Sun.
    viewDirection.subVectors(controls.target, camera.position).normalize();
    for (const { tag, direction } of starLabels) tag.element.classList.toggle('is-end-on', Math.abs(viewDirection.dot(direction)) > END_ON_COSINE);
    renderer.render(world, camera);
    labels.render(world, camera);
  }

  function tick(now) {
    frame = 0;
    if (!alive) return;
    if (judging) {
      frameTimes.push(now);
      if (frameTimes.length > MIN_FRAMES_TO_JUDGE && !flight) {
        judging = false;
        const gaps = frameTimes.slice(1).map((time, index) => time - frameTimes[index]).sort((a, b) => a - b);
        if (gaps[Math.floor(gaps.length / 2)] > SLOW_FRAME_MS) {
          options.onSlow?.();
          return;
        }
      }
    }
    let again = false;
    if (flight) {
      const k = Math.min(1, (now - flight.start) / flight.duration);
      const eased = easeInOut(k);
      camera.position.lerpVectors(flight.from.position, flight.to.position, eased);
      controls.target.lerpVectors(flight.from.target, flight.to.target, eased);
      if (k >= 1) {
        const done = flight.then;
        flight = null;
        controls.enabled = true;
        done?.();
      } else {
        again = true;
      }
    }
    again = controls.update() || again;
    render();
    if (again || judging) requestRender();
  }

  function requestRender() {
    if (!frame && alive) frame = requestAnimationFrame(tick);
  }

  function go(view, { then = null, duration = FLIGHT_MS } = {}) {
    if (!view) return false;
    currentName = view.name;
    options.onHud?.({ target: currentName });
    if (reducedMotion || duration === 0) {
      flight = null;
      camera.position.copy(view.position);
      controls.target.copy(view.target);
      controls.update();
      render();
      then?.();
      return true;
    }
    controls.enabled = false;
    flight = { start: performance.now(), duration, from: { position: camera.position.clone(), target: controls.target.clone() }, to: view, then };
    requestRender();
    return true;
  }

  // ---------- Size and the free area beside the left console ----------
  function resize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    labels.setSize(width, height);
    // In the phone layout the page scrolls past the scene: a vertical swipe scrolls, a sideways drag turns, a pinch zooms.
    renderer.domElement.style.touchAction = matchMedia('(max-width: 900px)').matches ? 'pan-y' : 'none';
    camera.aspect = width / height;
    const left = Math.min(options.insetLeft?.() ?? 0, width * 0.6);
    if (left > 0) camera.setViewOffset(width, height, -left / 2, 0, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    requestRender();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  // ---------- Picking (a click, not the end of a drag) ----------
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let downAt = null;
  const hitAt = (event) => {
    const box = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(pickable, false)[0]?.object.userData.key ?? null;
  };
  renderer.domElement.addEventListener('pointerdown', (event) => {
    downAt = { x: event.clientX, y: event.clientY };
  });
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > CLICK_SLOP_PX) return;
    downAt = null;
    const key = hitAt(event);
    if (key) options.onPick?.(key);
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (event.buttons) return;
    renderer.domElement.style.cursor = hitAt(event) ? 'pointer' : '';
  });
  controls.addEventListener('change', requestRender);
  controls.addEventListener('start', () => {
    flight = null;
    controls.enabled = true;
  });

  resize();
  // An opening dolly from farther out; its frame times also tell whether this device copes.
  camera.position.copy(views.home.position).multiplyScalar(reducedMotion ? 1 : 1.3).clampLength(0, MAX_CAMERA_DISTANCE);
  go(views.home, { duration: reducedMotion ? 0 : INTRO_MS });
  options.onHud?.({ target: currentName });

  return {
    has: (key) => places.has(key),
    flyTo: (key, { then = null } = {}) => go(viewFor(key), { then }),
    reset: () => go(views.home),
    top: () => go(views.top),
    render: requestRender,
    resize,
    dispose() {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}
