#!/bin/bash
# Build stubs/lucide.js from every lucide-react import in src/
cd /home/claude/sgfd-app/src
names=$(python3 - <<'PY'
import re,glob
s=set()
for f in glob.glob('*.jsx'):
    t=open(f).read()
    for m in re.finditer(r'import\s*\{([^}]*)\}\s*from\s*"lucide-react"', t, re.S):
        for n in m.group(1).split(','):
            n=n.strip().split(' as ')[0].strip()
            if n: s.add(n)
print(' '.join(sorted(s)))
PY
)
{
  echo 'import React from "react";'
  for n in $names; do
    echo "export const $n = (p) => React.createElement('span', { 'data-icon': '$n', 'aria-label': p['aria-label'], role: p['aria-label'] ? 'button' : undefined, style: { display: 'inline-block', width: p.size || 14, height: p.size || 14 }, onClick: p.onClick });"
  done
} > /home/claude/testrun/stubs/lucide.js
echo "stubbed $(echo $names | wc -w) icons"
