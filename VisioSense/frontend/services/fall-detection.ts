import { Accelerometer } from 'expo-sensors';

// Single-spike detector. Any sudden movement above the threshold fires immediately.
// Tuned aggressively so a phone toss / sharp shake reliably triggers.
const SAMPLE_INTERVAL_MS = 20;        // 50 Hz
const SPIKE_G = 1.12;                  // gravity = 1.0 g; even a small bump clears 1.12 g
const COOLDOWN_MS = 15_000;

type FallDetectorOptions = {
  onFall: () => void;
};

type FallDetector = {
  stop: () => void;
};

let active: FallDetector | null = null;

export function startFallDetection({ onFall }: FallDetectorOptions): FallDetector {
  if (active) active.stop();

  Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);

  let lastFireAt = 0;

  const sub = Accelerometer.addListener(({ x, y, z }) => {
    const mag = Math.sqrt(x * x + y * y + z * z);
    const now = Date.now();

    if (lastFireAt && now - lastFireAt < COOLDOWN_MS) return;
    if (mag < SPIKE_G) return;

    lastFireAt = now;
    try {
      onFall();
    } catch (err) {
      console.warn('[fall-detection] onFall threw', err);
    }
  });

  const handle: FallDetector = {
    stop: () => {
      sub.remove();
      if (active === handle) active = null;
    },
  };
  active = handle;
  return handle;
}

export function stopFallDetection() {
  active?.stop();
  active = null;
}
