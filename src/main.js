import * as THREE from 'three';
import { World, LAYER_COUNT, layerCenter } from './world.js';
import { createPost } from './post.js';
import { SoundScape } from './audio.js';
import { createSignal } from './signal.js';

window.__portfolioBooted = true;

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeInOutSine = (x) => -(Math.cos(Math.PI * x) - 1) / 2;
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const ease = (x) => easeInOutCubic(x) * 0.6 + easeInOutSine(x) * 0.4;

const html = document.documentElement;
const panels = $$('.panel');
const ids = panels.map((p) => p.id);
const N = panels.length;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sound = new SoundScape();

console.assert(N === LAYER_COUNT, 'every section needs a layer in world.js');
$('#year').textContent = new Date().getFullYear();

// ---------------------------------------------------------------- sound toggle

function setSoundUI() {
  html.classList.toggle('sfx-on', sound.enabled);
  $('#sfxBtn').setAttribute('aria-pressed', String(sound.enabled));
  $('[data-sfx-label]').textContent = sound.enabled ? 'Sound on' : 'Sound off';
}
$('#sfxBtn').addEventListener('click', async () => {
  try { await sound.setEnabled(!sound.enabled); } catch (err) { console.warn('audio unavailable', err); }
  setSoundUI();
});
setSoundUI();
// a remembered "on" still needs a user gesture before audio can start
addEventListener('pointerdown', () => sound.unlock().catch(() => {}), { once: true });
addEventListener('keydown', () => sound.unlock().catch(() => {}), { once: true });

// ---------------------------------------------------------------- try WebGL, otherwise stay static

let gl = null;
try {
  const canvas = $('#gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x05060a, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
  const world = new World(scene);
  const post = createPost(renderer, scene, camera);
  gl = { renderer, camera, world, post };
} catch (err) {
  console.warn('WebGL unavailable, showing the static layout', err);
}

if (gl) run(gl);
else html.className = 'static';

// ---------------------------------------------------------------- the interactive version

function run({ renderer, camera, world, post }) {
  const nav = { current: 0, from: 0, to: 0, start: 0, dur: 1, active: false, focus: 0, showTimer: 0 };
  const pointer = { ndc: new THREE.Vector2(), smooth: new THREE.Vector2(), active: false, last: 0, speed: 0, hover: -1, touch: false, overUI: false };
  const signal = createSignal();
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: N }, (_, i) => layerCenter(i)), false, 'centripetal');
  const look = new THREE.Vector3();
  const frame = { x: 0, y: 0, dist: 21 };
  const BASE_FOV = 50;

  const navLinks = $$('[data-goto]').filter((a) => a.closest('.topnav, .rail'));
  const topLinks = $$('#topnav a');
  const indicator = $('#topnavIndicator');
  const railSignal = $('#railSignal');

  // --- layout: push the 3D subject away from the text panel
  function resize() {
    const w = innerWidth, h = innerHeight;
    const pr = Math.min(devicePixelRatio, 1.75);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h);
    post.setSize(w, h, pr);
    camera.aspect = w / h;
    const mobile = w <= 760;
    frame.dist = mobile ? 21 * clamp(1.15 / camera.aspect, 1, 1.9) : 21;
    const visH = 2 * frame.dist * Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2));
    frame.x = mobile ? 0 : -0.14 * visH * camera.aspect;
    frame.y = mobile ? -0.24 * visH : 0;
    camera.updateProjectionMatrix();
    placeIndicator(nav.to);
  }

  // --- panels
  panels.forEach((p) => $$('.reveal', p).forEach((el, i) => el.style.setProperty('--i', i)));

  const updateOverflow = (p) => p.classList.toggle('has-more', p.scrollTop + p.clientHeight < p.scrollHeight - 4);
  panels.forEach((p) => p.addEventListener('scroll', () => updateOverflow(p), { passive: true }));
  addEventListener('resize', () => panels.forEach(updateOverflow));

  function showPanel(i, focusHeading) {
    panels.forEach((p, j) => {
      const on = j === i;
      p.classList.toggle('is-active', on);
      p.inert = !on;
      p.setAttribute('aria-hidden', String(!on));
    });
    panels[i].scrollTop = 0;
    updateOverflow(panels[i]);
    if (focusHeading) $('h1, h2', panels[i])?.focus({ preventScroll: true });
  }

  function hidePanels() {
    panels.forEach((p) => { p.classList.remove('is-active'); p.inert = true; });
  }

  function placeIndicator(i) {
    const link = topLinks.find((a) => Number(a.dataset.goto) === i);
    if (!link || !link.offsetParent) { indicator.style.opacity = '0'; return; }
    indicator.style.opacity = '1';
    indicator.style.width = `${link.offsetWidth - 24}px`;
    indicator.style.transform = `translateX(${link.offsetLeft + 12}px)`;
  }

  function updateChrome(i) {
    navLinks.forEach((a) => a.setAttribute('aria-current', String(Number(a.dataset.goto) === i)));
    placeIndicator(i);
    const name = $('h1, h2', panels[i]).textContent.trim();
    document.title = i === 0 ? 'Aaron Hong' :`${name} · Aaron Hong`;
  }

  // --- navigation
  function goTo(i, { push = true, focusHeading = false } = {}) {
    i = clamp(i, 0, N - 1);
    if (i === nav.to) return;
    nav.from = nav.focus;
    nav.to = i;
    nav.start = performance.now() / 1000;
    nav.dur = reduceMotion ? 0.4 : 1.4 + 0.25 * Math.min(Math.abs(i - nav.from), 4);
    nav.active = true;

    hidePanels();
    world.setHover(null);
    pointer.hover = -1;
    clearTimeout(nav.showTimer);
    nav.showTimer = setTimeout(() => showPanel(i, focusHeading), nav.dur * 1000 * 0.7);

    if (push) history.pushState(null, '', `#${ids[i]}`);
    updateChrome(i);
  }
  const step = (d, opts) => goTo(nav.to + d, opts);

  function indexFromHash() {
    const i = ids.indexOf(decodeURIComponent(location.hash.slice(1)));
    return i < 0 ? 0 : i;
  }
  addEventListener('popstate', () => goTo(indexFromHash(), { push: false }));

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-goto]');
    if (!el) return;
    e.preventDefault();
    goTo(Number(el.dataset.goto), { focusHeading: e.detail === 0 });
  });

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); step(1, { focusHeading: true }); }
    else if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); step(-1, { focusHeading: true }); }
    else if (k === 'Home') { e.preventDefault(); goTo(0, { focusHeading: true }); }
    else if (k === 'End') { e.preventDefault(); goTo(N - 1, { focusHeading: true }); }
  });

  // Does a scrollable panel under the pointer still have room to scroll in this direction?
  function panelCanScroll(target, dir) {
    const panel = target.closest?.('.panel');
    if (!panel || panel.scrollHeight <= panel.clientHeight + 1) return false;
    return dir > 0 ? panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1 : panel.scrollTop > 0;
  }

  // wheel: one gesture = one step. Trackpad inertia that starts during a transition is swallowed until it stops.
  let wheelAcc = 0, lastWheel = 0, streamBlocked = false;
  addEventListener('wheel', (e) => {
    if (e.ctrlKey) return;
    const now = performance.now();
    if (now - lastWheel > 160) { streamBlocked = false; wheelAcc = 0; }
    lastWheel = now;
    const dy = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (panelCanScroll(e.target, Math.sign(dy))) { streamBlocked = true; return; }
    if (streamBlocked || nav.active) { streamBlocked = true; return; }
    wheelAcc += e.deltaMode === 1 ? dy * 30 : dy;
    if (Math.abs(wheelAcc) > 50) {
      step(Math.sign(wheelAcc));
      wheelAcc = 0;
      streamBlocked = true;
    }
  }, { passive: true });

  // touch: vertical swipe
  let touch = null;
  addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touch = { x: t.clientX, y: t.clientY, target: e.target, scrollTop: e.target.closest?.('.panel')?.scrollTop ?? 0 };
  }, { passive: true });
  addEventListener('touchend', (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    const panel = touch.target.closest?.('.panel');
    const scrolled = panel && Math.abs(panel.scrollTop - touch.scrollTop) > 2;
    if (!scrolled && Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.3) {
      const dir = dy < 0 ? 1 : -1;
      if (!panelCanScroll(touch.target, dir)) step(dir);
    }
    touch = null;
  }, { passive: true });

  // pointer: parallax, pressing the meadow, and playing nodes
  const overUI = (target) => !!target.closest?.('.panel, .hud, .rail');
  function setPointer(e) {
    const x = (e.clientX / innerWidth) * 2 - 1, y = -(e.clientY / innerHeight) * 2 + 1;
    const now = performance.now();
    const dt = Math.max(1, now - pointer.last) / 1000;
    pointer.speed = Math.hypot(x - pointer.ndc.x, y - pointer.ndc.y) / dt;
    pointer.ndc.set(x, y);
    pointer.last = now;
    pointer.active = true;
    pointer.overUI = overUI(e.target);
  }
  function pickAt(time) {
    return pointer.overUI || nav.active
      ? null
      : world.pick(pointer.ndc, camera, nav.focus, time, innerWidth, innerHeight, pointer.touch ? 40 : 26);
  }
  const degreeOf = (hit) => hit.pitch * 9; // two octaves of pentatonic

  addEventListener('pointermove', (e) => {
    pointer.touch = e.pointerType === 'touch';
    setPointer(e);
  }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer.active = false; });

  // click or tap a node to play it and send a ripple through the network
  addEventListener('pointerdown', (e) => {
    pointer.touch = e.pointerType !== 'mouse';
    setPointer(e);
    const hit = pickAt(performance.now() / 1000);
    if (!hit) return;
    sound.pluck(hit.layer, degreeOf(hit), 0.9);
    world.ping(hit.index, performance.now() / 1000);
    if (pointer.touch) { world.setHover(hit.index); pointer.hover = hit.index; }
  });

  // --- boot
  const initial = indexFromHash();
  nav.current = nav.from = nav.to = nav.focus = initial;
  history.replaceState(null, '', `#${ids[initial]}`);
  panels.forEach((p) => { p.inert = true; });
  addEventListener('resize', resize);
  resize();
  updateChrome(initial);
  document.fonts?.ready.then(() => placeIndicator(nav.to));

  setTimeout(() => {
    html.classList.add('is-ready');
    setTimeout(() => showPanel(initial, false), 300);
  }, reduceMotion ? 200 : 600);

  // --- frame loop
  let last = performance.now() / 1000;
  function frameLoop(nowMs) {
    requestAnimationFrame(frameLoop);
    const t = nowMs / 1000;
    const dt = Math.min(0.05, Math.max(0, t - last));
    last = t;

    let warp = 0;
    if (nav.active) {
      const p = clamp((performance.now() / 1000 - nav.start) / nav.dur, 0, 1);
      nav.focus = nav.from + (nav.to - nav.from) * ease(p);
      warp = Math.sin(p * Math.PI);
      if (p >= 1) { nav.active = false; nav.focus = nav.current = nav.to; }
    }

    const levels = signal.update(t);
    sound.setFocus(nav.focus);
    sound.sample(levels);
    if (performance.now() - pointer.last > 4000) pointer.active = false;
    pointer.smooth.lerp(pointer.ndc, 1 - Math.exp(-dt * 1.5));

    // hovering a node plays it softly (mouse only; touch plays on tap)
    if (!pointer.touch) {
      const hit = pointer.active ? pickAt(t) : null;
      const k = hit ? hit.index : -1;
      if (k !== pointer.hover) {
        pointer.hover = k;
        world.setHover(hit ? k : null);
        if (hit) sound.pluck(hit.layer, degreeOf(hit), 0.35);
        renderer.domElement.style.cursor = hit ? 'pointer' : '';
        document.body.style.cursor = hit ? 'pointer' : '';
      }
    }
    // brushing the meadow rustles it
    pointer.speed *= Math.exp(-dt * 8);
    sound.setRustle(world.push * pointer.speed * 0.5);

    // camera rides the spline through the layer centres, looking slightly down
    curve.getPoint(clamp(nav.focus / (N - 1), 0, 1), look);
    const motion = reduceMotion ? 0 : 1;
    camera.position.set(
      look.x + frame.x + pointer.smooth.x * 0.8 * motion,
      look.y + frame.y + 4.2 + pointer.smooth.y * 0.5 * motion,
      look.z + frame.dist + warp * 2 * motion,
    );
    camera.lookAt(look.x + frame.x, look.y + frame.y, look.z);
    const fov = BASE_FOV + warp * 5 * motion;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }

    world.uniforms.uProj.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    world.update({ time: t, dt, focus: nav.focus, levels, flow: warp, camera, pointer });
    post.render(t, dt);

    railSignal.style.setProperty('--p', (nav.focus / (N - 1)).toFixed(4));
  }
  requestAnimationFrame(frameLoop);
}
