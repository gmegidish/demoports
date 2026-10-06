import struct,sys
d=open('KAHN.EXE','rb').read()
le=0x2c90
def u32(o): return struct.unpack_from('<I',d,o)[0]
def u16(o): return struct.unpack_from('<H',d,o)[0]
npages=u32(le+0x14); pagesize=u32(le+0x28); lastpage=u32(le+0x2c)
objtab=le+u32(le+0x40); nobj=u32(le+0x44); objpagetab=le+u32(le+0x48)
fixpagetab=le+u32(le+0x68); fixrectab=le+u32(le+0x6c); datapages=u32(le+0x80)
objs=[]
for i in range(nobj):
    vsize,base,flags,pidx,np,_=struct.unpack_from('<IIIIII',d,objtab+i*24)
    objs.append(dict(vsize=vsize,base=base,pidx=pidx,np=np,img=bytearray(vsize if vsize>np*pagesize else np*pagesize)))
# load pages
for o in objs:
    for p in range(o['np']):
        pg=o['pidx']+p  # 1-based logical page
        off=datapages+(pg-1)*pagesize
        n=lastpage if pg==npages else pagesize
        o['img'][p*pagesize:p*pagesize+n]=d[off:off+n]
fix=[]  # (srcaddr, target, type)
for o in objs:
    for p in range(o['np']):
        pg=o['pidx']+p
        s=fixrectab+u32(fixpagetab+(pg-1)*4); e=fixrectab+u32(fixpagetab+pg*4)
        while s<e:
            st=d[s]; fl=d[s+1]; so=struct.unpack_from('<h',d,s+2)[0]; s+=4
            assert fl&3==0,(hex(fl))
            if fl&0x40: ob=u16(s); s+=2
            else: ob=d[s]; s+=1
            if st&0xf==2: toff=None
            elif fl&0x10: toff=u32(s); s+=4
            else: toff=u16(s); s+=2
            src=p*pagesize+so
            if st&0xf==7:
                tgt=objs[ob-1]['base']+toff
                if 0<=src and src+4<=len(o['img']): struct.pack_into('<I',o['img'],src,tgt)
                fix.append((o['base']+src,tgt,7))
            elif st&0xf==8:
                tgt=objs[ob-1]['base']+toff
                rel=(tgt-(o['base']+src+4))&0xffffffff
                if 0<=src and src+4<=len(o['img']): struct.pack_into('<I',o['img'],src,rel)
                fix.append((o['base']+src,tgt,8))
            else:
                fix.append((o['base']+src,toff,st&0xf))
import collections
print(collections.Counter(f[2] for f in fix))
for i,o in enumerate(objs):
    open(sys.argv[1]+'/obj%d.bin'%(i+1),'wb').write(o['img'][:o['vsize']])
import json
json.dump(fix,open(sys.argv[1]+'/fix.json','w'))
