// A slow, steady signal that keeps the scene gently alive: the oscilloscope, the spectrum ring
// and the network's breathing all read from it. Nothing here is tied to audio playback.

const BANDS = 48;

export function createSignal() {
  const wave = new Float32Array(1024);
  const spectrum = new Float32Array(BANDS);
  const levels = { low: 0, mid: 0, high: 0, beat: 0, wave, spectrum };

  levels.update = (t) => {
    levels.low = 0.12 + 0.05 * Math.sin(t * 0.35);
    levels.mid = 0.16 + 0.05 * Math.sin(t * 0.23 + 1.0);
    levels.high = 0.1 + 0.03 * Math.sin(t * 0.3 + 2.0);
    for (let i = 0; i < wave.length; i++) {
      wave[i] = 0.24 * Math.sin(i * 0.028 + t * 0.7) * Math.sin(i * 0.0061 + t * 0.21)
              + 0.05 * Math.sin(i * 0.11 - t * 1.3);
    }
    for (let b = 0; b < BANDS; b++) {
      spectrum[b] = 0.1 + 0.16 * Math.exp(-b / 18) * (0.75 + 0.25 * Math.sin(t * 0.45 + b * 0.22))
                  + 0.04 * (0.5 + 0.5 * Math.sin(b * 0.5 - t * 0.6));
    }
    return levels;
  };
  return levels;
}
