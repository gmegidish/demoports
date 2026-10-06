M32=0xffffffff
MARGIN=0x10000
def s16(v):
    v&=0xffff; return v-0x10000 if v&0x8000 else v
def s32(v):
    v&=M32; return v-(1<<32) if v&0x80000000 else v
def sprite(fb,tex,table,p0,p1,W=320,H=200):
    """p0,p1 = packed 32-bit (y<<16)+x corner values (as the caller builds them)"""
    p0&=M32; p1&=M32
    x0=s16(p0); x1=s16(p1); y0=s16(p0>>16); y1=s16(p1>>16)
    if x0>=320 or x1<0 or s32(p0)>=0xc80000 or s32(p1)<0: return
    d=(p1-p0)&M32
    w=s16(d); h=s16(d>>16)
    if w<2 or h<2: return
    du=0x10000//w; dv=0x10000//h            # 8.8 texel steps (unsigned 16-bit)
    q=0
    if s32(p0)<0: h=s16(h+y0); v=((-y0)*dv)&0xffff
    else: v=0; q+=y0*W
    if s32((p1-0xc70000)&M32)>=0: h=s16(h-(((p1-0xc70000)&M32)>>16))
    if x0<0: w=s16(w+x0); u=((-x0)*du)&0xffff
    else: u=0; q+=x0
    if x1-0x13f>=0: w=s16(w-(x1-0x13f))
    rows=max(h,1)             # do{...}while(--h>0) effectively: h-1 down to 0
    skip=320-w
    vacc=v                    # 8.8
    n=w-2
    for _ in range(rows):
        uacc=u; npx = (n+2) if n>=0 else (2 if n%2==0 else 3)
        p=q
        for i in range(npx):
            t=tex[((vacc>>8)<<8)|(uacc>>8)]
            idx=MARGIN+p
            dst=fb[idx]
            # even pixel of each pair: table[texel<<8|dst]; odd: table[dst<<8|texel]; the final odd-width pixel is 'even'
            fb[idx]=table[(t<<8)|dst] if i%2==0 else table[(dst<<8)|t]
            uacc=(uacc+du)&0xffff; p+=1
        q+=320 if n>=0 else npx+skip - (1 if npx==3 else 0) + (1 if npx==3 else 0)
        vacc=(vacc+dv)&0xffff
