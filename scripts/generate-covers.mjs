import fs from "node:fs";
import path from "node:path";

const width = 280;
const height = 180;
const frames = 16;
const delay = 8;
const outDir = path.join("assets", "covers");

const palette = [
  [9, 14, 24],
  [13, 21, 34],
  [17, 28, 44],
  [21, 38, 56],
  [29, 53, 74],
  [42, 64, 88],
  [74, 85, 104],
  [119, 132, 154],
  [226, 232, 240],
  [248, 250, 252],
  [12, 74, 110],
  [14, 116, 144],
  [22, 163, 184],
  [103, 232, 249],
  [191, 244, 255],
  [225, 252, 255],
  [18, 83, 55],
  [22, 116, 72],
  [47, 142, 88],
  [88, 169, 114],
  [145, 199, 136],
  [204, 222, 152],
  [250, 232, 166],
  [66, 39, 24],
  [104, 56, 32],
  [151, 69, 35],
  [207, 82, 42],
  [239, 119, 50],
  [255, 166, 64],
  [255, 214, 104],
  [255, 241, 173],
  [255, 255, 235],
  [92, 18, 34],
  [144, 27, 50],
  [191, 38, 70],
  [232, 86, 103],
  [255, 144, 155],
  [49, 33, 90],
  [85, 58, 148],
  [117, 86, 199],
  [165, 139, 250],
  [216, 205, 255],
  [94, 54, 16],
  [145, 89, 21],
  [202, 138, 4],
  [234, 179, 8],
  [254, 240, 138],
  [32, 43, 61],
  [52, 64, 84],
  [71, 85, 105],
  [100, 116, 139],
  [148, 163, 184],
  [31, 74, 89],
  [15, 118, 110],
  [20, 184, 166],
  [94, 234, 212],
  [153, 246, 228],
  [119, 55, 23],
  [154, 52, 18],
  [194, 65, 12],
  [249, 115, 22],
  [251, 146, 60],
  [20, 184, 166],
  [244, 63, 94],
];

function u16(n) {
  return Buffer.from([n & 255, (n >> 8) & 255]);
}

function blockify(buf) {
  const blocks = [];
  for (let i = 0; i < buf.length; i += 255) {
    const part = buf.subarray(i, i + 255);
    blocks.push(Buffer.from([part.length]), part);
  }
  blocks.push(Buffer.from([0]));
  return Buffer.concat(blocks);
}

function bitWriter() {
  const out = [];
  let cur = 0;
  let bits = 0;
  return {
    write(code, size) {
      cur |= code << bits;
      bits += size;
      while (bits >= 8) {
        out.push(cur & 255);
        cur >>= 8;
        bits -= 8;
      }
    },
    finish() {
      if (bits > 0) out.push(cur & 255);
      return Buffer.from(out);
    },
  };
}

function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let codeSize = minCodeSize + 1;
  const writer = bitWriter();

  // Keep each packet below the decoder's code-size growth threshold. This is
  // intentionally uncompressed, but avoids fragile GIF LZW dictionary behavior.
  const packetPixels = Math.max(8, clear - 16);
  let inPacket = 0;
  writer.write(clear, codeSize);

  for (let i = 0; i < indices.length; i += 1) {
    writer.write(indices[i], codeSize);
    inPacket += 1;
    if (inPacket >= packetPixels && i < indices.length - 1) {
      writer.write(clear, codeSize);
      inPacket = 0;
    }
  }

  writer.write(end, codeSize);
  return writer.finish();
}

function encodeGif(frameData) {
  const tableBits = Math.ceil(Math.log2(palette.length));
  const tableSize = 1 << tableBits;
  const minCodeSize = Math.max(2, tableBits);
  const padded = [...palette];
  while (padded.length < tableSize) padded.push([0, 0, 0]);

  const parts = [
    Buffer.from("GIF89a", "ascii"),
    u16(width),
    u16(height),
    Buffer.from([0x80 | (7 << 4) | (tableBits - 1), 0, 0]),
    Buffer.from(padded.flat()),
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from("NETSCAPE2.0", "ascii"),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
  ];

  for (const frame of frameData) {
    parts.push(
      Buffer.from([0x21, 0xf9, 0x04, 0x04]),
      u16(delay),
      Buffer.from([0, 0]),
      Buffer.from([0x2c]),
      u16(0),
      u16(0),
      u16(width),
      u16(height),
      Buffer.from([0]),
      Buffer.from([minCodeSize]),
      blockify(lzwEncode(frame, minCodeSize)),
    );
  }

  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

class Canvas {
  constructor(bg = 0) {
    this.pixels = new Uint8Array(width * height);
    this.pixels.fill(bg);
  }

  set(x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < width && y >= 0 && y < height) this.pixels[y * width + x] = c;
  }

  rect(x, y, w, h, c) {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(width, Math.round(x + w));
    const y1 = Math.min(height, Math.round(y + h));
    for (let yy = y0; yy < y1; yy += 1) {
      this.pixels.fill(c, yy * width + x0, yy * width + x1);
    }
  }

  hline(x0, x1, y, c) {
    y = Math.round(y);
    if (y < 0 || y >= height) return;
    x0 = Math.max(0, Math.round(x0));
    x1 = Math.min(width - 1, Math.round(x1));
    if (x1 >= x0) this.pixels.fill(c, y * width + x0, y * width + x1 + 1);
  }

  line(x0, y0, x1, y1, c, thickness = 1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= steps; i += 1) {
      const x = x0 + (dx * i) / steps;
      const y = y0 + (dy * i) / steps;
      if (thickness <= 1) {
        this.set(x, y, c);
      } else {
        this.circle(x, y, thickness / 2, c);
      }
    }
  }

  circle(cx, cy, r, c) {
    const x0 = Math.floor(cx - r);
    const x1 = Math.ceil(cx + r);
    const y0 = Math.floor(cy - r);
    const y1 = Math.ceil(cy + r);
    const rr = r * r;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= rr) this.set(x, y, c);
      }
    }
  }

  ring(cx, cy, r, c, thickness = 2) {
    const x0 = Math.floor(cx - r - thickness);
    const x1 = Math.ceil(cx + r + thickness);
    const y0 = Math.floor(cy - r - thickness);
    const y1 = Math.ceil(cy + r + thickness);
    const outer = (r + thickness) * (r + thickness);
    const inner = Math.max(0, (r - thickness) * (r - thickness));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const d = dx * dx + dy * dy;
        if (d <= outer && d >= inner) this.set(x, y, c);
      }
    }
  }
}

function hash(x, y, seed = 0) {
  let n = x * 374761393 + y * 668265263 + seed * 2147483647;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function gradient(canvas, bands) {
  for (let y = 0; y < height; y += 1) {
    const t = y / (height - 1);
    const band = bands[Math.min(bands.length - 1, Math.floor(t * bands.length))];
    canvas.hline(0, width - 1, y, band);
  }
}

function border(canvas, c = 6) {
  canvas.rect(0, 0, width, 2, c);
  canvas.rect(0, height - 2, width, 2, c);
  canvas.rect(0, 0, 2, height, c);
  canvas.rect(width - 2, 0, 2, height, c);
}

function makeWildfire() {
  const data = [];
  for (let f = 0; f < frames; f += 1) {
    const c = new Canvas();
    const p = f / frames;
    gradient(c, [10, 10, 11, 16, 17, 17]);
    for (let y = 110; y < height; y += 1) {
      const ridge = 104 + Math.sin((y + f) * 0.04) * 6;
      c.hline(0, width - 1, y, y < ridge ? 18 : 16 + ((y + f) % 3));
    }

    for (let x = 0; x < width; x += 14) {
      c.line(x, 112, x + 22, 174, 20, 1);
      c.line(x + 14, 112, x - 8, 174, 20, 1);
    }

    const front = 34 + p * (width + 60);
    for (let y = 98; y < height - 7; y += 7) {
      for (let x = 4; x < width - 5; x += 7) {
        const wave = Math.sin((y * 0.13) + (f * 0.42)) * 12;
        const d = x - front - wave + hash(x, y, 4) * 24;
        if (d < -14) c.rect(x, y, 6, 6, hash(x, y, f) > 0.74 ? 24 : 23);
        if (d >= -14 && d < 36) {
          const idx = d < 5 ? 30 : d < 14 ? 29 : d < 25 ? 27 : 26;
          c.circle(x + 3, y + 3, 4 + hash(x, y, f) * 4, idx);
        }
      }
    }

    const frontY = 113 + Math.sin(f * 0.45) * 6;
    c.line(front - 26, frontY + 30, front + 54, frontY - 7, 31, 2);
    c.line(front - 35, frontY + 38, front + 68, frontY + 2, 29, 2);

    for (let i = 0; i < 4; i += 1) {
      const x = 26 + i * 16;
      const h = 18 + Math.sin(f * 0.35 + i) * 5;
      c.rect(x, 26 + i * 5, 10, h, 13);
      c.rect(112 - x / 2, 28 + i * 5, 10, h, 13);
      c.line(x + 10, 35 + i * 5, 112 - x / 2, 37 + i * 5, 14, 1);
    }
    c.line(152, 30, 244, 30 + Math.sin(f * 0.22) * 4, 14, 1);
    c.line(152, 48, 244, 48 + Math.cos(f * 0.25) * 4, 14, 1);
    c.line(152, 66, 244, 66 + Math.sin(f * 0.2) * 4, 14, 1);
    border(c);
    data.push(c.pixels);
  }
  return data;
}

function makeAgents() {
  const data = [];
  const nodes = [
    [45, 92],
    [84, 48],
    [96, 132],
    [142, 76],
    [154, 128],
    [204, 54],
    [224, 116],
  ];
  const edges = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4], [3, 5], [4, 6], [5, 6], [1, 4]];
  for (let f = 0; f < frames; f += 1) {
    const c = new Canvas(1);
    for (let x = 0; x < width; x += 18) c.line(x, 0, x, height, 3, 1);
    for (let y = 0; y < height; y += 18) c.line(0, y, width, y, 3, 1);

    for (const [a, b] of edges) c.line(nodes[a][0], nodes[a][1], nodes[b][0], nodes[b][1], 6, 2);

    const phase = (f / frames) * edges.length;
    for (let i = 0; i < edges.length; i += 1) {
      const [a, b] = edges[i];
      const local = phase - i;
      if (local >= 0 && local < 1) {
        const x = nodes[a][0] + (nodes[b][0] - nodes[a][0]) * local;
        const y = nodes[a][1] + (nodes[b][1] - nodes[a][1]) * local;
        c.line(nodes[a][0], nodes[a][1], x, y, 35, 2);
        c.circle(x, y, 5, 30);
      }
    }

    nodes.forEach(([x, y], i) => {
      const pulse = 1.5 + Math.sin(f * 0.45 + i) * 1.2;
      c.ring(x, y, 10 + pulse, i === 0 ? 35 : 13, 2);
      c.circle(x, y, 7, i === 0 ? 34 : 12);
      c.circle(x - 2, y - 2, 2, 15);
    });

    for (let y = 128; y < 160; y += 7) {
      for (let x = 190; x < 256; x += 7) c.rect(x, y, 4, 4, hash(x, y, f) > 0.7 ? 35 : 4);
    }
    border(c);
    data.push(c.pixels);
  }
  return data;
}

function makeSpectral() {
  const data = [];
  for (let f = 0; f < frames; f += 1) {
    const c = new Canvas(0);
    for (let i = 0; i < 60; i += 1) {
      const x = Math.floor(hash(i, 1, 9) * width);
      const y = Math.floor(hash(i, 2, 9) * 90);
      if (hash(i, f, 10) > 0.38) c.set(x, y, 8 + (i % 2));
    }

    c.rect(20, 92, 240, 62, 16);
    c.rect(26, 98, 228, 50, 3);
    for (let x = 36; x < 246; x += 24) {
      c.line(x, 120, x + 18, 120 + Math.sin((x + f * 8) * 0.08) * 17, 54, 2);
      c.circle(x, 120, 3, 55);
      c.circle(x + 18, 120 + Math.sin((x + f * 8) * 0.08) * 17, 3, 55);
    }
    c.rect(116, 104, 48, 34, 47);
    c.rect(122, 110, 36, 22, 48);
    for (let i = 0; i < 6; i += 1) {
      c.rect(102, 108 + i * 5, 10, 2, 55);
      c.rect(168, 108 + i * 5, 10, 2, 55);
    }

    let lastX = 0;
    let lastY = 52;
    for (let x = 1; x < width; x += 2) {
      const y = 52 + Math.sin((x + f * 10) * 0.11) * 15 + Math.sin((x + f * 15) * 0.031) * 8;
      c.line(lastX, lastY, x, y, 13, 2);
      lastX = x;
      lastY = y;
    }

    for (let i = 0; i < 26; i += 1) {
      const x = 20 + i * 9;
      const amp = Math.pow(Math.sin((i * 0.41) + (f * 0.28)), 2);
      const h = 7 + amp * 58 + (i % 5 === 0 ? 18 : 0);
      c.rect(x, 170 - h, 5, h, amp > 0.75 ? 30 : amp > 0.45 ? 28 : 13);
    }
    border(c);
    data.push(c.pixels);
  }
  return data;
}

function makeMurlan() {
  const data = [];
  for (let f = 0; f < frames; f += 1) {
    const c = new Canvas(16);
    for (let y = 0; y < height; y += 1) c.hline(0, width - 1, y, y < 80 ? 53 : y < 130 ? 16 : 1);
    c.ring(72, 92, 46, 55, 2);
    c.ring(204, 92, 46, 13, 2);
    for (let i = 0; i < 5; i += 1) {
      const p = ((f / frames) + i * 0.2) % 1;
      const x = 28 + p * 190;
      const y = 44 + Math.sin(p * Math.PI) * 34 + i * 8;
      c.rect(x, y, 28, 42, 9);
      c.rect(x + 3, y + 3, 22, 36, i % 2 ? 34 : 10);
      c.circle(x + 14, y + 21, 5, i % 2 ? 36 : 13);
    }
    const net = [[80, 142], [122, 126], [122, 158], [174, 126], [174, 158], [218, 142]];
    for (const [a, b] of [[0, 1], [0, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 5], [4, 5]]) {
      c.line(net[a][0], net[a][1], net[b][0], net[b][1], 7, 1);
    }
    net.forEach(([x, y], i) => {
      c.circle(x, y, 6, i === 5 ? 29 : 40);
      c.circle(x - 2, y - 2, 2, 41);
    });
    for (let i = 0; i < 5; i += 1) {
      const h = 8 + ((Math.sin(f * 0.4 + i) + 1) / 2) * 24;
      c.rect(31 + i * 10, 157 - h, 6, h, 46 - (i % 3));
    }
    border(c);
    data.push(c.pixels);
  }
  return data;
}

function makeBalkan() {
  const data = [];
  const centers = [[160, 70, 12], [208, 92, 39], [178, 126, 54]];
  for (let f = 0; f < frames; f += 1) {
    const c = new Canvas(9);
    for (let x = 34; x < 252; x += 18) c.line(x, 28, x, 154, 8, 1);
    for (let y = 32; y < 156; y += 18) c.line(32, y, 252, y, 8, 1);
    c.line(36, 150, 252, 150, 49, 2);
    c.line(36, 150, 36, 28, 49, 2);

    for (let i = 0; i < 18; i += 1) {
      const h = 20 + Math.sin(f * 0.26 + i * 0.7) * 13 + hash(i, 3, 2) * 36;
      c.rect(14 + i * 5, 152 - h, 3, h, i % 3 === 0 ? 12 : i % 3 === 1 ? 40 : 54);
    }

    for (let cluster = 0; cluster < centers.length; cluster += 1) {
      const [cx, cy, color] = centers[cluster];
      c.ring(cx, cy, 22 + Math.sin(f * 0.35 + cluster) * 4, color, 1);
      for (let i = 0; i < 18; i += 1) {
        const a = i * 2.399 + f * 0.08 * (cluster + 1);
        const r = 7 + hash(i, cluster, 4) * 20;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a * 1.2) * r * 0.65;
        c.circle(x, y, 3, color);
      }
    }
    c.line(118, 142, 246, 48 + Math.sin(f * 0.24) * 5, 6, 1);
    border(c, 51);
    data.push(c.pixels);
  }
  return data;
}

function makeHeart() {
  const data = [];
  for (let f = 0; f < frames; f += 1) {
    const c = new Canvas(1);
    for (let x = 0; x < width; x += 20) c.line(x, 0, x, height, 3, 1);
    for (let y = 0; y < height; y += 20) c.line(0, y, width, y, 3, 1);
    c.rect(24, 36, 232, 108, 16);
    c.rect(32, 44, 216, 92, 2);
    for (let x = 46; x < 238; x += 32) {
      c.line(x, 84, x + 28, 118, 54, 2);
      c.line(x, 118, x + 28, 84, 54, 2);
      c.circle(x, 84, 3, 55);
      c.circle(x + 28, 118, 3, 55);
    }
    c.rect(116, 72, 48, 36, 47);
    for (let i = 0; i < 8; i += 1) {
      c.rect(102 + i * 9, 62, 4, 12, 50);
      c.rect(102 + i * 9, 108, 4, 12, 50);
    }

    const pulseX = (f / frames) * width;
    let px = 0;
    let py = 92;
    for (let x = 0; x < width; x += 2) {
      const d = ((x - pulseX + width) % width) / width;
      let y = 92 + Math.sin((x + f * 5) * 0.05) * 3;
      if (d < 0.08) y -= Math.sin((d / 0.08) * Math.PI) * 54;
      if (d >= 0.08 && d < 0.14) y += Math.sin(((d - 0.08) / 0.06) * Math.PI) * 25;
      c.line(px, py, x, y, d < 0.16 ? 35 : 13, 2);
      px = x;
      py = y;
    }
    c.ring(218, 58, 12 + Math.sin(f * 0.52) * 4, 35, 2);
    c.circle(218, 58, 6, 34);
    border(c);
    data.push(c.pixels);
  }
  return data;
}

function makeRecommendation() {
  const data = [];
  for (let f = 0; f < frames; f += 1) {
    const c = new Canvas(0);
    for (let x = 0; x < width; x += 20) c.line(x, 0, x, height, 3, 1);
    for (let y = 0; y < height; y += 20) c.line(0, y, width, y, 3, 1);

    c.rect(18, 22, 92, 116, 9);
    c.rect(24, 30, 80, 100, 2);
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        const x = 32 + col * 11;
        const y = 40 + row * 12;
        const wave = Math.sin(f * 0.35 + row * 0.8 + col * 0.45);
        const seen = hash(row, col, 12) > 0.35;
        const color = seen ? (wave > 0.35 ? 46 : wave > -0.2 ? 55 : 12) : 5;
        c.rect(x, y, 8, 8, color);
      }
    }

    const nodes = [
      [146, 62],
      [146, 112],
      [196, 42],
      [196, 86],
      [196, 130],
      [244, 64],
      [244, 116],
    ];
    for (const [a, b] of [[0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 5], [3, 5], [3, 6], [4, 6]]) {
      c.line(nodes[a][0], nodes[a][1], nodes[b][0], nodes[b][1], 49, 1);
    }
    const active = Math.floor((f / frames) * 10);
    for (let i = 0; i <= active; i += 1) {
      const edge = [[0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 5], [3, 5], [3, 6], [4, 6]][i % 10];
      c.line(nodes[edge[0]][0], nodes[edge[0]][1], nodes[edge[1]][0], nodes[edge[1]][1], 13, 2);
    }
    nodes.forEach(([x, y], i) => {
      c.circle(x, y, i < 2 ? 9 : 7, i < 2 ? 39 : i < 5 ? 12 : 35);
      c.circle(x - 2, y - 2, 2, 15);
    });

    const starX = 145 + (f % frames) * 6;
    for (let i = 0; i < 5; i += 1) {
      const x = 124 + i * 15;
      c.line(x, 156, x + 6, 144, i * 15 < starX - 124 ? 46 : 6, 2);
      c.line(x + 6, 144, x + 12, 156, i * 15 < starX - 124 ? 46 : 6, 2);
      c.line(x + 1, 151, x + 11, 151, i * 15 < starX - 124 ? 46 : 6, 2);
    }
    c.rect(210, 150, 44, 8, 47);
    c.rect(214, 153, 34 + Math.sin(f * 0.5) * 6, 2, 56);
    border(c, 50);
    data.push(c.pixels);
  }
  return data;
}

const covers = [
  ["wildfire-cover.gif", makeWildfire],
  ["multi-agent-cover.gif", makeAgents],
  ["spectral-fpga-cover.gif", makeSpectral],
  ["murlan-rl-cover.gif", makeMurlan],
  ["balkan-dynamics-cover.gif", makeBalkan],
  ["heart-rate-cover.gif", makeHeart],
  ["recommendation-systems-cover.gif", makeRecommendation],
];

fs.mkdirSync(outDir, { recursive: true });
for (const [name, make] of covers) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, encodeGif(make()));
  const size = fs.statSync(file).size;
  console.log(`${file} ${(size / 1024).toFixed(1)} KB`);
}
