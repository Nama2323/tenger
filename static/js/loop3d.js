// "Why Pluto loops" in 3D (three.js). Real heliocentric positions (au) for the Sun, Pluto and the telescope, except
// that SPHEREx's orbit is drawn EXAGGERATION times larger (labelled): each sight line runs from the drawn telescope
// through Pluto's real position to a sky sphere, where the sight lines trace the apparent loop. The 2D chart on the
// same page shows the real loop at true scale.
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, CSS2DObject, CSS2DRenderer, Float32BufferAttribute, Line,
  LineBasicMaterial, LineDashedMaterial, LineLoop, Mesh, MeshBasicMaterial, OrbitControls, PerspectiveCamera, Points,
  PointsMaterial, Scene, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, WebGLRenderer,
} from '../vendor/three/three-tenger.min.js';
import { drawnObserver, drawnSightline, EXAGGERATION, observerAt, timeline } from './loop.js';

const SKY_RADIUS = 160;
const MAX_PIXEL_RATIO = 2;
const FLIGHT_MS = 1100;

const toScene = ([x, y, z]) => new Vector3(x, z, -y);
const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const easeInOut = (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);

function glow(color, size, opacity = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.25, color);
  gradient.addColorStop(1, `${color}00`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  sprite.scale.set(size, size, 1);
  return sprite;
}

const lineOf = (points, material, Kind = Line) => {
  const line = new Kind(new BufferGeometry().setFromPoints(points), material);
  if (material.isLineDashedMaterial) line.computeLineDistances();
  return line;
};

function dots(points, color, size) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points.flatMap((point) => [point.x, point.y, point.z]), 3));
  return new Points(geometry, new PointsMaterial({ color, size, sizeAttenuation: false, transparent: true, depthWrite: false }));
}

/**
 * Builds the scene in `host`. model: loopModel(); labelOf(key, values); reducedMotion; onTime(mjd) is not needed,
 * the page calls setTime. Returns the controller, or { unavailable } when WebGL cannot start.
 */
export function createLoopScene(host, { model, labelOf, reducedMotion = false, allowSoftware = false }) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return { unavailable: 'webgl' };
  }
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererName = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  if (!allowSoftware && /swiftshader|llvmpipe|software/i.test(rendererName)) {
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

  const colour = {
    accent: token('--accent', '#5cc8ff'), star: token('--star', '#ffe08a'), solar: token('--solar', '#5cc8ff'), miss: token('--miss', '#ffb547'),
    variable: token('--variable', '#c9a0ff'), other: token('--other', '#c8d2e3'), muted: token('--muted', '#8d9bb0'), hit: token('--hit', '#5fd38d'),
  };
  const world = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.05, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2;
  controls.maxDistance = 400;

  function label(text, className, position) {
    const node = document.createElement('div');
    node.className = `space-label ${className}`;
    node.textContent = text;
    const object = new CSS2DObject(node);
    object.position.copy(position);
    object.center.set(-0.06, 0.5);
    world.add(object);
    return object;
  }

  // ---------- Sun, the telescope's (drawn) orbit and the exposures ----------
  const sun = new Mesh(new SphereGeometry(0.9, 24, 16), new MeshBasicMaterial({ color: '#fff3c4' }));
  world.add(sun, glow('#ffd77a', 7, 0.9));
  label(labelOf('loop.sun'), 'is-sun', new Vector3(0, -1.6, 0));
  const year = timeline(model.start, model.start + 365.25, 3).map((mjd) => toScene(drawnObserver(observerAt(mjd))));
  world.add(lineOf(year, new LineBasicMaterial({ color: colour.accent, transparent: true, opacity: 0.55 }), LineLoop));
  label(labelOf('loop.orbitLabel', { factor: String(EXAGGERATION) }), 'is-earth', year[Math.floor(year.length * 0.62)]);
  world.add(dots(model.training.map((entry) => toScene(drawnObserver(entry.observer))), colour.solar, 7));
  world.add(dots(model.evaluation.map((entry) => toScene(drawnObserver(entry.observer))), colour.miss, 8));

  // ---------- Pluto's path (TENGER's frozen orbit) and the fitted positions ----------
  const path = timeline(model.start, model.end, 4).map((mjd) => toScene(model.orbit(mjd)));
  world.add(lineOf(path, new LineBasicMaterial({ color: colour.solar, transparent: true, opacity: 0.8 })));
  world.add(dots([...model.training, ...model.evaluation].map((entry) => toScene(entry.pluto)), colour.solar, 4));
  label(labelOf('loop.plutoPath'), 'is-planet', path[0]);

  // ---------- Sight lines of the exposures, and the apparent loop on the sky sphere ----------
  const exposureLines = new LineBasicMaterial({ color: colour.other, transparent: true, opacity: 0.09 });
  for (const entry of [...model.training, ...model.evaluation]) {
    const line = drawnSightline(entry.observer, entry.pluto, SKY_RADIUS);
    world.add(lineOf([toScene(line.from), toScene(line.sky)], exposureLines));
  }
  const loopTimes = timeline(model.start, model.end, 2);
  const skyPoints = loopTimes.map((mjd) => toScene(drawnSightline(observerAt(mjd), model.orbit(mjd), SKY_RADIUS).sky));
  // The whole apparent path faintly (dots every few days, as lines are one pixel wide), and the part up to "now" bright.
  world.add(lineOf(skyPoints, new LineBasicMaterial({ color: colour.accent, transparent: true, opacity: 0.4 })));
  world.add(dots(skyPoints.filter((_, index) => index % 3 === 0), colour.accent, 2.5));
  const done = lineOf(skyPoints, new LineBasicMaterial({ color: '#ffffff' }));
  world.add(done);
  const skyOf = (entry) => toScene(drawnSightline(entry.observer, entry.pluto, SKY_RADIUS).sky);
  world.add(dots(model.training.map(skyOf), colour.solar, 6), dots(model.evaluation.map(skyOf), colour.miss, 7));
  const trainingMid = model.training[Math.floor(model.training.length / 2)];
  if (trainingMid) label(labelOf('loop.trainingLabel'), 'is-note', skyOf(trainingMid).add(new Vector3(0, -4, 0)));

  // ---------- The 2026 check: frozen forecast and observation (5.9″ apart: the inset shows them) ----------
  let checkPoint = null;
  if (model.frozen) {
    checkPoint = skyOf({ observer: model.frozen.observer, pluto: model.frozen.pluto });
    const ring = glow(colour.miss, 3.2);
    ring.position.copy(checkPoint);
    world.add(ring);
    label(labelOf('loop.checkLabel'), 'is-hypothetical', checkPoint.clone().add(new Vector3(0, 4, 0)));
  }

  // ---------- 2027 open forecast tracks (v1 frozen before the miss, v2 after it) ----------
  for (const track of model.tracks) {
    const points = track.points.map((point) => toScene(drawnSightline(point.observer, point.pluto, SKY_RADIUS).sky));
    const material = track.version >= 2
      ? new LineBasicMaterial({ color: colour.variable })
      : new LineDashedMaterial({ color: colour.star, dashSize: 0.8, gapSize: 0.6 });
    world.add(lineOf(points, material), dots(points, track.version >= 2 ? colour.variable : colour.star, 5));
    const end = points.at(-1);
    label(labelOf(track.version >= 2 ? 'loop.v2Label' : 'loop.v1Label', { month: new Date((track.points.at(-1).tMjd - 40587) * 86400000).toISOString().slice(0, 7) }),
      `is-note loop-${track.version >= 2 ? 'v2' : 'v1'}`, end.clone().add(new Vector3(0, track.version >= 2 ? -3.5 : 3.5, 0)));
  }

  // ---------- The moving parts: now ----------
  const telescope = new Mesh(new SphereGeometry(0.45, 16, 12), new MeshBasicMaterial({ color: colour.accent }));
  const telescopeGlow = glow(colour.accent, 2.4, 0.9);
  const pluto = new Mesh(new SphereGeometry(0.6, 20, 14), new MeshBasicMaterial({ color: colour.solar }));
  const plutoGlow = glow(colour.solar, 3, 0.9);
  const nowSky = glow('#ffffff', 2.6);
  const sight = lineOf([new Vector3(), new Vector3()], new LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }));
  // These move with the slider; their first bounding spheres would cull them wrongly later.
  sight.frustumCulled = false;
  done.frustumCulled = false;
  world.add(telescope, telescopeGlow, pluto, plutoGlow, nowSky, sight);
  const telescopeLabel = label(labelOf('loop.spherex'), 'is-target colour-solar', new Vector3());
  const plutoLabel = label(labelOf('loop.pluto'), 'is-target colour-solar', new Vector3());

  // ---------- Camera, rendering and views ----------
  let frame = 0;
  let flight = null;
  let follow = false;
  let current = { observer: [0, 0, 0], pluto: [0, 0, 0], sky: [0, 0, 0] };
  const loopCentre = skyPoints[Math.floor(skyPoints.length / 2)].clone();
  const views = {
    // From behind and a little above the Sun, looking out past Pluto at the loop: the loop is seen nearly face-on,
    // with the Sun and Pluto in front of it and the sight lines fanning out between them.
    overview: () => {
      const along = loopCentre.clone().normalize();
      const side = new Vector3(0, 1, 0).cross(along).normalize();
      const reach = camera.aspect < 1 ? 1.5 : 1;
      const position = along.clone().multiplyScalar(-55 * reach).add(side.multiplyScalar(22 * reach)).add(new Vector3(0, 30 * reach, 0));
      // Aimed a little below the line so the Sun, Pluto and the loop sit in the middle of the frame.
      return { position, target: along.clone().multiplyScalar(SKY_RADIUS * 0.6).add(new Vector3(0, -16 * reach, 0)) };
    },
    top: () => ({ position: new Vector3(0, 230, 0.01), target: new Vector3(0, 0, 0) }),
    spherex: () => {
      const from = toScene(drawnObserver(current.observer));
      const toward = toScene(current.sky).sub(from).normalize();
      // Just ahead of the telescope (so it does not fill the picture), looking along its sight line at the loop.
      return { position: from.clone().add(toward.clone().multiplyScalar(1.5)).add(new Vector3(0, 0.4, 0)), target: from.clone().add(toward.multiplyScalar(80)), fov: 24 };
    },
  };

  function render() {
    renderer.render(world, camera);
    labels.render(world, camera);
  }
  function tick(now) {
    frame = 0;
    let again = false;
    if (flight) {
      const k = Math.min(1, (now - flight.start) / FLIGHT_MS);
      camera.position.lerpVectors(flight.from.position, flight.to.position, easeInOut(k));
      controls.target.lerpVectors(flight.from.target, flight.to.target, easeInOut(k));
      if (k >= 1) {
        flight = null;
        controls.enabled = true;
      } else again = true;
    }
    again = controls.update() || again;
    render();
    if (again) requestRender();
  }
  function requestRender() {
    if (!frame) frame = requestAnimationFrame(tick);
  }
  function go(view, { instant = reducedMotion } = {}) {
    // The SPHEREx view narrows the field of view to the size of the loop; the others use the normal one.
    camera.fov = view.fov ?? 40;
    camera.updateProjectionMatrix();
    if (instant) {
      flight = null;
      camera.position.copy(view.position);
      controls.target.copy(view.target);
      controls.update();
      render();
      return;
    }
    controls.enabled = false;
    flight = { start: performance.now(), from: { position: camera.position.clone(), target: controls.target.clone() }, to: view };
    requestRender();
  }

  /** Moves "now" to mjd: the telescope, Pluto, the sight line and the part of the loop drawn so far. */
  function setTime(mjd) {
    const observer = observerAt(mjd);
    const plutoAt = model.orbit(mjd);
    const line = drawnSightline(observer, plutoAt, SKY_RADIUS);
    current = { observer, pluto: plutoAt, sky: line.sky };
    const [from, through, sky] = [toScene(line.from), toScene(plutoAt), toScene(line.sky)];
    telescope.position.copy(from);
    telescopeGlow.position.copy(from);
    pluto.position.copy(through);
    plutoGlow.position.copy(through);
    nowSky.position.copy(sky);
    telescopeLabel.position.copy(from);
    plutoLabel.position.copy(through);
    sight.geometry.setFromPoints([from, sky]);
    const shown = loopTimes.findIndex((time) => time > mjd);
    done.geometry.setDrawRange(0, shown === -1 ? loopTimes.length : Math.max(1, shown));
    if (follow) go(views.spherex(), { instant: true });
    requestRender();
  }

  function resize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    labels.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  controls.addEventListener('change', requestRender);
  controls.addEventListener('start', () => {
    flight = null;
    follow = false;
    controls.enabled = true;
  });
  resize();
  go(views.overview(), { instant: true });

  return {
    setTime,
    overview: () => {
      follow = false;
      go(views.overview());
    },
    top: () => {
      follow = false;
      go(views.top());
    },
    fromSpherex: () => {
      follow = true;
      go(views.spherex());
    },
    loopCentre,
    checkPoint,
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}

