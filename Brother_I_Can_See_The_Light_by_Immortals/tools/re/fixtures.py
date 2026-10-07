# fixtures.py: writes test/fixtures/original-SONG.rgb.gz, frames of the capture (raw RGB, 320x200),
# for the moments test/original.test.js checks. Each is paired with the song time at which the
# port shows the same picture; the pairing absorbs the capture's clock drift (see compare.py).
import gzip,os,subprocess,tempfile
from PIL import Image
from capframe import frame
H=os.path.dirname(os.path.abspath(__file__))
OUT=os.path.join(H,'..','..','test','fixtures')
PAIRS=[(16.0,16.015),(30.0,30.015),(41.895,42.0),(72.04,71.86),(92.05,91.72),(130.0,129.6)]
tmp=tempfile.mkdtemp()
for song,cap in PAIRS:
    frame(cap,tmp+'/f.png')
    rgb=Image.open(tmp+'/f.png').convert('RGB').tobytes()
    with gzip.open(os.path.join(OUT,'original-%s.rgb.gz'%('%g'%song)),'wb') as f: f.write(rgb)
    print(song,cap)
