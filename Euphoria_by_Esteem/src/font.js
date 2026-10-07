// 0db3: the bitmap font object. Glyphs are rectangles of a font picture (a page), described by a
// 2048-byte resource of 256 x {x, y, w, h} int16. Notes: L5_units.md "0db3".
import { loadPicture } from './picture.js';
import { roundHalfEven } from './machine.js';

/** DS:0a7e: characters whose advance is one pixel less than their width. */
const NARROW_SET = " I0123456789-+.,!?:()*'";
const FIRST_FONT_PAGE = 0x0b;

export class Font {
  /** 0db3:004f: takes the first free page from 11 up. */
  constructor(m) {
    this.m = m;
    let page = FIRST_FONT_PAGE;
    while (m.pages.has(page)) {
      page++;
    }
    this.page = page;
    m.setActivePage(page);
    this.glyphs = [];
    this.centerX = 0;
    this.centerY = 0;
    this.text = '';
    this.phases = [];
  }

  /** 0db3:0769: the picture (which also becomes the active page and sets the palette), then the glyphs. */
  load(pictureResource, glyphResource) {
    loadPicture(this.m, this.page, pictureResource);
    this.savedPalette = this.m.palette.slice();
    const bytes = this.m.resources[glyphResource - 1];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.glyphs = [];
    for (let c = 0; c < 256; c++) {
      const at = c * 8;
      this.glyphs.push({ x: view.getInt16(at, true), y: view.getInt16(at + 2, true), w: view.getInt16(at + 4, true), h: view.getInt16(at + 6, true) });
    }
  }

  advance(ch) {
    const glyph = this.glyphs[ch.charCodeAt(0)];
    return NARROW_SET.includes(ch) ? glyph.w - 1 : glyph.w;
  }

  /** 0db3:00ca: vertical clip only; colour 0 transparent; both strides are the screen width. */
  drawChar(ch, x, y) {
    const m = this.m;
    let { x: gx, y: gy, w: gw, h: gh } = this.glyphs[ch.charCodeAt(0)];
    const { top, bottom } = m.clip;
    if (y < top) {
      if (y + gh < top) {
        return;
      }
      gy += top - y;
      gh -= top - y;
      y = top;
    }
    if (y + gh > bottom) {
      if (y > bottom) {
        return;
      }
      gh -= y + gh - bottom;
    }
    if (gh <= 0) {
      return;
    }
    const src = m.getPage(this.page);
    const W = m.width;
    let d = (Math.imul(y, W) + x) & 0xffff;
    let s = gy * 320 + gx;
    for (let row = 0; row < gh; row++) {
      for (let col = 0; col < gw; col++) {
        const c = src[s & 0xffff];
        if (c !== 0) {
          m.active[d & 0xffff] = c;
        }
        d++;
        s++;
      }
      d += W - gw;
      s += W - gw;
    }
  }

  /** 0db3:01bc */
  drawCentered(cx, y, text) {
    let total = 0;
    for (const ch of text) {
      total += this.advance(ch);
    }
    let x = cx - ((total & 0xffff) >>> 1);
    for (const ch of text) {
      if (ch > ' ') {
        this.drawChar(ch, x, y);
      }
      x += this.advance(ch);
    }
  }

  /** 0db3:033b: each letter gets a phase (1 - i/len) * 2pi. */
  setWave(cx, cy, text) {
    this.centerX = cx;
    this.centerY = cy;
    this.text = text;
    this.phases = [];
    for (let i = 1; i <= text.length; i++) {
      this.phases[i] = (1 - i / text.length) * 2 * Math.PI;
    }
  }

  /** 0db3:0429 */
  drawWave(a, b, c, n) {
    const scale = n / 1000;
    let width = 0;
    for (const ch of this.text) {
      width += roundHalfEven(scale * this.advance(ch));
    }
    width = (width << 16) >> 16;
    let x = this.centerX - Math.trunc(width / 2);
    const y0 = this.centerY - (this.glyphs[this.text.charCodeAt(0)].h >>> 1);
    for (let i = 1; i <= this.text.length; i++) {
      const ch = this.text[i - 1];
      const angle = (b * Math.PI) / 180 + this.phases[i];
      const dy = roundHalfEven(c * Math.sin(angle) * Math.cos(angle / a));
      const dx = roundHalfEven(c * Math.cos(angle));
      if (ch > ' ') {
        this.drawChar(ch, x + dx, y0 + dy);
      }
      x += roundHalfEven(scale * this.advance(ch));
    }
  }
}
