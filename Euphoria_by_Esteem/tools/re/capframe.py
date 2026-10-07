# capframe.py T [OUT.png]  -> frame of the original at demo time T seconds (0 = music start / timer reset)
# also: capframe.py --sheet T0 T1 STEP OUT.png
import os
WORK = os.environ.get('EUPHORIA_RE_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work'))
EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'EUPHORIA.EXE')

import sys,subprocess,os
C=''+WORK+'/cap/'
SEGS=[('video0004.avi',3235,320,200),('video0005.avi',419,640,480),('video0006.avi',31202,320,200),
      ('video0007.avi',2099,640,480),('video0008.avi',13908,320,200),('video0009.avi',886,720,400)]
FPS={320:70.086,640:70.007,720:70.087}
def locate(t):
    start=0.0
    for f,n,w,h in SEGS:
        d=n/FPS[w]
        if t<start+d: return f,int((t-start)*FPS[w]),w,h
        start+=d
    raise SystemExit('past end')
def frame(t,out):
    f,i,w,h=locate(t)
    subprocess.run(['ffmpeg','-v','error','-y','-i',C+f,'-vf','select=eq(n\\,%d)'%i,'-frames:v','1',out],check=True)
if sys.argv[1]=='--sheet':
    t0,t1,st=map(float,sys.argv[2:5]); out=sys.argv[5]
    from PIL import Image
    ts=[];t=t0
    while t<t1: ts.append(t); t+=st
    tiles=[]
    for k,t in enumerate(ts):
        p=out+'.%d.png'%k; frame(t,p); tiles.append(Image.open(p).convert('RGB').resize((320,200))); os.remove(p)
    cols=min(6,len(tiles)); rows=(len(tiles)+cols-1)//cols
    sh=Image.new('RGB',(cols*320,rows*200))
    for k,im in enumerate(tiles): sh.paste(im,((k%cols)*320,(k//cols)*200))
    sh.save(out)
else:
    frame(float(sys.argv[1]),sys.argv[2] if len(sys.argv)>2 else 'frame.png')
