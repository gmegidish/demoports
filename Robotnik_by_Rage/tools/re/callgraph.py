# callgraph.py ADDR...: functions reachable from each root (direct calls only), with sizes and strings used
import re,sys,os,collections
L=os.path.join(os.path.dirname(os.path.abspath(__file__)),'work','robotnik.lst')
funcs=collections.OrderedDict(); cur=None
for l in open(L):
    if l.startswith('; ======== sub_'): cur=int(l.split('sub_')[1][:5],16); funcs[cur]=[]
    elif cur is not None and re.match(r'[0-9a-f]{5}  ',l): funcs[cur].append(l.rstrip())
def calls(f):
    out=set()
    for l in funcs.get(f,[]):
        m=re.search(r'\bcall 0x([0-9a-f]+)$',l)
        if m: out.add(int(m.group(1),16))
    return out
def strs(f):
    return sorted(set(m for l in funcs.get(f,[]) for m in re.findall(r'"([^"]+)"',l)))
LIB=0x2c000  # functions at/above this address are runtime/MIDAS/libraries
for a in sys.argv[1:]:
    root=int(a,16); seen=set(); st=[root]
    while st:
        f=st.pop()
        if f in seen: continue
        seen.add(f); st.extend(c for c in calls(f) if c<LIB)
    lib=set(c for f in seen for c in calls(f) if c>=LIB)
    print('root %x: %s'%(root,' '.join('%x(%d)'%(f,len(funcs.get(f,[]))) for f in sorted(seen))))
    print('   lib:',' '.join('%x'%c for c in sorted(lib)))
    s=[x for f in sorted(seen) for x in strs(f)]
    if s: print('   strings:',s)
