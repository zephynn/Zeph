// Liquid Glass refraction layer.
//
// The "lens" look (background bending at the edges of a glass surface) comes
// from an SVG displacement filter used as a CSS backdrop-filter:
//   backdrop-filter: url(#lg-refract)
// Only Chromium browsers render SVG filters inside backdrop-filter. Safari and
// Firefox parse it but draw nothing — which would wipe out the blur entirely —
// so the filter is only switched on (via `html.lg-refract`) when we're sure it
// will render. Everyone else keeps the plain frosted-blur glass from style.css.
//
// It's also skipped on low-power devices and when the visitor asks for reduced
// transparency, because the displacement pass re-runs every time the content
// behind a glass surface changes (e.g. the drifting background blobs).

const FILTER_ID = "lg-refract";

// Displacement map, stretched over each element's box.
// Red = horizontal shift, green = vertical shift, 128 = no shift.
// The map is neutral in the middle and ramps up near each edge, so the
// backdrop is pulled inward at the rim — like light bending through the
// thick edge of a glass lens — while the centre stays undistorted.
const DISPLACEMENT_MAP_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200" preserveAspectRatio="none">
  <defs>
    <linearGradient id="x" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="rgb(255,0,0)"/>
      <stop offset="0.14" stop-color="rgb(128,0,0)"/>
      <stop offset="0.86" stop-color="rgb(128,0,0)"/>
      <stop offset="1" stop-color="rgb(0,0,0)"/>
    </linearGradient>
    <linearGradient id="y" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="rgb(0,255,0)"/>
      <stop offset="0.2" stop-color="rgb(0,128,0)"/>
      <stop offset="0.8" stop-color="rgb(0,128,0)"/>
      <stop offset="1" stop-color="rgb(0,0,0)"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" fill="url(#x)"/>
  <rect width="200" height="200" fill="url(#y)" style="mix-blend-mode:screen"/>
</svg>`;

function isChromium(): boolean {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData
    ?.brands;
  if (brands) return brands.some((b) => b.brand === "Chromium");
  // Older Chromium without UA-CH: exclude Safari (no "Chrome/") and Firefox.
  const ua = navigator.userAgent;
  return /Chrome\/\d+/.test(ua) && !/Firefox|FxiOS|CriOS/.test(ua);
}

function isLowPowerDevice(): boolean {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 8;
  return (memory !== undefined && memory <= 4) || cores <= 4;
}

function prefersPlainSurfaces(): boolean {
  return (
    window.matchMedia("(prefers-reduced-transparency: reduce)").matches ||
    window.matchMedia("(prefers-contrast: more)").matches
  );
}

function injectFilter(): void {
  if (document.getElementById(FILTER_ID)) return;

  const mapUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(DISPLACEMENT_MAP_SVG.trim())}`;
  const svgNS = "http://www.w3.org/2000/svg";

  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.style.pointerEvents = "none";

  // primitiveUnits="objectBoundingBox" stretches the map over whatever element
  // the filter is applied to, so one filter works for pills and the big card.
  svg.innerHTML = `
    <filter id="${FILTER_ID}" x="0" y="0" width="1" height="1"
            primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">
      <feImage href="${mapUrl}" x="0" y="0" width="1" height="1"
               preserveAspectRatio="none" result="map" />
      <feDisplacementMap in="SourceGraphic" in2="map" scale="0.09"
                         xChannelSelector="R" yChannelSelector="G" />
    </filter>`;

  document.body.appendChild(svg);
}

export function initLiquidGlass(): void {
  if (!isChromium() || isLowPowerDevice() || prefersPlainSurfaces()) return;
  injectFilter();
  document.documentElement.classList.add("lg-refract");
}

initLiquidGlass();
