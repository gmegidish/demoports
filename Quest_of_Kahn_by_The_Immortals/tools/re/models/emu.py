import struct,random
from unicorn import *
from unicorn.x86_const import *
S='/private/tmp/claude-501/-Users-gilm-git-quest-kahn/8902eaa9-bb8c-4ee6-ab72-4ea289b5ccfe/scratchpad/'
OBJ1=open(S+'obj1.bin','rb').read(); OBJ2=open(S+'obj2.bin','rb').read()
BUF=0x310000; TEX=0x400000; TAB=0x500000; STRUCT=0x600000; STACK=0x700000
class Emu:
    def __init__(self):
        mu=Uc(UC_ARCH_X86,UC_MODE_32); self.mu=mu
        mu.mem_map(0x10000,0x50000); mu.mem_write(0x10000,OBJ1[:0x40000]); mu.mem_write(0x50000,OBJ2)
        mu.mem_map(0x300000,0x40000); mu.mem_map(TEX,0x10000); mu.mem_map(TAB,0x10000)
        mu.mem_map(STRUCT,0x1000); mu.mem_map(STACK-0x10000,0x11000)
        mu.mem_map(0x1000,0x1000); mu.mem_write(0x1000,b'\xf4')
        # FPU: fninit; fldcw 0x127f
        mu.mem_write(0x1100,bytes.fromhex('dbe3d92d00120000f4')); mu.mem_write(0x1200,struct.pack('<H',0x127f))
        mu.emu_start(0x1100,0x1108)
    def call(self,addr,eax=0,edx=0,ebx=0,ecx=0):
        mu=self.mu
        mu.reg_write(UC_X86_REG_ESP,STACK-4); mu.mem_write(STACK-4,struct.pack('<I',0x1000))
        for r,v in ((UC_X86_REG_EAX,eax),(UC_X86_REG_EDX,edx),(UC_X86_REG_EBX,ebx),(UC_X86_REG_ECX,ecx)): mu.reg_write(r,v&0xffffffff)
        mu.emu_start(addr,0x1000,count=5000000)
        assert mu.reg_read(UC_X86_REG_EIP)==0x1000,hex(mu.reg_read(UC_X86_REG_EIP))
    def setup(self,table=TAB):
        self.call(0x13cfe,eax=320,edx=200,ebx=BUF,ecx=table)
    def setbuf(self,b): self.mu.mem_write(0x300000,bytes(0x10000)+bytes(b)+bytes(0x40000-0x10000-len(b)))
    def getall(self): return bytes(self.mu.mem_read(0x300000,0x40000))
