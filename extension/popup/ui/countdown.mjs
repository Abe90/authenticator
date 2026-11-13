import { TOTP_PERIOD } from '../../core/totp.mjs';
import { reducedMotion } from './dom.mjs';

export function createCountdown() {
  const states = new Map();

  // The sector of the time left, from the top anticlockwise. More than half goes first down the left half and then on
  // from the bottom: a single arc whose ends almost meet at the top, as just after a new period, is ambiguous, and
  // Firefox would not draw it for a few frames.
  function paint(sector, remaining) {
    if (remaining === TOTP_PERIOD) {
      sector.setAttribute('d', 'M16 2 A14 14 0 1 1 16 30 A14 14 0 1 1 16 2 Z');
    } else if (remaining === 0) {
      sector.setAttribute('d', '');
    } else {
      const angle = -(remaining / TOTP_PERIOD) * 2 * Math.PI - Math.PI / 2;
      const x = 16 + 14 * Math.cos(angle);
      const y = 16 + 14 * Math.sin(angle);
      const half = remaining > TOTP_PERIOD / 2 ? 'A14 14 0 0 0 16 30 ' : '';
      sector.setAttribute('d', `M16 16 L16 2 ${half}A14 14 0 0 0 ${x} ${y} Z`);
    }
  }

  function draw(sector, remaining) {
    const previous = states.get(sector);
    if (previous?.remaining === remaining) return;
    if (previous?.frame) cancelAnimationFrame(previous.frame);
    const state = { remaining, frame: 0 };
    states.set(sector, state);
    // A new period: the full circle fades in and grows from the centre, instead of appearing at once.
    if (!reducedMotion() && previous && remaining === TOTP_PERIOD && previous.remaining < TOTP_PERIOD) {
      paint(sector, remaining);
      sector.animate([{ opacity: 0, transform: 'scale(0.5)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
      return;
    }
    if (reducedMotion() || !previous || previous.remaining - remaining !== 1) {
      paint(sector, remaining);
      return;
    }
    const started = performance.now();
    function animate(now) {
      const progress = Math.min(1, (now - started) / 160);
      paint(sector, previous.remaining + (remaining - previous.remaining) * (1 - (1 - progress) ** 3));
      state.frame = progress < 1 ? requestAnimationFrame(animate) : 0;
    }
    state.frame = requestAnimationFrame(animate);
  }

  function clear() {
    for (const { frame } of states.values()) if (frame) cancelAnimationFrame(frame);
    states.clear();
  }

  return { draw, clear };
}
