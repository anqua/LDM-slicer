# Clay Slicer

A browser-based slicer for clay / paste 3D printers. No install, no build step: it's one HTML file that uses three.js from a CDN.

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

## Settings

- **Printer:** bed size and shape, where the origin is, nozzle, extruder type, how E is interpreted (virtual filament or volume), firmware, start and end G-code.
- **Print paths:** layer height, line width, spiral or layered mode, walls, bottom layers, seam, flow, retraction, speeds, skirt.
