import random,struct,sys
from emu import *
from model_span import *
random.seed(int(sys.argv[1]) if len(sys.argv)>1 else 1)
e=Emu(); e.setup()
tex=bytes(random.randrange(256) for _ in range(65536)); table=bytes(random.randrange(256) for _ in range(65536))
e.mu.mem_write(TEX,tex); e.mu.mem_write(TAB,table)
bg=bytes(random.randrange(256) for _ in range(64000))
fails=0
f=lambda x: fround(x)
for it in range(int(sys.argv[2]) if len(sys.argv)>2 else 200):
    for variant,addr in (('blend',0x119c2),('opaque',0x1255b)):
        y0=random.randrange(0,150); rows1=random.randrange(0,25); rows2=random.randrange(0,25)
        xl=random.randrange(40,200); w=random.randrange(1,100) if variant=='opaque' else random.randrange(-1,100)
        if random.random()<0.2: w=random.choice([15,16,17,31,32,33,1,2])
        S={}
        S['i04']=y0*320+xl; S['i08']=y0*320+xl+w
        sl=lambda: (320<<16)+random.randrange(-65536,65536)
        S['i0c']=sl(); S['i10']=sl(); S['i14']=S['i0c']+random.randrange(0,40000); S['i18']=S['i10']-random.randrange(0,40000) if rows2 else sl()
        if rows2 and (S['i18']-S['i10'])*(rows2+1)+ (S['i14']-S['i0c'])*rows1 + (w<<16) < 0x18000: S['i18']=S['i10']
        S['i4c']=rows1|(rows2<<16)
        z=random.uniform(1,20); dzx=random.uniform(-0.002,0.002); dzy=random.uniform(-0.002,0.002)
        ooz=1/z
        u=random.uniform(-70000,70000); v=random.uniform(-70000,70000)
        S['f40']=f(ooz); S['f44']=f(u*ooz); S['f48']=f(v*ooz)
        S['f1c']=f(16*dzx*ooz); S['f20']=f(random.uniform(-300,300)*16*ooz); S['f24']=f(random.uniform(-300,300)*16*ooz)
        for k in ('f28','f2c'): S[k]=f(dzy*ooz)
        for k in ('f30','f34','f38','f3c'): S[k]=f(random.uniform(-300,300)*ooz)
        s0=(TEX|(TAB>>16)) if variant=='blend' else TEX
        st=struct.pack('<I6i12fI',s0,S['i04'],S['i08'],S['i0c'],S['i10'],S['i14'],S['i18'],
            S['f1c'],S['f20'],S['f24'],S['f28'],S['f2c'],S['f30'],S['f34'],S['f38'],S['f3c'],S['f40'],S['f44'],S['f48'],S['i4c'])
        e.mu.mem_write(STRUCT,st); e.setbuf(bg)
        e.mu.mem_write(0x53e10,b'\0\0')
        try: e.call(addr,eax=STRUCT)
        except Exception as ex:
            print('emu fail',variant,S,ex); e=Emu(); e.setup(); e.mu.mem_write(TEX,tex); e.mu.mem_write(TAB,table); continue
        real=e.getall()
        fb=bytearray(0x10000)+bytearray(bg)+bytearray(0x40000-0x10000-64000)
        span(fb,tex,table,S,variant)
        if bytes(fb)!=real:
            fails+=1
            d=[i-0x10000 for i,(a,b) in enumerate(zip(fb,real)) if a!=b]
            if fails<6: print('MISMATCH',variant,len(d),[(o//320,o%320) for o in d[:5]],rows1,rows2,w,y0,xl)
print('fails',fails)
