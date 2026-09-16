// Shared by the React card and the self-contained local review preview.
// MD timing/lighting preserved; user override 2026-09-16: 0 -> 180 -> 360 -> 540.
// Never normalize the angle at rest: the next flip must continue forward.
export const FLIP_SPEC = Object.freeze({
  openMs: 350,
  closeMs: 320,
  perspectivePx: 750,
  easing: 'cubic-bezier(.44, .30, .56, .70)',
  lighting: [
    { offset: 0, opacity: 0 },
    { offset: 0.125, opacity: 0.12 },
    { offset: 0.25, opacity: 0.33 },
    { offset: 0.39, opacity: 0.55 },
    { offset: 0.5, opacity: 0.65 },
    { offset: 0.61, opacity: 0.55 },
    { offset: 0.75, opacity: 0.33 },
    { offset: 0.875, opacity: 0.12 },
    { offset: 1, opacity: 0 },
  ],
});

/**
 * Only transform the rotor. Animate black overlays on individual faces instead
 * of applying filter/opacity to the rotor, which would flatten its 3D children.
 * All effects share the same timeline start, duration and effect-level easing.
 * Lighting offsets therefore refer to ANGLE progress: dark at 90 degrees.
 * @param {HTMLButtonElement} card
 * @param {{onChange?: (state: {flipped: boolean, busy: boolean, angle: number}) => void}} options
 */
export function createCardFlip(card, options = {}) {
  const shades = Array.from(card.querySelectorAll('.flip-shade'));
  const faces = Array.from(card.querySelectorAll('.id-face'));
  const shell = card.closest('.flip-shell');
  const app = card.closest('.video-app');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let flipped = false;
  let angle = 0;
  let busy = false;
  let disposed = false;
  let generation = 0;
  /** @type {Animation[]} */
  let effects = [];
  /** @type {number | null} */
  let timer = null;

  if (shell instanceof HTMLElement) shell.style.perspective = `${FLIP_SPEC.perspectivePx}px`;
  card.style.transform = 'rotateY(0deg)';

  function notify() {
    card.setAttribute('aria-disabled', String(busy));
    card.setAttribute('aria-busy', String(busy));
    options.onChange?.({ flipped, busy, angle });
  }

  function motionDisabled() {
    return reduceMotion.matches || card.closest('.no-motion') !== null;
  }

  function clearEffects() {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    effects.forEach(effect => effect.cancel());
    effects = [];
  }

  /** @param {number} token */
  function settle(token) {
    if (disposed || token !== generation) return;
    // Commit the target before removing fill effects; no flash of the old face.
    card.style.transform = `rotateY(${angle}deg)`;
    generation += 1;
    clearEffects();
    busy = false;
    notify();
  }

  function onMotionChange() {
    if (busy && motionDisabled()) settle(generation);
  }

  reduceMotion.addEventListener('change', onMotionChange);
  const observer = new MutationObserver(onMotionChange);
  if (app) observer.observe(app, { attributes: true, attributeFilter: ['class'] });

  function flip() {
    if (disposed || busy) return false;
    const from = angle;
    angle += 180;
    flipped = !flipped;
    const to = angle;
    const token = ++generation;
    busy = true;
    notify();

    if (motionDisabled() || typeof card.animate !== 'function') {
      settle(token);
      return true;
    }

    /** @type {KeyframeAnimationOptions} */
    const timing = {
      duration: flipped ? FLIP_SPEC.openMs : FLIP_SPEC.closeMs,
      easing: FLIP_SPEC.easing,
      fill: 'both',
    };
    // Repeat the same angle-relative light curve for every forward half-turn.
    const shadowFrames = FLIP_SPEC.lighting.map(({ offset, opacity }) => ({
      offset,
      boxShadow: `0 2px ${4 + opacity * 12}px rgba(0,0,0,${0.04 + opacity * 0.10})`,
    }));

    try {
      effects.push(card.animate([
        { transform: `rotateY(${from}deg)` },
        { transform: `rotateY(${to}deg)` },
      ], timing));
      shades.forEach(shade => effects.push(shade.animate(FLIP_SPEC.lighting, timing)));
      faces.forEach(face => effects.push(face.animate(shadowFrames, timing)));

      // Bind rejection handlers before any cancel/fallback path can execute.
      Promise.all(effects.map(effect => effect.finished)).then(
        () => settle(token),
        () => settle(token),
      );
      const start = document.timeline.currentTime;
      if (start !== null) effects.forEach(effect => { effect.startTime = start; });
      card.style.transform = `rotateY(${to}deg)`;
      timer = window.setTimeout(() => settle(token), Number(timing.duration) + 150);
    } catch {
      // Partial Web Animations support must not leave a dark or locked card.
      effects.forEach(effect => { effect.finished.catch(() => {}); });
      settle(token);
    }
    return true;
  }

  function dispose() {
    disposed = true;
    generation += 1;
    clearEffects();
    reduceMotion.removeEventListener('change', onMotionChange);
    observer.disconnect();
  }

  notify();
  return { flip, dispose, getState: () => ({ flipped, busy, angle }) };
}
