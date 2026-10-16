# aajghong.com: portfolio

A single-page portfolio laid out as a small neural network in three.js. Each section is a layer.
Moving between sections runs a "forward pass": the camera glides along the connections while a soft
wavefront travels down the edges.

- **Navigation**: a regular section menu in the header, plus a "layer rail" on the right. The rail is a
  tiny diagram of the network, and its signal line fills as the camera moves. On phones it sits along the bottom.
  You can also scroll, swipe, or use the arrow keys, PageUp/PageDown and Home/End. Each section has its own
  URL hash (`#about`, `#projects`…) and the back button works.
- **Sound** (off by default; the header toggle remembers the choice): a single tone travels through the
  network and is transformed by each layer. It starts as a pure sine, then gains harmonics, wind, FM and a
  resonant filter, then echoes, and resolves into a chord at the output. Parameters follow the camera's
  continuous position, so the sound morphs during each flight. Hovering a node plays it softly; clicking
  or tapping plays it louder and sends a ripple through the network. Brushing the meadow makes it rustle.
  With sound on, the oscilloscope and spectrum ring show the real output; with sound off they follow a slow
  procedural signal (`src/signal.js`).
- **Layers**: input grid with an oscilloscope → about (a wireframe "mind" core) → projects (a meadow
  you can press with the cursor, a nod to Grass) → toolkit (torus knot) → now (helix) → contact
  (output node inside a spectrum ring).
- **Fallbacks**: without WebGL or JS, the sections render as a normal stacked page.
  `prefers-reduced-motion` shortens the flights and turns off parallax.

## Structure

```
index.html      all content (edit copy here)
styles.css
src/main.js     navigation, camera rig, input, frame loop
src/world.js    network, meadow, core, scope, spectrum ring + shaders
src/audio.js    the layer-by-layer sound (opt-in) + node plucks + analyser
src/signal.js   slow procedural signal behind the ambient motion
src/post.js     bloom + vignette/grain
_headers        Cloudflare Pages headers
tools/serve.ps1 local static server
```

No build step. three.js loads from jsDelivr through the import map in `index.html`, pinned to `0.169.0`.

## Editing content

- **Add a project:** in `index.html`, copy a `<li class="project">` block inside `.tracklist`,
  renumber, and set the live/source links. Keep "This site" as the last entry.
- **Tune the sound:** the per-layer table `LAYER_PARAMS` at the top of `src/audio.js`.
- **Email:** replace `hello@aajghong.com` in the Contact section with your real address.
- **Sections:** each `<section class="panel">` must line up with an entry in `LAYERS` in `src/world.js`
  (same order and count).

## Run locally

```powershell
./tools/serve.ps1        # http://localhost:8080
```

## Deploy (Cloudflare Pages)

Push this folder to a Git repo, then in Cloudflare create a Pages project → connect the repo, and set:

- Framework preset: **None**
- Build command: *(empty)*
- Build output directory: **/**

Then add the custom domain (e.g. `aajghong.com`) under the project's *Custom domains*.
You can also use *Direct Upload* and drag this folder in.
