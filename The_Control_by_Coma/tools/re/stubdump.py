import struct
from unicorn import *
from unicorn.x86_const import *
from capstone import *
import sys
d=open(sys.argv[1],'rb').read(); h=struct.unpack('<14H',d[:28]); hdr=h[4]*16; size=(h[2]-1)*512+h[1]
PSP=0x1000; LOAD=PSP+0x10
u=Uc(UC_ARCH_X86,UC_MODE_16); u.mem_map(0,0x110000); u.mem_write(LOAD*16,d[hdr:size])
u.reg_write(UC_X86_REG_CS,LOAD+h[11]); u.reg_write(UC_X86_REG_IP,h[10]); u.reg_write(UC_X86_REG_SS,LOAD+h[7]); u.reg_write(UC_X86_REG_SP,h[8]); u.reg_write(UC_X86_REG_DS,PSP); u.reg_write(UC_X86_REG_ES,PSP)
hits={}
def code(uc,a,s,_):
    cs=uc.reg_read(UC_X86_REG_CS)
    if cs in (0x67ec,0x6717): hits[(cs,uc.reg_read(UC_X86_REG_IP))]=hits.get((cs,uc.reg_read(UC_X86_REG_IP)),0)+1
    if cs==LOAD and len(hits)>0: uc.emu_stop()
u.hook_add(UC_HOOK_CODE,code)
u.emu_start((LOAD+h[11])*16+h[10],0,count=5_000_000)
md=Cs(CS_ARCH_X86,CS_MODE_16)
for cs in (0x67ec,0x6717):
    ips=sorted(ip for (c,ip) in hits if c==cs)
    if not ips: continue
    lo,hi=ips[0],ips[-1]+8
    code_bytes=bytes(u.mem_read(cs*16+lo,hi-lo))
    print('== cs %04x ip %04x..%04x, %d distinct ips'%(cs,lo,hi,len(ips)))
    for i in md.disasm(code_bytes,lo):
        print('%04x %6d %-6s %s'%(i.address,hits.get((cs,i.address),0),i.mnemonic,i.op_str))
