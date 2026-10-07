# Extracts the resource file appended to EUPHORIA.EXE into work/res/NN.ext (NN = 0-based item;
# the code numbers them from 1). Prints the table.
import os
import struct

WORK = os.environ.get('EUPHORIA_RE_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work'))
EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'EUPHORIA.EXE')
RESOURCE_BASE = 0x273f0
COUNT = 50

data = open(EXE, 'rb').read()
sizes = struct.unpack('<50I', data[RESOURCE_BASE:RESOURCE_BASE + 4 * COUNT])
os.makedirs(os.path.join(WORK, 'res'), exist_ok=True)
offset = RESOURCE_BASE + 4 * COUNT
for i, size in enumerate(sizes):
    item = data[offset:offset + size]
    if size:
        kind = 'mse' if item.startswith(b'BWSB') else 'gdm' if item.startswith(b'GDM') else 'asc' if item.startswith(b'Ambient') else 'pcx' if item[0] == 10 else 'bin'
        open(os.path.join(WORK, 'res', '%02d.%s' % (i, kind)), 'wb').write(item)
        print('%2d  %7d bytes  %s' % (i, size, kind))
    offset += size
