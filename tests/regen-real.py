import re, glob, json, os
S="/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad"
names=set()
for f in glob.glob("/home/claude/sgfd-app/src/*.jsx")+glob.glob("/home/claude/sgfd-app/src/*.js"):
    for m in re.findall(r'import\s*\{([^}]*)\}\s*from\s*"lucide-react"', open(f).read(), re.S):
        for n in m.split(","):
            n=n.strip().split(" as ")[0].strip()
            if n: names.add(n)
def keb(n):
    k=re.sub(r'([a-z0-9])([A-Z])',r'\1-\2',n); k=re.sub(r'([A-Z])([A-Z][a-z])',r'\1-\2',k).lower(); return re.sub(r'([a-z])([0-9])',r'\1-\2',k)
missing=[n for n in sorted(names) if not os.path.exists(f"{S}/lucide-src/icons/{keb(n)}.svg")]
print(len(names),"icons; missing in lucide 0.263.1:",missing)
out=['import React from "react";','const mk = (name, kids) => React.forwardRef(({ size = 24, color = "currentColor", strokeWidth = 2, fill = "none", style, ...rest }, ref) => React.createElement("svg", { ref, xmlns: "http://www.w3.org/2000/svg", width: size, height: size, viewBox: "0 0 24 24", fill, stroke: color, strokeWidth, strokeLinecap: "round", strokeLinejoin: "round", "data-icon": name, style, ...rest }, kids.map((k, i) => React.createElement(k[0], { key: i, ...k[1] }))));']
for n in sorted(names):
    p=f"{S}/lucide-src/icons/{keb(n)}.svg"; kids=[]
    if os.path.exists(p):
        for tag,attrs in re.findall(r'<(path|circle|rect|line|polyline|polygon|ellipse)\s([^>]*?)/?>',open(p).read()):
            kids.append([tag,{re.sub(r'-([a-z])',lambda m:m.group(1).upper(),an):av for an,av in re.findall(r'([a-zA-Z0-9-]+)="([^"]*)"',attrs)}])
    out.append(f'export const {n} = mk("{n}", {json.dumps(kids)});')
open("/home/claude/testrun/stubs/lucide-real.js","w").write("\n".join(out))
