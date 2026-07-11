const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Eases a number displayed in `el` from its last animated value up (or down) to `to`. */
export function animateCount(el: HTMLElement, to: number, format: (n: number) => string, duration = 700) {
  const from = Number(el.dataset.animatedValue ?? "0");
  el.dataset.animatedValue = String(to);

  if (prefersReducedMotion() || from === to) {
    el.textContent = format(to);
    return;
  }

  const start = performance.now();

  function tick(now: number) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = Math.round(from + (to - from) * eased);
    el.textContent = format(value);
    if (t < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
