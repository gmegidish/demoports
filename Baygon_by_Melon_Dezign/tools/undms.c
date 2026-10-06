#include <stdio.h>
#include <stdlib.h>
#include "xdms.h"
#define TRK 11264
static UBYTE b1[70000], b2[70000], text[0x4000], adf[80*TRK];
int main(int c, char **v) {
	FILE *f = fopen(v[1], "rb"); UBYTE h[56], t[20]; static struct xdms_data x; struct xdms_data *xdms = &x;
	x.text = text; fread(h, 1, 56, f); Init_Decrunchers(xdms);
	while (fread(t, 1, 20, f) == 20 && t[0] == 'T' && t[1] == 'R') {
		int n = t[2]<<8|t[3], pk1 = t[6]<<8|t[7], pk2 = t[8]<<8|t[9], un = t[10]<<8|t[11], fl = t[12], cm = t[13];
		int usum = t[14]<<8|t[15], r = 0; UBYTE *o = b2;
		fread(b1, 1, pk1, f);
		switch (cm) {
		case 0: o = b1; break;
		case 1: r = Unpack_RLE(xdms, b1, b2, un); break;
		case 2: Unpack_QUICK(xdms, b1, b2, pk2); r = Unpack_RLE(xdms, b2, b1, un); o = b1; break;
		case 3: Unpack_MEDIUM(xdms, b1, b2, pk2); r = Unpack_RLE(xdms, b2, b1, un); o = b1; break;
		case 4: Unpack_DEEP(xdms, b1, b2, pk2); r = Unpack_RLE(xdms, b2, b1, un); o = b1; break;
		case 5: case 6: r = Unpack_HEAVY(xdms, b1, b2, cm == 5 ? fl & 7 : fl | 8, pk2);
			if (fl & 4) { r |= Unpack_RLE(xdms, b2, b1, un); o = b1; } break;
		default: r = 99;
		}
		if (!(fl & 1)) Init_Decrunchers(xdms);
		int ok = Calc_CheckSum(o, un) == usum;
		if (n < 80 && un <= TRK) memcpy(adf + n*TRK, o, un);
		if (r || !ok || n >= 80) fprintf(stderr, "track %d mode %d len %d r=%d sum %s\n", n, cm, un, r, ok ? "ok" : "BAD");
		if (n >= 80) { fwrite(o, 1, un, stderr); fputc('\n', stderr); }
	}
	f = fopen(v[2], "wb"); fwrite(adf, 1, sizeof adf, f); fclose(f); return 0;
}
