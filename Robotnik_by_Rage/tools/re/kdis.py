# recursive-descent disassembler for ROBOTNIK.EXE object 1, annotated with data refs
import json,struct,sys,re
from capstone import *
from capstone.x86 import *
import os; os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),'work'))
code=open('obj1.bin','rb').read(); code2=open('obj2.bin','rb').read(); data=open('obj3.bin','rb').read()
CB=0x10000; DB=0x80000; C2=0x70000
def incode(a): return CB<=a<CB+len(code) or C2<=a<C2+len(code2)
def cbytes(a): return code[a-CB:a-CB+16] if a<C2 else code2[a-C2:a-C2+16]
fix=[f for f in json.load(open("fix.json")) if f[1] is not None]
fixsrc={f[0]:f[1] for f in fix}
md=Cs(CS_ARCH_X86,CS_MODE_32); md.detail=True
insn={}  # addr -> (size, mnemonic, opstr, annotation)

entry=CB+0x21194  # LE eip
work=[entry]; funcs={entry}
# code pointers from fixups (vtables, jump tables, callbacks)
for s,t,ty in fix:
    if incode(t):
        work.append(t)
        if s>=DB: funcs.add(t)
def cstr(a):
    o=a-DB
    if 0<=o<len(data):
        e=data.find(b'\0',o)
        s=data[o:e]
        if len(s)>=3 and all(32<=c<127 for c in s): return s.decode()
    return None
def annot(i):
    out=[]
    for a in range(i.address,i.address+i.size):
        if a in fixsrc:
            t=fixsrc[a]
            if t>=DB:
                s=cstr(t)
                o=t-DB
                if s: out.append('"%s"'%s[:60])
                elif o+8<=len(data):
                    m=i.mnemonic
                    if m.startswith('f'):
                        if 'qword' in i.op_str: out.append('dbl=%g'%struct.unpack_from('<d',data,o))
                        elif 'dword' in i.op_str: out.append('flt=%g'%struct.unpack_from('<f',data,o))
    for op in i.operands:
        if op.type==X86_OP_IMM and i.mnemonic in('push','mov') and (op.imm&0xffffffff)>0x3000000 and (op.imm&0xffffffff)<0xd0000000:
            v=op.imm&0xffffffff
            f=struct.unpack('<f',struct.pack('<I',v))[0]
            if 1e-6<abs(f)<1e9: out.append('f=%g'%f)
    return ' ; '+', '.join(out) if out else ''
while work:
    a=work.pop()
    while incode(a) and a not in insn:
        try: i=next(md.disasm(cbytes(a),a))
        except StopIteration: break
        insn[a]=(i.size,i.mnemonic,i.op_str,annot(i))
        g=i.groups
        if i.mnemonic=='call' and i.operands[0].type==X86_OP_IMM:
            t=i.operands[0].imm; funcs.add(t); work.append(t)
        elif i.mnemonic.startswith('j') or i.mnemonic.startswith('loop'):
            if i.operands[0].type==X86_OP_IMM: work.append(i.operands[0].imm)
            if i.mnemonic=='jmp': break
        elif i.mnemonic in('ret','retf','iretd','iret'): break
        a+=i.size
addrs=sorted(insn)
fl=sorted(f for f in funcs if f in insn)
with open('robotnik.lst','w') as f:
    prev=None
    for a in addrs:
        if a in funcs: f.write('\n; ======== sub_%05x ========\n'%a)
        elif prev is not None and prev!=a: f.write('; ---- gap %05x..%05x\n'%(prev,a))
        s,m,o,an=insn[a]
        f.write('%05x  %s %s%s\n'%(a,m,o,an))
        prev=a+s
json.dump(fl,open('funcs.json','w'))
print(len(insn),'insns',len(fl),'funcs', 'covered bytes',sum(v[0] for v in insn.values()),'of',len(code))
