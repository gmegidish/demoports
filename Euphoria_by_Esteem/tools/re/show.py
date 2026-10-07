import os
WORK = os.environ.get('EUPHORIA_RE_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work'))
EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'EUPHORIA.EXE')

import sys,re
a=sys.argv[1]; b=sys.argv[2]
def k(s): sg,o=s.split(':'); return int(sg,16)*16+int(o,16)
A,B=k(a),k(b); on=False
for line in open(''+WORK+'/euph.lst'):
    m=re.match(r'([0-9a-f]{4}):([0-9a-f]{4})',line)
    if m:
        v=int(m.group(1),16)*16+int(m.group(2),16)
        on=A<=v<B
        if v>=B: break
    if on: sys.stdout.write(line)
