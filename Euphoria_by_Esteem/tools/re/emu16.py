# minimal real-mode harness: loads EUPHORIA image at segment LOAD, relocated, runs far calls
import os
WORK = os.environ.get('EUPHORIA_RE_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work'))
EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'EUPHORIA.EXE')

import struct
from unicorn import *
from unicorn.x86_const import *
LOAD=0x1000
d=open(EXE,'rb').read()
h=struct.unpack('<14H',d[:28]); hdr=h[4]*16
img=bytearray(d[hdr:0x273f0])
for i in range(h[3]):
    off,seg=struct.unpack('<HH',d[h[12]+4*i:h[12]+4*i+4]); lin=seg*16+off
    v=struct.unpack('<H',img[lin:lin+2])[0]; img[lin:lin+2]=struct.pack('<H',(v+LOAD)&0xffff)
# patch FPU emulator ints everywhere they look like code (CD 34..3D)
def fpu_patch(buf):
    i=0
    while i<len(buf)-2:
        if buf[i]==0xcd and 0x34<=buf[i+1]<=0x3b: buf[i]=0x9b; buf[i+1]+=0xa4; i+=2; continue
        if buf[i]==0xcd and buf[i+1]==0x3c:
            b=buf[i+2]; buf[i]=0x9b; buf[i+1]=[0x3e,0x36,0x2e,0x26][b>>6]; buf[i+2]=0xd8|(b&7); i+=3; continue
        if buf[i]==0xcd and buf[i+1]==0x3d: buf[i]=0x90; buf[i+1]=0x9b; i+=2; continue
        i+=1
class M:
    def __init__(s):
        u=s.u=Uc(UC_ARCH_X86,UC_MODE_16)
        u.mem_map(0,0x110000)
        u.mem_write(LOAD*16,bytes(img))
        u.hook_add(UC_HOOK_INTR,s.intr)
        s.ivt={}
    def intr(s,u,n):
        if n in s.ivt:
            seg,off=s.ivt[n]
            sp=u.reg_read(UC_X86_REG_SP); ss=u.reg_read(UC_X86_REG_SS)
            fl=u.reg_read(UC_X86_REG_FLAGS); cs=u.reg_read(UC_X86_REG_CS); ip=u.reg_read(UC_X86_REG_IP)
            sp-=6; u.mem_write(ss*16+sp,struct.pack('<HHH',ip,cs,fl&0xffff))
            u.reg_write(UC_X86_REG_SP,sp); u.reg_write(UC_X86_REG_CS,seg+LOAD); u.reg_write(UC_X86_REG_IP,off)
        else:
            raise Exception('int %x at %x:%x'%(n,u.reg_read(UC_X86_REG_CS),u.reg_read(UC_X86_REG_IP)))
