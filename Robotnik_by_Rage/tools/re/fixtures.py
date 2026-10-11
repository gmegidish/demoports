# fixtures.py [NAME...]  -> writes recording frames the tests compare against to test/fixtures/NAME.rgb.gz
# (gzip'd raw RGB, 320x200x3). Each entry is (name, soundtrack seconds); the recording moment is fitted
# per song as in compare.py. Porters: append your entries to FIXTURES, don't rewrite others'.
# Run from tools/re with the venv python; with no names it (re)writes them all.
import os,sys,gzip,subprocess,tempfile
from PIL import Image
from capframe import frame
H=os.path.dirname(os.path.abspath(__file__)); OUT=os.path.join(H,'..','..','test','fixtures')
SONG_STARTS={'intro':0.221,'demo':124.792}
FITS={'intro':(0.995589,0.2208),'demo':(0.997557,124.7922)}
def capture_time(t):
    song='demo' if t>=SONG_STARTS['demo'] else 'intro'
    s,o=FITS[song]; return s*(t-SONG_STARTS[song])+o

FIXTURES=[
    ('presents-30.00', 30.00),          # part 1: presents.raw after the zoom
    ('coding-38.00', 38.00),            # part 2: burning with smoke
    ('artwork-84.00', 84.00),           # part 4: after the "is" flash
    ('music-110.50', 110.50),           # part 6: burning with smoke
    ('logo-33.35', 33.35),              # part 1: the 3D logo (engine) over presents.raw
    ('ball-127.50', 127.50, -0.012),    # part 7: the zoom bounce of the first picture (pixel exact)
    ('ball-129.00', 129.00),            # part 7: rays growing from the swinging centre
    ('sunset-170.00', 170.00, -0.19),   # part 8: sun, mountains, water, rocks (demo song syncs ~0.19 s early)
    ('maze-260.00', 260.00, -0.2826),   # part 11: floor, walls, "sara" (demo song syncs ~0.31 s early here)
    ('face-343.06', 343.06, -0.3132),   # part 13: the face in the liquid (a frame DOSBox drew whole)
    ('shatter-355.00', 355.00, -0.2959),  # part 13: the falling shatter (pixel exact)
    ('skull-61.00', 61.00, -0.07),      # part 3: projected mouth and the skull's shadow (intro syncs ~0.07 s early here)
    ('drill-98.00', 98.00, -0.07),      # part 5: drill, damage cracks, projected mouth
    ('skullshatter-106.40', 106.40, -0.026),   # part 5: the shatter over music.raw (pixel exact; real-hardware timing)
    ('roomintro-227.00', 227.00, -0.3369),   # part 10: part 9's picture tumbling, cl_pic on its back (pixel exact)
    ('room-239.20', 239.20, -0.3221),   # part 10: cloth, shadow, flares and "burn" (pixel exact)
    ('robot-200.00', 200.00, -0.163),   # part 9: robot, room and a block (a picture whose pass matches; pixel exact)
    ('robot-205.50', 205.50, -0.139),   # part 9: the "rage mirror" with the robot reflected in it
    ('robot-225.10', 225.10, -0.117),   # part 9: "RAGE RAGE", the headless robot sinking
    ('ending-365.32', 365.32, -0.2320),  # part 14: the camera over robot, skull and floor (pixel exact)
    ('ending-369.38', 369.38, -0.2339),  # part 14: "rage" lighting up the picture
    ('endflip-389.72', 389.72, -0.3136),  # part 15: "your" flipping over to "machine"
    ('endshatter-396.27', 396.27, -0.3728),  # part 15: "machine" flying apart over endlogo
    ('endfade-398.49', 398.49, -0.3350),  # part 15: endlogo fading out
    ('spider-15.40', 15.40, 0.005),     # part 0: the spotlight following the spider (real-hardware timing)
    ('spider-22.30', 22.30, 0.027),     # part 0: the RAGE cube falling on the spider (real-hardware timing)
    ('tunnel-300.00', 300.00, 3.5/70.086),  # part 12: inside, the chrome sphere and spikes (pixel exact; with real-hardware timing the port shows it at 300.355, see the test)
    ('tunnel-318.00', 318.00, -0.30),     # part 12: the spinning tube's bump-mapped flesh (pixel exact; real-hardware timing)
]

def write(name,t,offset=0.0):
    # offset: seconds added to the fitted recording moment (sync events of the demo song land a little
    # earlier in the recording than the fit says; see the part's test)
    tmp=tempfile.mkdtemp(); png=os.path.join(tmp,'f.png')
    frame(capture_time(t)+offset,png)
    rgb=Image.open(png).convert('RGB').tobytes()
    os.makedirs(OUT,exist_ok=True)
    with gzip.open(os.path.join(OUT,name+'.rgb.gz'),'wb') as f: f.write(rgb)
    print(name,'<- recording %.3f s'%(capture_time(t)+offset))

if __name__=='__main__':
    wanted=set(sys.argv[1:])
    for name,t,*offset in FIXTURES:
        if not wanted or name in wanted: write(name,t,*offset)
