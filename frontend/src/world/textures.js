import * as THREE from 'three';
import { hex, shade, hashString, seededRandom } from './materials.js';
import { BRAND, brandImage, drawContained } from './brand.js';

const FONT = '"Segoe UI", "Helvetica Neue", system-ui, sans-serif';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d') };
}

function toTexture(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitFont(ctx, text, weight, maxSize, maxWidth) {
  let size = maxSize;
  do {
    ctx.font = `${weight} ${size}px ${FONT}`;
    size -= 4;
  } while (ctx.measureText(text).width > maxWidth && size > 16);
}

export function woodFloorTexture(base, rng, repeat) {
  const { c, ctx } = makeCanvas(512, 512);
  const plankH = 64;
  for (let row = 0; row < 8; row += 1) {
    let x = -Math.floor(rng() * 200);
    while (x < 512) {
      const len = 180 + Math.floor(rng() * 220);
      ctx.fillStyle = hex(shade(base, (rng() - 0.5) * 0.2));
      ctx.fillRect(x, row * plankH, len, plankH);
      ctx.strokeStyle = 'rgba(60,35,15,0.10)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 6; g += 1) {
        const gy = row * plankH + 6 + rng() * (plankH - 12);
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.bezierCurveTo(x + len * 0.3, gy + rng() * 6 - 3, x + len * 0.6, gy + rng() * 6 - 3, x + len, gy);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,25,10,0.35)';
      ctx.fillRect(x, row * plankH, 2, plankH);
      x += len;
    }
    ctx.fillStyle = 'rgba(40,25,10,0.3)';
    ctx.fillRect(0, row * plankH, 512, 2);
  }
  return toTexture(c, repeat);
}

export function signTexture(title, subtitle, accent) {
  const { c, ctx } = makeCanvas(1024, 256);
  ctx.fillStyle = hex(BRAND.navy);
  roundRect(ctx, 6, 6, 1012, 244, 40);
  ctx.fill();
  ctx.save();
  roundRect(ctx, 6, 6, 1012, 244, 40);
  ctx.clip();
  ctx.fillStyle = hex(accent);
  ctx.fillRect(6, 226, 1012, 24);
  ctx.fillStyle = 'rgba(25,143,112,0.18)';
  ctx.beginPath();
  ctx.arc(980, 20, 160, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(124, 118, 86, 0, Math.PI * 2);
  ctx.fill();
  if (!drawContained(ctx, brandImage('icon'), 62, 58, 124, 120)) {
    ctx.fillStyle = hex(BRAND.green);
    ctx.font = `800 100px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title.charAt(0).toUpperCase(), 124, 124);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  fitFont(ctx, title, 800, 100, 740);
  ctx.fillText(title, 240, 100);
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = '#5fd3ad';
  ctx.fillText(subtitle.toUpperCase().split('').join(' '), 244, 180);
  return toTexture(c);
}

/** Logotipo completo sobre un panel (claro u oscuro). */
export function logoPanelTexture({ dark = false, width = 1024, height = 1024, padding = 0.12, tagline = false } = {}) {
  const { c, ctx } = makeCanvas(width, height);
  if (dark) {
    const g = ctx.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, hex(BRAND.navy));
    g.addColorStop(1, '#0b3a40');
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = '#ffffff';
  }
  ctx.fillRect(0, 0, width, height);
  const pad = Math.min(width, height) * padding;
  const bottom = tagline ? height * 0.16 : 0;
  drawContained(ctx, brandImage(dark ? 'logoWhite' : 'logo'), pad, pad, width - pad * 2, height - pad * 2 - bottom);
  if (tagline) {
    ctx.fillStyle = dark ? '#5fd3ad' : hex(BRAND.navy);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, BRAND.tagline.toUpperCase(), 700, 44, width - pad * 2);
    ctx.fillText(BRAND.tagline.toUpperCase(), width / 2, height - pad - bottom / 2);
  }
  return toTexture(c);
}

/** Solo el ícono del cerebro, fondo transparente (calcomanías). */
export function iconTexture(color) {
  const { c, ctx } = makeCanvas(256, 256);
  drawContained(ctx, brandImage('icon'), 16, 16, 224, 224);
  if (color !== undefined) {
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = hex(color);
    ctx.fillRect(0, 0, 256, 256);
  }
  return toTexture(c);
}

export function skylineTexture(rng) {
  const { c, ctx } = makeCanvas(1024, 512);
  const sky = ctx.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#6fb1e8');
  sky.addColorStop(0.65, '#cfe7f7');
  sky.addColorStop(1, '#f7e3c4');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, 512);

  ctx.fillStyle = 'rgba(255,240,200,0.9)';
  ctx.beginPath();
  ctx.arc(800, 120, 46, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 5; i += 1) {
    const cx = rng() * 1024;
    const cy = 40 + rng() * 140;
    for (let k = 0; k < 4; k += 1) {
      ctx.beginPath();
      ctx.ellipse(cx + k * 34, cy + (k % 2) * 8, 46, 22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Sierra de fondo
  ctx.fillStyle = '#9db3c6';
  ctx.beginPath();
  ctx.moveTo(0, 512);
  for (let x = 0; x <= 1024; x += 16) {
    ctx.lineTo(x, 300 - Math.sin(x / 90) * 40 - Math.sin(x / 37) * 14);
  }
  ctx.lineTo(1024, 512);
  ctx.fill();

  let x = -10;
  while (x < 1024) {
    const w = 50 + rng() * 80;
    const h = 120 + rng() * 230;
    const tone = Math.floor(80 + rng() * 50);
    ctx.fillStyle = `rgb(${tone - 10},${tone + 8},${tone + 30})`;
    ctx.fillRect(x, 512 - h, w, h);
    for (let wy = 512 - h + 12; wy < 500; wy += 20) {
      for (let wx = x + 8; wx < x + w - 10; wx += 16) {
        ctx.fillStyle = rng() < 0.3 ? 'rgba(255,225,140,0.9)' : 'rgba(255,255,255,0.18)';
        ctx.fillRect(wx, wy, 8, 10);
      }
    }
    x += w + 4 + rng() * 10;
  }
  return toTexture(c);
}

const NOTE_COLORS = ['#ffe066', '#ff8fab', '#8ecae6', '#b5e48c', '#ffd6a5'];

export function whiteboardTexture(kind, accent, rng) {
  const { c, ctx } = makeCanvas(768, 480);
  ctx.fillStyle = '#fbfbfd';
  ctx.fillRect(0, 0, 768, 480);
  ctx.fillStyle = '#273043';
  ctx.font = `700 40px ${FONT}`;
  const titles = { notes: 'Ideas de contenido', chart: 'Pipeline de ventas', kanban: 'Sprint actual', team: 'Seguimiento del equipo' };
  ctx.fillText(titles[kind] || titles.kanban, 36, 64);
  ctx.strokeStyle = hex(accent);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(36, 80);
  ctx.lineTo(300, 80);
  ctx.stroke();

  const scribble = (x, y, w, lines, color = 'rgba(30,30,50,0.55)') => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    for (let i = 0; i < lines; i += 1) {
      ctx.beginPath();
      ctx.moveTo(x, y + i * 18);
      ctx.lineTo(x + w * (0.5 + rng() * 0.5), y + i * 18);
      ctx.stroke();
    }
  };

  if (kind === 'notes') {
    for (let i = 0; i < 8; i += 1) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      ctx.save();
      ctx.translate(70 + col * 175, 130 + row * 165);
      ctx.rotate((rng() - 0.5) * 0.18);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(6, 6, 130, 130);
      ctx.fillStyle = i === 2 ? hex(shade(accent, 0.35)) : NOTE_COLORS[i % NOTE_COLORS.length];
      ctx.fillRect(0, 0, 130, 130);
      scribble(16, 32, 100, 4);
      ctx.restore();
    }
  } else if (kind === 'chart') {
    ctx.strokeStyle = '#273043';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(80, 120);
    ctx.lineTo(80, 420);
    ctx.lineTo(700, 420);
    ctx.stroke();
    const bars = 7;
    for (let i = 0; i < bars; i += 1) {
      const h = 60 + i * 34 + rng() * 40;
      ctx.fillStyle = i === bars - 1 ? hex(accent) : hex(shade(accent, 0.45));
      ctx.fillRect(110 + i * 82, 420 - h, 56, h);
    }
    ctx.strokeStyle = '#e8590c';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(130, 330);
    ctx.lineTo(380, 260);
    ctx.lineTo(520, 220);
    ctx.lineTo(670, 130);
    ctx.stroke();
    ctx.fillStyle = '#e8590c';
    ctx.beginPath();
    ctx.moveTo(690, 115);
    ctx.lineTo(655, 120);
    ctx.lineTo(675, 148);
    ctx.fill();
  } else {
    ['Por hacer', 'En curso', 'Hecho'].forEach((name, i) => {
      const x = 40 + i * 240;
      ctx.fillStyle = '#273043';
      ctx.font = `600 26px ${FONT}`;
      ctx.fillText(name, x, 130);
      const cards = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < cards; k += 1) {
        ctx.fillStyle = k === 0 && i === 1 ? hex(shade(accent, 0.5)) : NOTE_COLORS[(i + k) % NOTE_COLORS.length];
        ctx.fillRect(x, 150 + k * 72, 200, 58);
        scribble(x + 12, 172 + k * 72, 170, 2);
      }
    });
  }
  return toTexture(c);
}

export function posterTexture(lines, accent, rng) {
  const { c, ctx } = makeCanvas(360, 504);
  const g = ctx.createLinearGradient(0, 0, 360, 504);
  g.addColorStop(0, hex(accent));
  g.addColorStop(1, hex(shade(accent, -0.55)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 360, 504);
  for (let i = 0; i < 6; i += 1) {
    ctx.fillStyle = `rgba(255,255,255,${0.05 + rng() * 0.12})`;
    ctx.beginPath();
    ctx.arc(rng() * 360, rng() * 504, 30 + rng() * 90, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.arc(80, 90, 52, 0, Math.PI * 2);
  ctx.fill();
  drawContained(ctx, brandImage('icon'), 44, 54, 72, 72);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  lines.forEach((line, i) => {
    fitFont(ctx, line, 800, 64, 300);
    ctx.fillText(line, 30, 330 + i * 66);
  });
  ctx.font = `600 22px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('intelekia.cloud', 30, 470);
  return toTexture(c);
}

export function rugTexture(color) {
  const { c, ctx } = makeCanvas(512, 512);
  ctx.fillStyle = hex(color);
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = hex(shade(color, -0.25));
  ctx.lineWidth = 18;
  ctx.strokeRect(30, 30, 452, 452);
  ctx.lineWidth = 6;
  ctx.strokeRect(70, 70, 372, 372);
  ctx.fillStyle = hex(shade(color, 0.35));
  for (let i = 0; i < 5; i += 1) {
    for (let j = 0; j < 5; j += 1) {
      ctx.save();
      ctx.translate(126 + i * 65, 126 + j * 65);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-12, -12, 24, 24);
      ctx.restore();
    }
  }
  return toTexture(c);
}

/** Piso de azulejo claro (baño). */
export function tileFloorTexture(base, repeat) {
  const { c, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = hex(shade(base, -0.12));
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      ctx.fillStyle = hex(shade(base, (i + j) % 2 ? 0.0 : 0.06));
      ctx.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
    }
  }
  return toTexture(c, repeat);
}

const CODE_COLORS = ['#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7', '#f7768e', '#c0caf5', '#7dcfff'];

/** Pantalla de monitor animada según el estatus del agente. */
export class Screen {
  constructor(accent, seedText) {
    const { c, ctx } = makeCanvas(256, 160);
    this.canvas = c;
    this.ctx = ctx;
    this.texture = toTexture(c);
    this.accent = accent;
    this.seed = hashString(seedText);
    this.status = null;
    this.lastDraw = -1;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
  }

  update(status, t) {
    const animated = status === 'trabajando' || status === 'error';
    if (status === this.status && (!animated || t - this.lastDraw < 0.1)) return;
    this.status = status;
    this.lastDraw = t;
    this.draw(status, t);
    this.texture.needsUpdate = true;
  }

  draw(status, t) {
    const { ctx } = this;
    const W = 256;
    const H = 160;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (status === 'trabajando') {
      ctx.fillStyle = '#0d1321';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#151d30';
      ctx.fillRect(0, 14, 44, H);
      for (let i = 0; i < 8; i += 1) {
        ctx.fillStyle = i === 2 ? hex(this.accent) : 'rgba(192,202,245,0.25)';
        ctx.fillRect(8, 24 + i * 15, 26, 5);
      }
      const lineH = 11;
      const offset = t * 26;
      const start = Math.floor(offset / lineH);
      for (let i = 0; i < 14; i += 1) {
        const ln = start + i;
        const r = seededRandom(this.seed + ln * 7919);
        const y = 22 + i * lineH - (offset % lineH);
        if (y < 16) continue;
        let x = 52 + Math.floor(r() * 4) * 10;
        const segs = 1 + Math.floor(r() * 4);
        for (let s = 0; s < segs; s += 1) {
          const w = 10 + r() * 40;
          ctx.fillStyle = CODE_COLORS[Math.floor(r() * CODE_COLORS.length)];
          ctx.fillRect(x, y, w, 5);
          x += w + 6;
        }
      }
      ctx.fillStyle = '#1b2440';
      ctx.fillRect(0, 0, W, 14);
      ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(9 + i * 10, 7, 3, 0, Math.PI * 2);
        ctx.fill();
      });
      return;
    }

    if (status === 'listo_para_revision') {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#22c55e');
      g.addColorStop(1, '#15803d');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(W / 2, 66, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#16a34a';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(W / 2 - 15, 66);
      ctx.lineTo(W / 2 - 3, 79);
      ctx.lineTo(W / 2 + 17, 54);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `700 17px ${FONT}`;
      ctx.fillText('Listo para revisión', W / 2, 128);
      return;
    }

    if (status === 'error') {
      const pulse = 0.5 + Math.sin(t * 5) * 0.5;
      ctx.fillStyle = `rgb(${150 + pulse * 40},28,36)`;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(W / 2, 30);
      ctx.lineTo(W / 2 + 38, 98);
      ctx.lineTo(W / 2 - 38, 98);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#b91c1c';
      ctx.font = `900 46px ${FONT}`;
      ctx.fillText('!', W / 2, 74);
      ctx.fillStyle = '#fff';
      ctx.font = `700 18px ${FONT}`;
      ctx.fillText('Algo falló', W / 2, 128);
      return;
    }

    // idle: fondo de pantalla con el logotipo de Intelekia
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, hex(BRAND.navy));
    g.addColorStop(1, '#0e4a46');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(25,143,112,0.25)';
    ctx.beginPath();
    ctx.arc(220, 20, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hex(this.accent);
    ctx.fillRect(0, 0, W, 3);
    if (!drawContained(ctx, brandImage('logoWhite'), 70, 14, 116, 112)) {
      ctx.fillStyle = '#fff';
      ctx.font = `800 30px ${FONT}`;
      ctx.fillText('intelekia', W / 2, 68);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, H - 18, W, 18);
    for (let i = 0; i < 5; i += 1) {
      ctx.fillStyle = i === 0 ? '#fff' : 'rgba(255,255,255,0.55)';
      ctx.fillRect(84 + i * 18, H - 14, 10, 10);
    }
  }
}
