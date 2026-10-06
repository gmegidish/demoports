import random,struct,sys
from emu import *
from model_tri import *
random.seed(int(sys.argv[1]) if len(sys.argv)>1 else 1)
e=Emu(); e.setup()
tex=bytes(random.randrange(256) if random.random()>0.2 else 0 for _ in range(65536))
e.mu.mem_write(TEX,tex)
bg=bytes(random.randrange(256) for _ in range(64000))
fails=0
for it in range(int(sys.argv[2]) if len(sys.argv)>2 else 300):
    for variant,addr in (('opaque',0x12962),('key',0x11e8c),('blend',0x12fe1)):
        mode=random.randrange(4)
        def rv():
            x=random.randrange(0,320)
            y=random.randrange(-60,260) if mode else random.randrange(0,200)
            if mode==3: y=random.choice([y,10,50,-5,220])
            return V(x,y,random.randrange(65536) if mode==2 else random.randrange(256),random.randrange(65536) if mode==2 else random.randrange(256))
        vs=[rv(),rv(),rv()]
        st=struct.pack('<I',TEX)+b''.join(struct.pack('<hhHH',v.x,v.y,v.u,v.v) for v in vs)
        e.mu.mem_write(STRUCT,st); e.setbuf(bg)
        try:
            e.call(addr,eax=STRUCT)
        except Exception as ex:
            print('emu fail',variant,[(v.x,v.y,v.u,v.v) for v in vs],ex); e=Emu(); e.setup(); e.mu.mem_write(TEX,tex); continue
        real=e.getall()
        fb=bytearray(0x10000)+bytearray(bg)+bytearray(0x40000-0x10000-64000)
        try: tri(fb,tex,vs,variant)
        except Exception as ex:
            print('model fail',variant,[(v.x,v.y,v.u,v.v) for v in vs],repr(ex)); fails+=1; continue
        if bytes(fb)!=real:
            fails+=1
            nd=sum(1 for a,b in zip(fb,real) if a!=b)
            if fails<8: print('MISMATCH',variant,[(v.x,v.y,v.u,v.v) for v in vs],nd)
print('fails',fails)
