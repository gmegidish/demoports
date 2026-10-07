# extract.py: splits the files bound into BROTHER.EXE into work/res/.
# The PKLITE-packed DOS loader at the front (see unstub.py) hooks int 21h and serves file opens from a
# table that follows its own image: 'XL' header (16 bytes), then 32-byte entries scrambled by
# subtracting the byte index. Entry: name[16], size, offset from the end of the loader image.
import struct,os
H=os.path.dirname(os.path.abspath(__file__))
d=open(os.path.join(H,'../../BROTHER.EXE'),'rb').read()
cblp,cp=struct.unpack_from('<HH',d,2)
base=(cp-1)*512+cblp                       # end of the loader's MZ image
assert d[base:base+2]==b'XL'
count=struct.unpack_from('<H',d,base+8)[0]
table=struct.unpack_from('<I',d,base+12)[0]
t=bytes((b-i)&0xff for i,b in enumerate(d[base+table:base+table+count*32]))
out=os.path.join(H,'work','res'); os.makedirs(out,exist_ok=True)
for i in range(count):
    e=t[i*32:i*32+32]
    name=e[:16].split(b'\0')[0].decode('latin1')
    size,off=struct.unpack_from('<II',e,16)
    print('%-14s %7d at 0x%06x'%(name,size,base+off))
    open(os.path.join(out,name),'wb').write(d[base+off:base+off+size])
