#!/bin/bash
# For a merge commit M: report lines each parent ADDED (vs merge-base) in files BOTH parents changed,
# that are missing from M. A miss is either an intended resolution or a lost change -> review each.
M=$1; P1=$(git rev-parse $M^1); P2=$(git rev-parse $M^2); B=$(git merge-base $P1 $P2)
both=$(comm -12 <(git diff --name-only $B $P1 | sort) <(git diff --name-only $B $P2 | sort))
for f in $both; do
  git cat-file -e $M:"$f" 2>/dev/null || { echo "  $f: deleted in merge"; continue; }
  merged=$(git show $M:"$f")
  for side in 1 2; do P=$([ $side = 1 ] && echo $P1 || echo $P2)
    miss=$(git diff -U0 $B $P -- "$f" | grep '^+' | grep -v '^+++' | sed 's/^+//' | awk 'length($0)>12' | while IFS= read -r l; do t=$(printf '%s' "$l" | sed 's/^[[:space:]]*//'); grep -qF -- "$t" <<<"$merged" || printf '%s\n' "$t"; done)
    n=$(printf '%s' "$miss" | grep -c . )
    [ "$n" -gt 0 ] && { echo "  $f: parent$side lost $n added line(s):"; printf '%s\n' "$miss" | head -4 | sed 's/^/      /'; }
  done
done
