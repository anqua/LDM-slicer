# Liquid Deposition Modeling (LDM) Slicer

A browser-based slicer for Liquid Deposition 3D printers. No install, no build step: plain HTML, CSS and native ES modules, with three.js from a CDN.

**Live:** https://anqua.github.io/clay-slicer/

## Status

Being built step by step.

- [x] **Step 1 – Workspace:** 3D view of the model on a bed sized to your printer. Load an STL (or the demo vase), scale, rotate, offset, scale to fit the bed, and see a warning when it doesn't fit. Includes menus for printer details and print-path settings, saved in the browser, with JSON export and import.
- [ ] **Step 2 – Slicing:** cut the mesh into layers, with spiral-vase and layer-by-layer modes, walls, solid bottom and skirt.
- [ ] **Step 3 – Toolpath preview:** show the paths with a layer slider.
- [ ] **Step 4 – G-code export:** E values, speeds, min layer time, start and end G-code.

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
  model/
    model.js            loaded model: rotation, scale/offset placement, fit check
    loader.js           STL reading
    demo.js             procedural demo vase
  ui/
    form.js             renders schema fields, two-way bound to settings
    panels.js           sidebar tabs and the Model / Printer / Print paths panes
    status.js           model summary (status card and Model pane)
    view-controls.js    3D/Top/Front buttons, projection toggle, keyboard shortcuts
    file-input.js       Open STL button and drag-and-drop
```

Data flow: UI calls `update({...})` in `core/settings.js`. `main.js` listens with `onChange` and rebuilds the bed and model, then refreshes the status. Modules don't share globals; they're passed what they need.

## Settings

- **Printer:** bed size and shape, where the origin is, nozzle, extruder type, how E is interpreted (virtual filament or volume), firmware, start and end G-code.
- **Print paths:** layer height, line width, spiral or layered mode, walls, bottom layers, seam, flow, retraction, speeds, skirt.
