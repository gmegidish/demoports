# compare.py OUT.png T1 T2 ...   (soundtrack seconds) -> sheet: port | original | difference, one row per
# time, with the share of identical pixels printed. In the recording the songs play a little fast
# against the 70.086 Hz frames (DOSBox's Sound Blaster), so the matching recording moment is fitted per song:
#   intro: cap = 0.995589 * songTime + 0.2208     demo: cap = 0.997557 * songTime + 124.7922
# FROM=S plays every frame from S (for parts that accumulate state per frame).
import os,sys,subprocess,tempfile
from PIL import Image, ImageChops
H=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.join(H,'..','..')
SONG_STARTS={'intro':0.221,'demo':124.792}
FITS={'intro':(0.995589,0.2208),'demo':(0.997557,124.7922)}
def capture_time(t):
    song='demo' if t>=SONG_STARTS['demo'] else 'intro'
    s,o=FITS[song]; return s*(t-SONG_STARTS[song])+o
sys.path.insert(0,H)
out=sys.argv[1]; times=[float(t) for t in sys.argv[2:]]
tmp=tempfile.mkdtemp()
subprocess.run(['node',os.path.join(ROOT,'tools','shot.mjs'),tmp+'/p']+['%g'%t for t in times],check=True,stdout=subprocess.DEVNULL)
from capframe import frame
sheet=Image.new('RGB',(960,200*len(times)))
for k,t in enumerate(sorted(times)):
    port=Image.open(tmp+'/p-%s.png'%('%.2f'%t).rjust(6,'0')).convert('RGB')
    frame(capture_time(t),tmp+'/o.png'); orig=Image.open(tmp+'/o.png').convert('RGB')
    diff=ImageChops.difference(port,orig)
    same=sum(1 for p in diff.getdata() if max(p)<=8)/64000
    print('%7.2f  identical %.1f%%'%(t,same*100))
    sheet.paste(port,(0,200*k)); sheet.paste(orig,(320,200*k)); sheet.paste(diff.point(lambda v:min(255,v*4)),(640,200*k))
sheet.save(out)
