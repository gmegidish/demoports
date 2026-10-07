# Bounce events of part 4ebc (the gems), measured in the reference capture: the vertical centroid of
# the non-black pixels jumps up when the music's channel-5 VU fires. Prints [[tick, pulse], ...].
# usage: python3 bounces.py CAPTURE_SEGMENT.avi SEGMENT_START_SECONDS
import json, subprocess, sys
import numpy as np

path, segment_start = sys.argv[1], float(sys.argv[2])
PART_START, PART_END, HZ = 132.7, 172.8, 70.086
frames = int((PART_END - PART_START) * HZ)
ffmpeg = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', '%.3f' % (PART_START - segment_start), '-i', path,
                           '-frames:v', str(frames), '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
                          stdout=subprocess.PIPE)
ys = []
for _ in range(frames):
    raw = ffmpeg.stdout.read(64000)
    if len(raw) < 64000:
        break
    lit = np.frombuffer(raw, np.uint8).reshape(200, 320) > 40
    ys.append((lit.sum(1) * np.arange(200)).sum() / max(1, lit.sum()))
events = []
for i in range(1, len(ys)):
    jump = ys[i] - ys[i - 1]
    if jump < -4:
        tick = round((PART_START + i / HZ) * 100)
        pulse = max(1, round(-jump / 2))
        if events and tick - events[-1][0] < 15:
            events[-1][1] += pulse
            continue
        events.append([tick, pulse])
print(json.dumps(events))
