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

/**
 * The most prominent *vivid* colour in an image, as a CSS colour, for
 * accents (progress bar, equaliser, glow). Pixels are bucketed coarsely and
 * each bucket scores by pixel count × saturation, so a strong accent colour
 * beats a large grey or black area. Lightness is kept in a mid range so the
 * accent stays visible against both light and dark text themes.
 *
 * Resolves to null if the image can't be read (load error / no CORS); the
 * caller then keeps its default colours.
 */
export function dominantAccent(imageUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
          const bucket = buckets.get(key);
          if (bucket) {
            bucket.r += r; bucket.g += g; bucket.b += b; bucket.n++;
          } else {
            buckets.set(key, { r, g, b, n: 1 });
          }
        }

        let best: { h: number; s: number; score: number } | null = null;
        for (const { r, g, b, n } of buckets.values()) {
          const [h, s, l] = rgbToHsl(r / n, g / n, b / n);
          // Ignore near-black/near-white, which have no usable hue.
          if (l < 0.08 || l > 0.95) continue;
          const score = n * (0.15 + s);
          if (!best || score > best.score) best = { h, s, score };
        }
        if (!best) return resolve(null);

        const saturation = Math.max(best.s, 0.45);
        resolve(`hsl(${best.h.toFixed(0)} ${(saturation * 100).toFixed(0)}% 58%)`);
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}
