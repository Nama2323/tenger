# three.js (vendored, trimmed)

`three-tenger.min.js` is three.js **0.187.0** (npm package `three`, MIT licence, see `LICENSE`), cut down to the
classes the 3D home scene uses (`static/js/space3d.js`) and minified once. The site itself has no build step: this
file is served as an ES module and loaded only after the page is usable, and only when the 3D view is chosen.

| | Bytes |
|---|---:|
| `three-tenger.min.js` | 575,037 (141,716 gzip -9) |
| For comparison, the package's `build/three.core.js` + `build/three.module.js` | 2,133,699 (unminified) |

SHA-256 `55e2eeb64416a39239b29739ae16b33b1e823be8d78efd66981294f88886641d` (15 Nov 2026).

## How it was made

In an empty folder outside the repository:

```bash
npm install three@0.187.0 esbuild@0.25.12
```

`three-tenger-entry.js`:

```js
export {
  AdditiveBlending, BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, Line,
  LineBasicMaterial, LineDashedMaterial, LineLoop, Mesh, MeshBasicMaterial, PerspectiveCamera, Points,
  PointsMaterial, Raycaster, RingGeometry, Scene, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderer, REVISION,
} from 'three';
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
```

```bash
npx esbuild three-tenger-entry.js --bundle --format=esm --minify --legal-comments=inline --target=es2020 --outfile=three-tenger.min.js
```

The three.js licence header is kept inline at the top of the file. When `space3d.js` needs another class, add it to
the entry list, rebuild, and update the size and hash above.
