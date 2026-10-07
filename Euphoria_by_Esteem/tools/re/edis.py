# recursive-descent 16-bit disassembly of EUPHORIA.EXE (BP7 real mode). image loaded at segment 0.
import os
WORK = os.environ.get('EUPHORIA_RE_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work'))
EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'EUPHORIA.EXE')

import struct, re, json
from capstone import *
d=open(EXE,'rb').read()
h=struct.unpack('<14H',d[:28]); hdr=h[4]*16
img=bytearray(d[hdr:0x273f0])
nrel,ro=h[3],h[12]
relocs=set()
for i in range(nrel):
    off,seg=struct.unpack('<HH',d[ro+4*i:ro+4*i+4]); relocs.add(seg*16+off)
SEGS=sorted({struct.unpack('<H',img[r:r+2])[0] for r in relocs})
DS=0x2220
codesegs=[s for s in SEGS if s<DS]
def segend(s):
    i=codesegs.index(s); return codesegs[i+1]*16 if i+1<len(codesegs) else DS*16
md=Cs(CS_ARCH_X86,CS_MODE_16); md.detail=False
entries={(0,0xa62a)}
# far call targets via relocations: 9A off seg
for r in relocs:
    if r>=3 and img[r-3]==0x9a:
        off=struct.unpack('<H',img[r-2:r])[0]; seg=struct.unpack('<H',img[r:r+2])[0]
        if seg<DS: entries.add((seg,off))
# far pointers stored in data (procedure variables): dword with relocated seg
for r in relocs:
    if r>=DS*16:
        off=struct.unpack('<H',img[r-2:r])[0]; seg=struct.unpack('<H',img[r:r+2])[0]
        if seg<DS: entries.add((seg,off))
# procedure pointers built in code: mov reg,OFF ... mov reg,SEG(relocated)
for r in relocs:
    if r<DS*16 and r>=1 and 0xb8<=img[r-1]<=0xbf:
        seg=struct.unpack('<H',img[r:r+2])[0]
        if seg>=DS: continue
        for back in range(3,16):
            q=r-1-back
            if 0xb8<=img[q]<=0xbf:
                off=struct.unpack('<H',img[q+1:q+3])[0]
                if off<segend(seg)-seg*16: entries.add((seg,off))
                break
funcs=set(entries); seen={}; work=list(entries)
while work:
    seg,off=work.pop()
    base=seg*16; end=segend(seg)
    while True:
        lin=base+off
        if lin in seen or lin>=end: break
        if img[lin]==0xcd and 0x34<=img[lin+1]<=0x3b:
            img[lin]=0x9b; img[lin+1]+=0xa4
        elif img[lin]==0xcd and img[lin+1]==0x3c:
            b=img[lin+2]; img[lin]=0x9b; img[lin+1]=[0x3e,0x36,0x2e,0x26][b>>6]; img[lin+2]=0xd8|(b&7)
        elif img[lin]==0xcd and img[lin+1]==0x3d:
            img[lin]=0x9b; img[lin+1]=0x90
        ins=next(md.disasm(bytes(img[lin:lin+16]),off),None)
        if ins is None: break
        seen[lin]=ins
        m=ins.mnemonic; o=ins.op_str
        nxt=off+ins.size
        if m in('call','jmp') or m.startswith('j') or m.startswith('loop'):
            if re.fullmatch(r'0x[0-9a-f]+|0',o):
                t=int(o,16)&0xffff
                if m=='call': funcs.add((seg,t))
                work.append((seg,t))
        if m in('ret','retf','iret','jmp','hlt'): break
        off=nxt
# strings in DS: pascal strings referenced as immediates
dsimg=img[DS*16:]
def pstr(o):
    if o<len(dsimg):
        n=dsimg[o]; s=dsimg[o+1:o+1+n]
        if n>2 and all(32<=c<127 for c in s): return s.decode()
def cstr(lin):
    n=img[lin]; s=img[lin+1:lin+1+n]
    if n>2 and all(32<=c<127 or c in(13,10) for c in s): return s.decode()
# names for RTL from far calls into 0x1d81
out=open(os.path.join(WORK,'euph.lst'),'w')
fl=open(os.path.join(WORK,'funcs.txt'),'w')
names={}
for seg,off in sorted(funcs): names[seg*16+off]='sub_%04x_%04x'%(seg,off)
cnt={}
for lin,ins in seen.items():
    if ins.mnemonic=='call':pass
lastseg=None
for lin in sorted(seen):
    ins=seen[lin]; seg=max(s for s in codesegs if s*16<=lin)
    if seg!=lastseg: out.write('\n;;;;;;;;;;;;;;;; SEGMENT %04x ;;;;;;;;;;;;;;;;\n'%seg); lastseg=seg
    if lin in names: out.write('\n; ======== %s ========\n'%names[lin]); fl.write(names[lin]+'\n')
    ann=''
    raw=img[lin:lin+ins.size]
    o=ins.op_str
    if raw[0]==0x9a and ins.size==5:
        off,sg=struct.unpack('<HH',raw[1:5]); o='far %04x:%04x'%(sg,off); ins_m='callf'
        if sg==0x1d81: ann='; RTL'
    else: ins_m=ins.mnemonic
    for imm in re.findall(r'0x[0-9a-f]+',o):
        v=int(imm,16); s=pstr(v)
        if s and ('push' in ins_m or 'mov' in ins_m or 'lea' in ins_m): ann+=' ; "%s"'%s
    # string literal in code segment: push cs; push off
    if ins_m=='push' and re.fullmatch(r'0x[0-9a-f]+',o):
        v=int(o,16); s=cstr(seg*16+v) if seg*16+v<len(img) else None
        if s: ann+=' ; cs:"%s"'%s
    out.write('%04x:%04x  %-8s %s %s\n'%(seg,lin-seg*16,ins_m,o,ann))
print(len(seen),'insns',len(funcs),'funcs')
open(os.path.join(WORK,'img.bin'),'wb').write(img)
