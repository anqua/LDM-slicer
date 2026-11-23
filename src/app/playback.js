// Print simulation: the paths grow along the print's time line and the printer head follows the nozzle.
// Owns the play state (playing, time, speed); the views it drives (toolpath, printer, slice panel) are passed in.

/**
 * @param c { toolpath, printer, panel, setPrinterVisible(v, persist) }
 * @returns { sim, show(t), setPlaying(v), toggle(), scrub(layer), tick(dt), reset(), setSpeed(x) }
 */
export function createPlayback({ toolpath, printer, panel, setPrinterVisible }) {
  const sim = { playing: false, t: 0, speed: panel.speed };

  /** Show the print as it is at time t (s). */
  function show(t) {
    sim.t = t;
    const r = toolpath.simulate(t);
    if (!r) return;
    if (t >= toolpath.duration) printer.park(); else printer.setHead(...r.pos);
    panel.progress(r.t, r.layer);
  }

  function setPlaying(v) {
    sim.playing = v;
    panel.setPlaying(v);
    if (v && !printer.visible) setPrinterVisible(true, false);   // show the machine at work (not saved)
  }

  return {
    sim, show, setPlaying,
    /** Play or pause; at the end, play starts over. */
    toggle() {
      if (!toolpath.active) return;
      if (!sim.playing && sim.t >= toolpath.duration - 1e-6) sim.t = 0;
      setPlaying(!sim.playing);
    },
    /** Jump to the end of layer n (1-based), pausing. */
    scrub(n) { setPlaying(false); show(toolpath.layerEnd(n)); },
    /** Advance by dt real seconds (called every frame). */
    tick(dt) {
      if (!sim.playing) return;
      const t = sim.t + dt * sim.speed;
      if (t >= toolpath.duration) setPlaying(false);
      show(Math.min(t, toolpath.duration));
    },
    /** Back to the start with the head parked (the slice was dropped). */
    reset() { setPlaying(false); sim.t = 0; printer.park(); },
    setSpeed(x) { sim.speed = x; },
  };
}
