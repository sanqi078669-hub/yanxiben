import sharp from "sharp";
import { randomBytes } from "node:crypto";

/** Valid palette PNG <10MiB whose default RGB re-encoding exceeds 10MiB. */
export async function expandingPng() {
  const width = 4096,
    height = 2048;
  const palette = randomBytes(768),
    indices = randomBytes(width * height);
  const raw = Buffer.alloc(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i] * 3;
    raw[i * 3] = palette[index];
    raw[i * 3 + 1] = palette[index + 1];
    raw[i * 3 + 2] = palette[index + 2];
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png({ palette: true, colours: 256, dither: 0 })
    .toBuffer();
}
