import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffPixels } from './pixel-diff.mjs';

const W = 40;
const H = 30;

// A non-uniform image, so a diff that compared the wrong offsets (or only one
// channel) could not accidentally come out right.
function gradient() {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      rgba.set([x * 6, y * 8, (x + y) * 3, 255], i);
    }
  }
  return rgba;
}

function paintRect(rgba, x0, y0, w, h, delta) {
  const out = new Uint8ClampedArray(rgba);
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const i = (y * W + x) * 4;
      out[i + 2] = (out[i + 2] + delta) % 256; // blue only: every channel must be compared
    }
  }
  return out;
}

test('identical images differ in zero pixels', () => {
  const { changed, total } = diffPixels(gradient(), gradient(), 0);
  assert.equal(changed, 0);
  assert.equal(total, W * H);
});

test('a changed 7x4 rectangle is exactly 28 changed pixels, marked magenta in the image', () => {
  const before = gradient();
  const after = paintRect(before, 11, 9, 7, 4, 40);
  const { changed, image } = diffPixels(before, after, 2);
  assert.equal(changed, 28);
  const inside = (10 * W + 12) * 4;
  const outside = (0 * W + 0) * 4;
  assert.deepEqual([...image.slice(inside, inside + 4)], [255, 0, 255, 255]);
  assert.notDeepEqual([...image.slice(outside, outside + 4)], [255, 0, 255, 255]);
});

test('a difference at the tolerance is not a change; one above it is', () => {
  const before = gradient();
  assert.equal(diffPixels(before, paintRect(before, 0, 0, 5, 5, 2), 2).changed, 0);
  assert.equal(diffPixels(before, paintRect(before, 0, 0, 5, 5, 3), 2).changed, 25);
});
