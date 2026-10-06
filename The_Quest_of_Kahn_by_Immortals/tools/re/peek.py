# peek.py ADDR COUNT [b|w|d|f|q|s|p]  -- dump data from the loaded image (code 0x10000.., data 0x50000..)
# b bytes, w u16, d u32 (hex), f float32, q float64, s C strings, p u32 pointers annotated with fixup info
import sys,struct,json,os
S=os.path.dirname(os.path.abspath(__file__))
code=open(S+'/obj1.bin','rb').read(); data=open(S+'/obj2.bin','rb').read()
fix={f[0]:f[1] for f in json.load(open(S+'/fix.json'))}
a=int(sys.argv[1],16); n=int(sys.argv[2]); t=sys.argv[3] if len(sys.argv)>3 else 'b'
def rd(a,k):
    if a>=0x50000: return data[a-0x50000:a-0x50000+k].ljust(k,b'\0')
    return code[a-0x10000:a-0x10000+k]
if t=='b':
    for i in range(0,n,16): print('%05x: %s'%(a+i,rd(a+i,min(16,n-i)).hex(' ')))
elif t=='s':
    for _ in range(n):
        b=rd(a,256); e=b.find(b'\0'); print('%05x: %r'%(a,b[:e].decode('latin1'))); a+=e+1
else:
    sz={'w':2,'d':4,'f':4,'q':8,'p':4}[t]; fmt={'w':'<H','d':'<I','f':'<f','q':'<d','p':'<I'}[t]
    for i in range(n):
        v=struct.unpack(fmt,rd(a+i*sz,sz))[0]
        if t=='p': print('%05x: %08x%s'%(a+i*sz,v,'  (fixup)' if a+i*sz in fix else ''))
        elif t in 'fq': print('%05x: %g'%(a+i*sz,v))
        else: print('%05x: %x'%(a+i*sz,v))
