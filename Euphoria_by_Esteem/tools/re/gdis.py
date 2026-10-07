import os
WORK = os.environ.get('EUPHORIA_RE_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work'))
EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'EUPHORIA.EXE')

import sys
from capstone import *
S=WORK
img=open(S+'/img.bin','rb').read()
seg=int(sys.argv[1],16); a=int(sys.argv[2],16); b=int(sys.argv[3],16)
md=Cs(CS_ARCH_X86,CS_MODE_16)
code=img[seg*16+a:seg*16+b]
for i in md.disasm(code,a):
    print('%04x:%04x  %-20s %s %s'%(seg,i.address,i.bytes.hex(),i.mnemonic,i.op_str))
