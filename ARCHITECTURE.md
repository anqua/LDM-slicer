# Architecture

A guide for anyone who wants to read or change the code. No build step: plain HTML, CSS and native ES modules, with three.js from a CDN (the import map is in `index.html`). Open it through a local web server (`serve.ps1`, `npx serve` or `python -m http.server`).

## The idea in one picture

```
 STL file ──► model/ ──► positions (triangle soup)
                              │
settings (core/) ─────────────┤
                              ▼
                       pipeline.js  sliceModel()
                     ┌────────┴──────────┐
              slicer/ (standard)    nonstandard/ (curved, ruffle, loops, zones)
              layer by layer,       one continuous helix,
              walls, infill, spiral styles applied to the wall
                     └────────┬──────────┘
                              ▼
                    toolpaths  { layers: [{ z, h, paths }], warnings }
                              ▼
                       slicer/gcode.js ──► G-code text
                              ▼
        viewer/ (preview, simulation)      ui/ (panels, menus)
```

Data flows one way. The UI changes settings with `update({...})`; `main.js` listens with `onChange` and redraws the scene; slicing reads the settings and the model and never touches the UI.

## Folders

| Folder | What is in it |
|---|---|
| `src/main.js` | Entry point. Creates the scene and the controllers, wires the UI. Almost no logic. |
| `src/pipeline.js` | `sliceModel()`: mesh → toolpaths → G-code. The app and the tests both call it. |
| `src/core/` | Settings: `schema.js` (the definition of every setting, drives the forms and the defaults), `settings.js` (the store: `S`, `update()`, `onChange()`, saved in localStorage), `printers.js` (presets), `theme.js`. |
| `src/model/` | The loaded model: STL reading, placement (scale, rotation, offset), the demo vase. |
| `src/slicer/` | The standard slicer. `slice.js` cuts the mesh into contours, `layer-paths.js` + `layer-fill.js` make walls, base and infill, `infill.js` holds the fill patterns, `spiral.js` the spiral vase, `paths.js` ties them together, `gcode.js` writes G-code. |
| `src/nonstandard/` | The non-standard engine, for vase-like parts. `outline.js` measures the part, `zones.js` + `styles.js` decide the style at each height, `helix.js` builds the path, `report.js` the warnings, `field.js` the curved-layer warp, `engine.js` runs the steps. |
| `src/viewer/` | The 3D scene: renderer and cameras, bed, printer model, and the print preview (`toolpath.js`, with `move-list.js`, `timeline.js`, `solid-view.js`, `bead-mesh.js`, `gcode-moves.js`). |
| `src/app/` | Controllers: `slicing.js` (run a slice, keep the result), `playback.js` (the print simulation), `model-profile.js`. |
| `src/ui/` | Panels and menus: the settings forms (`form.js`, `panels.js`), the Slice button and menu, the zone editor, the layer bar. |
| `css/` | `theme.css` (colors, fonts), `layout.css` (page structure), `components.css` (buttons, rows, sections). |
| `tests/` | The regression test (below). |

## How do I …

**Add a setting.** Add a field to `src/core/schema.js` (`{ k, label, unit, def, step, min, max, help }`). The form row, the default, the saved value and the min/max check all come from that one line. Read it as `S.yourKey` anywhere. To show it only in some cases, add `dep: [key, [values]]`; to grey it out in some cases, add `off: [key, [values]]`.

**Add an infill pattern.** Add an entry to the registry in `src/slicer/infill.js` (`TPMS` for minimal surfaces). The dropdown and the pattern preview pick it up.

**Add a non-standard style.** Add an entry to `STYLES` in `src/nonstandard/styles.js`: its label, its settings (`params`), and `turn()`, which says how the wall is shaped. The settings form, the zone editor and the engine read the registry; nothing else needs to change. The comment at the top of that file describes the entry.

**Add a printer preset.** Add it to `src/core/printers.js`.

**Change how G-code is written.** `src/slicer/gcode.js`. The preview can replay the file (Exact G-code), so check there that it still reads back.

**Add a button or panel.** Markup in `index.html`, behaviour in a module under `src/ui/` with an `init…()` function that `main.js` calls. Keep logic out of `main.js`.

## Conventions

- Every module starts with a comment saying what it is for. Functions that are not obvious have a short doc comment: what goes in, what comes out.
- A function does one thing. If it grows past one screen, split it.
- Modules do not share globals. They are passed what they need (see how `main.js` creates `createSlicing({ model, toolpath, panel, playback })`).
- Settings are read from `S`; only `update()` writes them (so the UI and the saved copy stay in step). View preferences that must not clear the slice (printer shown, view mode) are set with `S.x = v; save()`.
- Interface style: black background, accent `#00ff00`, opaque surfaces only (no translucency, blur or fading), Space Grotesk / Space Mono.
- Comments explain why, not what. Units are in the name or the comment (mm, s, degrees).

## Testing

Open `tests/index.html` through the local server. It slices the demo vase with ten sets of settings (standard, spiral, infill only, curved, ruffle, loops, zones) through `sliceModel()` and compares a fingerprint of each G-code file with `tests/baseline.json`. All rows should say "same". Run it before and after a refactor: a change means the slicer's output changed.

After a deliberate change to the output (a new default, a new G-code line), check the new G-code by eye, then press "Copy new baseline" and save the text as `tests/baseline.json`. To cover a new feature, add a case to `tests/regression.js`.
