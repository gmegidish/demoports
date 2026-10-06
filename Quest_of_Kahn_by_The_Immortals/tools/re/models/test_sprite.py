import random,struct,sys
from emu import *
from model_sprite import *
random.seed(int(sys.argv[1]) if len(sys.argv)>1 else 1)
e=Emu(); e.setup()
tex=bytes(random.randrange(256) for _ in range(65536)); table=bytes(random.randrange(256) for _ in range(65536))
e.mu.mem_write(TEX,tex); e.mu.mem_write(TAB,table)
bg=bytes(random.randrange(256) for _ in range(64000))
fails=0
for it in range(int(sys.argv[2]) if len(sys.argv)>2 else 500):
    x0=random.randrange(-100,340); y0=random.randrange(-100,220); x1=x0+random.randrange(0,200); y1=y0+random.randrange(0,200)
    p0=((y0<<16)+x0)&0xffffffff; p1=((y1<<16)+x1)&0xffffffff
    e.setbuf(bg)
    try: e.call(0x10f60,eax=p0,edx=p1,ebx=TEX,ecx=BUF)
    except Exception as ex:
        print('emu fail',x0,y0,x1,y1,ex); e=Emu(); e.setup(); e.mu.mem_write(TEX,tex); e.mu.mem_write(TAB,table); continue
    real=e.getall()
    fb=bytearray(0x10000)+bytearray(bg)+bytearray(0x40000-0x10000-64000)
    sprite(fb,tex,table,p0,p1)
    if bytes(fb)!=real:
        fails+=1
        d=[i-0x10000 for i,(a,b) in enumerate(zip(fb,real)) if a!=b]
        if fails<8: print('MISMATCH',(x0,y0,x1,y1),len(d),[(o//320,o%320) for o in d[:4]])
print('fails',fails)
