// Dev gallery for Buddy sigils (open /sigil-gallery.html on the dev server).
// Renders random names at avatar size, plus latent walks between pairs to show
// the style space is continuous — no categories to jump between.
import {
  decodeGenome,
  lerpLatent,
  nameGenome,
  nameLatent,
  nameSeed,
} from '../components/buddies/sigil/genome';
import { renderSigil } from '../components/buddies/sigil/render';

const params = new URLSearchParams(location.search);
const count = Number(params.get('count') ?? 60);
const offset = Number(params.get('offset') ?? 0);

function heading(text: string) {
  const h = document.createElement('h2');
  h.textContent = text;
  h.style.cssText =
    'font-size:12px;color:#8b9099;margin:24px 0 10px;text-transform:uppercase;letter-spacing:.06em';
  document.body.append(h);
}

function row() {
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;align-items:center';
  document.body.append(div);
  return div;
}

function image(url: string, size: number) {
  const img = document.createElement('img');
  img.src = url;
  img.width = size;
  img.height = size;
  img.style.borderRadius = `${size / 4.5}px`;
  return img;
}

async function main() {
  heading('Channel size (36px)');
  const names = [
    'Product Development Lead',
    'Buddies Development Lead',
    'Memory Reviewer',
    'Release Captain',
    'Growth Analyst',
    'Design Critic',
    'Infra Oncall',
  ];
  for (const name of names) {
    const line = document.createElement('div');
    line.style.cssText = 'display:flex;gap:10px;margin:8px 0;align-items:center';
    line.append(image(await renderSigil(nameGenome(name)), 36), name);
    document.body.append(line);
  }

  heading(`Random names ${offset}–${offset + count} (72px)`);
  const grid = row();
  for (let i = offset; i < offset + count; i++) {
    grid.append(image(await renderSigil(nameGenome(`buddy ${i}`)), 72));
  }

  heading('Latent walks (continuous interpolation)');
  for (const [a, b] of [
    ['walk a', 'walk b'],
    ['walk c', 'walk d'],
    ['walk e', 'walk f'],
  ]) {
    const walk = row();
    const za = nameLatent(a);
    const zb = nameLatent(b);
    for (let s = 0; s <= 10; s++) {
      const genome = decodeGenome(lerpLatent(za, zb, s / 10), nameSeed(a));
      walk.append(image(await renderSigil(genome), 64));
    }
  }
  document.body.dataset.ready = 'true';
}

main().catch((error: unknown) => {
  document.body.append(String(error));
  document.body.dataset.ready = 'error';
});
