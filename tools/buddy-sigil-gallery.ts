// Renders a preview gallery of Buddy sigils from the real generator.
//   pnpm exec tsx tools/buddy-sigil-gallery.ts [out.html] [Buddy Name ...]
// Open the output through the app's /api/serve/<repo path> route to tune styles.
import { writeFileSync } from 'node:fs';
import { SIGIL_STYLES, drawSigil } from '../client/src/components/buddies/buddy-sigil';

const [out = 'agent_notes/buddy-sigils-gallery.html', ...names] = process.argv.slice(2);
const buddies =
  names.length > 0
    ? names
    : [
        'Product Development Lead',
        'Memory Reviewer',
        'Release Captain',
        'Growth Analyst',
        'Design Critic',
        'Infra Oncall',
      ];

const img = (svg: string, size: number) =>
  `<img width="${size}" height="${size}" style="border-radius:${size / 4.5}px" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;

const chat = buddies
  .map((name) => {
    const sigil = drawSigil(name);
    return `<div class="msg">${img(sigil.svg, 36)}<div><b>${name}</b> <small>${sigil.style}</small><br>Posted the standup notes for today.</div></div>`;
  })
  .join('');

const styles = SIGIL_STYLES.map((style) => {
  const cells = Array.from({ length: 16 }, (_, i) =>
    img(drawSigil(`${style} sample ${i}`, style).svg, 64)
  );
  return `<h2>${style}</h2><div class="grid">${cells.join('')}</div>`;
}).join('');

writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><title>Buddy sigils</title><style>
body{background:#1a1b1e;color:#c9ccd1;font:13px/1.4 system-ui,sans-serif;margin:24px}
h2{font-size:12px;color:#8b9099;margin:24px 0 10px;text-transform:uppercase;letter-spacing:.06em}
.grid{display:flex;flex-wrap:wrap;gap:12px}.msg{display:flex;gap:10px;margin:10px 0}
.msg img{margin-top:2px}b{color:#e6e8eb}small{color:#6b7079}
</style><h2>In a channel (36px)</h2>${chat}${styles}`
);
console.log(out);
