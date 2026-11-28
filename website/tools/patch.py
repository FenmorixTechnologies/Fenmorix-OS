# Makes a small patch that turns the live Worker script (= main's website/worker.js) into the newly built one, split into
# chunks for upload through the Cloudflare API: {tpl (worker.js with the big constants as __NAME__), ops (character edits to the
# old HTML), og (base64 share image)}. Usage: python3 tools/patch.py [base-ref] -> /tmp/claude-0/chunkN.txt
import re, json, difflib, subprocess, hashlib, sys
base = sys.argv[1] if len(sys.argv) > 1 else 'main'
old = subprocess.check_output(['git','show',f'{base}:website/worker.js']).decode()
new = open('worker.js').read()
c=lambda s,n: json.loads(re.search(r'^const %s = (".*");$'%n,s,re.M).group(1))
A=c(old,'HTML'); B=c(new,'HTML')
al=A.splitlines(True); bl=B.splitlines(True)
ao=[0];[ao.append(ao[-1]+len(x)) for x in al]; bo=[0];[bo.append(bo[-1]+len(x)) for x in bl]
ops=[]
for tag,i1,i2,j1,j2 in difflib.SequenceMatcher(None,al,bl,autojunk=False).get_opcodes():
    if tag=='equal': continue
    sa=A[ao[i1]:ao[i2]]; sb=B[bo[j1]:bo[j2]]
    for t,x1,x2,y1,y2 in difflib.SequenceMatcher(None,sa,sb,autojunk=False).get_opcodes():
        if t!='equal': ops.append([ao[i1]+x1, ao[i1]+x2, sb[y1:y2]])
m=[]
for o in ops:
    if m and o[0]-m[-1][1] < 12: p=m[-1]; m[-1]=[p[0], o[1], p[2]+A[p[1]:o[0]]+o[2]]
    else: m.append(o)
out=[];pos=0
for s,e,t in m: out.append(A[pos:s]); out.append(t); pos=e
out.append(A[pos:]); assert ''.join(out)==B
keep=[n for n in ['LOGO','FAV','AVX','FXW','PORTAL'] if re.search(r'^const %s = '%n,new,re.M)]
for n in keep: assert c(old,n)==c(new,n), n
tpl=new
for n in ['HTML','OG']+keep:
    mm=re.search(r'^const %s = (".*");$'%n,tpl,re.M); tpl=tpl[:mm.start(1)]+'__%s__'%n+tpl[mm.end(1):]
data=json.dumps({'tpl':tpl,'ops':m,'og':c(new,'OG'),'keep':keep},separators=(',',':'))
n=3; size=-(-len(data)//n)
for i in range(n):
    ch=data[i*size:(i+1)*size]; open(f'/tmp/claude-0/chunk{i}.txt','w').write(ch)
    assert '`' not in ch and '${' not in ch
    print(i,len(ch),hashlib.sha256(ch.encode()).hexdigest())
print('old',hashlib.sha256(old.encode()).hexdigest()); print('new',hashlib.sha256(new.encode()).hexdigest())
