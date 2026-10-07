# unstub.py: runs the PKLITE-compressed DOS loader at the front of BROTHER.EXE in Unicorn (real mode)
# until it jumps into its decompressed program, then writes that memory to work/stub.bin
import struct,sys,os
from unicorn import *
from unicorn.x86_const import *
H=os.path.dirname(os.path.abspath(__file__))
d=open(os.path.join(H,'../../BROTHER.EXE'),'rb').read()
hdr=struct.unpack_from('<14H',d,0)
cblp,cp,nrel,hpar=hdr[1],hdr[2],hdr[3],hdr[4]
size=cp*512-(512-cblp if cblp else 0)
img=d[hpar*16:size]
PSP=0x1000; LOAD=PSP+0x10
mu=Uc(UC_ARCH_X86,UC_MODE_16)
mu.mem_map(0,0x100000)
mu.mem_write(LOAD*16,img)
mu.mem_write(PSP*16,b'\xcd\x20'+struct.pack('<H',0x9fff))
for i in range(nrel):
    o,s=struct.unpack_from('<HH',d,hdr[12]+i*4)
    a=(LOAD+s)*16+o; v=struct.unpack('<H',mu.mem_read(a,2))[0]; mu.mem_write(a,struct.pack('<H',(v+LOAD)&0xffff))
cs=(hdr[11]+LOAD)&0xffff; ip=hdr[10]
mu.reg_write(UC_X86_REG_CS,cs); mu.reg_write(UC_X86_REG_IP,ip)
mu.reg_write(UC_X86_REG_SS,(hdr[7]+LOAD)&0xffff); mu.reg_write(UC_X86_REG_SP,hdr[8])
mu.reg_write(UC_X86_REG_DS,PSP); mu.reg_write(UC_X86_REG_ES,PSP)
state={'n':0}
def intr(uc,no,_):
    print('int %x ah=%x at %x:%x'%(no,uc.reg_read(UC_X86_REG_AH),uc.reg_read(UC_X86_REG_CS),uc.reg_read(UC_X86_REG_IP)))
    uc.emu_stop()
mu.hook_add(UC_HOOK_INTR,intr)
seen=set()
def code(uc,addr,sz,_):
    c=uc.reg_read(UC_X86_REG_CS)
    if c not in seen:
        seen.add(c); print('cs=%04x ip=%04x'%(c,uc.reg_read(UC_X86_REG_IP)))
mu.hook_add(UC_HOOK_CODE,code)
try: mu.emu_start(cs*16+ip,0,count=50_000_000)
except UcError as e: print('err',e)
print('stop at %04x:%04x'%(mu.reg_read(UC_X86_REG_CS),mu.reg_read(UC_X86_REG_IP)))
open(os.path.join(H,'work/stub.bin'),'wb').write(bytes(mu.mem_read(PSP*16,0x20000)))
