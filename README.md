# Liquid Deposition Modeling (LDM) Slicer

A browser-based slicer for Liquid Deposition 3D printers. No install, no build step: plain HTML, CSS and native ES modules, with three.js from a CDN.

**Live:** https://anqua.github.io/LDM-slicer/

A project of [@A – Art, Technology, Architecture](https://anqua.github.io/at-a/) research group.

## Status

Being built step by step.

- [x] **Step 1 – Workspace:** 3D view of the model on a bed sized to your printer. Load an STL (or the demo vase), scale, rotate, offset, scale to fit the bed, and see a warning when it doesn't fit. Includes menus for printer details and print-path settings, saved in the browser, with JSON export and import.
- [x] **Step 2 – Slicing:** cut the mesh into layers, with spiral-vase and layer-by-layer modes, walls, solid bottom and priming loops (skirt). Holes in the mesh up to 8 mm are closed automatically, and the slice summary warns that the model needs repair.
- [x] **Step 3 – Toolpath preview:** paths colored by type, a layer slider (arrow keys step through layers), optional travel moves and model overlay. **Play** (or Space) simulates the print at 10×, 20× or 30× speed: the paths grow move by move and the printer head follows the nozzle. On the delta printer, the carriages and arms move with it.
- [x] **Exact G-code preview:** the *Exact G-code* switch in the preview bar replays the exported G-code itself instead of the slicer's paths: every move as written (rounded coordinates, lifts, the approach from home and the lift at the end), timed with the file's feed rates (`viewer/gcode-moves.js`). The choice is saved. G-code now marks `;LAYER` inside a continuous spiral too.
- [x] **Step 4 – G-code export:** E values, speeds, min layer time, start and end G-code, plus clay-specific start and end handling modeled on [Termite](https://www.food4rhino.com/en/app/termite): first layer height, pre-fill, safe start and safe end.

- [x] **Infill** (layer-by-layer mode): zig-zag between the walls and an extra inner wall, lines, grid, and triply periodic minimal surfaces, with adjustable spacing / cell size. A preview of the chosen pattern shows under the dropdown.
  - Minimal surfaces: gyroid, I-WP and F-RD (Schoen, NASA TN D-5541, 1970), Schwarz D and P, Neovius, Fischer–Koch S, lidinoid, split P, and the double gyroid (two gyroid networks, printed as paired lines).
  - Each is a short trigonometric series whose zero set approximates the surface, cut at the layer height. Gyroid and Schwarz D are close to exact; I-WP, F-RD, lidinoid, split P and the double gyroid are rougher approximations. Not included: the other surfaces in Schoen's report (O,C-TO, C(D), the hybrids), for which no closed-form level-set was found.

- [x] **Slice styles** (the Slice button opens a chooser with a picture of each way to slice, `ui/slice-menu.js`; settings in Print paths → Non-standard slice). Standard (layer by layer) plus three non-standard styles:
  - *Curved layers* (non-planar): wave, ripple or cone height field. The part is measured in layer space (mesh refined and warped flat) and the path is mapped back with its z following the surface. The first layers stay flat; the effect ramps in over 3 × amplitude. Warns above 30° slope.
  - *Ruffled wall*: the wall waves up and down and in and out, a whole number of waves per turn so it closes at the seam; every turn repeats the one below, so the crests stack in columns.
  - *Loop texture*: the wall path curls into small loops (a trochoid in the tangent/vertical plane) between two heights.
  - These styles use their own engine (`src/nonstandard/`), separate from the standard slicer (shares the G-code writer and the base): the part is measured as one radius per angle per layer and printed as one continuous helix with the style applied to the wall. It suits vase-like parts (cross-sections star-shaped around the axis); handles, cavities and separate parts are ignored. The base (priming loops and bottom layers) is the standard slicer's, flat and identical to a standard slice; the style starts above it. No infill. Travel moves lift by the texture height.

Not yet: top surfaces, and acceleration in the time estimate.

## Run it

Open `index.html` through a local web server. ES modules don't load from `file://`.

- On Windows with no other tools installed: `powershell -ExecutionPolicy Bypass -File serve.ps1`, then open http://localhost:8765
- Any other static server also works, e.g. `npx serve` or `python -m http.server`

## Project structure

```
index.html              markup, importmap, loads css/* and src/main.js
css/
  theme.css             design tokens (colors, fonts); the 3D scene reads these too
  layout.css            page structure and responsive rules
  components.css        buttons, tabs, form rows, cards
src/
  main.js               entry point: creates modules and wires them together
  core/
    schema.js           settings definition (drives forms and defaults)
    settings.js         settings store: localStorage, update(patch), onChange()
    theme.js            cssVar() to read tokens from CSS
  viewer/
    viewer.js           renderer, scene, lights, render loop, resize
    camera-rig.js       perspective/orthographic cameras + OrbitControls, framing
    bed.js              build plate, grid, build-volume outline, bed extents
    toolpath.js         toolpath preview, drawn up to the chosen layer
    gcode-moves.js      reads G-code text back into moves for the exact preview
  model/
    model.js            loaded model: rotation, scale/offset placement, fit check
    loader.js           STL reading
    demo.js             procedural demo vase
  slicer/
    slice.js            mesh -> layer heights and closed contours (outer CCW, holes CW)
    polygon.js          2D helpers: area, offset, simplify, convex hull, islands
    paths.js            layer-by-layer engine: priming loops, walls, solid bottom infill, infill; dispatches the spiral
    spiral.js           spiral engine: one continuous helix (outline blended between layers, fixed seam)
    infill.js           fill patterns: scanlines, zig-zag, minimal surfaces (TPMS registry, marching squares)
    gcode.js            toolpaths -> G-code, with pre-fill, safe start and safe end
  nonstandard/          separate slicing algorithm for the Non-standard slice (shares the G-code writer and the base)
    engine.js           radial outline per layer, one continuous helix, styles: curved, ruffle, loops
    field.js            height-field warp for curved layers (mesh refinement, layer space)
  ui/
    slice-panel.js      Slice button (opens the slice-style chooser) and Export, layer slider, slice summary
    form.js             renders schema fields, two-way bound to settings
    panels.js           sidebar tabs and the Model / Printer / Print paths panes
    status.js           model summary (status card and Model pane)
    view-controls.js    3D/Top/Front buttons, projection toggle, keyboard shortcuts
    file-input.js       Open STL button and drag-and-drop
    sidebar-resize.js   drag the sidebar edge to resize it (width saved)
    version-stamp.js    "Updated <date, time>" under the lab logo: time of the latest commit on GitHub
```

Data flow: UI calls `update({...})` in `core/settings.js`. `main.js` listens with `onChange` and rebuilds the bed and model, then refreshes the status. Modules don't share globals; they're passed what they need.

## Settings

- **Printer:** built for the Delta WASP 2040 Clay only: round bed with the origin at its center. Settings: bed diameter and height, nozzle (1.5–3 mm), extruder type, how E is interpreted (virtual filament or volume), firmware, start and end G-code.
- **Print paths:** layer height, line width, spiral or layered mode, walls, infill pattern / angle / spacing / zig-zag width, seam, flow, retraction, speeds.
- **Bottom layers** (independent of the infill above): number of layers, infill pattern (lines turning 90° per layer, grid, or concentric rings following the outline with a line-filled middle), angle, line spacing (a multiple of the nozzle diameter), flow multiplier (default 75 % of the flow of the rest of the model) and print speed. Walls on these layers keep the wall settings; layer 1 uses the first-layer speed.
- **Start of print / end of paths** (after Termite by Julian Jauk, TU Graz):
  - *Priming loops* around the part before it starts, and their distance.
  - *First layer height*, separate from the other layers.
  - *Pre-fill*: clay pushed out in place before the first move, to build pressure.
  - *Safe start*: the first mm of every path printed slowly.
  - *Safe end*: the last mm of every path slowed down with the flow easing off, so ends don't lift.

The G-code uses relative extrusion (M83). It starts with a header giving estimated time, clay volume and path length.
