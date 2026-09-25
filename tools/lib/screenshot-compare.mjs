/**
 * screenshot-compare.mjs — `pnpm screenshots --compare <runA> <runB>`.
 *
 * Pairs the shots of two runs by file name (`<screen>@<size>.png`), diffs each
 * pair, and writes into run B:
 *   diff/<screen>@<size>.png   changed pixels in magenta (only when any changed)
 *   compare.json               per-pair changed-pixel percentage and verdict
 *   compare.html               contact sheet: before | after | diff per row
 *
 * PNG decoding happens in headless Chrome (createImageBitmap + OffscreenCanvas),
 * the same browser the capture already drives. That keeps the repo at zero new
 * dependencies without hand-writing a PNG decoder (inflate, five filter types,
 * palettes, 16-bit) and without `sips`, which is macOS-only and cannot produce
 * a diff image anyway. The diff math itself is `pixel-diff.mjs`, shipped into
 * the page as source so the Node test covers the code that runs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { openBlankTab } from './headless-chrome.mjs';
import { diffPixels } from './pixel-diff.mjs';

/**
 * Per-channel difference (of 255) still counted as equal. Measured on
 * 2026-09-25: two back-to-back runs of the same build against the same data
 * produced byte-identical PNGs for every stable screen, so this is not hiding
 * renderer noise. It is 2 rather than 0 so a colour token that rounds
 * differently (a `color-mix()` rewritten as its literal, `#7f7f7f` vs
 * `#808080`) does not light up a whole panel during the tokenization codemod.
 */
const TOLERANCE = 2;

function decodeAndDiff(beforeB64, afterB64) {
  return `(async () => {
  const diffPixels = ${diffPixels.toString()};
  const decode = async (b64) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    // No colour management and no premultiplication: compare the stored bytes.
    const bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height,
      rgba: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
  };
  const [before, after] = await Promise.all([decode(${JSON.stringify(beforeB64)}), decode(${JSON.stringify(afterB64)})]);
  if (before.width !== after.width || before.height !== after.height) {
    return { sizeMismatch: before.width + 'x' + before.height + ' vs ' + after.width + 'x' + after.height };
  }
  const { changed, total, image } = diffPixels(before.rgba, after.rgba, ${TOLERANCE});
  if (changed === 0) return { changed, total, png: null };
  const canvas = new OffscreenCanvas(after.width, after.height);
  canvas.getContext('2d').putImageData(new ImageData(image, after.width, after.height), 0, 0);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { changed, total, png: btoa(binary) };
})()`;
}

function readManifest(dir) {
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) throw new Error(`${dir} is not a screenshot run (no manifest.json)`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}

function compareSheet(report, relA) {
  const rows = report.pairs
    .map((pair) => {
      const cell = (src) =>
        src
          ? `<td><a href="${escapeHtml(src)}" target="_blank"><img src="${escapeHtml(src)}" loading="lazy"></a></td>`
          : '<td class="none">—</td>';
      const before = pair.status === 'only-in-b' ? null : `${relA}/${pair.file}`;
      const after = pair.status === 'only-in-a' ? null : pair.file;
      const diff = pair.diff ?? null;
      return `<tr class="${pair.over ? 'over' : ''}"><th scope="row">${escapeHtml(pair.file)}<small>${escapeHtml(pair.label)}</small></th>${cell(before)}${cell(after)}${cell(diff)}</tr>`;
    })
    .join('\n');
  return `<!doctype html>
<meta charset="utf-8">
<title>Screenshot compare · ${escapeHtml(report.createdAt)}</title>
<style>
  body { margin: 0; background: #111418; color: #c9ccd1; font: 13px/1.4 system-ui, sans-serif; }
  header { padding: 16px 20px; border-bottom: 1px solid #2a2f36; }
  header h1 { margin: 0 0 4px; font-size: 16px; }
  header p { margin: 0; color: #8a919b; }
  table { border-collapse: collapse; }
  th, td { padding: 12px; border-bottom: 1px solid #2a2f36; vertical-align: top; text-align: left; }
  thead th { position: sticky; top: 0; background: #111418; z-index: 1; }
  tbody th { width: 200px; }
  tbody th small { display: block; color: #8a919b; font-weight: 400; }
  tr.over th { color: #ff6bd6; }
  img { display: block; max-height: 520px; max-width: 420px; border: 1px solid #2a2f36; border-radius: 6px; }
  td.none { color: #8a919b; }
</style>
<header>
  <h1>${report.failed ? 'Over threshold' : 'Within threshold'} · ${report.overCount} of ${report.pairs.length} over ${report.thresholdPct}%</h1>
  <p>before ${escapeHtml(report.before)} · after ${escapeHtml(report.after)} · per-channel tolerance ${report.tolerance}/255</p>
</header>
<table>
  <thead><tr><th></th><th>before</th><th>after</th><th>diff</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
`;
}

/**
 * Diff run A (before) against run B (after). Returns the report; `failed` is
 * true when any pair is over `thresholdPct`, or a shot exists in only one run
 * (a screen that stopped rendering is a regression, not a zero diff).
 */
export async function compareRuns(dirA, dirB, thresholdPct) {
  const manifestA = readManifest(dirA);
  const manifestB = readManifest(dirB);
  const filesA = new Set(manifestA.shots.map((shot) => shot.file));
  const filesB = new Set(manifestB.shots.map((shot) => shot.file));
  const files = [...new Set([...filesA, ...filesB])].sort();
  fs.mkdirSync(path.join(dirB, 'diff'), { recursive: true });

  const pairs = [];
  const tab = await openBlankTab();
  try {
    for (const file of files) {
      if (!filesB.has(file)) {
        pairs.push({ file, status: 'only-in-a', over: true, label: 'missing from the after run' });
        continue;
      }
      if (!filesA.has(file)) {
        pairs.push({ file, status: 'only-in-b', over: true, label: 'missing from the before run' });
        continue;
      }
      const result = await tab.evaluate(
        decodeAndDiff(
          fs.readFileSync(path.join(dirA, file)).toString('base64'),
          fs.readFileSync(path.join(dirB, file)).toString('base64')
        )
      );
      if (result.sizeMismatch) {
        pairs.push({ file, status: 'size-mismatch', over: true, label: result.sizeMismatch });
        continue;
      }
      const pct = (result.changed / result.total) * 100;
      const diff = result.png ? `diff/${file}` : null;
      if (result.png) fs.writeFileSync(path.join(dirB, diff), Buffer.from(result.png, 'base64'));
      pairs.push({
        file,
        status: 'compared',
        changedPixels: result.changed,
        changedPct: Number(pct.toFixed(4)),
        over: pct > thresholdPct,
        diff,
        label: `${pct.toFixed(3)}% changed (${result.changed} px)`,
      });
    }
  } finally {
    await tab.close();
  }

  const overCount = pairs.filter((pair) => pair.over).length;
  const report = {
    createdAt: new Date().toISOString(),
    before: path.resolve(dirA),
    after: path.resolve(dirB),
    thresholdPct,
    tolerance: TOLERANCE,
    overCount,
    failed: overCount > 0,
    pairs,
  };
  fs.writeFileSync(path.join(dirB, 'compare.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    path.join(dirB, 'compare.html'),
    compareSheet(report, path.relative(dirB, dirA) || '.')
  );
  return report;
}
