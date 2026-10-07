# peek.py ADDR COUNT [b|w|sw|d|f|q|x|r|s]   ADDR = DS offset (e.g. 0x2522) or SEG:OFF (e.g. 186a:0066 for cs constants)
# types: b bytes, w u16, sw s16, d u32, f float32, q float64, x float80 (extended), r real48, s pascal string
import os
WORK = os.environ.get('EUPHORIA_RE_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work'))
EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'EUPHORIA.EXE')

import sys,struct
img=open(''+WORK+'/img.bin','rb').read()
a=sys.argv[1]; n=int(sys.argv[2],0); t=sys.argv[3] if len(sys.argv)>3 else 'b'
if ':' in a: s,o=a.split(':'); lin=int(s,16)*16+int(o,16)
else: lin=0x22200+int(a,0)
def get(k): return img[lin+k] if lin+k<len(img) else 0  # BSS beyond image = 0
def raw(k,n): return bytes(get(k+i) for i in range(n))
def r48(b):
    if b[0]==0: return 0.0
    m=int.from_bytes(b[1:5],'little')|((b[5]&0x7f)<<32)
    return (1+m/2**39)*2**(b[0]-129)*(-1 if b[5]&0x80 else 1)
def x80(b):
    m=int.from_bytes(b[:8],'little'); e=int.from_bytes(b[8:10],'little')
    if m==0: return 0.0
    return (-1 if e&0x8000 else 1)*m/2**63*2.0**((e&0x7fff)-16383)
sz={'b':1,'w':2,'sw':2,'d':4,'f':4,'q':8,'x':10,'r':6}
if t=='s':
    L=get(0); print(repr(raw(1,L).decode('latin1'))); sys.exit()
out=[]
for i in range(n):
    b=raw(i*sz[t],sz[t])
    v={'b':lambda:b[0],'w':lambda:struct.unpack('<H',b)[0],'sw':lambda:struct.unpack('<h',b)[0],'d':lambda:struct.unpack('<I',b)[0],
       'f':lambda:struct.unpack('<f',b)[0],'q':lambda:struct.unpack('<d',b)[0],'x':lambda:x80(b),'r':lambda:r48(b)}[t]()
    out.append(hex(v) if t in('b','w','d') else repr(v))
print(' '.join(out))
if lin>=0x22200+0x2620: print('(BSS: zero-initialised at start)')
