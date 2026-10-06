import os,sys,re
s=int(sys.argv[1],16); e=int(sys.argv[2],16)
out=[]
for l in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kahn.lst')):
    m=re.match(r'([0-9a-f]{5})  ',l)
    if m:
        a=int(m.group(1),16)
        if s<=a<e and 'call 0x10236' not in l: out.append(l.rstrip())
    elif l.startswith('; ==='):
        a=int(l.split('sub_')[1][:5],16)
        if s<=a<e: out.append('== '+l.split()[2])
print('\n'.join(out))
