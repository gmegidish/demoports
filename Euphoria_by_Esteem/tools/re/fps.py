# per-second count of frames that differ from the previous one, over the whole capture
import os
WORK = os.environ.get('EUPHORIA_RE_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work'))
EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'EUPHORIA.EXE')

import subprocess,numpy as np
C=WORK+'/cap/'
SEGS=[('video0004.avi',320,200),('video0005.avi',640,480),('video0006.avi',320,200),('video0007.avi',640,480),('video0008.avi',320,200)]
FPS={320:70.086,640:70.007}
t0=0.0; out=[]
for f,w,h in SEGS:
    p=subprocess.Popen(['ffmpeg','-v','error','-i',C+f,'-f','rawvideo','-pix_fmt','gray','-'],stdout=subprocess.PIPE)
    prev=None; n=0; sz=w*h
    while True:
        b=p.stdout.read(sz)
        if len(b)<sz: break
        cur=np.frombuffer(b,np.uint8)
        ch = prev is None or not np.array_equal(cur,prev)
        out.append((t0+n/FPS[w],ch)); prev=cur; n+=1
    t0+=n/FPS[w]
arr=np.array(out)
np.save(os.path.join(WORK,'changes.npy'),arr)
sec=np.floor(arr[:,0]).astype(int)
for s in range(0,int(sec.max())+1,1):
    m=sec==s
    print(s,int(arr[m,1].sum()),end=' | ' if s%10!=9 else '\n')
