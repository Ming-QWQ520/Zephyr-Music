import { usePlayerStore } from "@/stores/player";

/**
 * Audio visualizer composable — procedural simulation.
 *
 * WHY NOT WEB AUDIO API?
 * ----------------------
 * We do NOT use `createMediaElementSource()` + `AnalyserNode` because:
 *
 * 1. PLAYBACK RELIABILITY: `createMediaElementSource` permanently reroutes
 *    the `<audio>` element's output into the Web Audio graph. If the
 *    AudioContext enters "suspended" state (which happens when the tab loses
 *    focus, after periods of inactivity, or after pause/resume cycles),
 *    `audio.play()` starts the element (currentTime advances) but NO SOUND
 *    is produced. The user experiences "play button works but no audio".
 *
 * 2. CORS: The qijieya stream API does not send CORS headers. Without
 *    `crossOrigin="anonymous"` the media is opaque and `getByteFrequencyData`
 *    returns all zeros (tainted output). With `crossOrigin="anonymous"` the
 *    media fails to load entirely. So real frequency analysis is impossible.
 *
 * SIMULATION
 * ----------
 * Instead we synthesize a believable spectrum from the player state:
 *   - store.currentTime: deterministic per-song motion (each second looks
 *     different, seek jumps reset the pattern)
 *   - store.volume: scales overall amplitude (mute = flat, full vol = tall)
 *   - store.isPlaying: pauses decay to zero, resume restarts motion
 *   - Per-bin stable phase + frequency offsets (lower bins = bass = slower +
 *     beat-reactive; higher bins = treble = faster + jittery)
 *   - Beat pulses at ~120 BPM with per-song variation
 *   - Slow LFO for ebb-and-flow
 *
 * The simulation never touches the audio element, so it CANNOT interfere
 * with playback. It tracks play/pause/volume/seek state correctly.
 */
const MAX_BINS = 32;

// Stable per-bin phase + frequency offsets (computed once for determinism).
const BIN_PHASES = new Float32Array(MAX_BINS);
const BIN_FREQS = new Float32Array(MAX_BINS);
for (let i = 0; i < MAX_BINS; i++) {
  BIN_PHASES[i] = ((Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1) * Math.PI * 2;
  BIN_FREQS[i] = 0.6 + (i / MAX_BINS) * 2.4 + ((i * 7) % 5) * 0.18;
}

export function useAudioVisualizer() {
  const store = usePlayerStore();
  // Smoothed amplitude per bin (low-pass for organic motion)
  const smoothed = new Float32Array(MAX_BINS);
  let beatPhase = 0;
  let beatIntensity = 0;
  let lastFrameTime = 0;
  let lastCurrentTime = -1;

  /**
   * Fill `out` with frequency data in [0, 255].
   * Returns true if the visualizer should keep animating (playing OR decaying),
   * false if fully settled (paused long enough that output is ~0).
   */
  function fillFrequency(out: Uint8Array): boolean {
    const n = Math.min(out.length, MAX_BINS);
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const dt = lastFrameTime ? Math.min(0.05, (nowMs - lastFrameTime) / 1000) : 1 / 60;
    lastFrameTime = nowMs;

    // Detect seek (currentTime jumped by more than 2s) → reset phases for a
    // fresh visual pattern at the new position.
    if (lastCurrentTime >= 0 && Math.abs(store.currentTime - lastCurrentTime) > 2) {
      beatPhase = 0;
    }
    lastCurrentTime = store.currentTime;

    if (!store.isPlaying) {
      // Decay to zero when paused
      let settled = true;
      for (let i = 0; i < n; i++) {
        smoothed[i] *= 0.86;
        out[i] = Math.round(smoothed[i] * 255);
        if (out[i] > 2) settled = false;
      }
      return !settled;
    }

    const vol = store.muted ? 0 : store.volume;
    const t = store.currentTime;
    // Per-song tempo variation so different songs don't all pulse identically
    const songSeed = (store.currentSong?.id?.length || 0) % 7;
    const bpm = 120 + songSeed * 6;
    const beatHz = bpm / 60;

    // Beat pulse: sharp attack (4th-power sharpening), slow decay
    beatPhase += beatHz * dt * Math.PI * 2;
    const beatRaw = Math.max(0, Math.sin(beatPhase));
    const beatPulse = Math.pow(beatRaw, 4);
    beatIntensity = beatIntensity * 0.82 + beatPulse * 0.35;
    // Slow LFO for overall ebb-and-flow
    const lfo = 0.5 + 0.5 * Math.sin(t * 0.18);

    for (let i = 0; i < n; i++) {
      // Lower bins (bass) react strongly to beats; higher bins (treble) get
      // faster, gentler motion.
      const bassWeight = Math.max(0, 1 - i / (n * 0.55));
      const trebleWeight = Math.max(0, (i - n * 0.4) / (n * 0.6));
      // Per-bin oscillator at its own frequency, phase-shifted
      const phase = BIN_PHASES[i] + t * BIN_FREQS[i] * Math.PI * 2;
      let v = 0.5 + 0.5 * Math.sin(phase); // 0..1
      v = v * (0.6 + 0.4 * lfo) + bassWeight * beatIntensity * 0.7;
      v += trebleWeight * 0.18 * (0.5 + 0.5 * Math.sin(t * 8 + i));
      v *= 0.35 + vol * 0.95;
      v = Math.max(0, Math.min(1, v));
      // Low-pass smooth for organic motion
      smoothed[i] = smoothed[i] * 0.62 + v * 0.38;
      out[i] = Math.round(smoothed[i] * 255);
    }
    return true;
  }

  return { fillFrequency, maxBins: MAX_BINS };
}
