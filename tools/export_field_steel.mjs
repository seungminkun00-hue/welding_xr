// Export the existing basic-pipe PBR maps for the editable Blender workshop.
// Run before tools/blender/build_field_workshop.py. No browser is required.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { steelTextures } from '../src/SteelTextures.js';

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

const out = new URL('../assets/field-workshop/steel/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const [name, texture] of Object.entries(steelTextures('polishedTube'))) {
  const { data, width, height } = texture.image;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; // RGBA8
  const stride = width * 4, rows = Buffer.alloc((stride + 1) * height);
  // DataTexture's first row is the bottom; PNG's first row is the top.
  for (let y = 0; y < height; y++) {
    rows.set(data.subarray((height - 1 - y) * stride, (height - y) * stride), y * (stride + 1) + 1);
  }
  writeFileSync(new URL(`${name}.png`, out), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]));
  console.log(`Exported polishedTube ${name}: ${width} x ${height}`);
}
