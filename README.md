# Liquid Deposition Modeling (LDM) Slicer

A browser-based slicer for Liquid Deposition 3D printers. No install, no build step: plain HTML, CSS and native ES modules, with three.js from a CDN.

**Live:** https://anqua.github.io/LDM-slicer/

A project of [@A – Art, Technology, Architecture](https://anqua.github.io/at-a/) research group.

## Status

Being built step by step.

- [x] **Step 1 – Workspace:** 3D view of the model on a bed sized to your printer. Load an STL (or the demo vase), scale, rotate, offset, scale to fit the bed, and see a warning when it doesn't fit. Includes menus for printer details and print-path settings, saved in the browser, with JSON export and import.
- [x] **Step 2 – Slicing:** cut the mesh into layers, with spiral-vase and layer-by-layer modes, walls, solid bottom and priming loops (skirt). Holes in the mesh up to 8 mm are closed automatically, and the slice summary warns that the model needs repair.
- [x] **Step 3 – Toolpath preview:** paths colored by type, a layer slider (arrow keys step through layers), optional travel moves and model overlay. **Play** (or Space) simulates the print at 10×, 20× or 30× speed: the paths grow move by move and the printer head follows the nozzle. On the delta printer, the carriages and arms move with it.
- [x] **Two views** (Toolpath / Material in the preview bar, saved): *Toolpath* draws the paths as lines. *Material* builds the printed object: every move becomes a piece of bead with the real line width and a height from the clay extruded (layer height, flow, and in the exact view the E values of the file), and the nozzle (its real diameter) follows the print (`viewer/bead-mesh.js`).
- [x] **Exact G-code preview:** the *Exact G-code* switch in the preview bar replays the exported G-code itself instead of the slicer's paths: every move as written (rounded coordinates, lifts, the approach from home and the lift at the end), timed with the file's feed rates (`viewer/gcode-moves.js`). The choice is saved. G-code now marks `;LAYER` inside a continuous spiral too.
- [x] **Step 4 – G-code export:** E values, speeds, min layer time, start and end G-code, plus clay-specific start and end handling modeled on [Termite](https://www.food4rhino.com/en/app/termite): first layer height, pre-fill, safe start and safe end.

- [x] **Infill** (layer-by-layer mode): zig-zag between the walls and an extra inner wall, lines, grid, and triply periodic minimal surfaces, with adjustable spacing / cell size. A preview of the chosen pattern shows under the dropdown.
  - Minimal surfaces: gyroid, I-WP and F-RD (Schoen, NASA TN D-5541, 1970), Schwarz D and P, Neovius, Fischer–Koch S, lidinoid, split P, and the double gyroid (two gyroid networks, printed as paired lines).
  - Each is a short trigonometric series whose zero set approximates the surface, cut at the layer height. Gyroid and Schwarz D are close to exact; I-WP, F-RD, lidinoid, split P and the double gyroid are rougher approximations. Not included: the other surfaces in Schoen's report (O,C-TO, C(D), the hybrids), for which no closed-form level-set was found.

- [x] **Zones** (the Zones card in the Slice menu opens the editor): split the height into zones with draggable boundaries on the model silhouette; each zone has its own style (standard, curved, ruffle, loops) and settings, and the effect rises and falls at the zone edges. Slice from the editor. Next: parameter curves inside a zone.
- [x] **Seam angle** (Print paths → Seam angle): you choose where each turn of the wall starts and ends (0° right, 90° rear, 180° left, 270° front). Works for the continuous helix, every non-standard slice, and layer by layer with Seam position "At the seam angle". The Slice menu lists the two standard ways separately: layer by layer (Z cuts) and the continuous helix.
- [x] **Open a G-code file** (Open file, or drop it on the page): shows any G-code in the same preview as a slice: layer bar, play, Toolpath / Material, travel, printer. Reads this slicer, Cura, PrusaSlicer and Simplify3D files (layer comments or Z heights; relative and absolute E; arcs; inches). Colored by move type, or by speed when the file has none. The Model tab describes the file and sets its origin (bed center or corner); Close G-code goes back to the model.
- [x] **Infill only** (Print paths → Print): prints the infill and the bottom layers without the outer walls; the infill reaches the outline. Layer by layer. The default path mode is now layer by layer (standard).
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

See [ARCHITECTURE.md](ARCHITECTURE.md): the folders, how data flows, and where to change things (a setting, an infill pattern, a non-standard style, a printer preset). `tests/index.html` is the regression test: it slices the demo vase with ten sets of settings and compares the G-code with a baseline.

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
