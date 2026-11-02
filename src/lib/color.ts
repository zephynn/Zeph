/**
 * Samples a small downscaled copy of the image to estimate average
 * perceived luminance (0 = black, 1 = white). Used to decide whether the
 * page should flip to light-on-dark text for a dark/saturated avatar.
 * Resolves to 1 (assume light) if the image fails to load or the canvas
 * read is blocked (e.g. no CORS headers), which keeps the default light
 * theme rather than guessing wrong.
 */
export function estimateLuminance(imageUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const size = 16;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(1);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let total = 0;
        const pixelCount = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          total += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        }
        resolve(total / pixelCount / 255);
      } catch {
        resolve(1);
      }
    };

    img.onerror = () => resolve(1);
    img.src = imageUrl;
  });
}

export interface Palette {
  /** Distinct colours as [r, g, b] (0–255), most prominent first. */
  colors: [number, number, number][];
  /** Average perceived luminance of the image, 0 (black) to 1 (white). */
  luminance: number;
}

/**
 * Picks `count` distinct, prominent colours from an image, for the animated
 * background. Pixels are grouped into coarse colour buckets; buckets are
 * ranked by how many pixels they hold (with a bonus for saturated colours,
 * so a vivid accent beats a big grey area), and a colour is only taken if
 * it's clearly different from the ones already picked.
 *
 * Resolves to null if the image can't be read (load error / no CORS).
 */
export function extractPalette(imageUrl: string, count = 4): Promise<Palette | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        // Bucket by 4 bits per channel; keep a running sum to average each bucket.
        const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
        let luminanceTotal = 0;
        let pixels = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue; // skip transparent pixels
          const r = data[i], g = data[i + 1], b = data[i + 2];
          luminanceTotal += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          pixels++;
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          const bucket = buckets.get(key);
          if (bucket) {
            bucket.r += r; bucket.g += g; bucket.b += b; bucket.n++;
          } else {
            buckets.set(key, { r, g, b, n: 1 });
          }
        }
        if (pixels === 0) return resolve(null);

        const ranked = [...buckets.values()]
          .map(({ r, g, b, n }) => {
            const c = [r / n, g / n, b / n];
            const max = Math.max(...c), min = Math.min(...c);
            const saturation = max === 0 ? 0 : (max - min) / max;
            return { c, score: n * (1 + saturation * 2) };
          })
          .sort((a, b) => b.score - a.score);

        const picked: number[][] = [];
        const distance = (a: number[], b: number[]) =>
          Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        // Relax the "must be different" threshold if the image is nearly
        // single-coloured, so we still end up with `count` colours.
        for (const minDistance of [70, 45, 25, 0]) {
          for (const { c } of ranked) {
            if (picked.length >= count) break;
            if (picked.every((p) => distance(p, c) > minDistance)) picked.push(c);
          }
          if (picked.length >= count) break;
        }
        while (picked.length < count) picked.push(picked[picked.length - 1] ?? [128, 128, 128]);

        resolve({
          colors: picked.map(([r, g, b]) => [Math.round(r), Math.round(g), Math.round(b)] as [number, number, number]),
          luminance: luminanceTotal / pixels,
        });
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

/**
 * Returns the colour as a CSS string with its HSL lightness clamped to
 * [minL, maxL] (0–1). Hue and saturation are kept, so a colour stays
 * recognisably itself, just brighter or darker.
 */
export function clampLightness([r, g, b]: [number, number, number], minL: number, maxL: number): string {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  // Near-greys (whites, blacks, greys with a faint tint) stay neutral: their
  // tiny tint would otherwise become an obvious colour once the lightness
  // is moved, e.g. a slightly blue white turning into lavender.
  const s = d < 0.1 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const clamped = Math.min(Math.max(l, minL), maxL);
  return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(clamped * 100).toFixed(0)}%)`;
}

