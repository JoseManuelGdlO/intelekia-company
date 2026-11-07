/** Identidad visual de Intelekia Consultoría. */
export const BRAND = {
  green: 0x198f70,
  navy: 0x06212c,
  tagline: 'Software inteligente, decisiones brillantes',
};

const images = {};

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Precarga los logos (se usan para dibujar texturas en canvas). */
export async function loadBrandAssets() {
  const [logo, logoWhite, icon] = await Promise.all([
    loadImage('/assets/logo.png'),
    loadImage('/assets/logo-white.png'),
    loadImage('/assets/logo-icon.png'),
  ]);
  Object.assign(images, { logo, logoWhite, icon });
}

export function brandImage(name) {
  return images[name] || null;
}

/** Dibuja una imagen centrada dentro de una caja, conservando su proporción. */
export function drawContained(ctx, img, x, y, w, h) {
  if (!img) return false;
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  return true;
}
