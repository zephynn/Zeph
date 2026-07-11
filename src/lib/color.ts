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
