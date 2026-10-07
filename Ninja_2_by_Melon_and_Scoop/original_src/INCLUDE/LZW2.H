//
// Header fil for LZW kompresjon.
// Coded by Uzul of SCOOP 1995
//

// "Eksterne" funksjons-prototyper :

#include <stdio.h>
#include <stdlib.h>
#include <graph.h>
#include <malloc.h>
#include <scoop.h>

// Structures ////////////////////////////////////////////////////////////////
typedef struct strentry
{
	uint32 lastcode;
	uint8 thischr;
} strentry;																	/* LZW entry point */

// Prototypes ////////////////////////////////////////////////////////////////
char getbyte ();        										/* Gets a byte from file */
void putbyte (char c);  										/* Puts a byte to file */

// Declarations //////////////////////////////////////////////////////////////
const long exp2tab [17]={1,2,4,8,16,32,64,128,256,512,1024,2048,4096,8192,
                         16384,32768,65536};

FILE* packfp;

strentry 	strtable [65536];									/* All entries */
uint32		antstrs;													/* Number of entries */
uint32		curp;															/* Current offset */
uint32		oldp;															/* Last offset */
char      curc;															/* Current data */
char      error=0;													/* ERROR byte */
uint32	  curbits;													/* Current BITS */
uint8			antbits;													/* Number of BITS */
uint32		bitsize;													/* BIT Size */

// Functions /////////////////////////////////////////////////////////////////
void inittable ()
{
	uint32 x;
	strtable [0].lastcode=0;
	strtable [0].thischr=0;

	for (x=0;x<256;x++)
	{
		strtable [x+1].lastcode=0;
		strtable [x+1].thischr=x;
	}

	antstrs=256;
	bitsize=9;
}

void wrtcode (uint32 i)
{
	i=i << antbits;
	curbits=curbits | i;
	antbits+=bitsize;

	while (antbits>=8)
	{
		putbyte (curbits & 255);
		curbits=curbits >> 8;
		antbits-=8;
	}
}

void wrtstr (char *s,uint32 len)
{
	uint32 x;
	if (!error)
	{
		for (x=0;x<len;x++)
		  putbyte (s [x]);
	}
}

uint32 getnextcode ()
{
	uint32 nr=0;
	uint32 c;
	while (antbits<bitsize)
	{
	  c=getbyte ();
	  c=c << antbits;
	  curbits=curbits | c;
	  antbits+=8;
	}
	nr=curbits & (exp2tab [bitsize]-1);
	curbits=curbits >> bitsize;
	antbits-=bitsize;
	return nr;
}

uint32 readcode ()
{
	uint32 nr;
	nr=getnextcode ();
	if (nr==0)
	{
		inittable ();
		oldp=getnextcode ();
		curc=strtable [oldp].thischr;
		wrtstr (&curc,1);
		nr=getnextcode ();
	}
	return nr;
}

uint32 getcode ()
{
	uint32 x;

	for (x=curp+1;(x<=antstrs)&&
	    (strtable [x].lastcode!=curp || strtable [x].thischr!=curc);x++);

	if (x>antstrs) x=0;
	return x;
}

void addstring (uint32 nr)
{
	antstrs++;
	strtable [antstrs].lastcode=nr;
	strtable [antstrs].thischr=curc;
}

uint32 getstr (uint32 nr,char *str)
{
	uint32 strpos=32767;
	uint32 x;
	str [strpos]=0;
	while (nr!=0)
	{
	  strpos--;
	  str[strpos]=strtable [nr].thischr;
	  nr=strtable [nr].lastcode;
	}
	nr=32768-strpos-1;

	for (x=0;x<nr;x++)
	  str [x]=str [strpos+x];

	return nr;
}


void compress ()
{
	uint32 nc;
	inittable ();
	error=0;
	curp=0;
	curc=getbyte ();

	while (!error)
	{
		nc=getcode ();
		if (nc!=0) curp=nc;
		else
		{
		  addstring (curp);
		  wrtcode (curp);
		  if (antstrs==exp2tab [bitsize]) bitsize++;
		  if (antstrs==65530)
		  {
		    wrtcode (curc+1);
		    wrtcode (0);
		    inittable ();
		    curp=0;
		  }
		  else
		  {
			  curp=curc+1;
		  }
		}
		curc=getbyte ();
	}

	wrtcode (curp);

	if (antbits!=0)
	  putbyte (curbits & (exp2tab [antbits]-1));
}

void decompress (char* fname)
{
	char *str;
	uint32 slen;

	if(!(packfp=fopen(fname,"rb")))
	{
		_setvideomode(0x3);
		printf("PANIC : Couldn't open file : %s\n",fname);
		exit(0);
	}

	str = (char*)malloc(32768);

	inittable ();
	error=0;
	curp=readcode ();
	curc=strtable [curp].thischr;
	wrtstr (&curc,1);
	oldp=curp;

	curp=readcode ();

	while (!error)
	{
		if (curp<=antstrs)
		{
			slen=getstr (curp,str);
			wrtstr (str,slen);
			curc=str [0];
			addstring (oldp);
			if (antstrs==(exp2tab [bitsize])-1) bitsize++;
			oldp=curp;
		}
		else
		{
			slen=getstr (oldp,str);
			curc=str [0];
			wrtstr (str,slen);
			wrtstr (&curc,1);

			addstring (oldp);
			if (antstrs==(exp2tab [bitsize])-1) bitsize++;
			oldp=curp;
		}
		curp=readcode ();
	}

	 fclose(packfp);
}
