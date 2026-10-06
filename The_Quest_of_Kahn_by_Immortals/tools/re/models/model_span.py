import struct,math
M32=0xffffffff
MARGIN=0x10000
def fround(x): return struct.unpack('<f',struct.pack('<f',x))[0]
def s16(v):
    v&=0xffff; return v-0x10000 if v&0x8000 else v
def s8(v):
    v&=0xff; return v-0x100 if v&0x80 else v
def s32(v):
    v&=M32; return v-(1<<32) if v&0x80000000 else v
def fist32(x):
    if x!=x or abs(x)==math.inf: return 0x80000000
    r=int(round(x))
    return r&M32 if -2**31<=r<2**31 else 0x80000000
def span(fb,tex,table,S,variant):
    """S: dict with keys i04,i08,i0c,i10,i14,i18,i4c (ints) and f1c..f48 (float32 values)"""
    blend = variant=='blend'
    A,B,C=S['f1c'],S['f20'],S['f24']
    ooz,uoz,voz=S['f40'],S['f44'],S['f48']
    dooz,duoz,dvoz=S['f28'],S['f30'],S['f38']
    lstep,rstep=S['i0c']&M32,S['i14']&M32
    rows1=s16(S['i4c']); rows2=s16(S['i4c']>>16)
    if blend: L=S['i04']&M32; R=(S['i08']+1)&M32; lfrac=0x8001
    else:     L=(S['i04']-2)&M32; R=(S['i08']-1)&M32; lfrac=0x8000
    rfrac=0x8000
    Z=1.0/ooz
    def pix(q,t):
        i=MARGIN+s32(q)
        fb[i]=table[(t<<8)|fb[i]] if blend else t
    def scanline():
        nonlocal Z,ooz,uoz,voz,L,R,lfrac,rfrac
        V0=fist32(voz*Z); U0=fist32(uoz*Z)
        uoz_n=fround(uoz+B); voz_n=fround(voz+C)
        t=ooz+A; ooz_n=fround(t); Z=1.0/t
        width=(R-L)&M32
        ch=(width>>4)&0xff; rem=width&15
        if blend:
            if rem==0:
                ch=(ch-1)&0xff
                if s8(ch)>=0: rem=16
        else:
            if rem==0: rem=16; ch=(ch-1)&0xff
        blocks=s8(ch-1)+1          # block loop runs while (--ch)>=0 (signed byte)
        q=L if blend else (L+2)&M32
        def run(U0,V0,U1,V1,n):
            nonlocal q
            edx=(V0&0xffffff)|((U0&0xff)<<24)
            dU=(U1-U0)&M32
            ebp=(((dU>>4)&0xff)<<24)|((s16(V1-V0)>>4)&0xffff)
            ui=(dU>>12)&0xff
            bl=(U0>>8)&0xff
            for _ in range(n):
                pix(q,tex[(((edx>>8)&0xff)<<8)|bl]); q=(q+1)&M32
                edx+=ebp; c=edx>>32; edx&=M32
                bl=(bl+ui+c)&0xff
        for _ in range(max(blocks,0)):
            V1=fist32(voz_n*Z); voz_n=fround(voz_n+C)
            U1=fist32(uoz_n*Z); uoz_n=fround(uoz_n+B)
            t=ooz_n+A; ooz_n=fround(t); Znext=1.0/t
            run(U0,V0,U1,V1,16)
            U0,V0=U1,V1; Z=Znext
        V1=fist32(voz_n*Z); U1=fist32(uoz_n*Z)
        uoz=fround(uoz+duoz); voz=fround(voz+dvoz)
        t=ooz+dooz; ooz=fround(t); Z=1.0/t
        run(U0,V0,U1,V1,rem)
        f=lfrac+(lstep&0xffff); lfrac=f&0xffff; L=(L+s16(lstep>>16)+(f>>16))&M32
        f=rfrac+(rstep&0xffff); rfrac=f&0xffff; R=(R+s16(rstep>>16)+(f>>16))&M32
    for _ in range(max(rows1,0)): scanline()
    if rows2>0:
        lstep,rstep=S['i10']&M32,S['i18']&M32
        dooz,duoz,dvoz=S['f2c'],S['f34'],S['f3c']
        for _ in range(rows2+1): scanline()
