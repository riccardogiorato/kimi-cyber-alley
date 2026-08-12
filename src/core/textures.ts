import * as THREE from 'three';
import { ALLEY, mulberry32 } from './types';

/**
 * Canvas2D texture factory — zero assets, system fonts only.
 * Everything is drawn at startup, flat + graphic, neon glow painted INTO the
 * texture (layered shadowBlur strokes / radial gradients). All factories are
 * pure and deterministic: pass the same seed/rng, get the same pixels.
 */

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

export type Rng = () => number;

/** Every option bag accepts either a seeded rng or a numeric seed. */
export interface SeedOptions {
  seed?: number;
  rng?: Rng;
}

function resolveRng(o?: SeedOptions): Rng {
  if (o?.rng) return o.rng;
  return mulberry32(o?.seed ?? 0x5eed);
}

/** System font stacks — no webfonts, no assets. */
const JP = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo",sans-serif';
const LATIN = '"Arial Black","Helvetica Neue",Arial,sans-serif';

function font(px: number, weight: 'bold' | 'normal' = 'bold', family: string = JP): string {
  return `${weight} ${px}px ${family}`;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('textures.ts: 2D canvas context unavailable');
  return [c, ctx];
}

export interface TextureFinish {
  wrapS?: THREE.Wrapping;
  wrapT?: THREE.Wrapping;
  repeat?: [number, number];
  anisotropy?: number;
}

function toTexture(canvas: HTMLCanvasElement, finish: TextureFinish = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = finish.anisotropy ?? 4;
  t.wrapS = finish.wrapS ?? THREE.ClampToEdgeWrapping;
  t.wrapT = finish.wrapT ?? THREE.ClampToEdgeWrapping;
  if (finish.repeat) t.repeat.set(finish.repeat[0], finish.repeat[1]);
  t.needsUpdate = true;
  return t;
}

/** Small cache for tileable/reused textures so repeat calls are free. */
const textureCache = new Map<string, THREE.CanvasTexture>();
function cached(key: string, build: () => THREE.CanvasTexture): THREE.CanvasTexture {
  const hit = textureCache.get(key);
  if (hit) return hit;
  const t = build();
  textureCache.set(key, t);
  return t;
}

// ---------------------------------------------------------------------------
// Neon tube helpers — glyph stroke drawn in passes: wide low-alpha glow,
// mid glow, bright core, white-hot inner line.
// ---------------------------------------------------------------------------

export interface NeonPen {
  /** Bright tube core colour. */
  core: string;
  /** Glow halo colour (usually same hue as core). */
  glow: string;
  /** Core stroke width in px. */
  coreWidth: number;
  /** Extra wide glow passes (multiples of coreWidth). Default [7, 3.2]. */
  glowSpread?: [number, number];
  /** Alpha for the widest glow pass. Default 0.16. */
  glowAlpha?: number;
}

function neonStroke(ctx: CanvasRenderingContext2D, pen: NeonPen, drawPath: () => void): void {
  const [wide, mid] = pen.glowSpread ?? [7, 3.2];
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // widest halo
  ctx.globalAlpha = (pen.glowAlpha ?? 0.16) * 0.6;
  ctx.strokeStyle = pen.glow;
  ctx.lineWidth = pen.coreWidth * wide;
  ctx.shadowColor = pen.glow;
  ctx.shadowBlur = pen.coreWidth * wide * 0.8;
  drawPath();
  // mid halo
  ctx.globalAlpha = pen.glowAlpha ?? 0.16;
  ctx.lineWidth = pen.coreWidth * mid;
  ctx.shadowBlur = pen.coreWidth * mid;
  drawPath();
  // bright core
  ctx.globalAlpha = 1;
  ctx.strokeStyle = pen.core;
  ctx.lineWidth = pen.coreWidth;
  ctx.shadowColor = pen.glow;
  ctx.shadowBlur = pen.coreWidth * 2.2;
  drawPath();
  // white-hot inner line
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, pen.coreWidth * 0.35);
  ctx.shadowBlur = 0;
  drawPath();
  ctx.restore();
}

function neonText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  pen: NeonPen,
  fontStr: string,
  alpha = 1,
): void {
  ctx.save();
  ctx.font = fontStr;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = alpha;
  neonStroke(ctx, pen, () => ctx.strokeText(text, x, y));
  ctx.restore();
}

/** Vertical stack of glyphs (kanji towers, vertical hotel sign). */
function neonVerticalText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  yTop: number,
  step: number,
  pen: NeonPen,
  fontStr: string,
  charAlpha?: (i: number) => number,
): void {
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === undefined) continue;
    neonText(ctx, ch, x, yTop + i * step, pen, fontStr, charAlpha ? charAlpha(i) : 1);
  }
}

/** Slight deterministic tube wobble for hand-drawn stroke paths. */
function wobblePath(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  segments: number,
  amount: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const x = x0 + (x1 - x0) * t + (rng() - 0.5) * amount;
    const y = y0 + (y1 - y0) * t + (rng() - 0.5) * amount;
    ctx.lineTo(x, y);
  }
}

// ---------------------------------------------------------------------------
// 1. Sign faces
// ---------------------------------------------------------------------------

export interface HotelSignOptions extends SeedOptions {
  /** 'horizontal' = wide face for flat wall mounting; 'vertical' = stacked ホ・テ・ル for perpendicular mounting. */
  orientation?: 'horizontal' | 'vertical';
  /** Tube colour. Default hot pink. */
  color?: string;
}

/** Huge pink hotel sign face: ホテル + HOTEL + decorative katakana strip. */
export function makeHotelSignTexture(opts: HotelSignOptions = {}): THREE.CanvasTexture {
  const rng = resolveRng(opts);
  const orientation = opts.orientation ?? 'horizontal';
  const color = opts.color ?? '#ff2d95';
  const pen: NeonPen = { core: color, glow: color, coreWidth: 10 };

  if (orientation === 'vertical') {
    const [canvas, ctx] = makeCanvas(512, 1536);
    ctx.fillStyle = '#0b0710';
    ctx.fillRect(0, 0, 512, 1536);
    // cabinet frame
    neonStroke(ctx, { core: color, glow: color, coreWidth: 6 }, () => {
      ctx.strokeRect(28, 28, 456, 1480);
    });
    neonVerticalText(ctx, 'ホテル', 256, 220, 300, pen, font(220));
    neonText(ctx, 'HOTEL', 256, 1180, { ...pen, coreWidth: 6 }, font(96, 'bold', LATIN));
    // decorative katakana ticker
    neonText(ctx, 'ヨコハマヤミ', 256, 1400, { core: '#7de2ff', glow: '#7de2ff', coreWidth: 3 }, font(44));
    void rng;
    return toTexture(canvas);
  }

  const [canvas, ctx] = makeCanvas(1536, 768);
  ctx.fillStyle = '#0b0710';
  ctx.fillRect(0, 0, 1536, 768);
  neonStroke(ctx, { core: color, glow: color, coreWidth: 6 }, () => {
    ctx.strokeRect(24, 24, 1488, 720);
  });
  neonText(ctx, 'ホテル', 768, 300, { ...pen, coreWidth: 16 }, font(340));
  neonText(ctx, 'HOTEL', 768, 590, { ...pen, coreWidth: 7 }, font(150, 'bold', LATIN));
  // decorative katakana flanks
  neonText(ctx, 'アイラブ', 190, 590, { core: '#7de2ff', glow: '#7de2ff', coreWidth: 3 }, font(52));
  neonText(ctx, 'ネオン', 1350, 590, { core: '#7de2ff', glow: '#7de2ff', coreWidth: 3 }, font(52));
  void rng;
  return toTexture(canvas);
}

export interface KaraokeSignOptions extends SeedOptions {
  colorA?: string; // default green
  colorB?: string; // default pink
}

/** Karaoke tube sign face: カラオケ in alternating green/pink tubes. */
export function makeKaraokeSignTexture(opts: KaraokeSignOptions = {}): THREE.CanvasTexture {
  const rng = resolveRng(opts);
  const colorA = opts.colorA ?? '#39ff6a';
  const colorB = opts.colorB ?? '#ff2d95';
  const [canvas, ctx] = makeCanvas(1536, 512);
  ctx.fillStyle = '#060a08';
  ctx.fillRect(0, 0, 1536, 512);

  const text = 'カラオケ';
  const chars = [...text];
  const step = 300;
  const x0 = 768 - ((chars.length - 1) * step) / 2;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === undefined) continue;
    const c = i % 2 === 0 ? colorA : colorB;
    neonText(ctx, ch, x0 + i * step, 220, { core: c, glow: c, coreWidth: 12 }, font(240));
  }
  neonText(ctx, 'KARAOKE', 768, 430, { core: colorB, glow: colorB, coreWidth: 5 }, font(84, 'bold', LATIN));
  // wobbly underline tube
  neonStroke(ctx, { core: colorA, glow: colorA, coreWidth: 5 }, () => {
    wobblePath(ctx, rng, 120, 480, 1416, 480, 24, 6);
    ctx.stroke();
  });
  return toTexture(canvas);
}

export interface Lightbox24Options extends SeedOptions {
  /** Text after the red "24". Default 時間営業. */
  text?: string;
}

/** Backlit white lightbox face: 24時間営業, red/black type on glowing white. */
export function makeLightbox24Texture(opts: Lightbox24Options = {}): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(1024, 384);
  // backlit white box: bright centre, slightly dimmer edges
  const g = ctx.createRadialGradient(512, 192, 60, 512, 192, 640);
  g.addColorStop(0, '#fffdf4');
  g.addColorStop(0.75, '#f4eedd');
  g.addColorStop(1, '#cfc7ae');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 384);
  // dark housing frame
  ctx.strokeStyle = '#141414';
  ctx.lineWidth = 28;
  ctx.strokeRect(14, 14, 996, 356);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d8141f';
  ctx.font = font(210, 'bold', LATIN);
  ctx.fillText('24', 220, 200);
  ctx.fillStyle = '#161616';
  ctx.font = font(150);
  ctx.fillText(opts.text ?? '時間営業', 620, 205);
  return toTexture(canvas);
}

export interface OpenSignOptions extends SeedOptions {
  color?: string; // default green
  text?: string; // default 営業中
}

/** Round green 営業中 sign face (transparent background, glowing ring). */
export function makeOpenSignTexture(opts: OpenSignOptions = {}): THREE.CanvasTexture {
  const color = opts.color ?? '#2bff5d';
  const [canvas, ctx] = makeCanvas(512, 512);
  ctx.clearRect(0, 0, 512, 512);
  const pen: NeonPen = { core: color, glow: color, coreWidth: 8 };
  neonStroke(ctx, pen, () => {
    ctx.beginPath();
    ctx.arc(256, 256, 210, 0, Math.PI * 2);
    ctx.stroke();
  });
  neonStroke(ctx, { ...pen, coreWidth: 4 }, () => {
    ctx.beginPath();
    ctx.arc(256, 256, 168, 0, Math.PI * 2);
    ctx.stroke();
  });
  neonText(ctx, opts.text ?? '営業中', 256, 256, { ...pen, coreWidth: 9 }, font(120));
  return toTexture(canvas);
}

export type KanjiTowerVariant = 'izakaya' | 'ramen' | 'sake' | 'denki' | 'shichiya';

export interface KanjiTowerOptions extends SeedOptions {
  variant?: KanjiTowerVariant;
  /** Override the stacked text entirely. */
  text?: string;
  /** Override tube colour. */
  color?: string;
}

const TOWER_PRESETS: Record<KanjiTowerVariant, { text: string; color: string }> = {
  izakaya: { text: '居酒屋', color: '#ff3b30' },
  ramen: { text: 'ラーメン', color: '#ff9f1c' },
  sake: { text: '酒', color: '#ff2d95' },
  denki: { text: '電気', color: '#37e6ff' },
  shichiya: { text: '質屋', color: '#ffe14d' },
};

/** Vertical kanji sign-tower face: dark cabinet, stacked neon glyphs. */
export function makeKanjiTowerTexture(opts: KanjiTowerOptions = {}): THREE.CanvasTexture {
  const preset = TOWER_PRESETS[opts.variant ?? 'izakaya'];
  const text = opts.text ?? preset.text;
  const color = opts.color ?? preset.color;
  const chars = [...text];

  const H = Math.max(768, 240 + chars.length * 300);
  const [canvas, ctx] = makeCanvas(384, H);
  ctx.fillStyle = '#0a0a0e';
  ctx.fillRect(0, 0, 384, H);
  // cabinet edge
  ctx.strokeStyle = '#1c1c24';
  ctx.lineWidth = 16;
  ctx.strokeRect(8, 8, 368, H - 16);

  const pen: NeonPen = { core: color, glow: color, coreWidth: 10 };
  const step = chars.length > 1 ? Math.min(300, (H - 280) / (chars.length - 1)) : 0;
  const yTop = chars.length === 1 ? H / 2 : 200;
  neonVerticalText(ctx, text, 192, yTop, step, pen, font(190));
  return toTexture(canvas);
}

export interface FlickerSignOptions extends SeedOptions {
  text?: string;
  sub?: string;
  color?: string;
}

/**
 * Generic flicker sign: returns [full, partialDropout, dim] frames of the
 * SAME sign. The signs module swaps these CanvasTextures for animation.
 */
export function makeFlickerSignFrames(opts: FlickerSignOptions = {}): THREE.CanvasTexture[] {
  const text = opts.text ?? '電光';
  const sub = opts.sub ?? 'DENKOU';
  const color = opts.color ?? '#37e6ff';
  const rng = resolveRng(opts);
  // Decide once which glyph indices drop out in the "partial" frame.
  const chars = [...text];
  const dropout = chars.map(() => rng() < 0.45);

  const draw = (mode: 'full' | 'partial' | 'dim'): THREE.CanvasTexture => {
    const [canvas, ctx] = makeCanvas(768, 512);
    ctx.fillStyle = '#07070c';
    ctx.fillRect(0, 0, 768, 512);
    const dim = mode === 'dim';
    const pen: NeonPen = {
      core: color,
      glow: color,
      coreWidth: 9,
      glowAlpha: dim ? 0.05 : 0.16,
    };
    neonStroke(ctx, { ...pen, coreWidth: 5 }, () => ctx.strokeRect(20, 20, 728, 472));
    const alpha = dim ? 0.35 : 1;
    ctx.save();
    ctx.font = font(170);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const step = 200;
    const x0 = 384 - ((chars.length - 1) * step) / 2;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === undefined) continue;
      if (mode === 'partial' && dropout[i]) continue;
      neonText(ctx, ch, x0 + i * step, 210, pen, font(170), alpha);
    }
    ctx.restore();
    neonText(ctx, sub, 384, 420, { ...pen, coreWidth: 4 }, font(64, 'bold', LATIN), dim ? 0.25 : 0.9);
    return toTexture(canvas);
  };

  return [draw('full'), draw('partial'), draw('dim')];
}

// ---------------------------------------------------------------------------
// 2. Posters
// ---------------------------------------------------------------------------

export type PosterVariant = 'band' | 'ad' | 'cat' | 'notice';

export interface PosterOptions extends SeedOptions {
  /** Erase jagged chunks from the edges (transparent torn-paper look). */
  torn?: boolean;
}

function halftoneDots(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  count: number,
  maxR: number,
): void {
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const r = 1 + rng() * maxR;
    ctx.beginPath();
    ctx.arc(x + rng() * w, y + rng() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function tearEdges(ctx: CanvasRenderingContext2D, rng: Rng, w: number, h: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const bites = 6 + Math.floor(rng() * 5);
  for (let i = 0; i < bites; i++) {
    const edge = Math.floor(rng() * 4);
    const cx = edge === 0 ? 0 : edge === 1 ? w : rng() * w;
    const cy = edge === 2 ? 0 : edge === 3 ? h : rng() * h;
    const r = 20 + rng() * 55;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Bold flat graphic posters, limited palettes. 512x768, transparent when torn. */
export function makePosterTexture(variant: PosterVariant, opts: PosterOptions = {}): THREE.CanvasTexture {
  const rng = resolveRng(opts);
  const [canvas, ctx] = makeCanvas(512, 768);
  const W = 512;
  const H = 768;

  if (variant === 'band') {
    ctx.fillStyle = '#12101c';
    ctx.fillRect(0, 0, W, H);
    // diagonal band
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-0.35);
    ctx.fillStyle = '#ff2d95';
    ctx.fillRect(-W, -70, W * 2, 140);
    ctx.fillStyle = '#12101c';
    ctx.font = font(72, 'bold', LATIN);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NEON RATS', 0, 0);
    ctx.restore();
    ctx.fillStyle = '#f2ecff';
    ctx.font = font(110);
    ctx.textAlign = 'center';
    ctx.fillText('ライブ', W / 2, 200);
    ctx.font = font(44, 'bold', LATIN);
    ctx.fillStyle = '#7de2ff';
    ctx.fillText('08.15 — CYBER ALLEY', W / 2, 640);
    halftoneDots(ctx, rng, 30, 420, 200, 200, '#3a3355', 120, 5);
  } else if (variant === 'ad') {
    ctx.fillStyle = '#f2e8d8';
    ctx.fillRect(0, 0, W, H);
    // big flat circle + diagonal composition
    ctx.fillStyle = '#ff5c1c';
    ctx.beginPath();
    ctx.arc(350, 260, 210, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(0, H);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#141428';
    ctx.fillRect(0, 0, 900, 130);
    ctx.restore();
    ctx.fillStyle = '#141428';
    ctx.font = font(96);
    ctx.textAlign = 'left';
    ctx.fillText('ドリンク', 36, 120);
    ctx.font = font(60, 'bold', LATIN);
    ctx.fillText('ENERGY+', 36, 200);
    ctx.fillStyle = '#f2e8d8';
    ctx.font = font(54);
    ctx.textAlign = 'center';
    ctx.fillText('¥300', 350, 270);
    halftoneDots(ctx, rng, 30, 560, 450, 160, '#e0d2ba', 90, 6);
  } else if (variant === 'cat') {
    ctx.fillStyle = '#f6f2e6';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#161616';
    ctx.textAlign = 'center';
    ctx.font = font(58);
    ctx.fillText('猫を探しています', W / 2, 90);
    // flat cat silhouette
    ctx.beginPath();
    ctx.ellipse(W / 2, 380, 110, 90, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(W / 2, 270, 62, 0, Math.PI * 2);
    ctx.fill();
    // ears
    ctx.beginPath();
    ctx.moveTo(W / 2 - 55, 240);
    ctx.lineTo(W / 2 - 30, 170);
    ctx.lineTo(W / 2 - 8, 235);
    ctx.moveTo(W / 2 + 55, 240);
    ctx.lineTo(W / 2 + 30, 170);
    ctx.lineTo(W / 2 + 8, 235);
    ctx.fill();
    // tail
    ctx.strokeStyle = '#161616';
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(W / 2 + 100, 430);
    ctx.quadraticCurveTo(W / 2 + 190, 400, W / 2 + 170, 300);
    ctx.stroke();
    ctx.font = font(34);
    ctx.fillText('ミケ / 3才 / くわしくは下まで', W / 2, 540);
    // tear-off contact strips
    for (let i = 0; i < 8; i++) {
      const x = 36 + i * 56;
      ctx.fillRect(x, 600, 4, 120);
      ctx.save();
      ctx.translate(x + 26, 660);
      ctx.rotate(Math.PI / 2);
      ctx.font = font(22);
      ctx.fillText('090-XXXX', 0, 0);
      ctx.restore();
    }
  } else {
    // notice: yellow/black warning
    ctx.fillStyle = '#f7c948';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#141414';
    for (let i = 0; i < 12; i++) {
      ctx.save();
      ctx.translate(i * 48 - 20, 0);
      ctx.rotate(0.3);
      ctx.fillRect(0, -40, 22, 120);
      ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.font = font(120);
    ctx.fillText('警告', W / 2, 220);
    ctx.font = font(44);
    ctx.fillText('立入禁止区域', W / 2, 330);
    ctx.font = font(30, 'bold', LATIN);
    ctx.fillText('RESTRICTED AREA — SECTOR 7', W / 2, 400);
    ctx.font = font(28);
    ctx.fillText('違反者は罰せられます', W / 2, 470);
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = 10;
    ctx.strokeRect(24, 90, W - 48, H - 140);
  }

  if (opts.torn) tearEdges(ctx, rng, W, H);
  return toTexture(canvas);
}

// ---------------------------------------------------------------------------
// 3. Stickers
// ---------------------------------------------------------------------------

export type StickerVariant = 'arrow' | 'barcode' | 'mascot' | 'bolt' | 'logo';

export interface StickerOptions extends SeedOptions {
  /** Main colour override. */
  color?: string;
}

/** Individual small sticker, 256x256, transparent background. */
export function makeStickerTexture(variant: StickerVariant, opts: StickerOptions = {}): THREE.CanvasTexture {
  const rng = resolveRng(opts);
  const [canvas, ctx] = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  const color = opts.color ?? '#ff2d95';

  // white die-cut border behind every sticker
  const dieCut = (draw: () => void) => {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = 18;
    draw();
    ctx.restore();
  };

  if (variant === 'arrow') {
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(30, 108);
      ctx.lineTo(150, 108);
      ctx.lineTo(150, 60);
      ctx.lineTo(236, 128);
      ctx.lineTo(150, 196);
      ctx.lineTo(150, 148);
      ctx.lineTo(30, 148);
      ctx.closePath();
    };
    dieCut(() => {
      path();
      ctx.stroke();
    });
    ctx.fillStyle = color;
    path();
    ctx.fill();
  } else if (variant === 'barcode') {
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(18, 58, 220, 140);
    ctx.fillStyle = '#141414';
    let x = 30;
    while (x < 220) {
      const w = 2 + rng() * 8;
      ctx.fillRect(x, 70, w, 90);
      x += w + 2 + rng() * 6;
    }
    ctx.font = font(20, 'bold', LATIN);
    ctx.textAlign = 'center';
    ctx.fillText('4 901234 567890', 128, 188);
  } else if (variant === 'mascot') {
    // cute blob
    const blob = () => {
      ctx.beginPath();
      ctx.ellipse(128, 140, 86, 74, 0, 0, Math.PI * 2);
    };
    dieCut(() => {
      blob();
      ctx.stroke();
    });
    ctx.fillStyle = '#8ef7ff';
    blob();
    ctx.fill();
    ctx.fillStyle = '#141428';
    ctx.beginPath();
    ctx.arc(100, 130, 9, 0, Math.PI * 2);
    ctx.arc(156, 130, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#141428';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(128, 152, 18, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    // blush
    ctx.fillStyle = '#ff9fb0';
    ctx.beginPath();
    ctx.arc(82, 152, 10, 0, Math.PI * 2);
    ctx.arc(174, 152, 10, 0, Math.PI * 2);
    ctx.fill();
  } else if (variant === 'bolt') {
    const bolt = () => {
      ctx.beginPath();
      ctx.moveTo(150, 20);
      ctx.lineTo(70, 150);
      ctx.lineTo(120, 150);
      ctx.lineTo(100, 236);
      ctx.lineTo(190, 100);
      ctx.lineTo(136, 100);
      ctx.closePath();
    };
    dieCut(() => {
      bolt();
      ctx.stroke();
    });
    ctx.fillStyle = '#ffe14d';
    bolt();
    ctx.fill();
  } else {
    // logo-ish round mark
    dieCut(() => {
      ctx.beginPath();
      ctx.arc(128, 128, 92, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(128, 128, 92, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b0710';
    ctx.font = font(64);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('巷', 128, 130);
    ctx.font = font(18, 'bold', LATIN);
    ctx.fillText('CYBER ALLEY', 128, 196);
  }
  return toTexture(canvas);
}

/** 512x512 sheet with one of each sticker — UV-crop or use as a decal atlas. */
export function makeStickerSheetTexture(opts: StickerOptions = {}): THREE.CanvasTexture {
  const rng = resolveRng(opts);
  const [canvas, ctx] = makeCanvas(512, 512);
  ctx.clearRect(0, 0, 512, 512);
  const variants: StickerVariant[] = ['arrow', 'barcode', 'mascot', 'bolt'];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    if (v === undefined) continue;
    const t = makeStickerTexture(v, { rng });
    const dx = (i % 2) * 256;
    const dy = Math.floor(i / 2) * 256;
    ctx.drawImage(t.image as HTMLCanvasElement, dx, dy);
  }
  return toTexture(canvas);
}

// ---------------------------------------------------------------------------
// 4. Graffiti
// ---------------------------------------------------------------------------

export type GraffitiVariant = 'tag' | 'throwie' | 'stencil';

export interface GraffitiOptions extends SeedOptions {
  color?: string;
  outline?: string;
  /** Throwie word override. */
  text?: string;
}

const THROWIE_WORDS = ['NEO', 'VOID', 'RAYO', 'KAI', 'ZEN', 'MIRA', '404', 'SYN'];

/** Spray-ish but graphic graffiti, 768x384, transparent background. */
export function makeGraffitiTexture(variant: GraffitiVariant, opts: GraffitiOptions = {}): THREE.CanvasTexture {
  const rng = resolveRng(opts);
  const [canvas, ctx] = makeCanvas(768, 384);
  ctx.clearRect(0, 0, 768, 384);
  const color = opts.color ?? '#ff2d95';

  if (variant === 'tag') {
    // thick rounded single-stroke script
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(90, 260);
    ctx.bezierCurveTo(160, 90, 260, 90, 300, 220);
    ctx.bezierCurveTo(330, 320, 420, 300, 450, 160);
    ctx.bezierCurveTo(470, 80, 560, 110, 590, 230);
    ctx.moveTo(620, 120);
    ctx.lineTo(700, 260);
    ctx.stroke();
    // drips
    ctx.lineWidth = 8;
    for (let i = 0; i < 4; i++) {
      const x = 150 + rng() * 480;
      const y = 240 + rng() * 40;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 30 + rng() * 50);
      ctx.stroke();
    }
    ctx.restore();
  } else if (variant === 'throwie') {
    // bubble letters: outline + fill
    ctx.save();
    ctx.font = font(220, 'bold', LATIN);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.shadowColor = opts.outline ?? '#141428';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = opts.outline ?? '#141428';
    ctx.lineWidth = 34;
    const word = opts.text ?? THROWIE_WORDS[Math.floor(rng() * THROWIE_WORDS.length)]!;
    ctx.strokeText(word, 384, 200);
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.fillText(word, 384, 200);
    // highlight
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(240, 120);
    ctx.quadraticCurveTo(300, 90, 360, 118);
    ctx.stroke();
    ctx.restore();
  } else {
    // stencil: 未来 with cut bridges + overspray specks
    ctx.save();
    ctx.fillStyle = opts.color ?? '#e8e8e8';
    ctx.font = font(230);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('未来', 384, 190);
    // stencil bridges (knock out gaps)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(180, 60, 14, 260);
    ctx.fillRect(560, 60, 14, 260);
    ctx.globalCompositeOperation = 'source-over';
    // overspray
    ctx.fillStyle = opts.color ?? '#e8e8e8';
    for (let i = 0; i < 160; i++) {
      const a = rng() * Math.PI * 2;
      const r = 150 + rng() * 110;
      const x = 384 + Math.cos(a) * r;
      const y = 190 + Math.sin(a) * r * 0.5;
      ctx.globalAlpha = 0.12 + rng() * 0.2;
      ctx.beginPath();
      ctx.arc(x, y, 1 + rng() * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  return toTexture(canvas);
}

// ---------------------------------------------------------------------------
// 5. Menu strips (noodle stand)
// ---------------------------------------------------------------------------

export interface MenuItem {
  name: string;
  price: string;
}

export interface MenuStripOptions extends SeedOptions {
  item?: MenuItem;
  /** Add the red hanko stamp mark. */
  stamp?: boolean;
}

const DEFAULT_MENU: MenuItem[] = [
  { name: 'ラーメン', price: '¥900' },
  { name: '餃子', price: '¥450' },
  { name: 'ビール', price: '¥600' },
  { name: 'チャーシュー麺', price: '¥1100' },
  { name: '替玉', price: '¥150' },
];

/** One vertical paper menu strip: warm paper, vertical dish name + price. */
export function makeMenuStripTexture(opts: MenuStripOptions = {}): THREE.CanvasTexture {
  const rng = resolveRng(opts);
  const item = opts.item ?? DEFAULT_MENU[0] ?? { name: 'ラーメン', price: '¥900' };
  const [canvas, ctx] = makeCanvas(160, 640);

  // warm paper with slight vertical tone shift
  const g = ctx.createLinearGradient(0, 0, 0, 640);
  g.addColorStop(0, '#efe0bd');
  g.addColorStop(1, '#e2cda4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 160, 640);
  // paper edge shading
  ctx.fillStyle = 'rgba(120,90,50,0.18)';
  ctx.fillRect(0, 0, 8, 640);
  ctx.fillRect(152, 0, 8, 640);
  // fibre specks
  ctx.fillStyle = 'rgba(120,90,50,0.25)';
  for (let i = 0; i < 40; i++) {
    ctx.fillRect(rng() * 160, rng() * 640, 2, 2);
  }

  // vertical dish name
  const chars = [...item.name];
  ctx.fillStyle = '#2a1a10';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(56);
  const step = Math.min(64, 380 / Math.max(1, chars.length));
  const y0 = 90;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === undefined) continue;
    ctx.fillText(ch, 80, y0 + i * step);
  }
  // price
  ctx.font = font(40, 'bold', LATIN);
  ctx.fillText(item.price, 80, 560);

  if (opts.stamp) {
    ctx.save();
    ctx.translate(80, 470);
    ctx.rotate((rng() - 0.5) * 0.3);
    ctx.strokeStyle = '#c8321e';
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.85;
    ctx.strokeRect(-26, -26, 52, 52);
    ctx.fillStyle = '#c8321e';
    ctx.font = font(30);
    ctx.fillText('味', 0, 2);
    ctx.restore();
  }
  return toTexture(canvas);
}

/** The full default menu as an array of strips (first strip gets the stamp). */
export function makeMenuStripTextures(opts: SeedOptions = {}): THREE.CanvasTexture[] {
  const rng = resolveRng(opts);
  return DEFAULT_MENU.map((item, i) => makeMenuStripTexture({ rng, item, stamp: i === 0 }));
}

// ---------------------------------------------------------------------------
// 6. Ground — wet asphalt with painted neon reflection smears
// ---------------------------------------------------------------------------

export interface NeonSmearSpec {
  /** World z position of the sign/light pool. */
  z: number;
  /** World x position (across the alley). */
  x: number;
  /** Smear colour, e.g. '#ff2d95'. */
  color: string;
  /** Smear width in world units (across the alley). */
  width: number;
  /** Smear length in world units (along the alley). Default width * 6. */
  length?: number;
  /** 0..1 brightness. Default 0.55. */
  intensity?: number;
}

export interface GroundTextureOptions extends SeedOptions {
  /** Neon reflection smears painted under each sign. */
  smears?: NeonSmearSpec[];
  /** World x range mapped to u 0..1. Default [-ALLEY.halfWidth, +ALLEY.halfWidth]. */
  xRange?: [number, number];
  /** World z range mapped to v 0..1. Default [0, ALLEY.length]. */
  zRange?: [number, number];
  /** Canvas size. Default 1024x2048. */
  width?: number;
  height?: number;
}

/**
 * Large wet-asphalt canvas for the full alley floor. Wetness is faked here:
 * flat tonal patches, glossy puddles, and elongated neon smears at the given
 * sign positions. No real reflections needed downstream.
 */
export function makeGroundTexture(opts: GroundTextureOptions = {}): THREE.CanvasTexture {
  const rng = resolveRng(opts);
  const W = opts.width ?? 1024;
  const H = opts.height ?? 2048;
  const xRange = opts.xRange ?? [-ALLEY.halfWidth, ALLEY.halfWidth];
  const zRange = opts.zRange ?? [0, ALLEY.length];
  const [canvas, ctx] = makeCanvas(W, H);

  const u = (x: number) => ((x - xRange[0]) / (xRange[1] - xRange[0])) * W;
  const v = (z: number) => ((z - zRange[0]) / (zRange[1] - zRange[0])) * H;
  const sx = W / (xRange[1] - xRange[0]); // px per world unit across
  const sz = H / (zRange[1] - zRange[0]); // px per world unit along

  // base asphalt: near-neutral dark grey, slight warm cast (old repairs)
  ctx.fillStyle = '#17181d';
  ctx.fillRect(0, 0, W, H);

  // large patchwork of old repairs — overlapping darker/lighter tar rectangles
  for (let i = 0; i < 46; i++) {
    const warm = rng() < 0.3;
    const shade = 16 + Math.floor(rng() * 22);
    ctx.fillStyle = warm
      ? `rgba(${shade + 14},${shade + 6},${shade - 2},${0.2 + rng() * 0.25})`
      : `rgba(${shade},${shade + 3},${shade + 12},${0.25 + rng() * 0.3})`;
    const pw = 60 + rng() * 300;
    const ph = 80 + rng() * 420;
    ctx.fillRect(rng() * (W - pw), rng() * (H - ph), pw, ph);
    // tar seam around some patches
    if (rng() < 0.4) {
      ctx.strokeStyle = 'rgba(6,8,12,0.5)';
      ctx.lineWidth = 2 + rng() * 3;
      ctx.strokeRect(rng() * (W - pw), rng() * (H - ph), pw, ph);
    }
  }

  // aggregate speckle — dense, two-tone, some larger stones
  for (let i = 0; i < 5200; i++) {
    const l = rng();
    ctx.fillStyle = l > 0.55 ? `rgba(${58 + rng() * 26},${60 + rng() * 26},${66 + rng() * 26},0.4)` : 'rgba(8,9,12,0.45)';
    ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 2.5, 1 + rng() * 2.5);
  }

  // cracks: thin jagged polylines, dark with a faint light edge
  for (let i = 0; i < 26; i++) {
    let cx = rng() * W;
    let cy = rng() * H;
    const segs = 4 + Math.floor(rng() * 7);
    ctx.strokeStyle = 'rgba(5,7,10,0.55)';
    ctx.lineWidth = 1 + rng() * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let s = 0; s < segs; s++) {
      cx += (rng() - 0.5) * 90;
      cy += rng() * 60;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // painted curb edges along both sides
  ctx.fillStyle = '#232833';
  ctx.fillRect(0, 0, u(-ALLEY.halfWidth + 0.22), H);
  ctx.fillRect(u(ALLEY.halfWidth - 0.22), 0, W - u(ALLEY.halfWidth - 0.22), H);
  ctx.fillStyle = 'rgba(120,130,150,0.5)';
  ctx.fillRect(u(-ALLEY.halfWidth + 0.22), 0, 3, H);
  ctx.fillRect(u(ALLEY.halfWidth - 0.22) - 3, 0, 3, H);

  // worn centre lane dashes
  ctx.fillStyle = 'rgba(180,170,120,0.16)';
  for (let z = zRange[0] + 2; z < zRange[1] - 2; z += 4) {
    ctx.fillRect(u(-0.05), v(z), u(0.05) - u(-0.05), v(z + 1.6) - v(z));
  }

  // puddle-ish darker glossy patches with a bright sky-glint rim
  for (let i = 0; i < 12; i++) {
    const px = xRange[0] + 0.4 + rng() * (xRange[1] - xRange[0] - 0.8);
    const pz = zRange[0] + rng() * (zRange[1] - zRange[0]);
    const pr = (0.25 + rng() * 0.6) * sx;
    const g = ctx.createRadialGradient(u(px), v(pz), pr * 0.1, u(px), v(pz), pr);
    g.addColorStop(0, 'rgba(5,9,16,0.9)');
    g.addColorStop(0.7, 'rgba(9,14,24,0.6)');
    g.addColorStop(1, 'rgba(10,16,26,0)');
    ctx.save();
    ctx.translate(u(px), v(pz));
    ctx.scale(1, 1.6 + rng() * 0.8);
    ctx.translate(-u(px), -v(pz));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(u(px), v(pz), pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // faint cool glint on the puddle's upper edge (sky reflection)
    ctx.save();
    ctx.translate(u(px), v(pz));
    ctx.scale(1, 1.6);
    ctx.strokeStyle = 'rgba(120,160,190,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, pr * 0.8, Math.PI * 1.1, Math.PI * 1.6);
    ctx.stroke();
    ctx.restore();
  }

  // neon reflection smears — additive, vertically elongated soft streaks.
  // Bright core + wide halo + broken ripple lines: reads as WET, not as fog.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const smear of opts.smears ?? []) {
    const intensity = smear.intensity ?? 0.8;
    const wPx = Math.max(8, smear.width * sx);
    const lPx = Math.max(24, (smear.length ?? smear.width * 7) * sz);
    const cx = u(smear.x);
    const cy = v(smear.z);
    // wide halo
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, lPx / wPx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, wPx * 0.5);
    g.addColorStop(0, hexA(smear.color, 0.42 * intensity));
    g.addColorStop(0.45, hexA(smear.color, 0.18 * intensity));
    g.addColorStop(1, hexA(smear.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, wPx * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // bright narrow core streak
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, lPx / (wPx * 0.36));
    const g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, wPx * 0.18);
    g2.addColorStop(0, hexA(smear.color, 0.55 * intensity));
    g2.addColorStop(1, hexA(smear.color, 0));
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(0, 0, wPx * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // broken streak lines inside the smear (wet ripple gaps)
    ctx.save();
    ctx.globalAlpha = 0.4 * intensity;
    ctx.strokeStyle = smear.color;
    for (let i = 0; i < 7; i++) {
      ctx.lineWidth = 1.5 + rng() * 4;
      const lx = cx + (rng() - 0.5) * wPx * 0.7;
      const ly0 = cy - lPx * 0.45 + rng() * lPx * 0.35;
      ctx.beginPath();
      ctx.moveTo(lx, ly0);
      ctx.lineTo(lx + (rng() - 0.5) * 8, ly0 + lPx * (0.2 + rng() * 0.35));
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();

  // scattered paper scraps / flattened cardboard / leaves of old newsprint
  for (let i = 0; i < 22; i++) {
    const px = rng() * W;
    const pz = rng() * H;
    const w = 8 + rng() * 26;
    const h = 6 + rng() * 20;
    const tone = ['#8a8578', '#a39c8a', '#6b6558', '#7d6a4f'][Math.floor(rng() * 4)] ?? '#8a8578';
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(rng() * Math.PI);
    ctx.fillStyle = tone;
    ctx.globalAlpha = 0.55 + rng() * 0.3;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    // print lines on paper scraps
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#222';
    for (let l = 0; l < 3; l++) ctx.fillRect(-w / 2 + 2, -h / 2 + 3 + l * 4, w - 4, 1.5);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // drain grate slots
  const grate = (gx: number, gz: number) => {
    const x0 = u(gx - 0.3);
    const y0 = v(gz - 0.45);
    const w = u(gx + 0.3) - x0;
    const h = v(gz + 0.45) - y0;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = '#2c3340';
    const slots = 6;
    for (let i = 0; i < slots; i++) {
      const sy = y0 + (h / slots) * i + 3;
      ctx.fillRect(x0 + 4, sy, w - 8, h / slots - 6);
    }
  };
  grate(-1.1, 12);
  grate(1.15, 34);
  grate(-1.0, 56);

  // manhole circle
  {
    const mx = u(0.5);
    const my = v(24);
    const r = 0.42 * sx;
    ctx.fillStyle = '#20242e';
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#343b48';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = '#2a303c';
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(mx, my, r * (0.25 + i * 0.16), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // litter specks
  for (let i = 0; i < 90; i++) {
    const c = ['#5a5348', '#6e2f2f', '#3f5a46', '#777'][Math.floor(rng() * 4)] ?? '#5a5348';
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.5 + rng() * 0.4;
    ctx.fillRect(rng() * W, rng() * H, 2 + rng() * 5, 2 + rng() * 4);
  }
  ctx.globalAlpha = 1;

  return toTexture(canvas, { anisotropy: 8 });
}

/** '#rrggbb' + alpha → rgba() string. */
function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m || m[1] === undefined) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------------------------------------------------------------------------
// 6b. Tileable asphalt detail (seamless, meant to repeat down the alley)
// ---------------------------------------------------------------------------

export interface AsphaltTileOptions extends SeedOptions {
  /** Canvas size (square). Default 512. */
  size?: number;
}

/**
 * Seamless wet-asphalt tile. Unlike `makeGroundTexture` (one bespoke canvas
 * for the whole alley, which stretches), this is a small *repeating* detail
 * map: aggregate speckle, tar patches, cracks and faint seams drawn so the
 * edges wrap. RepeatWrapping on both axes; the caller sets `repeat` so one
 * tile covers ~4x4 m of ground — no more stretching down the alley length.
 */
export function makeAsphaltTileTexture(opts: AsphaltTileOptions = {}): THREE.CanvasTexture {
  const rng = resolveRng(opts);
  const S = opts.size ?? 512;
  const [canvas, ctx] = makeCanvas(S, S);

  // base asphalt
  ctx.fillStyle = '#181a20';
  ctx.fillRect(0, 0, S, S);

  // Draw helpers that stamp a shape at 9 wrapped offsets so edges tile.
  const wrap = (fn: (x: number, y: number) => void) => (x: number, y: number) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(x + ox, y + oy);
  };

  // large tonal patches (old repairs) — wrapped so seams don't show
  const patch = wrap((x, y) => {
    const warm = rng() < 0.3;
    const shade = 18 + Math.floor(rng() * 22);
    ctx.fillStyle = warm
      ? `rgba(${shade + 14},${shade + 6},${shade - 2},${0.2 + rng() * 0.25})`
      : `rgba(${shade},${shade + 3},${shade + 12},${0.24 + rng() * 0.3})`;
    ctx.fillRect(x, y, 50 + rng() * 150, 50 + rng() * 150);
  });
  for (let i = 0; i < 26; i++) patch(rng() * S, rng() * S);

  // aggregate speckle — the main detail that kills the "flat stretch" look
  for (let i = 0; i < 7000; i++) {
    const l = rng();
    ctx.fillStyle = l > 0.55
      ? `rgba(${58 + rng() * 26},${60 + rng() * 26},${66 + rng() * 26},0.4)`
      : 'rgba(8,9,12,0.45)';
    ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
  }

  // cracks — thin jagged polylines, wrapped
  const crack = wrap((x, y) => {
    let cx = x;
    let cy = y;
    const segs = 4 + Math.floor(rng() * 6);
    ctx.strokeStyle = 'rgba(5,7,10,0.5)';
    ctx.lineWidth = 1 + rng() * 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let s = 0; s < segs; s++) {
      cx += (rng() - 0.5) * 60;
      cy += (rng() - 0.5) * 60;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  });
  for (let i = 0; i < 16; i++) crack(rng() * S, rng() * S);

  // subtle puddle sheen patches (glossy darker ellipses)
  const puddle = wrap((x, y) => {
    const r = 20 + rng() * 50;
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, 'rgba(6,10,16,0.7)');
    g.addColorStop(0.7, 'rgba(9,14,22,0.4)');
    g.addColorStop(1, 'rgba(10,16,24,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  });
  for (let i = 0; i < 7; i++) puddle(rng() * S, rng() * S);

  return toTexture(canvas, {
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    anisotropy: 8,
  });
}

/**
 * Transparent overlay holding ONLY the neon reflection smears, laid over the
 * repeating asphalt tile. Drawn additively on a clear canvas; the mesh uses
 * AdditiveBlending so the black/empty parts vanish over the tiled base.
 */
export function makeSmearOverlayTexture(
  rng: Rng,
  opts: { lightPools: { x: number; z: number; color: number; width: number }[] },
): THREE.CanvasTexture {
  const W = 1024;
  const H = 2048;
  const xRange: [number, number] = [-ALLEY.halfWidth, ALLEY.halfWidth];
  const zRange: [number, number] = [0, ALLEY.length];
  const [canvas, ctx] = makeCanvas(W, H);
  const u = (x: number) => ((x - xRange[0]) / (xRange[1] - xRange[0])) * W;
  const v = (z: number) => ((z - zRange[0]) / (zRange[1] - zRange[0])) * H;
  const sx = W / (xRange[1] - xRange[0]);
  const sz = H / (zRange[1] - zRange[0]);

  ctx.globalCompositeOperation = 'lighter';
  for (const p of opts.lightPools) {
    const color = `#${p.color.toString(16).padStart(6, '0')}`;
    const intensity = 0.85;
    const wPx = Math.max(8, p.width * sx);
    const lPx = Math.max(24, p.width * 7 * sz);
    const cx = u(p.x);
    const cy = v(p.z);
    // wide halo
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, lPx / wPx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, wPx * 0.5);
    g.addColorStop(0, hexA(color, 0.42 * intensity));
    g.addColorStop(0.45, hexA(color, 0.18 * intensity));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, wPx * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // bright narrow core streak
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, lPx / (wPx * 0.36));
    const g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, wPx * 0.18);
    g2.addColorStop(0, hexA(color, 0.55 * intensity));
    g2.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(0, 0, wPx * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // broken wet ripple lines
    ctx.save();
    ctx.globalAlpha = 0.4 * intensity;
    ctx.strokeStyle = color;
    for (let i = 0; i < 7; i++) {
      ctx.lineWidth = 1.5 + rng() * 4;
      const lx = cx + (rng() - 0.5) * wPx * 0.7;
      const ly0 = cy - lPx * 0.45 + rng() * lPx * 0.35;
      ctx.beginPath();
      ctx.moveTo(lx, ly0);
      ctx.lineTo(lx + (rng() - 0.5) * 8, ly0 + lPx * (0.2 + rng() * 0.35));
      ctx.stroke();
    }
    ctx.restore();
  }

  return toTexture(canvas, { anisotropy: 8 });
}

// ---------------------------------------------------------------------------
// 7. Wall grime / base facade texture (tileable-ish)
// ---------------------------------------------------------------------------

export interface WallGrimeOptions extends SeedOptions {
  /** Base concrete colour. Default dark blue-grey. */
  base?: string;
  /** Canvas size (square). Default 512. */
  size?: number;
  repeat?: [number, number];
}

/**
 * Tileable-ish dark concrete: flat tonal variation, streak stains running
 * down, painted AO gradient at the bottom. RepeatWrapping on both axes.
 */
export function makeWallGrimeTexture(opts: WallGrimeOptions = {}): THREE.CanvasTexture {
  const key = `wall:${opts.seed ?? 'r'}:${opts.base ?? ''}:${opts.size ?? 512}`;
  if (opts.seed !== undefined) {
    const hit = textureCache.get(key);
    if (hit) return hit;
  }
  const rng = resolveRng(opts);
  const S = opts.size ?? 512;
  const [canvas, ctx] = makeCanvas(S, S);

  ctx.fillStyle = opts.base ?? '#3a3f4c';
  ctx.fillRect(0, 0, S, S);

  // large tonal blotches — patchy old concrete / repainted sections
  for (let i = 0; i < 34; i++) {
    const warm = rng() < 0.25;
    const shade = 34 + Math.floor(rng() * 30);
    ctx.fillStyle = warm
      ? `rgba(${shade + 16},${shade + 6},${shade - 4},${0.28 + rng() * 0.3})`
      : `rgba(${shade},${shade + 2},${shade + 10},${0.3 + rng() * 0.36})`;
    ctx.fillRect(rng() * S, rng() * S, 40 + rng() * 180, 40 + rng() * 180);
  }

  // horizontal formwork / panel seams (cast concrete bands)
  for (let y = 0; y < S; y += 64 + Math.floor(rng() * 32)) {
    ctx.fillStyle = 'rgba(8,10,14,0.55)';
    ctx.fillRect(0, y, S, 2);
    ctx.fillStyle = 'rgba(150,160,180,0.2)';
    ctx.fillRect(0, y + 2, S, 1);
  }
  // a few vertical seams
  for (let i = 0; i < 4; i++) {
    const x = rng() * S;
    ctx.fillStyle = 'rgba(10,12,16,0.3)';
    ctx.fillRect(x, 0, 2, S);
  }

  // speckle
  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = rng() > 0.5 ? 'rgba(60,64,76,0.3)' : 'rgba(10,11,15,0.35)';
    ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
  }

  // exposed patches where paint fell off (lighter raw concrete)
  for (let i = 0; i < 7; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const w = 20 + rng() * 60;
    const h = 14 + rng() * 44;
    ctx.fillStyle = `rgba(${120 + rng() * 30},${118 + rng() * 28},${108 + rng() * 24},${0.12 + rng() * 0.14})`;
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, rng() * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // rust weeps under imaginary bolts/fixtures
  for (let i = 0; i < 8; i++) {
    const x = rng() * S;
    const y = rng() * S * 0.7;
    const len = 30 + rng() * 90;
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, 'rgba(122,74,56,0.4)');
    g.addColorStop(1, 'rgba(122,74,56,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 2 - rng() * 3, y, 4 + rng() * 6, len);
    ctx.fillStyle = 'rgba(90,50,36,0.55)';
    ctx.beginPath();
    ctx.arc(x, y, 2.5 + rng() * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // streak stains running down (rain grime)
  for (let i = 0; i < 18; i++) {
    const x = rng() * S;
    const w = 4 + rng() * 18;
    const len = S * (0.3 + rng() * 0.7);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(8,10,12,0.4)');
    g.addColorStop(1, 'rgba(8,10,12,0)');
    ctx.save();
    ctx.translate(x, 0);
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2, 0, w, len);
    ctx.restore();
  }
  // painted AO gradient at the bottom
  const ao = ctx.createLinearGradient(0, S * 0.7, 0, S);
  ao.addColorStop(0, 'rgba(0,0,0,0)');
  ao.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = ao;
  ctx.fillRect(0, S * 0.7, S, S * 0.3);

  const t = toTexture(canvas, {
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    repeat: opts.repeat,
    anisotropy: 8,
  });
  if (opts.seed !== undefined) textureCache.set(key, t);
  return t;
}

// ---------------------------------------------------------------------------
// 8. Tarp / awning
// ---------------------------------------------------------------------------

export type TarpVariant = 'stripes' | 'patched';

export interface TarpOptions extends SeedOptions {
  /** Stripe colours for 'stripes'. Default faded red/cream. */
  colors?: [string, string];
  /** Base colour for 'patched'. Default blue-grey. */
  base?: string;
  size?: number;
  repeat?: [number, number];
}

/** Awning stripes (faded) or solid patched tarp with seam lines. */
export function makeTarpTexture(variant: TarpVariant, opts: TarpOptions = {}): THREE.CanvasTexture {
  return cached(`tarp:${variant}:${opts.seed ?? 'r'}`, () => {
    const rng = resolveRng(opts);
    const S = opts.size ?? 512;
    const [canvas, ctx] = makeCanvas(S, S);

    if (variant === 'stripes') {
      const [a, b] = opts.colors ?? ['#a8433a', '#d9cdb4'];
      const stripeW = S / 8;
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 === 0 ? a : b;
        ctx.fillRect(i * stripeW, 0, stripeW, S);
      }
      // fade / sun-bleach
      const fade = ctx.createLinearGradient(0, 0, 0, S);
      fade.addColorStop(0, 'rgba(220,220,210,0.25)');
      fade.addColorStop(1, 'rgba(40,40,44,0.2)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, S, S);
      // grime streaks
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = `rgba(20,20,24,${0.08 + rng() * 0.12})`;
        ctx.fillRect(rng() * S, 0, 3 + rng() * 10, S);
      }
    } else {
      ctx.fillStyle = opts.base ?? '#3c4a54';
      ctx.fillRect(0, 0, S, S);
      // tonal patches
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = `rgba(20,28,34,${0.1 + rng() * 0.2})`;
        ctx.fillRect(rng() * S, rng() * S, 40 + rng() * 120, 40 + rng() * 120);
      }
      // seam lines with stitching dashes
      ctx.strokeStyle = 'rgba(16,22,28,0.7)';
      ctx.lineWidth = 3;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, (S / 4) * i);
        ctx.lineTo(S, (S / 4) * i);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(200,205,210,0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, (S / 4) * i + 5);
        ctx.lineTo(S, (S / 4) * i + 5);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // repair patches
      for (let i = 0; i < 3; i++) {
        const px = rng() * (S - 90);
        const py = rng() * (S - 90);
        ctx.fillStyle = 'rgba(70,86,96,0.9)';
        ctx.fillRect(px, py, 70, 60);
        ctx.strokeStyle = 'rgba(16,22,28,0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.strokeRect(px, py, 70, 60);
        ctx.setLineDash([]);
      }
    }
    return toTexture(canvas, {
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      repeat: opts.repeat,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Compatibility layer: the world modules were built against a flat contract  */
/* (rng-first, numeric variants). These adapters map that contract onto the   */
/* richer per-kind factories above.                                           */
/* -------------------------------------------------------------------------- */

/**
 * Night sky seen through the gap between rooftops: deep teal-indigo gradient,
 * a few faint stars, and a warm city-glow band near the horizon. Used as the
 * scene background — the alley must read as LATE NIGHT, not a void.
 */
export function makeSkyTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(1024, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#101f38'); // zenith: cold indigo
  g.addColorStop(0.5, '#0c1a2c');
  g.addColorStop(0.8, '#14282f'); // teal haze band
  g.addColorStop(1, '#332e33'); // warm city glow at the roofline
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  // warm sodium glow pooling at the horizon
  const glow = ctx.createLinearGradient(0, 400, 0, 512);
  glow.addColorStop(0, 'rgba(255,150,90,0)');
  glow.addColorStop(1, 'rgba(255,150,90,0.22)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 400, 1024, 112);
  const rng = mulberry32(0x57);
  // milky way: a soft diagonal band of layered translucent blobs + dense star dust
  ctx.save();
  ctx.translate(512, 190);
  ctx.rotate(-0.42);
  for (let i = 0; i < 90; i++) {
    const t = rng() * 2 - 1;
    const off = (rng() - 0.5) * 130;
    const r = 30 + rng() * 90;
    const grad = ctx.createRadialGradient(t * 560, off * 0.35, 0, t * 560, off * 0.35, r);
    const warm = rng() < 0.3;
    grad.addColorStop(0, warm ? 'rgba(190,170,190,0.05)' : 'rgba(150,180,215,0.055)');
    grad.addColorStop(1, 'rgba(150,180,215,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(t * 560, off * 0.35, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // star dust inside the band
  for (let i = 0; i < 700; i++) {
    const t = rng() * 2 - 1;
    const off = (rng() + rng() - 1) * 90;
    const a = 0.15 + rng() * 0.5;
    ctx.fillStyle = `rgba(210,225,240,${a.toFixed(3)})`;
    ctx.fillRect(t * 580, off * 0.4, 1, 1);
  }
  ctx.restore();
  // stars, denser toward the zenith, a few bright ones with cross glints
  for (let i = 0; i < 320; i++) {
    const y = rng() * 380;
    const a = (1 - y / 420) * (0.3 + rng() * 0.6);
    ctx.fillStyle = `rgba(205,225,240,${a.toFixed(3)})`;
    const s = rng() < 0.92 ? 1 : 2;
    ctx.fillRect(rng() * 1024, y, s, s);
  }
  for (let i = 0; i < 14; i++) {
    const x = rng() * 1024;
    const y = rng() * 260;
    ctx.fillStyle = 'rgba(230,240,250,0.9)';
    ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = 'rgba(230,240,250,0.25)';
    ctx.fillRect(x - 3, y, 8, 1);
    ctx.fillRect(x, y - 3, 1, 8);
  }
  const t = toTexture(canvas);
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

export type NeonSignKind = 'hotel' | 'karaoke' | 'lightbox24' | 'eigyochu' | 'kanjiTower';

const TOWER_VARIANTS: KanjiTowerVariant[] = ['izakaya', 'ramen', 'sake', 'denki', 'shichiya'];

/** Contract adapter: one entry point for every major neon sign face. */
export function neonSignTexture(
  rng: Rng,
  opts: { kind: NeonSignKind; variant?: number },
): THREE.CanvasTexture {
  const v = opts.variant ?? 0;
  switch (opts.kind) {
    case 'hotel':
      // Even variants: stacked ホ・テ・ル for perpendicular mounting; odd: wide face.
      return makeHotelSignTexture({ rng, orientation: v % 2 === 0 ? 'vertical' : 'horizontal' });
    case 'karaoke':
      return makeKaraokeSignTexture({ rng });
    case 'lightbox24':
      return makeLightbox24Texture({ rng });
    case 'eigyochu':
      return makeOpenSignTexture({ rng });
    case 'kanjiTower':
      return makeKanjiTowerTexture({
        rng,
        variant: TOWER_VARIANTS[((v % TOWER_VARIANTS.length) + TOWER_VARIANTS.length) % TOWER_VARIANTS.length],
      });
  }
}

/** Contract adapter: [full, partialDropout, dim] frames of one sign. */
export function flickerSignFrames(
  rng: Rng,
  opts: { text: string; color: string; sub?: string },
): THREE.CanvasTexture[] {
  return makeFlickerSignFrames({ rng, text: opts.text, color: opts.color, sub: opts.sub });
}

const POSTER_VARIANTS: PosterVariant[] = ['band', 'ad', 'cat', 'notice'];
const STICKER_VARIANTS: StickerVariant[] = ['arrow', 'barcode', 'mascot', 'bolt', 'logo'];
const GRAFFITI_VARIANTS: GraffitiVariant[] = ['tag', 'throwie', 'stencil'];

function pick<T>(list: T[], v: number): T {
  return list[((v % list.length) + list.length) % list.length]!;
}

/** Contract adapter: wall grime base for facades. */
export function wallGrimeTexture(rng: Rng): THREE.CanvasTexture {
  return makeWallGrimeTexture({ rng });
}

/** Contract adapter: poster by numeric variant. */
export function posterTexture(rng: Rng, variant: number): THREE.CanvasTexture {
  return makePosterTexture(pick(POSTER_VARIANTS, variant), { rng });
}

/** Contract adapter: sticker by numeric variant. */
export function stickerTexture(rng: Rng, variant: number): THREE.CanvasTexture {
  return makeStickerTexture(pick(STICKER_VARIANTS, variant), { rng });
}

/** Contract adapter: graffiti by numeric variant. */
export function graffitiTexture(rng: Rng, variant: number): THREE.CanvasTexture {
  return makeGraffitiTexture(pick(GRAFFITI_VARIANTS, variant), { rng });
}

/** Contract adapter: 0 = striped awning, anything else = patched tarp. */
export function awningTexture(rng: Rng, variant: number): THREE.CanvasTexture {
  return makeTarpTexture(variant === 0 ? 'stripes' : 'patched', { rng });
}

/** Contract adapter: menu strip by numeric variant (cycles the default menu). */
export function menuStripTexture(rng: Rng, variant: number): THREE.CanvasTexture {
  const item = DEFAULT_MENU[((variant % DEFAULT_MENU.length) + DEFAULT_MENU.length) % DEFAULT_MENU.length]!;
  return makeMenuStripTexture({ rng, item, stamp: variant === 0 });
}

/** Contract adapter: wet-asphalt ground with neon smears under each light pool. */
export function groundTexture(
  rng: Rng,
  opts: { lightPools: { x: number; z: number; color: number; width: number }[] },
): THREE.CanvasTexture {
  return makeGroundTexture({
    rng,
    smears: opts.lightPools.map((p) => ({
      x: p.x,
      z: p.z,
      color: `#${p.color.toString(16).padStart(6, '0')}`,
      width: p.width,
    })),
  });
}
