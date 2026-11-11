/* STARFALL · generative ambient audio — fully synthesised, no samples.
 * A slow chord pad, sub drone, breathing noise, pentatonic bells and a soft
 * pulse. Exposes smoothed frequency-band levels for the visuals. */
(function () {
  'use strict';
  const NEB = (window.NEB = window.NEB || {});
  const AudioCtx = window.AudioContext || window.webkitAudioContext;

  const CHORDS = [
    [110.00, 130.81, 164.81, 220.00, 261.63], // Am
    [87.31, 110.00, 130.81, 174.61, 220.00],   // F
    [130.81, 164.81, 196.00, 261.63, 329.63],  // C
    [98.00, 123.47, 146.83, 196.00, 246.94],   // G
  ];
  const PENTA = [220.0, 246.94, 261.63, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];

  const levels = { bass: 0, mid: 0, treble: 0, level: 0 };
  const zeros = { bass: 0, mid: 0, treble: 0, level: 0 };

  let ctx = null;
  let master = null;
  let comp = null;
  let analyser = null;
  let reverb = null;
  let reverbSend = null;
  let delay = null;
  let delaySend = null;
  let padBus = null;
  let bellBus = null;
  let padVoices = [];
  let subOsc = null;
  let subGain = null;
  let noiseGain = null;
  let freqData = null;
  let timeData = null;
  let built = false;
  let chordIndex = 0;
  let chordTimer = 0;
  let bellTimer = 0;
  let pulseTimer = 0;
  let active = false;
  let seed = 7331;

  function rnd() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  function buildImpulse(seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (rnd() * 2 - 1) * Math.pow(1 - t, decay) * (i < rate * 0.01 ? 0.2 : 1);
      }
    }
    return buf;
  }

  function makeNoiseBuffer(seconds) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = rnd() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
      }
    }
    return buf;
  }

  function makeOsc(type, freq, detune) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    return o;
  }

  function init() {
    if (built || !AudioCtx) return;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0.0001;

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 24;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.32;

    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.82;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);

    master.connect(comp);
    comp.connect(analyser);
    comp.connect(ctx.destination);

    // reverb
    reverb = ctx.createConvolver();
    reverb.buffer = buildImpulse(2.6, 2.2);
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.5;
    reverbSend.connect(reverb);
    reverb.connect(master);

    // ping-pong-ish delay
    delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const delayWet = ctx.createGain();
    delayWet.gain.value = 0.28;
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(delayWet);
    delayWet.connect(master);
    delaySend = ctx.createGain();
    delaySend.gain.value = 0.30;
    delaySend.connect(delay);

    // pad bus
    padBus = ctx.createGain();
    padBus.gain.value = 0.16;
    padBus.connect(master);
    padBus.connect(reverbSend);

    // slow filter opening
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 760;
    padFilter.Q.value = 0.6;
    padFilter.connect(padBus);

    const lfo = makeOsc('sine', 0.037, 0);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 340;
    lfo.connect(lfoGain);
    lfoGain.connect(padFilter.frequency);
    lfo.start();

    // four detuned pad voices (root, fifth, octave, ninth colour)
    const ratios = [1.0, 1.4983, 2.0, 2.9975];
    for (let i = 0; i < ratios.length; i++) {
      const g = ctx.createGain();
      g.gain.value = [0.16, 0.10, 0.07, 0.045][i];
      const o1 = makeOsc(i === 3 ? 'triangle' : 'sawtooth', 110 * ratios[i], -4);
      const o2 = makeOsc('sawtooth', 110 * ratios[i], 5);
      o1.connect(g);
      o2.connect(g);
      g.connect(padFilter);
      o1.start();
      o2.start();
      padVoices.push({ o1: o1, o2: o2, ratio: ratios[i], gain: g });
    }

    // sub drone
    subGain = ctx.createGain();
    subGain.gain.value = 0.16;
    const subFilter = ctx.createBiquadFilter();
    subFilter.type = 'lowpass';
    subFilter.frequency.value = 120;
    subOsc = makeOsc('sine', 55, 0);
    subOsc.connect(subFilter);
    subFilter.connect(subGain);
    subGain.connect(master);
    subGain.connect(reverbSend);
    subOsc.start();

    const subLfo = makeOsc('sine', 0.061, 0);
    const subLfoGain = ctx.createGain();
    subLfoGain.gain.value = 0.07;
    subLfo.connect(subLfoGain);
    subLfoGain.connect(subGain.gain);
    subLfo.start();

    // breathing filtered noise
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(4.0);
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1400;
    noiseFilter.Q.value = 0.7;
    noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.05;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noiseGain.connect(reverbSend);
    noise.start();

    const noiseLfo = makeOsc('sine', 0.043, 0);
    const noiseLfoGain = ctx.createGain();
    noiseLfoGain.gain.value = 0.035;
    noiseLfo.connect(noiseLfoGain);
    noiseLfoGain.connect(noiseGain.gain);
    noiseLfo.start();

    // bells bus
    bellBus = ctx.createGain();
    bellBus.gain.value = 0.9;
    bellBus.connect(master);
    bellBus.connect(reverbSend);
    bellBus.connect(delaySend);

    built = true;
    scheduleChord();
  }

  function setChord() {
    if (!ctx || !padVoices.length) return;
    const chord = CHORDS[chordIndex % CHORDS.length];
    const now = ctx.currentTime;
    padVoices.forEach(function (v, i) {
      v.o1.frequency.setTargetAtTime(chord[Math.min(i, 3)] * v.ratio, now, 2.4);
      v.o2.frequency.setTargetAtTime(chord[Math.min(i, 3)] * v.ratio, now, 2.4);
      v.gain.gain.setTargetAtTime([0.16, 0.10, 0.07, 0.045][i] * (0.8 + Math.random() * 0.4), now, 2.0);
    });
    if (subOsc) subOsc.frequency.setTargetAtTime(chord[0] * 0.5, now, 2.4);
    chordIndex++;
  }

  function scheduleChord() {
    clearTimeout(chordTimer);
    chordTimer = setTimeout(function () {
      setChord();
      scheduleChord();
    }, 13000 + Math.random() * 5000);
  }

  function scheduleBell() {
    clearTimeout(bellTimer);
    const wait = 2600 + Math.random() * 4200;
    bellTimer = setTimeout(function () {
      playBell();
      scheduleBell();
    }, wait);
  }

  function playBell() {
    if (!ctx || !active) return;
    const now = ctx.currentTime;
    const freq = PENTA[Math.floor(Math.random() * PENTA.length)] * (Math.random() < 0.3 ? 0.5 : 1);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = Math.random() * 1.6 - 0.8;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.10 + Math.random() * 0.08, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 2.2 + Math.random() * 2.2);

    const o = makeOsc('sine', freq, 0);
    const o2 = makeOsc('sine', freq * 2.001, 0);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    const out = pan || ctx.createGain();
    g.connect(out);
    if (pan) pan.connect(bellBus);
    else out.connect(bellBus);

    o.start(now);
    o2.start(now);
    o.stop(now + 4.6);
    o2.stop(now + 4.6);
  }

  function playPulse() {
    if (!ctx || !active) return;
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.20, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    const o = makeOsc('sine', 96, 0);
    o.frequency.setValueAtTime(96, now);
    o.frequency.exponentialRampToValueAtTime(42, now + 0.22);
    o.connect(g);
    g.connect(master);
    o.start(now);
    o.stop(now + 0.6);
  }

  function schedulePulse() {
    clearTimeout(pulseTimer);
    const wait = 2400 + Math.random() * 2200;
    pulseTimer = setTimeout(function () {
      playPulse();
      schedulePulse();
    }, wait);
  }

  function startTimers() {
    clearTimeout(bellTimer);
    clearTimeout(pulseTimer);
    scheduleBell();
    schedulePulse();
  }

  function stopTimers() {
    clearTimeout(bellTimer);
    clearTimeout(pulseTimer);
    bellTimer = 0;
    pulseTimer = 0;
  }

  function readLevels() {
    if (!analyser || !active) {
      levels.bass *= 0.9;
      levels.mid *= 0.9;
      levels.treble *= 0.9;
      levels.level *= 0.9;
      return levels;
    }
    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);

    const rate = ctx.sampleRate;
    const bins = freqData.length;
    const binHz = rate / 2 / bins;
    let bass = 0, mid = 0, treble = 0;
    let bassN = 0, midN = 0, trebleN = 0;
    for (let i = 1; i < bins; i++) {
      const f = i * binHz;
      const v = freqData[i] / 255;
      if (f < 160) { bass += v; bassN++; }
      else if (f < 1600) { mid += v; midN++; }
      else if (f < 9000) { treble += v; trebleN++; }
    }
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) {
      const d = (timeData[i] - 128) / 128;
      sum += d * d;
    }
    const rms = Math.sqrt(sum / timeData.length);

    const targets = {
      bass: bassN ? bass / bassN : 0,
      mid: midN ? mid / midN : 0,
      treble: trebleN ? treble / trebleN : 0,
      level: Math.min(1, rms * 3.2),
    };
    const keys = ['bass', 'mid', 'treble', 'level'];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const target = targets[k];
      const ema = target > levels[k] ? 0.55 : 0.12;
      levels[k] += (target - levels[k]) * ema;
    }
    return levels;
  }

  NEB.Audio = {
    get on() { return active; },
    ready: !!AudioCtx,

    async toggle() {
      try {
        if (!AudioCtx) return false;
        if (!built) init();
        if (!ctx) return false;
        if (active) {
          active = false;
          stopTimers();
          clearTimeout(chordTimer);
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.28);
          return false;
        }
        if (ctx.state === 'suspended') await ctx.resume();
        active = true;
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(0.22, ctx.currentTime, 0.5);
        setChord();
        scheduleChord();
        startTimers();
        return true;
      } catch (err) {
        console.warn('[STARFALL] audio unavailable:', err);
        active = false;
        return false;
      }
    },

    sample() {
      if (!active) return zeros;
      return readLevels();
    },

    dispose() {
      try {
        stopTimers();
        clearTimeout(chordTimer);
        if (ctx) ctx.close();
      } catch (err) { /* noop */ }
      ctx = null;
      built = false;
      active = false;
    },
  };
})();
