#!/usr/bin/env bash
# check-client-invariants.sh — 3 grep gates for Mobile PWA (§12, PLANNING_MOBILE.md §12)
# Fails CI if any invariant is violated. Zero custom plugins — stock grep only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAIL=0

echo "==> Gate G1: jotaiStore.set outside client/src/atoms/ — components call actions, never write atoms"
# Allowlist: only files under client/src/atoms/ may call jotaiStore.set
# mutate.ts wraps jotaiStore.set inside atoms/ — allowed; everything outside must be zero.
if grep -R --include="*.ts" --include="*.tsx" -n "jotaiStore\.set" client/src 2>/dev/null | grep -v "client/src/atoms/" | grep -v "node_modules" ; then
  echo "G1 FAIL: jotaiStore.set found outside client/src/atoms/. Components must call actions, never write atoms directly."
  echo "  Fix: move the write into an action in client/src/atoms/actions.ts (or another module in client/src/atoms/)."
  FAIL=1
else
  echo "G1 PASS"
fi
echo

echo "==> Gate G2: raw .buddyContext / .purpose reads in client/src/mobile/ — use the row kind"
# All mobile code must read identity from the row's `kind` via matchConversationKind
# (shared/src/conversation-config.ts), never raw field access. One-allowed consumer is components/buddies/buddies-shaping.ts
# which is outside mobile/. Zero hits expected in mobile/.
# Exclude parsed.*.purpose from buddy-review-message parser (pure helper, not Conversation.purpose).
if grep -R --include="*.ts" --include="*.tsx" -n "\.buddyContext\|\.purpose" client/src/mobile 2>/dev/null | grep -v "parsed\.purpose" | grep -v "parsed\.subjectBuddyId" | grep -v "No raw \.buddyContext" ; then
  echo "G2 FAIL: raw .buddyContext or .purpose read in client/src/mobile/. Read row.kind / matchConversationKind()."
  FAIL=1
else
  echo "G2 PASS"
fi
echo

echo "==> Gate G3: components/*.tsx imports in mobile/ — except components/buddies/*"
# mobile/ may import atoms/*, hooks/*, utils/*, shared/*, components/buddies/* — never other components/*.tsx
# Parsers now live in utils/, not components/. CSS side-effect imports from components would couple trees.
# Allow: components/buddies/{api,types,ui-contract,buddies-shaping}.ts — co-located shaping, not view trees.
# Path-resolving check: resolve each relative import against the importing file's dir and fail
# if the resolved path is under client/src/components/ and not client/src/components/buddies/.
# This catches the mobile/index.ts hole where "../components" text looks like mobile/components
# but actually resolves to the desktop tree.
if ! node <<'NODE'
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const mobileRoot = path.join(ROOT, 'client/src/mobile');
const componentsRoot = path.join(ROOT, 'client/src/components') + path.sep;
const buddiesRoot = path.join(ROOT, 'client/src/components/buddies') + path.sep;
const importRe = /from\s+["']([^"']+)["']/g;
let violations = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) {
      const src = fs.readFileSync(p, 'utf8');
      let m;
      while ((m = importRe.exec(src))) {
        const spec = m[1];
        if (!spec.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(p), spec);
        const norm = resolved + path.sep;
        if (norm.startsWith(componentsRoot) && !norm.startsWith(buddiesRoot)) {
          violations.push(`${path.relative(ROOT, p)} imports ${spec} -> ${path.relative(ROOT, resolved)}`);
        }
      }
    }
  }
}
walk(mobileRoot);
if (violations.length) { violations.forEach(v => console.error('G3 violation: ' + v)); process.exit(1); }
NODE
then
  echo "G3 FAIL: mobile/ imports from components/* outside components/buddies/. Move shared logic to utils/ or atoms/."
  echo "  Allowed: components/buddies/{api,types,ui-contract,buddies-shaping}.ts only."
  FAIL=1
else
  echo "G3 PASS"
fi
echo

# Both remaining gates ban a secure-context-gated browser API outside its
# wrapper. They are text greps, so a doc comment naming the API would trip them
# — strip comment lines (leading //, * or /*) before matching.
strip_comments() { grep -v -E '^[^:]*:[0-9]+:[[:space:]]*(//|\*|/\*)'; }

echo "==> Gate G4: bare crypto.randomUUID() — secure-context only, undefined over plain-http LAN"
# The dev server is opened on phones via http://<lan-ip>:7489, which is NOT a secure
# context, so crypto.randomUUID is undefined there and every creation path throws.
# client/src/utils/ids.ts owns the getRandomValues-based fallback; it is the one
# allowed reference to crypto.randomUUID.
if grep -R --include="*.ts" --include="*.tsx" -n "crypto\.randomUUID" client/src 2>/dev/null | grep -v "client/src/utils/ids.ts" | strip_comments | grep . ; then
  echo "G4 FAIL: bare crypto.randomUUID() outside client/src/utils/ids.ts."
  echo "  Fix: import { newId } from '<...>/utils/ids' and call newId()."
  FAIL=1
else
  echo "G4 PASS"
fi
echo

echo "==> Gate G5: bare navigator.clipboard — same secure-context trap as G4"
# navigator.clipboard is undefined (not merely rejecting) in a non-secure
# context, so `navigator.clipboard.writeText(...)` throws a TypeError before it
# can be caught as a rejection. client/src/utils/clipboard.ts owns the
# execCommand fallback and reports success as a boolean.
if grep -R --include="*.ts" --include="*.tsx" -n "navigator\.clipboard" client/src 2>/dev/null | grep -v "client/src/utils/clipboard.ts" | strip_comments | grep . ; then
  echo "G5 FAIL: bare navigator.clipboard outside client/src/utils/clipboard.ts."
  echo "  Fix: import { copyText } from '<...>/utils/clipboard' and check its boolean result."
  FAIL=1
else
  echo "G5 PASS"
fi
echo

echo "==> Gate G6: one owner per CSS class — the same class defined in two .css files"
# CSS here is global (plain .css imports, no modules). Two files defining the
# same class silently fight over the cascade: import order picks the winner and
# the loser leaves no trace. This cost real debugging time when a header chip
# picked up SwarmDetail's .config-summary { flex-direction: column }. Shared
# primitives (.empty-state, .provider-badge) live once in client/src/App.css;
# everything else is prefixed with its component.
DUPES="$(
  while IFS= read -r f; do
    grep -o -E '^\.[a-zA-Z0-9_-]+' "$f" | sed 's/^\.//' | sort -u | sed "s|\$| $f|"
  done < <(find client/src -name '*.css') | awk '{print $1}' | sort | uniq -d
)"
if [ -n "$DUPES" ]; then
  echo "G6 FAIL: these classes are defined in more than one .css file:"
  while IFS= read -r c; do
    [ -z "$c" ] && continue
    echo "  .$c"
    grep -l -E "^\.$c[[:space:],{:]" $(find client/src -name '*.css') | sed 's/^/      /'
  done <<< "$DUPES"
  echo "  Fix: prefix the class with its component (.chat-config-summary, not"
  echo "  .config-summary), or move a genuinely shared primitive to client/src/App.css."
  FAIL=1
else
  echo "G6 PASS"
fi
echo

echo "==> Gate G7: no literal px font-size / padding / gap, and only the two breakpoints"
# Pattern: tokens-and-shells (docs/patterns.md#tokens-and-shells)
# T21a collapsed 45 font sizes and 172 paddings onto the scale in
# client/src/ui/tokens.css; this keeps a new `padding: 7px` from starting the
# drift again. Breakpoints cannot be var(), so their VALUES are checked: 768px
# (device switch) and 340px (compact phone), see tokens.css.
# Every stylesheet is covered: the last exemptions (Channel*.css,
# mobile-channels.css) reached 0 on 2026-09-26 and KNOWN_LITERAL is gone.
if ! node <<'NODE'
const fs = require('fs');
const path = require('path');
const SRC = 'client/src';
const TOKENS = 'ui/tokens.css';
const BREAKPOINTS = new Set(['768px', '340px']);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const DECL = /(?:^|[{;\s])(font-size|padding(?:-[a-z-]+)?|gap|row-gap|column-gap)\s*:([^;{}]*)/g;
const PX = /(?:^|[\s(,])-?(\d*\.?\d+)px\b/g;
const bad = [];
for (const file of walk(SRC).filter((f) => f.endsWith('.css'))) {
  const rel = path.relative(SRC, file);
  if (rel === TOKENS) continue;
  const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const hits = [];
  for (const m of text.matchAll(DECL)) {
    const line = text.slice(0, m.index).split('\n').length;
    for (const px of m[2].matchAll(PX)) if (Number(px[1]) !== 0) hits.push(`${rel}:${line} ${m[1]}: ${m[2].trim()}`);
  }
  for (const m of text.matchAll(/@media[^{]*/g)) {
    for (const w of m[0].matchAll(/(?:min|max)-width:\s*([\d.]+px)/g)) {
      if (!BREAKPOINTS.has(w[1])) hits.push(`${rel}:${text.slice(0, m.index).split('\n').length} @media ${w[1]}`);
    }
  }
  if (hits.length) bad.push(`${rel}: ${hits.length} literal(s)\n    ${hits.slice(0, 8).join('\n    ')}`);
}
if (bad.length) { bad.forEach((b) => console.error('  ' + b)); process.exit(1); }
NODE
then
  echo "G7 FAIL: use a --fs-* / --sp-* token from client/src/ui/tokens.css (or 768px/340px in @media)."
  FAIL=1
else
  echo "G7 PASS"
fi
echo

echo "==> Gate G8: total client CSS lines must not grow"
# Ratchet: the lean rewrite takes CSS from 18.4k lines to a ~3.75k budget
# (lean-scope 06 §3). When a change cuts CSS, lower CSS_LINE_CEILING to the new
# total in the same commit so the cut cannot silently grow back.
CSS_LINE_CEILING=14544 # T20-B search into views/search (-153), config picker into views/config (-7), 2026-09-26; earlier: 14704 channel CSS on tokens + primitives (-95), 2026-09-26; earlier: 14799 channel parity merged (DM notice +10, paid by Chat.css/Sidebar.css merges); channel parity merged (DM notice +10, paid by Chat.css/Sidebar.css merges), 2026-09-26; earlier: 14801 dead-code sweep, 14836 banner, 14831 PORT-3, 14838 audit, 14841 S6+port, 14855 S6, 14947, 14961, 14975, 14980; 15834 on 4e5a01c
CSS_LINES="$(find client/src -name '*.css' -print0 | xargs -0 cat | wc -l | tr -d ' ')"
if [ "$CSS_LINES" -gt "$CSS_LINE_CEILING" ]; then
  echo "G8 FAIL: client CSS is $CSS_LINES lines, ceiling $CSS_LINE_CEILING. Reuse a primitive (ui/primitives.css) or cut elsewhere."
  FAIL=1
else
  echo "G8 PASS ($CSS_LINES / $CSS_LINE_CEILING lines)"
fi
echo

if [ "$FAIL" -ne 0 ]; then
  echo "check-client-invariants: FAILED — fix the gates above."
  exit 1
fi

echo "check-client-invariants: all 8 gates PASS"
