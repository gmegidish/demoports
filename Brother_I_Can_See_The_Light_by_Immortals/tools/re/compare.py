# compare.py OUT.png T1 T2 ...   (song seconds) -> sheet: port | original | difference, one row per time,
# with the share of identical pixels printed. The capture's clock runs ahead of the song (MIDAS
# reports positions early in DOSBox); capture time = SLOPE * song time + OFFSET, fitted on part starts.
import os,sys,subprocess,tempfile
from PIL import Image, ImageChops
H=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.join(H,'..','..')
SLOPE=float(os.environ.get('CAP_SLOPE','0.9958')); OFFSET=float(os.environ.get('CAP_OFFSET','0.04'))
sys.path.insert(0,H)
out=sys.argv[1]; times=[float(t) for t in sys.argv[2:]]
tmp=tempfile.mkdtemp()
subprocess.run(['node',os.path.join(ROOT,'tools','shot.mjs'),tmp+'/p']+['%g'%t for t in times],check=True,stdout=subprocess.DEVNULL)
from capframe import frame
sheet=Image.new('RGB',(960,200*len(times)))
for k,t in enumerate(times):
    port=Image.open(tmp+'/p-%s.png'%('%.2f'%t).rjust(6,'0')).convert('RGB')
    frame(SLOPE*t+OFFSET,tmp+'/o.png'); orig=Image.open(tmp+'/o.png').convert('RGB')
    diff=ImageChops.difference(port,orig)
    same=sum(1 for p in diff.getdata() if max(p)<=8)/64000
    print('%7.2f  identical %.1f%%'%(t,same*100))
    sheet.paste(port,(0,200*k)); sheet.paste(orig,(320,200*k)); sheet.paste(diff.point(lambda v:min(255,v*4)),(640,200*k))
sheet.save(out)
