# capframe.py T [OUT.png]  -> frame of the original at demo time T seconds (0 = the switch to 320x200,
#                              a few ms before the music starts)
# capframe.py --sheet T0 T1 STEP OUT.png   -> contact sheet, 6 per row
# Reads the DOSBox Staging capture in work/cap/ (video0002.avi = the whole graphics-mode run).
import os,sys,subprocess
H=os.path.dirname(os.path.abspath(__file__))
CAP=os.path.join(H,'work','cap','video0002.avi')
FPS=2190197/31250
def frame(t,out):
    subprocess.run(['ffmpeg','-v','error','-y','-i',CAP,'-vf','select=eq(n\\,%d)'%int(t*FPS),'-frames:v','1',out],check=True)
if __name__!='__main__':
    pass
elif sys.argv[1]=='--sheet':
    t0,t1,st=map(float,sys.argv[2:5]); out=sys.argv[5]
    n=int((t1-t0)/st+0.5)
    sel='+'.join('eq(n\\,%d)'%int((t0+k*st)*FPS) for k in range(n))
    subprocess.run(['ffmpeg','-v','error','-y','-i',CAP,'-vf',"select='%s',tile=6x%d"%(sel,(n+5)//6),'-fps_mode','passthrough','-frames:v','1',out],check=True)
else:
    frame(float(sys.argv[1]),sys.argv[2] if len(sys.argv)>2 else 'frame.png')
