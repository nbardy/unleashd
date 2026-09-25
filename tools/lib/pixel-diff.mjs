/**
 * pixel-diff.mjs — the diff math behind `pnpm screenshots --compare`.
 *
 * One pure function over two RGBA buffers of the same size. It has no imports
 * and touches no globals on purpose: `screenshot-compare.mjs` ships its source
 * into headless Chrome (`diffPixels.toString()`), which decodes the PNGs with
 * createImageBitmap, and the Node test calls the very same function. One
 * implementation, so the tested math is the math that runs.
 *
 * A pixel counts as changed when any channel differs by more than `tolerance`
 * (0..255). The diff image paints changed pixels solid magenta over a faded
 * greyscale copy of `after`, so a reviewer sees WHERE the change is and what
 * surrounds it.
 *
 * @param {Uint8ClampedArray} before RGBA, width*height*4
 * @param {Uint8ClampedArray} after  RGBA, width*height*4
 * @param {number} tolerance per-channel absolute difference that still counts as equal
 * @returns {{ changed: number, total: number, image: Uint8ClampedArray }}
 */
export function diffPixels(before, after, tolerance) {
  const image = new Uint8ClampedArray(after.length);
  let changed = 0;
  for (let i = 0; i < after.length; i += 4) {
    const delta = Math.max(
      Math.abs(before[i] - after[i]),
      Math.abs(before[i + 1] - after[i + 1]),
      Math.abs(before[i + 2] - after[i + 2]),
      Math.abs(before[i + 3] - after[i + 3])
    );
    if (delta > tolerance) {
      changed += 1;
      image[i] = 255;
      image[i + 1] = 0;
      image[i + 2] = 255;
    } else {
      // Faded luma: context without competing with the magenta.
      const luma = (after[i] * 299 + after[i + 1] * 587 + after[i + 2] * 114) / 1000;
      const faded = 200 + luma * 0.2;
      image[i] = faded;
      image[i + 1] = faded;
      image[i + 2] = faded;
    }
    image[i + 3] = 255;
  }
  return { changed, total: after.length / 4, image };
}
