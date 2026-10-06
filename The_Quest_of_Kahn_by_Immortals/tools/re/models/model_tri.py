import struct,math
M32=0xffffffff
def s16(v):
    v&=0xffff; return v-0x10000 if v&0x8000 else v
def s32(v):
    v&=M32; return v-(1<<32) if v&0x80000000 else v
def tdiv(a,b):
    q=abs(a)//abs(b); return -q if (a<0)!=(b<0) else q
def rint(x): # round half even
    return int(round(x))
def fist16(x):
    if x!=x or abs(x)==math.inf: return -32768
    r=rint(x); return r if -32768<=r<=32767 else -32768
MARGIN=0x10000
class V:
    def __init__(s,x,y,u,v): s.x=x; s.y=y; s.u=u&0xffff; s.v=v&0xffff
    @property
    def key(s): return s32(((s.y&0xffff)<<16)|(s.x&0xffff))
def tri(fb,tex,verts,variant,W=320,H=200):
    """fb: bytearray with MARGIN offset; tex: 65536 bytes (texture, or table for variant 'blend');
       variant: 'opaque' (sub_12962), 'key' (sub_11e8c), 'blend' (sub_12fe1)"""
    PITCH=W<<16
    A,Bv,C=verts
    if A.key==Bv.key or A.key==C.key or Bv.key==C.key: return
    T,M,B=sorted(verts,key=lambda v:v.key)
    if B.key<0 or T.key>=(H<<16): return
    if (B.y&0xffff)==(T.y&0xffff): return
    dxb=s16(B.x-T.x); dxm=s16(M.x-T.x); dyb=s16(B.y-T.y); dym=s16(M.y-T.y)
    D=float(dxb*dym-dxm*dyb)
    invD=(1.0/D) if D!=0 else math.inf
    slope_long=tdiv(dxb*65536,dyb)
    dub=s16(B.u-T.u); dum=s16(M.u-T.u); dvb=s16(B.v-T.v); dvm=s16(M.v-T.v)
    def grad(b,m):
        n=float(b*256*dym-m*256*dyb)
        if D==0: return -32768
        return fist16(n*invD)
    dudx=grad(dub,dum)&0xffff; dvdx=grad(dvb,dvm)&0xffff
    wacc=0; rows2=0
    du2=dv2=lstep2=wstep2=None
    def duv(du_,dv_,dy):
        du=(tdiv(du_*65536,dy)&M32)>>8 & 0xffff
        dv=(tdiv(dv_*65536,dy)&M32)>>8 & 0xffff
        return du,dv
    leftmid=False
    if dym==0:
        wacc=(dxm&0xffff)<<16; rows1=0; slope_tm=0
    else:
        slope_tm=tdiv(dxm*65536,dym); rows1=dym
        leftmid = slope_tm<slope_long
    dy2=dyb-dym
    if leftmid:
        wstep1=(slope_long-slope_tm)&M32; lstep1=(slope_tm+PITCH)&M32
        du1,dv1=duv(dum,dvm,dym)
        if dy2==0:
            if variant!='blend': rows1+=1
            rows2=0
        else:
            slope_mb=tdiv(s16(B.x-M.x)*65536,dy2)
            wstep2=(slope_long-slope_mb)&M32; lstep2=(slope_mb+PITCH)&M32
            du2,dv2=duv(s16(B.u-M.u),s16(B.v-M.v),dy2); rows2=dy2+1
    else:
        wstep1=(slope_tm-slope_long)&M32
        du1,dv1=duv(dub,dvb,dyb); du2,dv2=du1,dv1
        slope_mb=tdiv(s16(B.x-M.x)*65536,dy2)
        wstep2=(slope_mb-slope_long)&M32; rows2=dy2+1
        lstep1=lstep2=(slope_long+PITCH)&M32
    if s16(B.y)>=H:
        rows2=s16(rows2-(s16(B.y)-(H-1)))
        if rows2<0: rows1=s16(rows1+rows2); rows2=0
    # start state
    u=T.u&0xff; v=T.v&0xff; vf_extra=0
    ytop=s16(T.y)
    if ytop>=0:
        p=(T.x&0xffff)+ytop*W; lfrac=0x8000
    else:
        n=-ytop
        if rows1-n>=0:
            rows1-=n
            prod=n*s32(lstep1-PITCH)          # 16.16
            f=(prod&0xffff)+0x8000
            p=(T.x&0xffff)+(prod>>16)+(f>>16); lfrac=f&0xffff
            u=(u+((n*du1)>>8))&0xff if False else (((u<<8)+n*du1)&0xffff)>>8
            v=(((v<<8)+n*dv1)&0xffff)>>8
            wacc=(wacc+n*wstep1)&M32
        else:
            rows2=s16(rows2+rows1-n); m=n-rows1
            if lstep1==lstep2:
                prod=n*s32(lstep1-PITCH); f=(prod&0xffff)+0x8000
                p=(T.x&0xffff)+(prod>>16)+(f>>16); lfrac=f&0xffff
                u=(u+(((n*du1)&0xffff)>>8))&0xff
                v=(v+(((n*dv1)&0xffff)>>8))&0xff
            else:
                prod=m*s32(lstep2-PITCH); f=(prod&0xffff)+0x8000
                p=(M.x&0xffff)+(prod>>16)+(f>>16); lfrac=f&0xffff
                # esi=[0][v][0][u] + [0][mdv hi][mdv lo][mdu hi] as one 32-bit add; then u=byte0, v=byte2
                e=(((M.v&0xff)<<16)|(M.u&0xff))+((((m*dv2)&0xffff)<<8)|(((m*du2)&0xffff)>>8))
                u=e&0xff; v=(e>>16)&0xff; vf_extra=(e>>24)&0xff
            wacc=(-(wstep2*(rows2&0xffff)))&M32
            rows1=0
    p&=M32
    ufrac=0x80; v16=(v<<8)|0x80|vf_extra          # v 8.8
    if variant=='opaque': wacc=(wacc+1)&M32
    elif variant=='blend': wacc=(wacc+0xffff0001)&M32
    ebp=((dudx&0xff)<<24)|dvdx; duint=(dudx>>8)&0xff
    def put(q,val): fb[MARGIN+s32(q)]=val
    def get(q): return fb[MARGIN+s32(q)]
    def rows(count,lstep,wstep,du,dv):
        nonlocal p,lfrac,wacc,u,ufrac,v16
        for _ in range(count):
            tot=s32(wacc+lfrac)
            N=tot>>16
            if variant=='blend':
                npx = 0 if tot<0 else N+1
            else:
                npx = max(N,0)+1
            edx=(ufrac<<24)|v16; bl=u; q=p
            for i in range(npx):
                if variant=='blend':
                    d=get(q); put(q,tex[(d<<8)|bl])
                else:
                    t=tex[((edx>>8)&0xff)<<8|bl] if i>0 else tex[((v16>>8)<<8)|bl]
                    if variant=='opaque' or t!=0: put(q,t)
                edx+=ebp; c=edx>>32; edx&=M32
                bl=(bl+duint+c)&0xff; q+=1
            f=lfrac+(lstep&0xffff); lfrac=f&0xffff
            p=(p+(lstep>>16)+(f>>16))&M32
            # u,v edge step: esi=[ufrac][0][v16] + [du frac][0][dv16]
            e=((ufrac<<24)|v16)+(((du&0xff)<<24)|dv)
            c=e>>32; ufrac=(e>>24)&0xff; v16=e&0xffff
            u=(u+(du>>8)+c)&0xff
            wacc=(wacc+wstep)&M32
    if rows1>0: rows(rows1,lstep1,wstep1,du1,dv1)
    if rows2>0: rows(rows2,lstep2,wstep2,du2,dv2)
