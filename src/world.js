import * as THREE from 'three';

// The scene is a small feed-forward network laid out along -Z. Each section of the page is one layer;
// navigating between sections flies the camera through the connections between layers.

export const LAYER_GAP = 42;

const MINT = new THREE.Color('#7ef9d0');
const PINK = new THREE.Color('#ff5fa2');
const AMBER = new THREE.Color('#ffc46b');
const VIOLET = new THREE.Color('#9b8cff');
const ICE = new THREE.Color('#bfe9ff');

export const LAYERS = [
  { key: 'intro', spin: 0, colors: [MINT, ICE] },
  { key: 'about', spin: 1, colors: [PINK, VIOLET] },
  { key: 'projects', spin: -0.5, colors: [MINT, AMBER] },
  { key: 'toolkit', spin: 0.8, colors: [AMBER, PINK] },
  { key: 'now', spin: -1, colors: [VIOLET, MINT] },
  { key: 'contact', spin: 0.4, colors: [PINK, AMBER] },
];
export const LAYER_COUNT = LAYERS.length;

const SPIN_RATE = 0.07; // must match nodeWorld() in COMMON

export function layerCenter(i, out = new THREE.Vector3()) {
  return out.set(Math.sin(i * 1.7) * 6, Math.sin(i * 1.1 + 0.6) * 2.5, -i * LAYER_GAP);
}

// 1 when the camera sits on `layer`, falling smoothly to 0 one layer away.
export function activation(layer, focus) {
  const d = Math.min(1, Math.abs(layer - focus));
  return 1 - d * d * (3 - 2 * d);
}

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- layer shapes

function shape(key) {
  const V = THREE.Vector3;
  const pts = [];
  const links = [];
  const chain = (start, count, closed) => {
    for (let k = 1; k < count; k++) links.push([start + k - 1, start + k]);
    if (closed) links.push([start + count - 1, start]);
  };

  switch (key) {
    case 'intro': {
      // input "pixels"
      const n = 8;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          pts.push(new V((x - 3.5) * 1.3, (y - 3.5) * 1.3, 0));
          const k = y * n + x;
          if (x) links.push([k - 1, k]);
          if (y) links.push([k - n, k]);
        }
      }
      break;
    }
    case 'about': {
      // fibonacci sphere wrapped around the "mind" core
      const n = 150, r = 5.6, ga = Math.PI * (3 - Math.sqrt(5));
      for (let k = 0; k < n; k++) {
        const y = 1 - (k / (n - 1)) * 2;
        const rr = Math.sqrt(1 - y * y);
        pts.push(new V(Math.cos(ga * k) * rr * r, y * r, Math.sin(ga * k) * rr * r));
      }
      const seen = new Set();
      pts.forEach((p, a) => {
        const near = pts
          .map((q, b) => [b, p.distanceToSquared(q)])
          .filter(([b]) => b !== a)
          .sort((u, v) => u[1] - v[1])
          .slice(0, 2);
        for (const [b] of near) {
          const id = a < b ? `${a}-${b}` : `${b}-${a}`;
          if (!seen.has(id)) { seen.add(id); links.push([a, b]); }
        }
      });
      break;
    }
    case 'projects': {
      // two rings floating over the meadow
      const ring = (count, r, y, phase) => {
        const s = pts.length;
        for (let k = 0; k < count; k++) {
          const a = (k / count) * Math.PI * 2 + phase;
          pts.push(new V(Math.cos(a) * r, y, Math.sin(a) * r));
        }
        chain(s, count, true);
        return s;
      };
      const outer = ring(40, 7.4, 0.6, 0);
      const inner = ring(20, 4.2, 2.4, 0.1);
      for (let k = 0; k < 20; k++) links.push([inner + k, outer + k * 2]);
      break;
    }
    case 'toolkit': {
      // (2,3) torus knot
      const n = 180;
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2;
        const r = Math.cos(3 * t) + 2.2;
        pts.push(new V(Math.cos(2 * t) * r * 2.2, Math.sin(2 * t) * r * 2.2, -Math.sin(3 * t) * 2.6));
      }
      chain(0, n, true);
      break;
    }
    case 'now': {
      // double helix
      const n = 60, h = 13, r = 3.2;
      for (let s = 0; s < 2; s++) {
        for (let k = 0; k < n; k++) {
          const t = k / (n - 1);
          const a = t * Math.PI * 4 + s * Math.PI;
          pts.push(new V(Math.cos(a) * r, (t - 0.5) * h, Math.sin(a) * r));
        }
      }
      chain(0, n, false);
      chain(n, n, false);
      for (let k = 0; k < n; k += 3) links.push([k, n + k]);
      break;
    }
    case 'contact': {
      // the output: one bright node and its softmax ring
      pts.push(new V(0, 0, 0));
      const m = 10;
      for (let k = 0; k < m; k++) {
        const a = (k / m) * Math.PI * 2;
        pts.push(new V(Math.cos(a) * 3.4, Math.sin(a) * 3.4, 0));
        links.push([0, k + 1]);
      }
      chain(1, m, true);
      break;
    }
  }
  return { pts, links };
}

// ---------------------------------------------------------------- shaders

const COMMON = /* glsl */ `
  uniform float uTime;
  uniform float uFocus;
  uniform float uLow;
  uniform float uMid;
  uniform float uHigh;
  uniform float uBeat;
  uniform float uFlow;
  uniform float uProj;
  uniform vec3 uPing;
  uniform float uPingT;

  // a ring that expands from the last node someone played
  float ripple(vec3 wp) {
    float age = uTime - uPingT;
    if (age < 0.0 || age > 3.5) return 0.0;
    float d = distance(wp, uPing);
    return exp(-pow(d - age * 9.0, 2.0) * 0.3) * exp(-age * 1.3);
  }

  float activation(float layer) {
    float d = min(1.0, abs(layer - uFocus));
    return 1.0 - d * d * (3.0 - 2.0 * d);
  }

  vec3 nodeWorld(vec3 center, vec3 offset, float spin, float seed, float layer) {
    float a = uTime * ${SPIN_RATE.toFixed(3)} * spin;
    float c = cos(a), s = sin(a);
    vec3 o = vec3(c * offset.x + s * offset.z, offset.y, -s * offset.x + c * offset.z);
    float act = activation(layer);
    float breathe = 1.0 + 0.03 * sin(uTime * 1.3 + seed * 6.2831) + act * (0.07 * uLow + 0.05 * uBeat);
    return center + o * breathe;
  }

  float depthFade(float z) {
    return smoothstep(170.0, 40.0, z) * smoothstep(0.5, 5.0, z);
  }
`;

const NODE_VERT = /* glsl */ `
  attribute vec3 aCenter;
  attribute float aLayer;
  attribute float aSeed;
  attribute float aSpin;
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 wp = nodeWorld(aCenter, position, aSpin, aSeed, aLayer);
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    float depth = -mv.z;
    float act = activation(aLayer);
    // a slow wave radiating out from each layer's center
    float wave = 0.7 + 0.3 * sin(length(position) * 0.9 - uTime * 0.8);
    float rp = ripple(wp);
    float size = aSize * (0.75 + act * 0.6) * (0.9 + 0.2 * wave) * (1.0 + rp * 0.9);
    gl_PointSize = max(size * uProj / depth, 1.0);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vAlpha = (0.12 + act * (0.5 + 0.2 * wave) + rp * 0.7) * depthFade(depth);
  }
`;

const NODE_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = smoothstep(0.14, 0.0, d);
    float glow = pow(1.0 - d * 2.0, 3.0);
    vec3 col = vColor * glow * 0.8 + vec3(1.0) * core * 0.6;
    gl_FragColor = vec4(col, vAlpha);
  }
`;

const EDGE_VERT = /* glsl */ `
  attribute vec3 aCenter;
  attribute float aLayer;
  attribute float aSeed;
  attribute float aSpin;
  attribute vec3 aColor;
  attribute float aT;
  attribute float aPhase;
  attribute vec2 aEdge; // x: source layer, y: 1 for edges between layers, 0 within a layer
  varying float vT;
  varying float vPhase;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFlowT;
  varying float vMask;
  varying float vRipple;

  void main() {
    vec3 wp = nodeWorld(aCenter, position, aSpin, aSeed, aLayer);
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mv;
    vRipple = ripple(wp);
    float act = 1.0 - smoothstep(0.0, 1.3, abs(aEdge.x + 0.5 * aEdge.y - uFocus));
    vT = aT;
    vPhase = aPhase;
    vColor = aColor;
    vAlpha = depthFade(-mv.z) * (0.3 + act);
    vFlowT = uFocus - aEdge.x; // where the camera is along this edge, 0..1
    vMask = aEdge.y;
  }
`;

const EDGE_FRAG = /* glsl */ `
  varying float vT;
  varying float vPhase;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFlowT;
  varying float vMask;
  varying float vRipple;

  void main() {
    // signal packets running source -> destination
    float p = fract(uTime * 0.08 + vPhase);
    float pulse = exp(-pow((vT - p) * 12.0, 2.0));
    // during a transition, a soft wavefront rides along with the camera: the forward pass
    float flow = exp(-pow((vT - vFlowT) * 4.0, 2.0)) * uFlow * vMask;
    float a = vAlpha * (0.04 + pulse * (0.16 + uMid * 0.4) + vRipple * 0.5) + flow * vAlpha * 0.45;
    vec3 col = mix(vColor, vec3(1.0), pulse * 0.2 + flow * 0.25 + vRipple * 0.3);
    gl_FragColor = vec4(col, a);
  }
`;

const MARKER_VERT = /* glsl */ `
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 1.5 * uProj / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const MARKER_FRAG = /* glsl */ `
  uniform float uOpacity;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float ring = smoothstep(0.035, 0.0, abs(d - 0.4));
    gl_FragColor = vec4(vec3(0.85, 1.0, 0.95), ring * uOpacity);
  }
`;

const DUST_VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aSize;
  varying float vA;
  void main() {
    vec3 p = position;
    p.y += sin(uTime * 0.11 + aSeed * 20.0) * 0.8;
    p.x += cos(uTime * 0.07 + aSeed * 13.0) * 0.8;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    gl_PointSize = max(aSize * uProj / depth, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.55 + 0.45 * sin(uTime * 0.25 + aSeed * 31.0);
    vA = tw * smoothstep(190.0, 30.0, depth) * smoothstep(0.5, 3.0, depth) * 0.5;
  }
`;

const DUST_FRAG = /* glsl */ `
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vec3(0.66, 0.64, 0.95), a * vA * 0.55);
  }
`;

const CORE_VERT = /* glsl */ `
  uniform float uAct;
  varying float vN;
  varying float vDepth;
  void main() {
    vec3 n = normalize(position);
    float t = uTime * 0.25;
    float w = sin(n.x * 3.1 + t) * sin(n.y * 2.7 + t * 1.3) * sin(n.z * 3.3 + t * 0.8)
            + 0.5 * sin(n.x * 7.0 - t * 1.7) * sin(n.z * 6.0 + t);
    float disp = w * (0.25 + uLow * 0.8);
    vN = w;
    vec4 mv = modelViewMatrix * vec4(position + n * disp, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const CORE_FRAG = /* glsl */ `
  uniform float uAct;
  varying float vN;
  varying float vDepth;
  void main() {
    vec3 col = mix(vec3(1.0, 0.37, 0.64), vec3(0.6, 0.55, 1.0), vN * 0.5 + 0.5);
    float a = (0.06 + 0.32 * uAct) * depthFade(vDepth);
    gl_FragColor = vec4(col, a);
  }
`;

const BLADE_VERT = /* glsl */ `
  attribute vec4 aBlade; // x, z, height, yaw
  attribute float aSeed;
  uniform vec3 uPointer;
  uniform float uPush;
  varying float vH;
  varying float vSeed;
  varying float vDepth;

  void main() {
    vec3 p = position;
    float h = p.y;
    p.x *= 0.09 * (1.0 - h * 0.92);
    p.y *= aBlade.z;
    float c = cos(aBlade.w), s = sin(aBlade.w);
    p = vec3(c * p.x, p.y, s * p.x);

    vec3 root = vec3(aBlade.x, 0.0, aBlade.y);
    float wave = sin(uTime * 1.1 + root.x * 0.45 + root.z * 0.25) + 0.5 * sin(uTime * 1.8 + root.z * 0.9 + aSeed * 6.0);
    vec2 bend = vec2(0.9, 0.4) * (0.16 + 0.08 * wave + uMid * 0.3);

    // the cursor presses the grass down, a nod to the Grass project
    vec2 d = root.xz - uPointer.xz;
    float push = uPush * smoothstep(3.2, 0.0, length(d));
    bend += normalize(d + 1e-4) * push * 1.5;

    float k = h * h;
    p.xz += bend * k * aBlade.z;
    p.y -= min(length(bend), 1.2) * k * aBlade.z * 0.4;

    vec4 mv = modelViewMatrix * vec4(root + p, 1.0);
    vDepth = -mv.z;
    vH = h;
    vSeed = aSeed;
    gl_Position = projectionMatrix * mv;
  }
`;

const BLADE_FRAG = /* glsl */ `
  uniform float uAct;
  varying float vH;
  varying float vSeed;
  varying float vDepth;
  void main() {
    vec3 base = vec3(0.004, 0.03, 0.025);
    vec3 tip = mix(vec3(0.25, 0.95, 0.68), vec3(1.0, 0.75, 0.35), step(0.93, vSeed));
    vec3 col = mix(base, tip * (0.25 + 0.4 * vSeed), pow(vH, 2.0));
    col *= 0.2 + 0.7 * uAct;
    gl_FragColor = vec4(col * depthFade(vDepth), 1.0);
  }
`;

// ---------------------------------------------------------------- world

export class World {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = {
      uTime: { value: 0 },
      uFocus: { value: 0 },
      uLow: { value: 0 },
      uMid: { value: 0 },
      uHigh: { value: 0 },
      uBeat: { value: 0 },
      uFlow: { value: 0 },
      uProj: { value: 500 },
      uPing: { value: new THREE.Vector3() },
      uPingT: { value: -100 },
    };
    this.centers = LAYERS.map((_, i) => layerCenter(i));
    this.spinGroups = LAYERS.map((L, i) => {
      const g = new THREE.Group();
      g.position.copy(this.centers[i]);
      scene.add(g);
      return g;
    });

    this._buildNetwork();
    this._buildDust();
    this._buildScope();
    this._buildCore();
    this._buildMeadow();
    this._buildRing();
    this._buildMarker();

    this.hover = -1;
    this.markerOpacity = 0;
    this.projected = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.dummy = new THREE.Object3D();
    this.push = 0;
  }

  _shader(vert, frag, extra = {}, opts = {}) {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, ...extra }, // shared uniform objects, so one update drives every material
      vertexShader: COMMON + vert,
      fragmentShader: COMMON + frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      ...opts,
    });
  }

  _buildNetwork() {
    const rand = rng(7);
    const layers = LAYERS.map((L) => shape(L.key));
    const nodes = [];
    const starts = [];

    this.nodes = nodes;
    this.layerRanges = [];
    layers.forEach((ly, i) => {
      starts.push(nodes.length);
      // normalized height/width inside the layer picks the note a node plays
      const ys = ly.pts.map((p) => p.y), xs = ly.pts.map((p) => p.x);
      const [y0, y1, x0, x1] = [Math.min(...ys), Math.max(...ys), Math.min(...xs), Math.max(...xs)];
      this.layerRanges.push([nodes.length, nodes.length + ly.pts.length]);
      const [ca, cb] = LAYERS[i].colors;
      ly.pts.forEach((p, k) => {
        const isOutput = LAYERS[i].key === 'contact' && k === 0;
        const ty = y1 > y0 ? (p.y - y0) / (y1 - y0) : 0.5;
        const tx = x1 > x0 ? (p.x - x0) / (x1 - x0) : 0.5;
        nodes.push({
          layer: i,
          offset: p,
          pitch: ty * 0.75 + tx * 0.25,
          seed: rand(),
          size: isOutput ? 2.2 : 0.3 + rand() * 0.45,
          color: ca.clone().lerp(cb, rand() < 0.3 ? 0.85 : rand() * 0.25),
        });
      });
    });

    // nodes
    {
      const n = nodes.length;
      const pos = new Float32Array(n * 3), center = new Float32Array(n * 3), color = new Float32Array(n * 3);
      const layer = new Float32Array(n), seed = new Float32Array(n), spin = new Float32Array(n), size = new Float32Array(n);
      nodes.forEach((d, k) => {
        d.offset.toArray(pos, k * 3);
        this.centers[d.layer].toArray(center, k * 3);
        d.color.toArray(color, k * 3);
        layer[k] = d.layer; seed[k] = d.seed; spin[k] = LAYERS[d.layer].spin; size[k] = d.size;
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
      geo.setAttribute('aLayer', new THREE.BufferAttribute(layer, 1));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      geo.setAttribute('aSpin', new THREE.BufferAttribute(spin, 1));
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      const pts = new THREE.Points(geo, this._shader(NODE_VERT, NODE_FRAG));
      pts.frustumCulled = false;
      pts.renderOrder = 2;
      this.scene.add(pts);
    }

    // edges: within each layer, then sparse random fan-out between consecutive layers
    const edges = [];
    layers.forEach((ly, i) => ly.links.forEach(([a, b]) => edges.push([starts[i] + a, starts[i] + b, i, 0])));
    for (let i = 0; i < LAYER_COUNT - 1; i++) {
      const aS = starts[i], aN = layers[i].pts.length;
      const bS = starts[i + 1], bN = layers[i + 1].pts.length;
      const fan = aN < 20 ? 8 : 2;
      const reached = new Uint8Array(bN);
      for (let a = 0; a < aN; a++) {
        for (let f = 0; f < fan; f++) {
          const b = Math.floor(rand() * bN);
          reached[b] = 1;
          edges.push([aS + a, bS + b, i, 1]);
        }
      }
      for (let b = 0; b < bN; b++) if (!reached[b]) edges.push([aS + Math.floor(rand() * aN), bS + b, i, 1]);
    }

    {
      const v = edges.length * 2;
      const pos = new Float32Array(v * 3), center = new Float32Array(v * 3), color = new Float32Array(v * 3);
      const layer = new Float32Array(v), seed = new Float32Array(v), spin = new Float32Array(v);
      const tAttr = new Float32Array(v), phase = new Float32Array(v), edge = new Float32Array(v * 2);
      edges.forEach(([a, b, l, mask], e) => {
        const ph = rand();
        [a, b].forEach((nodeIndex, end) => {
          const k = e * 2 + end;
          const d = nodes[nodeIndex];
          d.offset.toArray(pos, k * 3);
          this.centers[d.layer].toArray(center, k * 3);
          d.color.toArray(color, k * 3);
          layer[k] = d.layer; seed[k] = d.seed; spin[k] = LAYERS[d.layer].spin;
          tAttr[k] = end; phase[k] = ph;
          edge[k * 2] = l; edge[k * 2 + 1] = mask;
        });
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
      geo.setAttribute('aLayer', new THREE.BufferAttribute(layer, 1));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      geo.setAttribute('aSpin', new THREE.BufferAttribute(spin, 1));
      geo.setAttribute('aT', new THREE.BufferAttribute(tAttr, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
      geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 2));
      const lines = new THREE.LineSegments(geo, this._shader(EDGE_VERT, EDGE_FRAG));
      lines.frustumCulled = false;
      lines.renderOrder = 1;
      this.scene.add(lines);
    }
  }

  _buildDust() {
    const rand = rng(99);
    const n = 4200;
    const depth = LAYER_GAP * (LAYER_COUNT - 1) + 140;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n), size = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      pos[k * 3] = (rand() - 0.5) * 150;
      pos[k * 3 + 1] = (rand() - 0.5) * 90;
      pos[k * 3 + 2] = 50 - rand() * depth;
      seed[k] = rand();
      size[k] = 0.12 + rand() * rand() * 0.45;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const dust = new THREE.Points(geo, this._shader(DUST_VERT, DUST_FRAG));
    dust.frustumCulled = false;
    this.scene.add(dust);
  }

  _buildScope() {
    // live oscilloscope under the input layer
    this.scopeN = 256;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.scopeN * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.scopeMat = new THREE.LineBasicMaterial({ color: MINT, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
    this.scope = new THREE.Line(geo, this.scopeMat);
    this.scope.frustumCulled = false;
    this.scope.position.set(0, -6.8, 0);
    this.spinGroups[0].add(this.scope);
  }

  _buildCore() {
    const geo = new THREE.IcosahedronGeometry(2.4, 4);
    this.coreMat = this._shader(CORE_VERT, CORE_FRAG, { uAct: { value: 0 } }, { wireframe: true });
    this.core = new THREE.Mesh(geo, this.coreMat);
    this.spinGroups[1].add(this.core);
  }

  _buildMeadow() {
    const rand = rng(3);
    const count = 6000, radius = 8;
    const base = new THREE.PlaneGeometry(1, 1, 1, 5);
    base.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.instanceCount = count;
    const blade = new Float32Array(count * 4), seed = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      const r = Math.sqrt(rand()) * radius, a = rand() * Math.PI * 2;
      const edge = 1 - Math.pow(r / radius, 3);
      blade[k * 4] = Math.cos(a) * r;
      blade[k * 4 + 1] = Math.sin(a) * r;
      blade[k * 4 + 2] = (0.5 + rand() * 1.1) * (0.35 + 0.65 * edge);
      blade[k * 4 + 3] = rand() * Math.PI;
      seed[k] = rand();
    }
    geo.setAttribute('aBlade', new THREE.InstancedBufferAttribute(blade, 4));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    this.meadowMat = this._shader(
      BLADE_VERT,
      BLADE_FRAG,
      { uAct: { value: 0 }, uPointer: { value: new THREE.Vector3(999, 0, 999) }, uPush: { value: 0 } },
      { transparent: false, depthWrite: true, blending: THREE.NormalBlending, side: THREE.DoubleSide },
    );
    this.meadow = new THREE.Mesh(geo, this.meadowMat);
    this.meadow.frustumCulled = false;
    this.meadow.position.set(0, -4.2, 0);
    this.spinGroups[2].add(this.meadow);
  }

  _buildRing() {
    // spectrum analyser wrapped around the output node
    this.bars = 96;
    const geo = new THREE.BoxGeometry(0.14, 1, 0.14);
    geo.translate(0, 0.5, 0);
    this.ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.ring = new THREE.InstancedMesh(geo, this.ringMat, this.bars);
    this.ring.frustumCulled = false;
    const c = new THREE.Color();
    for (let k = 0; k < this.bars; k++) {
      const m = Math.abs((k / this.bars) * 2 - 1);
      this.ring.setColorAt(k, c.copy(PINK).lerp(AMBER, m));
    }
    this.ring.instanceColor.needsUpdate = true;
    this.spinGroups[5].add(this.ring);
  }

  _buildMarker() {
    // a thin ring around the node under the cursor
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.markerMat = this._shader(MARKER_VERT, MARKER_FRAG, { uOpacity: { value: 0 } });
    this.marker = new THREE.Points(geo, this.markerMat);
    this.marker.frustumCulled = false;
    this.marker.renderOrder = 3;
    this.scene.add(this.marker);
  }

  // CPU mirror of nodeWorld() in the shader (minus the tiny breathing)
  nodePosition(k, time, out) {
    const n = this.nodes[k];
    const a = time * SPIN_RATE * LAYERS[n.layer].spin;
    const c = Math.cos(a), s = Math.sin(a), o = n.offset;
    return out.set(c * o.x + s * o.z, o.y, -s * o.x + c * o.z).add(this.centers[n.layer]);
  }

  // The nearest node of the layer in view to a screen position, within `radius` px.
  pick(ndc, camera, focus, time, width, height, radius = 26) {
    let best = -1, bestD = radius * radius;
    this.layerRanges.forEach(([from, to], layer) => {
      if (activation(layer, focus) < 0.7) return;
      for (let k = from; k < to; k++) {
        const v = this.nodePosition(k, time, this.projected).project(camera);
        if (v.z > 1) continue;
        const dx = ((v.x - ndc.x) * width) / 2, dy = ((v.y - ndc.y) * height) / 2;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = k; }
      }
    });
    return best < 0 ? null : { index: best, layer: this.nodes[best].layer, pitch: this.nodes[best].pitch };
  }

  setHover(k) {
    this.hover = k ?? -1;
  }

  ping(k, time) {
    this.nodePosition(k, time, this.uniforms.uPing.value);
    this.uniforms.uPingT.value = time;
  }

  update({ time, dt, focus, levels, flow, camera, pointer }) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uFocus.value = focus;
    u.uLow.value = levels.low;
    u.uMid.value = levels.mid;
    u.uHigh.value = levels.high;
    u.uBeat.value = levels.beat;
    u.uFlow.value = flow;

    this.spinGroups.forEach((g, i) => { g.rotation.y = time * SPIN_RATE * LAYERS[i].spin; });

    // hover ring follows its node as the layer turns
    if (this.hover >= 0) this.nodePosition(this.hover, time, this.marker.position);
    this.markerOpacity += ((this.hover >= 0 ? 0.9 : 0) - this.markerOpacity) * (1 - Math.exp(-dt * 12));
    this.markerMat.uniforms.uOpacity.value = this.markerOpacity;

    // scope
    const act0 = activation(0, focus);
    if (act0 > 0.01) {
      const arr = this.scope.geometry.attributes.position.array;
      const wave = levels.wave, stride = Math.floor(wave.length / this.scopeN);
      for (let k = 0; k < this.scopeN; k++) {
        const t = k / (this.scopeN - 1);
        arr[k * 3] = (t - 0.5) * 21;
        arr[k * 3 + 1] = wave[k * stride] * 3.4 * Math.sin(Math.PI * t);
        arr[k * 3 + 2] = 0;
      }
      this.scope.geometry.attributes.position.needsUpdate = true;
    }
    this.scopeMat.opacity = 0.08 + 0.5 * act0;

    // core
    this.coreMat.uniforms.uAct.value = activation(1, focus);
    this.core.rotation.x = time * 0.06;

    // meadow + cursor
    const act2 = activation(2, focus);
    this.meadowMat.uniforms.uAct.value = act2;
    let pushTarget = 0;
    if (pointer.active && act2 > 0.3) {
      this.raycaster.setFromCamera(pointer.ndc, camera);
      this.meadow.getWorldPosition(this.tmp);
      this.plane.constant = -this.tmp.y;
      if (this.raycaster.ray.intersectPlane(this.plane, this.hit)) {
        this.meadow.worldToLocal(this.hit);
        if (this.hit.x * this.hit.x + this.hit.z * this.hit.z < 12 * 12) {
          this.meadowMat.uniforms.uPointer.value.copy(this.hit);
          pushTarget = 1;
        }
      }
    }
    this.push += (pushTarget - this.push) * (1 - Math.exp(-dt * 5));
    this.meadowMat.uniforms.uPush.value = this.push;

    // spectrum ring
    const act5 = activation(5, focus);
    this.ringMat.opacity = 0.05 + 0.38 * act5;
    if (act5 > 0.01) {
      const spec = levels.spectrum, half = this.bars / 2, d = this.dummy;
      for (let k = 0; k < this.bars; k++) {
        const band = k < half ? k : this.bars - 1 - k;
        const v = spec[Math.min(spec.length - 1, Math.floor((band / half) * spec.length))];
        const a = (k / this.bars) * Math.PI * 2 + Math.PI / 2;
        d.position.set(Math.cos(a) * 5.6, Math.sin(a) * 5.6, 0);
        d.rotation.set(0, 0, a - Math.PI / 2);
        d.scale.set(1, 0.15 + v * 3.2, 1);
        d.updateMatrix();
        this.ring.setMatrixAt(k, d.matrix);
      }
      this.ring.instanceMatrix.needsUpdate = true;
    }
  }
}
