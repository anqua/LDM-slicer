# Liquid Deposition Modeling (LDM) Slicer

A browser-based slicer for Liquid Deposition 3D printers. No install, no build step: plain HTML, CSS and native ES modules, with three.js from a CDN.

**Live:** https://anqua.github.io/LDM-slicer/

A project of [@A – Art, Technology, Architecture](https://anqua.github.io/at-a/) research group.

## Status

Being built step by step.

- [x] **Step 1 – Workspace:** 3D view of the model on a bed sized to your printer. Load an STL (or the demo vase), scale, rotate, offset, scale to fit the bed, and see a warning when it doesn't fit. Includes menus for printer details and print-path settings, saved in the browser, with JSON export and import.
- [x] **Step 2 – Slicing:** cut the mesh into layers, with spiral-vase and layer-by-layer modes, walls, solid bottom and priming loops (skirt).
- [x] **Step 3 – Toolpath preview:** paths colored by type, a layer slider (arrow keys step through layers), optional travel moves and model overlay. **Play** (or Space) simulates the print at 10×, 20× or 30× speed: the paths grow move by move and the printer head follows the nozzle. On the delta printer, the carriages and arms move with it.
- [x] **Step 4 – G-code export:** E values, speeds, min layer time, start and end G-code, plus clay-specific start and end handling modeled on [Termite](https://www.food4rhino.com/en/app/termite): first layer height, pre-fill, safe start and safe end.

Not yet: top surfaces and sparse infill (layered mode prints walls and a solid bottom only), and acceleration in the time estimate.

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
  model/
    model.js            loaded model: rotation, scale/offset placement, fit check
    loader.js           STL reading
    demo.js             procedural demo vase
  slicer/
    slice.js            mesh -> layer heights and closed contours (outer CCW, holes CW)
    polygon.js          2D helpers: area, offset, simplify, convex hull
    paths.js            contours -> toolpaths: priming loops, walls, bottom fill, spiral
    gcode.js            toolpaths -> G-code, with pre-fill, safe start and safe end
  ui/
    slice-panel.js      Slice / Export buttons, layer slider, slice summary
    form.js             renders schema fields, two-way bound to settings
    panels.js           sidebar tabs and the Model / Printer / Print paths panes
    status.js           model summary (status card and Model pane)
    view-controls.js    3D/Top/Front buttons, projection toggle, keyboard shortcuts
    file-input.js       Open STL button and drag-and-drop
```

Data flow: UI calls `update({...})` in `core/settings.js`. `main.js` listens with `onChange` and rebuilds the bed and model, then refreshes the status. Modules don't share globals; they're passed what they need.

## Settings

- **Printer:** built for the Delta WASP 2040 Clay only: round bed with the origin at its center. Settings: bed diameter and height, nozzle, extruder type, how E is interpreted (virtual filament or volume), firmware, start and end G-code.
- **Print paths:** layer height, line width, spiral or layered mode, walls, bottom layers, seam, flow, retraction, speeds.
- **Start of print / end of paths** (after Termite by Julian Jauk, TU Graz):
  - *Priming loops* around the part before it starts, and their distance.
  - *First layer height*, separate from the other layers.
  - *Pre-fill*: clay pushed out in place before the first move, to build pressure.
  - *Safe start*: the first mm of every path printed slowly.
  - *Safe end*: the last mm of every path slowed down with the flow easing off, so ends don't lift.

The G-code uses relative extrusion (M83). It starts with a header giving estimated time, clay volume and path length.
