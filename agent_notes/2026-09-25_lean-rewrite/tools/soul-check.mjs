// Read-only: compare each buddy's soul file on disk with its soul memory head.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 12);
const rows = db.prepare(`SELECT b.id, b.slug, b.status, b.soul_path, p.root_path, r.body, r.revision, r.sha256, h.updated_at
  FROM buddies b JOIN projects p ON p.id=b.project_id
  LEFT JOIN buddy_memory_heads h ON h.buddy_id=b.id AND h.document_kind='soul'
  LEFT JOIN buddy_memory_revisions r ON r.id=h.revision_id ORDER BY b.slug`).all();
const tally = {};
for (const b of rows) {
  let verdict, detail = '';
  if (!b.soul_path) verdict = b.body ? 'no_path_db_only' : 'no_path_empty';
  else {
    const path = isAbsolute(b.soul_path) ? b.soul_path : resolve(b.root_path, b.soul_path);
    if (!existsSync(path)) verdict = 'file_missing';
    else {
      const raw = readFileSync(path, 'utf8');
      const m = raw.match(/^---\nversion: (\d+)\nupdated: ([^\n]*)\ndocument: soul\n---\n\n/);
      const fileBody = m ? raw.slice(m[0].length) : raw;
      const same = fileBody.trimEnd() === (b.body ?? '').trimEnd();
      verdict = same ? (m && Number(m[1]) === b.revision ? 'match' : 'match_body_version_differs') : (m ? 'differ_rendered' : 'differ_unrendered');
      detail = `file_ver=${m?.[1] ?? '-'} db_rev=${b.revision} file=${sha(fileBody.trimEnd())} db=${sha((b.body ?? '').trimEnd())} fileLen=${fileBody.length} dbLen=${(b.body ?? '').length}`;
    }
  }
  tally[verdict] = (tally[verdict] ?? 0) + 1;
  console.log([b.slug, b.status, verdict, detail].join('\t'));
}
console.error(JSON.stringify(tally));
