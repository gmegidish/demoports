// IFF image access, ported from the assembly in original_src/NINJA.A and checked against NINJA2.EXE.
// Images are addressed as an offset into pGraphics, like the original pointers.

export function ILBM_GetXSize(g, p) {
  return (g[p + 0x14] << 8) | g[p + 0x15];
}

export function ILBM_GetYSize(g, p) {
  return (g[p + 0x16] << 8) | g[p + 0x17];
}

/** ChunkSearch: scan forward for a 4-character tag, return the offset of the chunk data. */
function chunkSearch(g, p, tag) {
  const a = tag.charCodeAt(0);
  const b = tag.charCodeAt(1);
  const c = tag.charCodeAt(2);
  const d = tag.charCodeAt(3);
  for (let i = p; i + 8 <= g.length; i++) {
    if (g[i] === a && g[i + 1] === b && g[i + 2] === c && g[i + 3] === d) {
      return i + 8;
    }
  }
  throw new Error(`no ${tag} chunk after offset ${p}`);
}

/**
 * ILBM_Palette: load numCols colours of the image's CMAP into the DAC at colOff.
 * Components are 6 bit; fade is a signed byte added to each and clamped to 0..63.
 */
export function ILBM_Palette(m, p, numCols, colOff, fade) {
  const g = m.pGraphics;
  const signedFade = (Math.trunc(fade) << 24) >> 24;
  let cmap = chunkSearch(g, p, 'CMAP');
  for (let i = 0; i < numCols; i++) {
    const entry = ((i + colOff) & 0xff) * 3;
    if (entry === 0) {
      // The shipped routine never loads colour 0: it stays black whatever the image says.
      m.palette.fill(0, 0, 3);
      cmap += 3;
      continue;
    }
    for (let component = 0; component < 3; component++) {
      const value = (g[cmap++] >> 2) + signedFade;
      m.palette[entry + component] = Math.max(0, Math.min(63, value));
    }
  }
}

/**
 * DepackILBM: ByteRun1-unpack width*height bytes of BODY into dst.
 * Colour 0 is written as 0; every other colour gets colStart added.
 * The original never checks buffer ends. Here reads and writes stop at them.
 */
export function DepackILBM(g, p, dst, colStart, dstOffset = 0) {
  let remaining = ILBM_GetXSize(g, p) * ILBM_GetYSize(g, p);
  let s = chunkSearch(g, p, 'BODY');
  let d = dstOffset;
  while (s < g.length) {
    const control = g[s++];
    if (control >= 128) {
      const count = 257 - control;
      remaining -= count;
      if (remaining < 0) {
        break;
      }
      let colour = g[s++];
      if (colour !== 0) {
        colour = (colour + colStart) & 0xff;
      }
      dst.fill(colour, d, d + count);
      d += count;
    } else {
      const count = control + 1;
      remaining -= count;
      if (remaining < 0) {
        break;
      }
      for (let i = 0; i < count; i++) {
        const colour = g[s++];
        dst[d++] = colour === 0 ? 0 : (colour + colStart) & 0xff;
      }
    }
  }
  return d - dstOffset;
}
