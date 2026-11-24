// Slice / Export buttons, the layer slider bar with print playback, and the slice summary card.
const $ = id => document.getElementById(id);

function hms(sec) {
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h} h ${m} min` : `${m} min ${s % 60} s`;
}
const clock = sec => {
  const s = Math.floor(sec);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':');
};

function bindSwitch(btn, initial, onToggle) {
  const set = v => { btn.classList.toggle('on', v); btn.setAttribute('aria-checked', String(v)); };
  let v = initial;
  set(v);
  btn.addEventListener('click', () => { v = !v; set(v); onToggle(v); });
  return { set: nv => { v = nv; set(v); } };
}

/**
 * @param actions {
 *   exportGcode(), setShowModel(v), setShowTravel(v),
 *   viewMode, setViewMode(v)   the Toolpath / Material switch (initial value and change)
 *   exact, setExact(v)         the Exact G-code switch
 *   scrubLayer(n)    jump to the end of layer n (1-based), pausing playback
 *   togglePlay()     start or pause the print simulation
 *   setSpeed(x)      playback speed multiplier
 * }
 */
export function initSlicePanel(actions) {
  const exportBtn = $('export'), bar = $('slicebar'), info = $('sliceInfo');
  const slider = $('layer'), label = $('layerLabel'), playBtn = $('play'), speed = $('simSpeed'), time = $('simTime');
  let layers = [], total = 0;
  const legend = bar.querySelector('.legend'), legendHTML = legend.innerHTML;   // the type colors; a G-code file without types shows speeds instead

  const npBtn = $('sliceNP');
  exportBtn.addEventListener('click', actions.exportGcode);
  const modelSw = bindSwitch($('showModel'), false, actions.setShowModel);
  bindSwitch($('showTravel'), false, actions.setShowTravel);
  bindSwitch($('showExact'), !!actions.exact, actions.setExact);
  const viewBtns = document.querySelectorAll('[data-view]');
  const markView = v => viewBtns.forEach(b => b.classList.toggle('on', b.dataset.view === v));
  markView(actions.viewMode);
  viewBtns.forEach(b => b.addEventListener('click', () => { markView(b.dataset.view); actions.setViewMode(b.dataset.view); }));
  playBtn.addEventListener('click', actions.togglePlay);
  speed.addEventListener('change', () => actions.setSpeed(+speed.value));

  const showLabel = n => {
    const l = layers[n - 1];
    label.textContent = !l ? "" : `${n} / ${layers.length} · Z ${l.zMax - l.zMin > 0.5 ? l.zMin.toFixed(1) + "–" + l.zMax.toFixed(1) : l.z.toFixed(2)}`;
  };
  slider.addEventListener('input', () => { showLabel(+slider.value); actions.scrubLayer(+slider.value); });
  addEventListener('keydown', e => {
    if (bar.hidden || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === ' ') {
      if (e.target.tagName === 'BUTTON') return;     // a focused button handles Space itself
      e.preventDefault(); actions.togglePlay(); return;
    }
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') slider.value = +slider.value + step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') slider.value = +slider.value - step;
    else return;
    e.preventDefault();
    showLabel(+slider.value);
    actions.scrubLayer(+slider.value);
  });

  return {
    /** Enable Slice when a model is loaded. */
    setCanSlice(v, why) {
      npBtn.disabled = !v;
      npBtn.title = v ? 'Choose how to slice: standard, non-planar, ruffled wall, loop texture (S = standard, with the current path mode)' : (why || 'Load a model first');
    },
    busy(v, np = false) {
      npBtn.textContent = v ? 'Slicing…' : 'Slice ▾';
      npBtn.disabled = v;
    },
    /** Total print time (s) shown next to the clock, when the preview is redrawn. */
    setTotal(d) { total = d; },
    get speed() { return +speed.value; },

    /** Show a finished slice. `duration`: simulated print time in s. */
    show(tp, stats, o, duration) {
      layers = tp.layers;
      total = duration;
      slider.max = layers.length;
      modelSw.set(false);
      bar.hidden = false;
      exportBtn.disabled = false;
      exportBtn.title = 'Download the G-code';
      const over = o.reservoir > 0 && stats.volume / 1000 > o.reservoir;
      info.innerHTML = `<b>Sliced</b> · ${stats.layers} layers · ${hms(stats.time)}<br>`
        + `Clay ≈ ${(stats.volume / 1000).toFixed(0)} ml`
        + (over ? ` · <span class="warn">more than the ${o.reservoir} ml tank</span>` : '')
        + ` · path ${(stats.extrudeLen / 1000).toFixed(1)} m`
        + tp.warnings.map(w => `<br><span class="warn">${w}</span>`).join('');
      info.hidden = false;
      this.progress(duration, layers.length - 1);
    },


    /**
     * Show a G-code file that was opened (not sliced here): layer bar, summary card with a Close button.
     * @param r     result of readGcode(): layers, stats, warnings
     * @param opts  { name, onClose, hasModel: an STL is loaded (its Model switch stays), bySpeed: colors are speeds }
     */
    showGcode(r, { name, onClose, hasModel, bySpeed, warnings = r.warnings }) {
      layers = r.layers;
      total = r.stats.time;
      slider.max = Math.max(1, layers.length);
      modelSw.set(false);
      $('showModel').hidden = !hasModel;
      $('showExact').hidden = true;                    // a G-code file is always shown exactly
      legend.innerHTML = bySpeed
        ? `<i style="background:linear-gradient(90deg,#4aa3ff,#ff8c42);width:48px"></i>Speed ${r.stats.vMin.toFixed(0)}–${r.stats.vMax.toFixed(0)} mm/s (slow to fast)`
        : legendHTML;
      bar.hidden = false;
      exportBtn.disabled = true;
      exportBtn.title = 'A G-code file is open: nothing to export';
      const st = r.stats;
      info.innerHTML = `<b>${name.replace(/</g, '&lt;')}</b> · ${st.layers} layers · ${hms(st.time)}<br>`
        + `Clay ≈ ${(st.volume / 1000).toFixed(0)} ml · path ${(st.extrudeLen / 1000).toFixed(1)} m`
        + warnings.map(w => `<br><span class="warn">${w}</span>`).join('')
        + `<br><button class="btn" id="closeGcode" style="margin-top:6px">Close G-code</button>`;
      info.hidden = false;
      $('closeGcode').addEventListener('click', onClose);
      this.progress(st.time, Math.max(0, layers.length - 1));
    },
    /** Reflect the simulation state: time t (s) and the 0-based layer being printed. */
    progress(t, layer) {
      slider.value = layer + 1;
      showLabel(layer + 1);
      time.textContent = `${clock(t)} / ${clock(total)}`;
    },

    setPlaying(v) {
      playBtn.textContent = v ? '❚❚' : '▶';
      playBtn.setAttribute('aria-label', v ? 'Pause' : 'Play');
      playBtn.classList.toggle('on', v);
    },

    /** Drop a slice that no longer matches the model or settings. */
    reset(message) {
      layers = [];
      bar.hidden = true;
      $('showModel').hidden = false; $('showExact').hidden = false; legend.innerHTML = legendHTML;   // back from a G-code file
      exportBtn.disabled = true;
      exportBtn.title = 'Slice first';
      this.setPlaying(false);
      info.hidden = !message;
      if (message) info.innerHTML = `<span class="muted">${message}</span>`;
    },
  };
}
