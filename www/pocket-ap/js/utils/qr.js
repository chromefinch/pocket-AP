// Minimal zero-dependency QR Code SVG generator (Byte mode, ECC Level L, Versions 1..8).
// Designed specifically for Wi-Fi connection payloads (`WIFI:T:WPA;S:...;P:...;;`).

const VERSIONS = [
  // [size, totalCodewords, ecCodewordsPerBlock, numBlocks, alignCenters]
  null,
  [21, 26, 7, 1, []],
  [25, 44, 10, 1, [6, 18]],
  [29, 70, 15, 1, [6, 22]],
  [33, 100, 20, 1, [6, 26]],
  [37, 134, 26, 1, [6, 30]],
  [41, 172, 18, 2, [6, 34]],
  [45, 196, 20, 2, [6, 22, 38]],
  [49, 242, 24, 2, [6, 24, 42]]
];

// GF(256) tables with primitive polynomial 0x11d
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(deg) {
  let poly = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(ecLen);
  for (const b of data) {
    const factor = b ^ res[0];
    for (let i = 0; i < ecLen - 1; i++) res[i] = res[i + 1] ^ gfMul(gen[i + 1], factor);
    res[ecLen - 1] = gfMul(gen[ecLen], factor);
  }
  return res;
}

function encodeData(bytes) {
  let ver = 0;
  for (let v = 1; v < VERSIONS.length; v++) {
    const [, total, ecPer, blocks] = VERSIONS[v];
    const dataCap = total - ecPer * blocks;
    if (bytes.length + 2 <= dataCap) { ver = v; break; }
  }
  if (!ver) return null;

  const [size, total, ecPer, blocks, aligns] = VERSIONS[ver];
  const dataCap = total - ecPer * blocks;

  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);
  const maxBits = dataCap * 8;
  pushBits(0, Math.min(4, maxBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }
  const pads = [0xec, 0x11];
  for (let i = 0; codewords.length < dataCap; i++) codewords.push(pads[i % 2]);

  // Split into RS blocks and interleave
  const blockData = [];
  const blockEc = [];
  const baseLen = Math.floor(dataCap / blocks);
  const extra = dataCap % blocks;
  let offset = 0;
  for (let b = 0; b < blocks; b++) {
    const len = baseLen + (b >= blocks - extra ? 1 : 0);
    const slice = codewords.slice(offset, offset + len);
    offset += len;
    blockData.push(slice);
    blockEc.push(rsRemainder(slice, ecPer));
  }

  const finalBytes = [];
  const maxBlockLen = Math.max(...blockData.map((d) => d.length));
  for (let i = 0; i < maxBlockLen; i++) {
    for (const d of blockData) if (i < d.length) finalBytes.push(d[i]);
  }
  for (let i = 0; i < ecPer; i++) {
    for (const e of blockEc) finalBytes.push(e[i]);
  }

  return { ver, size, aligns, finalBytes };
}

function buildMatrix(info) {
  const { ver, size, aligns, finalBytes } = info;
  const grid = Array.from({ length: size }, () => new Int8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setFunc = (r, c, val) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    grid[r][c] = val ? 1 : 0;
    reserved[r][c] = 1;
  };

  // Finder patterns + separators
  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dark = inOuter && (
          dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
          (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)
        );
        setFunc(r, c, dark);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  for (const r of aligns) {
    for (const c of aligns) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunc(r + dr, c + dc, dark);
        }
      }
    }
  }

  // Reserve format info + dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) { setFunc(8, i, 0); setFunc(i, 8, 0); }
  }
  for (let i = size - 8; i < size; i++) { setFunc(8, i, 0); setFunc(i, 8, 0); }
  setFunc(size - 8, 8, 1);

  // Version info for ver >= 7
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vbits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = (vbits >>> i) & 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  // Place data bits (mask 0: (r + c) % 2 === 0)
  let bitIdx = 0;
  const totalBits = finalBytes.length * 8;
  let upward = true;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (reserved[row][c]) continue;
        let bit = 0;
        if (bitIdx < totalBits) {
          bit = (finalBytes[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
          bitIdx++;
        }
        if ((row + c) % 2 === 0) bit ^= 1;
        grid[row][c] = bit;
      }
    }
    upward = !upward;
  }

  // Format bits for ECC-L (01) + Mask 0 (000) => 5-bit data = 0b01000 -> BCH+XOR = 0x77c4
  const fmt = 0x77c4;
  for (let i = 0; i <= 5; i++) setFunc(8, i, (fmt >>> (14 - i)) & 1);
  setFunc(8, 7, (fmt >>> 8) & 1);
  setFunc(8, 8, (fmt >>> 7) & 1);
  setFunc(7, 8, (fmt >>> 6) & 1);
  for (let i = 9; i < 15; i++) setFunc(14 - i, 8, (fmt >>> (14 - i)) & 1);
  for (let i = 0; i < 8; i++) setFunc(8, size - 1 - i, (fmt >>> i) & 1);
  for (let i = 8; i < 15; i++) setFunc(size - 15 + i, 8, (fmt >>> i) & 1);
  setFunc(size - 8, 8, 1);

  return grid;
}

export function renderQrSvg(text, px = 160) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  const info = encodeData(bytes);
  if (!info) return '<div class="hint">QR payload too long</div>';
  const grid = buildMatrix(info);
  const quiet = 2;
  const dim = info.size + quiet * 2;
  let d = '';
  for (let r = 0; r < info.size; r++) {
    for (let c = 0; c < info.size; c++) {
      if (grid[r][c]) d += `M${c + quiet},${r + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="Wi-Fi QR code"><rect width="${dim}" height="${dim}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
