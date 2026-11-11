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
 *   slice(), exportGcode(), setShowModel(v), setShowTravel(v),
 *   scrubLayer(n)    jump to the end of layer n (1-based), pausing playback
 *   togglePlay()     start or pause the print simulation
 *   setSpeed(x)      playback speed multiplier
 * }
 */
export function initSlicePanel(actions) {
  const sliceBtn = $('slice'), exportBtn = $('export'), bar = $('slicebar'), info = $('sliceInfo');
  const slider = $('layer'), label = $('layerLabel'), playBtn = $('play'), speed = $('simSpeed'), time = $('simTime');
  let layers = [], total = 0;

  sliceBtn.addEventListener('click', actions.slice);
  exportBtn.addEventListener('click', actions.exportGcode);
  const modelSw = bindSwitch($('showModel'), false, actions.setShowModel);
  bindSwitch($('showTravel'), false, actions.setShowTravel);
  playBtn.addEventListener('click', actions.togglePlay);
  speed.addEventListener('change', () => actions.setSpeed(+speed.value));

  const showLabel = n => {
    const l = layers[n - 1];
    label.textContent = l ? `${n} / ${layers.length} · Z ${l.z.toFixed(2)}` : '';
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
    setCanSlice(v) {
      sliceBtn.disabled = !v;
      sliceBtn.title = v ? 'Slice the model (S)' : 'Load a model first';
    },
    busy(v) { sliceBtn.textContent = v ? 'Slicing…' : 'Slice'; sliceBtn.disabled = v; },
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
      exportBtn.disabled = true;
      exportBtn.title = 'Slice first';
      this.setPlaying(false);
      info.hidden = !message;
      if (message) info.innerHTML = `<span class="muted">${message}</span>`;
    },
  };
}
