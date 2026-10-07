# CMP=name compare.py T... (writes $S/name.png; default name cmp)
# compare.py T... : port (node tools/shot.mjs) vs capture, side by side, into cmp.png ; prints diff stats
import os
WORK = os.environ.get('EUPHORIA_RE_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work'))
EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'EUPHORIA.EXE')

import sys,subprocess,os
from PIL import Image
import numpy as np
S=WORK
P='/Users/gilm/git/demoports/Euphoria_by_Esteem'
ts=sys.argv[1:]
NAME=os.environ.get('CMP','cmp')
SH=S+'/shots/'+NAME
os.makedirs(SH,exist_ok=True)
subprocess.run(['node',P+'/tools/shot.mjs',SH]+ts,check=True,stdout=subprocess.DEVNULL)
rows=[]
for t in ts:
    cp=SH+'/cap-%s.png'%t
    subprocess.run([S+'/venv/bin/python',S+'/capframe.py',t,cp],check=True)
    a=Image.open(SH+'/port-%.2f.png'%float(t)).convert('RGB'); b=Image.open(cp).convert('RGB')
    if a.size==b.size:
        d=(np.asarray(a).astype(int)-np.asarray(b).astype(int))
        print(t,'differing pixels %.1f%%'%(100*(np.abs(d).sum(2)>0).mean()))
    w=max(a.width,b.width); h=max(a.height,b.height)
    row=Image.new('RGB',(2*w+8,h),'magenta'); row.paste(a,(0,0)); row.paste(b,(w+8,0)); rows.append(row)
W=max(r.width for r in rows); H=sum(r.height+8 for r in rows)
out=Image.new('RGB',(W,H),'gray'); y=0
for r in rows: out.paste(r,(0,y)); y+=r.height+8
out.save(S+'/'+NAME+'.png'); print('wrote',S+'/'+NAME+'.png')
