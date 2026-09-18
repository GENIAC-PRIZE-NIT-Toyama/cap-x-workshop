// Dependency-free PNG encoder for the mock backend's synthetic camera
// frames. Only the subset needed here (8-bit RGB, no interlace, filter 0) —
// see WORKSHOP_WEBUI_LOCAL_DEV.md section 5.

import { deflateSync } from "node:zlib";

const WIDTH = 320;
const HEIGHT = 240;
const BAND_HEIGHT = 16;

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(rgb, width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function fillRect(rgb, x0, y0, w, h, [r, g, b]) {
  const x1 = Math.min(WIDTH, x0 + w);
  const y1 = Math.min(HEIGHT, y0 + h);
  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < x1; x++) {
      const i = (y * WIDTH + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
}

// A dark "table" with a red cube that moves with `step`, and a magenta band
// on top so it can never be mistaken for a real Robosuite render. The wrist
// camera gets a bluish background so the two cameras are distinguishable.
export function renderFrame({ camera, step }) {
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
  const wrist = camera === "wrist";
  fillRect(rgb, 0, 0, WIDTH, HEIGHT, wrist ? [30, 40, 60] : [42, 42, 42]);
  fillRect(rgb, 0, HEIGHT - 60, WIDTH, 60, wrist ? [50, 60, 85] : [70, 70, 70]);

  const cubeSize = wrist ? 56 : 32;
  const travel = WIDTH - cubeSize - 80;
  const x = 40 + ((step * 12) % travel);
  const y = HEIGHT - 60 - cubeSize - (step % 4) * 3;
  fillRect(rgb, x, y, cubeSize, cubeSize, [200, 40, 40]);

  fillRect(rgb, 0, 0, WIDTH, BAND_HEIGHT, [255, 0, 255]);
  return encodePng(rgb, WIDTH, HEIGHT).toString("base64");
}
