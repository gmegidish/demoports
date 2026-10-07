//////////////////////////////////////////////////////////////////////////////
//
//  											(C)1995 SCOOP Productions
//
// Program : Ninja.exe
//
// Author : Einar Ingebrigtsen
//
// Created : 15.11.95
//
// Purpose : Ninja Demo 2
//
// $Log: ninjac.cpp $
// Revision 1.1  1995/11/15  23:43:41  einar
// Initial revision
//
//
//////////////////////////////////////////////////////////////////////////////

#define program "Ninja Demo 2"

// Includes //////////////////////////////////////////////////////////////////
#include <scoop.h>														// SCOOP Types
#include <types.h>														// PC Specific TYPES
#include <mikmod.h>														// MIKMOD Module player
#include <stdio.h>														// FILE Stuff
#include <stdlib.h>														// EXIT(x)
#include <graph.h>														// _setvideomode(xx)
#include <string.h>														// memset(), memcpy() etc. etc.
#include <conio.h>														// kbhit();

#include "depack.h"														// Depacking, LZW
#include "ninja.h"														// Ninja Header
#include "link\files.h"												// All files positions.

// Types /////////////////////////////////////////////////////////////////////

// Structures ////////////////////////////////////////////////////////////////

// MIDAS /////////////////////////////////////////////////////////////////////

// Includes //
#include "midas.h"
#include "mconfig.h"
#include "vu.h"
#include "vga.h"
#include "midp.h"


// Defines //
#ifndef NOTIMER
#define SCRSYNC
#endif

// DATA //
extern uchar edata;
extern uchar end;
extern uchar __ClosedStreams;

int             numChannels = 0;        /* number of channels in module */
int             activeChannel = 0;      /* active channel number */

uchar           attrDispTop = 0x4F;     /* display top message */
uchar           attrMainBg = 0x70;      /* main window background */
uchar           attrMainLit = 0x7F;     /* main window lit areas */
uchar           attrMainShadow = 0x78;  /* main window shadow areas */
uchar           attrMainBorderLit = 0x0F;   /* main window lit border */
uchar           attrMainBorderSh = 0x08;    /* main window shadow border */
uchar           attrChanInfoSep = 0x70;    /* channel information separator */
uchar           attrChanInfo = 0x70;    /* channel information */
uchar           attrSongInfoLabel = 0x7F;   /* song information label */
uchar           attrSongInfo = 0x70;    /* song information */
uchar           attrUsedInstName = 0x70;    /* used instrument name */
uchar           attrUnusedInstName = 0x78;  /* unused instrument name */
uchar           attrInstNameSeparator = 0x70;  /* instrument name separator */
uchar           attrInstIndicator = 0x7E;   /* instrument used indicator */
uchar           attrActChanMarker = 0x07;   /* active channel marker */
uchar           attrVUMeters = 0x7A;    /* VU meters */
uchar           attrVUBlank = 0x70;     /* Blank VU meters */

int             msgWindowHeight = 8;    /* message window height */

time_t          startTime;              /* total playing time */
time_t          pauseTime = 0;          /* time spent paused */
time_t          pauseStart;             /* start time for current pause */

int             paused = 0;             /* is playing paused? */
unsigned        masterVolume = 64;      /* master volume */
int             instNameMode = 0;       /* instrument name display mode */
int             firstInstName = 1;      /* first instrument name on screen */

int             realVU = 1;             /* are real VU meters active? */

gmpModule       *module;                /* current playing module */
gmpInformation  *info;                  /* current module playing info */
int             callMP;

uchar           chMuted[32];            /* channel muted flags */

unsigned        scrSync;                /* timer screen sync value */

volatile ulong  frameCount;             /* frame counter */

// Functions //
int CALLING MakeMeter(sdSample *sdsmp, gmpSample *gmpsmp)
{
    return 0;
}

void MessBSS(void)
{
    unsigned    count = (((unsigned) &__ClosedStreams) - ((unsigned) &edata))
                    / 4;
    unsigned    *b = (unsigned*) &edata;

    printf("Messing %u starting at %P\n", 4*count, b);

    while ( count )
    {
        *(b++) = 0x36467640;
        count--;
    }
}


/*****************************************************************************
 *
 * Synopsis : InitializeModule()
 *
 * Author   : Einar Ingebrigtsen
 *
 * Input    : char *psFileName - Pointer to zero terminated filename
 *
 * Output   : NONE
 *
 * Project  : MIDAS Sound Player
 *
 *
 * Function : To load and initialize module
 *
 *****************************************************************************/
void InitializeModule(char *psFileName)
{
  int			error;
  int			quit = 0;
  int			key, i;
  static 	fileHandle  f;
  static 	uchar       buf[48];
  static 	int  				panning;

	MessBSS();
	midasSetDefaults();
	midasDisableEMS = 1;
	midasInit();

	/* Read first 48 bytes of module: */
  if ( (error = fileOpen(psFileName, fileOpenRead, &f)) != OK )
      midasError(error);
  if ( (error = fileRead(f, buf, 48)) != OK )
      midasError(error);
  if ( (error = fileClose(f)) != OK )
      midasError(error);

  if ( mMemEqual(buf, "Extended Module:", 16) )
  {
    puts("Loading Fasttracker 2 module");
    if ( realVU )
    {
        if ( (error = gmpLoadXM(psFileName, 1, &MakeMeter, &module)) != OK )
            midasError(error);
    }
    else
    {
        if ( (error = gmpLoadXM(psFileName, 1, NULL, &module)) != OK )
            midasError(error);
    }
  }
  else
  {
    if ( mMemEqual(buf+44, "SCRM", 4) )
    {
      puts("Loading Screamtracker 3 module");
      if ( realVU )
      {
          if ( (error = gmpLoadS3M(psFileName, 1, &MakeMeter, &module))
              != OK )
              midasError(error);
      }
      else
      {
          if ( (error = gmpLoadS3M(psFileName, 1, NULL, &module)) != OK )
              midasError(error);
      }
    }
    else
    {
      puts("Loading Protracker module");
      if ( realVU )
      {
          if ( (error = gmpLoadMOD(psFileName, 1, &MakeMeter, &module))
              != OK )
              midasError(error);
      }
      else
      {
          if ( (error = gmpLoadMOD(psFileName, 1, NULL, &module)) != OK )
              midasError(error);
      }
    }
  }
  numChannels = module->numChannels;
}

/*****************************************************************************
 *
 * Synopsis : PlayModule()
 *
 * Author   : Einar Ingebrigtsen
 *
 * Input    : NONE
 *
 * Output   : NONE
 *
 * Project  : MIDAS Sound System
 *
 *
 * Function : To start playing a module
 *
 *****************************************************************************/
void PlayModule(void)
{
	midasPlayModule(module, 0);
}

/*****************************************************************************
 *
 * Synopsis : StopModule()
 *
 * Author   : Einar Ingebrigtsen
 *
 * Input    : NONE
 *
 * Output   : NONE
 *
 * Project  : MIDAS Sound System
 *
 *
 * Function : To stop a module that is playing
 *
 *****************************************************************************/
void StopModule(void)
{
	midasStopModule(module);
  midasClose();
}



// Defines ///////////////////////////////////////////////////////////////////
#define PACKED_SIZE   332944									// Graphics file size
#define UNPACK_SIZE   583098

#define PACKING				0												// Enable/disable depacking
#define MUSIC 				0												// 0= No music, 1= Music
#define GUSRAM  			1024										// How much GUS ram required
#define MODULE				"ninja2_7.xm"

/* Anims */
#define aSEQ1_NINJA 3
#define aSEQ2_LOGO	19
#define aSEQ3_CHASE 31
#define aSEQ4_CHASE	78
#define aSEQ5_MKID	108
#define aSEQ6_LEGS  116
#define aSEQ7_BODY  133
#define aSEQ7_HEAD	139
#define aSEQ8 			148
#define aSEQ9_NINJA 156
#define aSEQ10			0
#define aSEQ11_NINJA 176
#define aSEQ12_NINJA 207
#define aSEQ13      243
#define aSEQ14			247
#define aSEQ15			253
#define aSEQ16			255
#define aSEQ17			261
#define aSEQ18			0
#define aSEQ19			264
#define aSEQ20			0
#define aSEQ21_LAUGH	283
#define aSEQ21_CUT		285
#define aSEQ21_GUSH		296
#define aSEQ22_NINJA  303
#define aANGRY        335

#define gSEQ1_LAYER1	0
#define gSEQ1_LAYER2	1
#define gSEQ1_LAYER3	2
#define gSEQ2_LOGO		27
#define gSEQ3_LAYER1	28
#define gSEQ3_LAYER2	29
#define gSEQ3_LAYER3	30
#define gSEQ3_NEON1		76
#define gSEQ3_NEON2		77
#define gSEQ4_LAYER1	106
#define gSEQ4_LAYER2	107
#define gSEQ5_BACK		114
#define gSEQ6_BACK		115
#define gSEQ7_BACK		132
#define gSEQ7_NINJA		147
#define gSEQ8_BACK		152
#define gSEQ9_FOG			153
#define gSEQ9_LAYER1	154
#define gSEQ9_LAYER2	155
#define gSEQ10				0
#define gSEQ11_MBLURR	174
#define gSEQ11_CLOUDS 175
#define gSEQ11_MEND   206
#define gSEQ12				0
#define gSEQ13_BACK		242
#define gSEQ14				0
#define gSEQ15				0
#define gSEQ16				0
#define gSEQ17				0
#define gSEQ18_ATTACK	263
#define gSEQ19				0
#define gSEQ20_STAND	281
#define gSEQ21_HEAD		282
#define gSEQ22_BACK		300
#define gSEQ22_LAYER1 301
#define gSEQ22_FOG 		302
#define gANGRY        344

// Macros ////////////////////////////////////////////////////////////////////
#define GetKB() inp(0x60)

// Structures ////////////////////////////////////////////////////////////////

// Externals /////////////////////////////////////////////////////////////////

// Declarations //////////////////////////////////////////////////////////////
//int GUS=0;
bool vFirstTime = TRUE;
Graphics_t sGraphics;
Timer_t 	 sTimer;

float		nLayer1Xpos;													/* Layer 1 X position */
float 	nLayer2Xpos;                          /* Layer 2 X position */
float 	nLayer3Xpos;                          /* Layer 3 X position */
float 	nLayer1Ypos;                          /* Layer 1 Y position */
float 	nLayer2Ypos;                          /* Layer 2 Y position */
float 	nLayer3Ypos;                          /* Layer 3 Y position */

uint8 *pGraphics;															/* All graphics */
uint8 *pVspace;																/* Virtual depack space */

uint8 *pLayer1;                               /* Pointer to depack layer area 1 */
uint8 *pLayer2;                               /* Pointer to depack layer area 2 */
uint8 *pLayer3;                               /* Pointer to depack layer area 3 */

uint8 *pIntroLayer1;
uint8 *pIntroLayer2;
uint8 *pIntroLayer3;
uint8 *pCityLayer1;
uint8 *pCityLayer2;
uint8 *pCityLayer3;

// Functions /////////////////////////////////////////////////////////////////
/*****************************************************************************
 *
 * Synopsis	:
 *
 * Author		: Einar Ingebrigtsen
 *
 * Input		: NONE
 *
 * Output		: NONE
 *
 * Function	:
 *
 *****************************************************************************/

/*****************************************************************************
 *
 * Synopsis	: time_GetDelta()
 *
 * Author		: Einar Ingebrigtsen
 *
 * Input		: NONE
 *
 * Output		: uint32 - 32 bit containing a delta time value.
 *
 * Function	: To get delta time value between this frame and previous frame.
 *
 *****************************************************************************/
uint32 time_GetDelta(void)
{
	//sTimer.vPrevious = sTimer.vCurrent;								/* Store previous time */

	//sTimer.vCurrent = timer_GetTime();								/* Get new time */

	//if(vFirstTime == TRUE)														/* Check if first call */
	//{
//		sTimer.vPrevious = sTimer.vCurrent;							/* If so, set previous to */
//		vFirstTime = FALSE;															/* current */
//	}

//	while(sTimer.vCurrent<=sTimer.vPrevious)
//		sTimer.vCurrent = timer_GetTime();							/* Get new time */

	/* Do delta time */
//	sTimer.vDelta = (sTimer.vCurrent - sTimer.vPrevious)>>2;

//	printf("CURRENT : %08x\n",sTimer.vCurrent);
//	printf("DELTA   : %08x\n",sTimer.vDelta);

//	sTimer.vPreviousDelta = sTimer.vDelta;

	sTimer.vDelta = 40;

	return sTimer.vDelta;
}


/*****************************************************************************
 *
 * Synopsis	: report()
 *
 * Author		: Einar Ingebrigtsen
 *
 * Input		: char *pError - Pointer to ERROR STRING
 *
 * Output		: NONE
 *
 * Function	: To return back to DOS with an error.
 *
 *****************************************************************************/
void report(char *pError)
{
	_setvideomode(0x3);
	printf("PANIC : %s\n",pError);
	exit(0);
}

/*****************************************************************************
 *
 * Synopsis	: file_Load()
 *
 * Author		: Einar Ingebrigtsen
 *
 * Input		: char *pFname - Pointer to file name STRING
 *            char *pBuffer - Pointer to buffer.
 *
 * Output		: NONE
 *
 * Function	: To load and allocate memory for a file.
 *
 *****************************************************************************/
bool file_Load(char *pFname, uint8 **pBuffer)
{
	FILE *pFP;
	long	vFileSize;

	/* Open a READ file */
	pFP = fopen(pFname,"rb");
	if(pFP == NULL)
		return FALSE;

	/* Find file size */
	fseek(pFP,0,SEEK_END);
	vFileSize = ftell(pFP);
	fseek(pFP,0,SEEK_SET);

	/* Allocate memory needed for FILE */
	*pBuffer = (uint8*)malloc(vFileSize);

	if(pBuffer == NULL)
		report("Couldn't allocate memory for graphics\n");

	/* Read whole file into memory */
	if(fread(*pBuffer,1,vFileSize,pFP)!=vFileSize)
		report("Couldn't read graphics\n");

	fclose(pFP);

	/* SUCCESS */
	return TRUE;
}


/*****************************************************************************
 *
 * Synopsis	: Load_Graphics()
 *
 * Author		: Einar Ingebrigtsen
 *
 * Input		: NONE
 *
 * Output		: NONE
 *
 * Function	: To load and decompress all graphics needed.
 *
 *****************************************************************************/
void Load_Graphics(void)
{
	unpacked 	= pGraphics;											/* Initialize data pointer */
	pack_size = PACKED_SIZE;										/* Initialize size of packed */

#if(PACKING)
	decompress("link/ninja.pak");								/* Decompress given FILE */
#else
	if(!file_Load("link/ninja.000",&pGraphics))	/* Load graphics */
		report("Couldn't load graphics\n");
#endif

	/* Initialize pointers */
	pIntroLayer1 = pGraphics+file_offsets[gSEQ1_LAYER1];
	pIntroLayer2 = pGraphics+file_offsets[gSEQ1_LAYER2];
	pIntroLayer3 = pGraphics+file_offsets[gSEQ1_LAYER3];
	pCityLayer1  = pGraphics+file_offsets[gSEQ3_LAYER1];
	pCityLayer2  = pGraphics+file_offsets[gSEQ3_LAYER2];
	pCityLayer3  = pGraphics+file_offsets[gSEQ3_LAYER3];
}

/*****************************************************************************
 *
 * Synopsis	: ShowFrame()
 *
 * Author		: Einar Ingebrigtsen
 *
 * Input		: uint8 *pFrame - Pointer to 320x256 frame
 *
 * Output		: NONE
 *
 * Function	: To paste a 320x256 screen onto framebuffer.
 *
 *****************************************************************************/
void ShowFrame(uint8 *pFrame)
{
	memcpy(sGraphics.pScreen, pFrame, 320*256);
}


void ClearScreen(void)
{
	memset(sGraphics.pScreen,0,320*256);
	ShowScreen();
}

void AnimPlay(int nNumber, int nFrameNums, int nSpeed, int nLoop, uint8 *pBackground)
{
	int i=0;
	uint8	*apAnim[60];
	float	nFrameNumber=0;

	for(i=0; i<nFrameNums; i++)
		apAnim[i] = pGraphics+file_offsets[nNumber+i];

	if(pBackground!=NULL)
	{
		ILBM_Palette(pBackground,64,0,0);
		DepackILBM(pBackground,pLayer1,0);
	}
	else
		memset(pLayer1,320*256,0);

	ILBM_Palette(apAnim[0],64,192,0);

	time_GetDelta();

	i=0;

	while(GetKB()!=2)
	{
		VBlank();
		time_GetDelta();

		ShowFrame(pLayer1);
		DepackILBM(apAnim[(uint32)nFrameNumber],pLayer2,192);
		DrawLayerVert(pLayer2,0);

		ShowScreen();


		nFrameNumber += ((float)sTimer.vDelta)/nSpeed;

		if(nFrameNumber>=nFrameNums)
		{
			if(i>=nLoop)
			{
				VBlank();
				ResetPalette();
				ClearScreen();
				VBlank();
				VBlank();
				VBlank();
				return;
			}
			nFrameNumber = 0;
			i++;
		}
	}

	VBlank();
	ResetPalette();
	ClearScreen();
}

void AnimPlay3(int nNumber, int nFrameNums, int nSpeed, int nLength, uint8 *pBackground)
{
	int i=0;
	uint8	*apAnim[60];
	float	nFrameNumber=0;

	for(i=0; i<nFrameNums; i++)
		apAnim[i] = pGraphics+file_offsets[nNumber+i];

	if(pBackground!=NULL)
	{
		ILBM_Palette(pBackground,64,0,0);
		DepackILBM(pBackground,pLayer1,0);
	}
	else
		memset(pLayer1,320*256,0);

	ILBM_Palette(apAnim[0],64,192,0);

	time_GetDelta();

	i=0;

	while(nFrameNumber<=nFrameNums)
	{
		VBlank();
		time_GetDelta();

		ShowFrame(pLayer1);
		DepackILBM(apAnim[(uint32)nFrameNumber],pLayer2,192);
		DrawLayerVert(pLayer2,0);

		ShowScreen();

		nFrameNumber += ((float)sTimer.vDelta)/nSpeed;
	}

	for(i=0; i<nLength; i++)
		VBlank();

	VBlank();
	ResetPalette();
	ClearScreen();
	VBlank();
}

void AnimPlay4(int nNumber, int nFrameNums, int nSpeed, int nLoop, uint8 *pBackground)
{
	int i=0;
	uint8	*apAnim[60];
	float	nFrameNumber=0;

	for(i=0; i<nFrameNums; i++)
		apAnim[i] = pGraphics+file_offsets[nNumber+i];

	if(pBackground!=NULL)
	{
		ILBM_Palette(pBackground,64,0,0);
		DepackILBM(pBackground,pLayer1,0);
	}
	else
		memset(pLayer1,320*256,0);

	ILBM_Palette(apAnim[0],64,192,0);

	time_GetDelta();

	i=0;

	while(GetKB()!=2)
	{
		VBlank();
		time_GetDelta();

		ShowFrame(pLayer1);
		DepackILBM(apAnim[(uint32)nFrameNumber],pLayer2,192);
		DrawLayerVert(pLayer2,0);

		ShowScreen();


		nFrameNumber += ((float)sTimer.vDelta)/nSpeed;

		if(nFrameNumber>=nFrameNums)
		{
			if(i>=nLoop)
			{
				return;
			}
			nFrameNumber = 0;
			i++;
		}
	}
}


void AnimPlay2(int nNumber, int nFrameNums, int nSpeed, int nLoop, uint8 *pBackground, uint8 *pForeground)
{
	int i=0;
	uint8	*apAnim[60];
	float	nFrameNumber=0;

	for(i=0; i<nFrameNums; i++)
		apAnim[i] = pGraphics+file_offsets[nNumber+i];

	VBlank();
	ILBM_Palette(apAnim[0],64,192,0);

	if(pForeground!=NULL)
	{
		VBlank();
		ILBM_Palette(pForeground,64,128,0);
		DepackILBM(pForeground,pLayer3,128);
	}
	else
		memset(pLayer3,320*256,0);

	if(pBackground!=NULL)
	{
		VBlank();
		ILBM_Palette(pBackground,64,0,0);
		DepackILBM(pBackground,pLayer1,0);
	}
	else
		memset(pLayer1,320*256,0);

	time_GetDelta();

	i=0;

	while(GetKB()!=2)
	{
		VBlank();
		time_GetDelta();

		ShowFrame(pLayer1);
		DepackILBM(apAnim[(uint32)nFrameNumber],pLayer2,192);
		DrawLayerVert(pLayer2,0);
		DrawLayerVert(pLayer3,0);

		ShowScreen();


		nFrameNumber += ((float)sTimer.vDelta)/nSpeed;

		if(nFrameNumber>=nFrameNums)
		{
			if(i>=nLoop)
			{
				VBlank();
				ResetPalette();
				ClearScreen();
				VBlank();
				VBlank();
				VBlank();
				return;
			}
			nFrameNumber = 0;
			i++;
		}
	}

	VBlank();
	ResetPalette();
	ClearScreen();
}


void AnimPlayUnpacked(int nNumber, int nFrameNums, int nSpeed, int nLoop, uint8 *pBackground)
{
	int i=0;
	uint8	*apAnim[60];
	float	nFrameNumber=0;

	for(i=0; i<nFrameNums; i++)
		apAnim[i] = pGraphics+file_offsets[nNumber+i];

	if(pBackground!=NULL)
		memcpy(pLayer1,pBackground,320*256);
	else
		memset(pLayer1,320*256,0);

	ILBM_Palette(apAnim[0],64,192,0);

	time_GetDelta();

	i=0;

	while(GetKB()!=2)
	{
		VBlank();
		time_GetDelta();

		ShowFrame(pLayer1);
		DepackILBM(apAnim[(uint32)nFrameNumber],pLayer2,192);
		DrawLayerVert(pLayer2,0);

		ShowScreen();


		nFrameNumber += ((float)sTimer.vDelta)/nSpeed;

		if(nFrameNumber>=nFrameNums)
		{
			if(i>=nLoop)
			{
				VBlank();
				ResetPalette();
				ClearScreen();
				VBlank();
				VBlank();
				VBlank();
				return;
			}
			nFrameNumber = 0;
			i++;
		}
	}

	VBlank();
	ResetPalette();
	ClearScreen();
}


void Intro(void)
{
	uint8	aFadeDown[35] = {
		0,0,0,5,14,44,44,14,5,2,5,14,44,44,14,10,5,2,1,0,0,0,0,0,0,0,0
	};

	float nFadePos=0;
	float	nFrameCounter=0;

	Sprite_t sSprite;
	uint8 *apStandAnim[16];

	bool bScroll = TRUE;
	float	nFrameNumber=0;

	int i=0;
	uint32 nLayer1XSize;
	uint32 nLayer2XSize;
	uint32 nLayer3XSize;

	nLayer1Xpos = 0;
	nLayer2Xpos = 0;
	nLayer3Xpos = 0;

	nLayer1XSize = ILBM_GetXSize(pIntroLayer1);
	nLayer2XSize = ILBM_GetXSize(pIntroLayer2);
	nLayer3XSize = ILBM_GetXSize(pIntroLayer3);

	ILBM_Palette(pIntroLayer1,64,0,-64);
	ILBM_Palette(pIntroLayer2,64,64,-64);
	ILBM_Palette(pIntroLayer3,64,128,-64);
	ILBM_Palette(pGraphics+file_offsets[aSEQ1_NINJA],64,192,-64);

	DepackILBM(pIntroLayer1,pLayer1,0);
	DepackILBM(pIntroLayer2,pLayer2,64);
	DepackILBM(pIntroLayer3,pLayer3,128);

	for(i=0; i<16; i++)
		apStandAnim[i] = pGraphics+file_offsets[aSEQ1_NINJA+i];

	sSprite.screen 		= sGraphics.pScreen;
	sSprite.vsprite 	= pVspace;
	sSprite.xscreen1  = 0;
	sSprite.yscreen1	= 0;
	sSprite.xscreen2	= 320;
	sSprite.yscreen2	= 256;
	sSprite.modulo		= 320;
	sSprite.xpos			= 0;
	sSprite.ypos			= 0;
	sSprite.xsize			= 320;
	sSprite.ysize			= 256;
	sSprite.xflip			= 0;
	sSprite.yflip			= 0;

	time_GetDelta();

	nFadePos = -64;

	while(GetKB()!=2)
	{
		VBlank();
		/* Get TIME delta */
		time_GetDelta();

		if(nFrameCounter<=120)
		{
			if(nFadePos<=0)
			{
				ILBM_Palette(pIntroLayer3,64,0,(int8)nFadePos);
				ILBM_Palette(pIntroLayer3,64,64,(int8)nFadePos);
				ILBM_Palette(pIntroLayer3,64,128,(int8)nFadePos);
				ILBM_Palette(pGraphics+file_offsets[9],64,192,-(int8)nFadePos);
			}
			nFadePos+=((float)sTimer.vDelta)/100;
		}

		if(nFrameCounter>=150 & nFrameCounter <=180)
			nFadePos = 0;

		/* Lightning 1 */
		if(nFrameCounter>=180 & nFrameCounter <=210)
		{
			if(nFadePos<=25)
			{
				ILBM_Palette(pIntroLayer3,64,0,aFadeDown[(int)(nFadePos)]);
				ILBM_Palette(pIntroLayer3,64,64,aFadeDown[(int)(nFadePos)+1]>>1);
				ILBM_Palette(pIntroLayer3,64,128,aFadeDown[(int)(nFadePos)+2]>>2);
				ILBM_Palette(pGraphics+file_offsets[9],64,192,aFadeDown[(int)(nFadePos)+2]>>2);
			}
			nFadePos+=((float)sTimer.vDelta)/50;
		}

		if(nFrameCounter>=250 & nFrameCounter<=340)
			nFadePos=0;

		/* Lightning 2 */
		if(nFrameCounter>=365 & nFrameCounter<=400)
		{
			if(nFadePos<=25)
			{
				ILBM_Palette(pIntroLayer3,64,0,aFadeDown[(int)(nFadePos)]);
				ILBM_Palette(pIntroLayer3,64,64,aFadeDown[(int)(nFadePos)+1]>>1);
				ILBM_Palette(pIntroLayer3,64,128,aFadeDown[(int)(nFadePos)+2]>>2);
				ILBM_Palette(pGraphics+file_offsets[9],64,192,aFadeDown[(int)(nFadePos)+2]>>2);
			}
			nFadePos+=((float)sTimer.vDelta)/50;
		}

		if(nFrameCounter>=400 & nFrameCounter<= 410)
			nFadePos=0;

		if(nFrameCounter>=420 & nFrameCounter<=455)
		{
			if(nFadePos<=64)
			{
				ILBM_Palette(pIntroLayer3,64,0,-(int8)nFadePos);
				ILBM_Palette(pIntroLayer3,64,64,-(int8)nFadePos);
				ILBM_Palette(pIntroLayer3,64,128,-(int8)nFadePos);
				ILBM_Palette(pGraphics+file_offsets[9],64,192,-(int8)nFadePos);
			}
			nFadePos+=((float)sTimer.vDelta)/30;
		}

		if(nFrameCounter>=490)
		{
			VBlank();
			ResetPalette();
			ClearScreen();
			VBlank();
			return;
		}

		/* Draw Layers */
		DrawLayerHor(pLayer1,(uint32)nLayer1Xpos,nLayer1XSize,0);
		DrawLayerHor(pLayer2,(uint32)nLayer2Xpos,nLayer2XSize,0);
		DrawLayerHor(pLayer3,(uint32)nLayer3Xpos,nLayer3XSize,55);

		/* Depack animation */
		DepackILBM(apStandAnim[(uint32)nFrameNumber],pVspace,192);
		sSprite.xpos = -(uint32)nLayer3Xpos+1080;
		Sprite_Draw((Sprite_t*)&sSprite);

		nFrameNumber += ((float)sTimer.vDelta)/85;

		if(nFrameNumber>=15)
			nFrameNumber = 0;

		/* Show screen */
		ShowScreen();

		if(bScroll==TRUE)
		{
			nLayer3Xpos += ((float)sTimer.vDelta)/25;
			nLayer2Xpos += ((float)sTimer.vDelta)/67;
			nLayer1Xpos += ((float)sTimer.vDelta)/83;
		}

		if(bScroll==FALSE)
			nLayer1Xpos -= ((float)sTimer.vDelta)/100;

		if(nLayer2Xpos >= (700-320))
			bScroll = FALSE;

		nFrameCounter += ((float)sTimer.vDelta)/67;
	}

	VBlank();
	ResetPalette();
	ClearScreen();
	VBlank();
}

void City(void)
{
	int 	i=0;
	bool	isScrolling;
	float	nFCount;

	nLayer1Ypos = 0;
	nLayer2Ypos = 0;
	nLayer3Ypos = 0;

	ILBM_Palette(pCityLayer1,64,0,-64);
	ILBM_Palette(pCityLayer2,64,64,-64);
	ILBM_Palette(pCityLayer3,64,128,-64);

	DepackILBM(pCityLayer1,pLayer3,0);
	DepackILBM(pCityLayer2,pLayer2,64);
	DepackILBM(pCityLayer3,pLayer1,128);

	DrawLayerVert(pLayer1,nLayer1Ypos);
	DrawLayerVert(pLayer2,nLayer2Ypos);
	DrawLayerVert(pLayer3,nLayer3Ypos);

	ShowScreen();

	isScrolling = TRUE;
	nFCount = 0;


	nLayer1Ypos = 0;
	nLayer2Ypos = 11;
	nLayer3Ypos = 0;


	time_GetDelta();

	while(GetKB()!=1)
	{
		VBlank();
		time_GetDelta();

		if(isScrolling)
		{
			if(i<=64)
			{
				ILBM_Palette(pCityLayer1,64,0,-64+(i));
				ILBM_Palette(pCityLayer2,64,64,-64+(i));
				ILBM_Palette(pCityLayer3,64,128,-64+(i));
			}

			i++;

			nLayer3Ypos += ((float)sTimer.vDelta)/52;		// 46
			nLayer2Ypos += ((float)sTimer.vDelta)/73;		// 65
			nLayer1Ypos += ((float)sTimer.vDelta)/219;

			if(nLayer3Ypos >= 344)
				isScrolling = FALSE;

			DrawLayerVert(pLayer1,(uint32)nLayer1Ypos);
			DrawLayerVert(pLayer2,(uint32)nLayer2Ypos);
			DrawLayerVert(pLayer3,(uint32)nLayer3Ypos);

			ShowScreen();
		}

		nFCount += ((float)sTimer.vDelta)/56;

		if(nFCount >= 375)
		{
			DrawLayerVert(pLayer1,nLayer1Ypos);
			DrawLayerVert(pLayer2,nLayer2Ypos);
			DrawLayerVert(pLayer3,nLayer3Ypos);

			memcpy(pVspace,sGraphics.pScreen,320*256);
			AnimPlayUnpacked(aSEQ3_CHASE,45,180,0,pVspace);

			memcpy(sGraphics.pScreen,pVspace,320*256);
			ShowScreen();

			nLayer1Ypos = 0;
			nLayer2Ypos = 0;
			nLayer3Ypos = 0;

			VBlank();
			ResetPalette();
			ClearScreen();

			return;
		}
	}

	VBlank();
	ResetPalette();
	ClearScreen();
}

void MutantSurprise(void)
{
	int	anFrames[] = {
		0,0,0,1,2,3,3,3,3,3,3,4,5,6,7,8,8,8,8,8,8,8,8,8,8,8
	};

	int i=0;
	uint8	*apMutantAnim[10];
	float	nFrameNumber=0;

	for(i=0; i<9; i++)
		apMutantAnim[i] = pGraphics+file_offsets[aANGRY+i];

	DepackILBM(pGraphics+file_offsets[gANGRY],pLayer1,0);

	ILBM_Palette(apMutantAnim[0],64,64,0);
	ILBM_Palette(pGraphics+file_offsets[gANGRY],64,0,0);

	time_GetDelta();

	while(GetKB()!=2)
	{
		VBlank();
 		time_GetDelta();

		ShowFrame(pLayer1);
		DepackILBM(apMutantAnim[anFrames[(uint32)nFrameNumber]],pLayer2,64);
		DrawLayerVert(pLayer2,0);

		ShowScreen();

		nFrameNumber += ((float)sTimer.vDelta)/115;

		if(nFrameNumber>=23)
		{
			VBlank();
			ResetPalette();
			ClearScreen();
			VBlank();
			return;
		}
	}

	VBlank();
	ResetPalette();
	ClearScreen();
}

void NinjaScrollUp(void)
{
	uint8	aFadeDown[35] = {
		0,0,0,5,14,44,44,14,5,2,5,14,44,44,14,10,5,2,1,0,0,0,0,0,0,0,0
	};

	float nFadePos=0;
	float	nFrameCounter=0;

	float	nHeadAnim=0;
	float	nBodyAnim=0;
	Sprite_t sSprite;
	bool	isScrolling = TRUE;

	VBlank();


	ILBM_Palette(pGraphics+file_offsets[gSEQ7_BACK],64,0,0);
	DepackILBM(pGraphics+file_offsets[gSEQ7_BACK],pLayer1,0);
	ILBM_Palette(pGraphics+file_offsets[gSEQ7_NINJA],64,64,0);
	DepackILBM(pGraphics+file_offsets[gSEQ7_NINJA],pLayer2,64);

	time_GetDelta();

	nLayer1Ypos = 544;
	nLayer2Ypos = 544;

	while(GetKB()!=2)
	{
		VBlank();
		time_GetDelta();

		if(nFrameCounter>=140 & nFrameCounter<=167)
		{
			if(nFadePos<=25)
			{
				ILBM_Palette(pGraphics+file_offsets[gSEQ7_BACK],64,0,aFadeDown[(int)(nFadePos)]);
				ILBM_Palette(pGraphics+file_offsets[gSEQ7_NINJA],64,64,aFadeDown[(int)(nFadePos)]>>2);
			}
			nFadePos+=((float)sTimer.vDelta)/35;
		}

		if(nFrameCounter>=167)
		{
			VBlank();
			ResetPalette();
			ClearScreen();
			VBlank();
			return;
		}

		DrawLayerVert(pLayer1,(uint32)nLayer1Ypos);
		DrawLayerVert(pLayer2,(uint32)nLayer2Ypos);

		sSprite.screen 		= sGraphics.pScreen;
		sSprite.vsprite 	= pVspace;
		sSprite.xscreen1  = 0;
		sSprite.yscreen1	= 0;
		sSprite.xscreen2	= 320;
		sSprite.yscreen2	= 256;
		sSprite.modulo		= 320;
		sSprite.xpos			= 0;
		sSprite.ypos			= (uint32)-nLayer2Ypos;
		sSprite.xsize			= 320;
		sSprite.ysize			= 256;
		sSprite.xflip			= 0;
		sSprite.yflip			= 0;
		DepackILBM(pGraphics+file_offsets[aSEQ7_HEAD+(uint32)nHeadAnim],pVspace,64);
		Sprite_Draw((Sprite_t*)&sSprite);

		sSprite.screen 		= sGraphics.pScreen;
		sSprite.vsprite 	= pVspace;
		sSprite.xscreen1  = 0;
		sSprite.yscreen1	= 0;
		sSprite.xscreen2	= 320;
		sSprite.yscreen2	= 256;
		sSprite.modulo		= 320;
		sSprite.xpos			= 67;
		sSprite.ypos			= (uint32)(544-355)-nLayer2Ypos;
		sSprite.xsize			= 320;
		sSprite.ysize			= 256;
		sSprite.xflip			= 0;
		sSprite.yflip			= 0;
		DepackILBM(pGraphics+file_offsets[aSEQ7_BODY+(uint32)nBodyAnim],pVspace,64);
		Sprite_Draw((Sprite_t*)&sSprite);

		ShowScreen();

		nHeadAnim += ((float)sTimer.vDelta)/85;
		if(nHeadAnim>=8)
			nHeadAnim = 0;

		nBodyAnim += ((float)sTimer.vDelta)/89;
		if(nBodyAnim>=6)
			nBodyAnim = 0;

		if(isScrolling == TRUE)
		{
			nLayer2Ypos -= ((float)sTimer.vDelta)/20;

			if(nLayer2Ypos>=350)
				nLayer1Ypos -= ((float)sTimer.vDelta)/20;
			if(nLayer2Ypos<=350 & nLayer2Ypos>=300)
				nLayer1Ypos -= ((float)sTimer.vDelta)/30;
			if(nLayer2Ypos<=300)
				nLayer1Ypos -= ((float)sTimer.vDelta)/35;

			if(nLayer1Ypos<=0)
			{
				nLayer1Ypos = 0;
			}

			if(nLayer2Ypos<=60)
			{
				nLayer2Ypos = 60;
				isScrolling = FALSE;
			}
		}
		nFrameCounter += ((float)sTimer.vDelta)/67;
	}
}

void NinjaJumpUp(void)
{
	uint32 nFogXSize;
	float	nFrameNumber=0;
	int		nFCount=0;

	DepackILBM(pGraphics+file_offsets[gSEQ9_LAYER1],pLayer1,0);
	ILBM_Palette(pGraphics+file_offsets[gSEQ9_LAYER1],64,0,0);
	DepackILBM(pGraphics+file_offsets[gSEQ9_FOG],pLayer2,0);
	DepackILBM(pGraphics+file_offsets[gSEQ9_LAYER2],pLayer3,64);
	ILBM_Palette(pGraphics+file_offsets[gSEQ9_LAYER2],64,64,0);
	ILBM_Palette(pGraphics+file_offsets[aSEQ9_NINJA],64,128,0);

	nFogXSize = ILBM_GetXSize(pGraphics+file_offsets[gSEQ9_FOG]);

	time_GetDelta();

	nFrameNumber = 0;

	while(GetKB()!=2)
	{
		VBlank();
		time_GetDelta();

		DrawLayerVert(pLayer1,0);

		DrawFog(pLayer2,(uint32)nLayer3Xpos,nFogXSize,0);
		DrawLayerVert(pLayer3,0);
		DepackILBM(pGraphics+file_offsets[aSEQ9_NINJA+(uint32)nFrameNumber],pVspace,128);
		DrawLayerVert(pVspace,0);

		ShowScreen();

		nLayer3Xpos += ((float)sTimer.vDelta)/90;

		nFrameNumber += ((float)sTimer.vDelta)/100;

		if(nFCount<1)
		{
			if(nFrameNumber>=4)
			{
				nFrameNumber = 0;
				nFCount++;
			}
		}
		else
		{
			if(nFrameNumber>=18)
			{
				nFrameNumber = 0;
				nFCount = 0;
				VBlank();
				ResetPalette();
				ClearScreen();
				return;
			}
		}
	}
}

#define NUMMBLURR 16

void NinjaInAir(void)
{
	int		nCount=0;
	int		nCount2=0;
	bool	isMBlurr=TRUE;
	float	nFrameNumber=0;

	memset(pLayer1,0,320*1024);
	memset(pLayer3,0,320*1024);

	DepackILBM(pGraphics+file_offsets[gSEQ11_MBLURR],pLayer1+(320*512),0);
	DepackILBM(pGraphics+file_offsets[gSEQ11_MEND],pLayer2,0);
	ILBM_Palette(pGraphics+file_offsets[gSEQ11_MBLURR],64,0,0);
	memcpy(pLayer1+(320*768),pLayer1+(320*512),320*256);
	memcpy(pLayer1+(320*323),pLayer2,320*189);
	DepackILBM(pGraphics+file_offsets[gSEQ11_CLOUDS],pLayer2,64);
	ILBM_Palette(pGraphics+file_offsets[gSEQ11_CLOUDS],64,64,0);
	ILBM_Palette(pGraphics+file_offsets[aSEQ11_NINJA],64,128,0);

	nLayer1Ypos = 768;
	nLayer2Ypos = 64;

	isMBlurr = TRUE;
	nCount = 0;
	nCount2= 0;

	time_GetDelta();

	while(GetKB()!=2)
	{
		VBlank();
		time_GetDelta();

		DepackILBM(pGraphics+file_offsets[aSEQ11_NINJA+(uint32)nFrameNumber],pLayer3+(320*60),128);

		if(nCount2<=10)
		{
			if(nFrameNumber>=3)
			{
				nFrameNumber=0;
				nCount2++;
			}
		}

		if(nCount2<=14)
		{
			if(nFrameNumber>=29)
			{
				nFrameNumber = 24;
				nCount2++;
			}
		}

		if(nCount2>=14)
		{
			VBlank();
			ResetPalette();
			ClearScreen();
			return;
		}

		DrawLayerVert(pLayer2,(uint32)nLayer2Ypos);

		if(isMBlurr)
			DrawLayerVert(pLayer1,(uint32)nLayer1Ypos);

		DrawLayerVert(pLayer3,(uint32)nLayer3Ypos);

		if(nCount>=NUMMBLURR)
		{
			nLayer2Ypos -= ((float)sTimer.vDelta)/80;
		}

		if(nCount2>=12)
			nLayer3Ypos -= ((float)sTimer.vDelta)/30;


		if(isMBlurr)
		{
			if(nCount==NUMMBLURR)
				nLayer1Ypos=256;

			if(nCount>=NUMMBLURR)
			{
				nLayer1Ypos -= ((float)sTimer.vDelta)/1.5;

				if(nLayer1Ypos<=80)
					isMBlurr = FALSE;
			}

			if(nCount<=4)
				nLayer3Ypos += ((float)sTimer.vDelta)/20;

			if(nCount<=NUMMBLURR)
			{
				switch(nCount)
				{
					case 0:nLayer1Ypos -= ((float)sTimer.vDelta)/2;
					case 1:nLayer1Ypos -= ((float)sTimer.vDelta)/1.9;
					case 2:nLayer1Ypos -= ((float)sTimer.vDelta)/1.8;
					case 3:nLayer1Ypos -= ((float)sTimer.vDelta)/1.6;
					default:nLayer1Ypos -= ((float)sTimer.vDelta)/1.6;
				}

				if(nLayer1Ypos<=512)
				{
					nLayer1Ypos = 768;
					nCount++;
				}
			}
		}

		nFrameNumber += ((float)sTimer.vDelta)/130;

		ShowScreen();
	}
}

void NinjaFallDown(void)
{
	uint32 nFogXSize;
	float	nFrameNumber=0;
	int		nFCount=0;

	DepackILBM(pGraphics+file_offsets[gSEQ9_LAYER1],pLayer1,0);
	ILBM_Palette(pGraphics+file_offsets[gSEQ9_LAYER1],64,0,0);
	DepackILBM(pGraphics+file_offsets[gSEQ9_FOG],pLayer2,0);
	DepackILBM(pGraphics+file_offsets[gSEQ9_LAYER2],pLayer3,64);
	ILBM_Palette(pGraphics+file_offsets[gSEQ9_LAYER2],64,64,0);
	ILBM_Palette(pGraphics+file_offsets[aSEQ12_NINJA],64,128,0);

	nFogXSize = ILBM_GetXSize(pGraphics+file_offsets[gSEQ9_FOG]);

	nFrameNumber = 0;

	nLayer3Xpos = 70;

	time_GetDelta();

	while(GetKB()!=2)
	{
		VBlank();
		time_GetDelta();

		DrawLayerVert(pLayer1,0);

		DrawFog(pLayer2,(uint32)nLayer3Xpos,nFogXSize,0);
		DrawLayerVert(pLayer3,0);
		DepackILBM(pGraphics+file_offsets[aSEQ12_NINJA+(uint32)nFrameNumber],pVspace,128);
		DrawLayerVert(pVspace,0);

		ShowScreen();

		nLayer3Xpos += ((float)sTimer.vDelta)/90;

		if(nFCount>=70)
			nFrameNumber += ((float)sTimer.vDelta)/125;

		if(nFrameNumber>=35)
		{
			nFrameNumber = 0;
			nFCount = 0;
			VBlank();
			ResetPalette();
			ClearScreen();
			VBlank();
			return;
		}

		nFCount += ((float)sTimer.vDelta)/40;
	}
}

void NinjaIntoFog(void)
{
	uint32 nFogXSize;
	float	nFrameNumber=0;
	int		nFCount=0;

	DepackILBM(pGraphics+file_offsets[gSEQ9_LAYER1],pLayer1,0);
	ILBM_Palette(pGraphics+file_offsets[gSEQ9_LAYER1],64,0,0);
	DepackILBM(pGraphics+file_offsets[gSEQ9_FOG],pLayer2,0);
	DepackILBM(pGraphics+file_offsets[gSEQ22_LAYER1],pLayer3,64);
	ILBM_Palette(pGraphics+file_offsets[gSEQ22_LAYER1],64,64,0);
	ILBM_Palette(pGraphics+file_offsets[aSEQ22_NINJA],64,128,0);

	nFogXSize = ILBM_GetXSize(pGraphics+file_offsets[gSEQ9_FOG]);

	time_GetDelta();

	nFrameNumber = 0;

	nLayer3Xpos  = 70;

	time_GetDelta();

	while(GetKB()!=2)
	{
		VBlank();
		time_GetDelta();

		ShowFrame(pLayer1);

		DrawFog(pLayer2,(uint32)nLayer3Xpos,nFogXSize,0);
		DrawLayerVert(pLayer3,0);
		DepackILBM(pGraphics+file_offsets[aSEQ22_NINJA+(uint32)nFrameNumber],pVspace,128);
		DrawLayerVert(pVspace,0);

		ShowScreen();

		nLayer3Xpos += ((float)sTimer.vDelta)/90;

		nFrameNumber += ((float)sTimer.vDelta)/145;

		if(nFrameNumber>=28)
		{
			nFrameNumber = 0;
			nFCount = 0;
			VBlank();
			ResetPalette();
			ClearScreen();
			VBlank();
			return;
		}
	}
}

void NinjaAttack(void)
{

	DepackILBM(pGraphics+file_offsets[gSEQ11_MBLURR],pLayer1,0);
	ILBM_Palette(pGraphics+file_offsets[gSEQ11_MBLURR],64,0,0);
	DepackILBM(pGraphics+file_offsets[gSEQ18_ATTACK],pLayer2,64);
	ILBM_Palette(pGraphics+file_offsets[gSEQ18_ATTACK],64,64,0);
	memcpy(pLayer1+(320*256),pLayer1,320*256);

	time_GetDelta();

	nLayer1Ypos = 256;
	nLayer2Ypos = 0;

	while(GetKB()!=2)
	{
		VBlank();
		time_GetDelta();

		DrawLayerVert(pLayer1,nLayer1Ypos);
		DrawLayerVert(pLayer2,nLayer2Ypos);

		nLayer1Ypos -= ((float)sTimer.vDelta)/2;
		nLayer2Ypos += ((float)sTimer.vDelta)/60;

		if(nLayer1Ypos<=0)
			nLayer1Ypos = 256;

		ShowScreen();
	}

}

#define ZOOM		8000

void Logo(void)
{
	Zoom_t sZoom;
	float		nXzoom;
	float		nYzoom;
	bool		isZooming;
	bool		isActive;
	bool		isAnimating;
	float		vFrameNumber;
	float		vFadeValue;

	memset(pLayer1,0,320*400);
	memset(pLayer2,0,320*400);
	memset(pLayer3,0,320*400);

	DepackILBM(pGraphics+file_offsets[gSEQ2_LOGO],pLayer1,0);
	ILBM_Palette(pGraphics+file_offsets[gSEQ2_LOGO],64,0,0);

	nXzoom 				= ZOOM;
	nYzoom 				= ZOOM;
	isZooming 		= TRUE;
	isActive			= TRUE;
	isAnimating 	= FALSE;
	vFrameNumber 	= 0;

	time_GetDelta();

	while(isActive & (GetKB()!=2) & (nXzoom>=1))
	{
		VBlank();
		time_GetDelta();

		if(nXzoom<=120)
		{
			ILBM_Palette(pGraphics+file_offsets[gSEQ2_LOGO],64,0,-(uint32)vFadeValue);
			vFadeValue += ((float)sTimer.vDelta)/60;
			if(vFadeValue>=64)
				isActive = FALSE;
		}

		if(isZooming)
		{
			memset(sGraphics.pScreen,0,320*256);

			if(nXzoom>=320)
			{
				sZoom.nXpos 	= ((uint32)(nXzoom) - 320)>>1;
				sZoom.nSXpos	= 0;
			}
			else
			{
				sZoom.nXpos 	= 0;
				sZoom.nSXpos  = 160 - ((uint32)(nXzoom)>>1);
			}

			if(nYzoom>=256)
			{
				sZoom.nYpos 	= ((uint32)(nYzoom) - 256)>>1;
				sZoom.nSYpos	= 0;
			}
			else
			{
				sZoom.nYpos 	= 0;
				sZoom.nSYpos  = 128 - ((uint32)(nYzoom)>>1);
			}

			sZoom.nScaleX		= (uint32)nXzoom;
			sZoom.nScaleY		= (uint32)nYzoom;
			sZoom.pGraphics = pLayer3;
			if(isAnimating)
				BitmapZoom((Zoom_t*)&sZoom);
			sZoom.pGraphics = pLayer1;
			BitmapZoom((Zoom_t*)&sZoom);

			if(nXzoom>=2560)
			{
				nXzoom -= ((float)sTimer.vDelta)*6;
				nYzoom -= ((float)sTimer.vDelta)*6;
			}

			if(nXzoom>=1280 & nXzoom<=2559)
			{
				nXzoom -= ((float)sTimer.vDelta)*4;
				nYzoom -= ((float)sTimer.vDelta)*4;
			}

			if(nXzoom<=1279 & nXzoom>=320)
			{
				nXzoom -= ((float)sTimer.vDelta)*3;
				nYzoom -= ((float)sTimer.vDelta)*3;
			}

			if(nXzoom<=319)
			{
				nXzoom -= ((float)sTimer.vDelta)/20;
				nYzoom -= ((float)sTimer.vDelta)/20;
				isAnimating = TRUE;
			}

			if(isAnimating)
			{
				DepackILBM(pGraphics+file_offsets[aSEQ2_LOGO+(uint32)vFrameNumber],pLayer3,20);

				vFrameNumber += ((float)sTimer.vDelta)/125;

				if(vFrameNumber>=8)
					vFrameNumber = 7;
			}

			if(nXzoom<=1)
				isZooming = FALSE;
			if(nYzoom<=1)
				isZooming = FALSE;
		}
		MotionBlurr(pLayer2);

		memcpy(pLayer2,sGraphics.pScreen,320*256);

		ShowScreen();
	}
}

void MutantHead(void)
{
	float	nFrameNumber;
	uint32 nLayer1XSize;

	memset(pLayer1,0,500*400);

	DepackILBM(pGraphics+file_offsets[gSEQ21_HEAD],pLayer1+(500*70),0);
	ILBM_Palette(pGraphics+file_offsets[gSEQ21_HEAD],64,0,0);
	ILBM_Palette(pGraphics+file_offsets[aSEQ21_GUSH],64,64,0);

	time_GetDelta();

	nLayer1XSize = ILBM_GetXSize(pGraphics+file_offsets[gSEQ21_HEAD]);

	nLayer1Xpos = 40;
	nLayer1Ypos = 30;

	while(GetKB()!=2)
	{
		VBlank();
		time_GetDelta();

		DepackILBM(pGraphics+file_offsets[aSEQ21_GUSH+(uint32)nFrameNumber],pLayer2,64);
		ShowFrame(pLayer2);
		DrawLayerHor(pLayer1,(((uint32)nLayer1Ypos)*nLayer1XSize)+(uint32)nLayer1Xpos,nLayer1XSize,0);

		ShowScreen();

		nLayer1Xpos += ((float)sTimer.vDelta)/90;
		nLayer1Ypos -= ((float)sTimer.vDelta)/90;

		nFrameNumber += ((float)sTimer.vDelta)/175;

		if(nFrameNumber>=4)
			nFrameNumber = 0;
	}

	VBlank();
	ResetPalette();
	ClearScreen();
	VBlank();
}



// Main program //////////////////////////////////////////////////////////////
void main(void)
{
	int			i=0;
	uint8		OldIrq;

	/* Store OLD IRQs and disable Keyboard */
	OldIrq = inp(0x21);
	outp(0x21,OldIrq|2);

#if(MUSIC)
	InitializeModule(MODULE);
/*
	GUS=1;
 	if(UltraDetect()) GUS=1;
	if(GUS) if(UltraSizeDram()<GUSRAM) GUS=0;
	if(GUS) initialize_music(MODULE);					// Initialize music
	*/
#endif

	/* Allocate memory for graphics */
#if(DEPACK)
	pGraphics = (uint8*)malloc(UNPACK_SIZE);

	if(pGraphics == NULL)
		report("Not enough memory for the graphics");
#endif

	/* Allocate virtual depack space */
	pVspace = (uint8*)malloc(320*400);

	if(pVspace == NULL)
		report("Not enough memory for the depacking area");

	/* Allocate virtual depack space LAYER1 */
	pLayer1 = (uint8*)malloc(400000);

	if(pLayer1 == NULL)
		report("Not enough memory for the depacking area");

	/* Allocate virtual depack space LAYER2 */
	pLayer2 = (uint8*)malloc(400000);

	if(pLayer2 == NULL)
		report("Not enough memory for the depacking area");

	/* Allocate virtual depack space LAYER2 */
	pLayer3 = (uint8*)malloc(400000);

	if(pLayer3 == NULL)
		report("Not enough memory for the depacking area");

	/* Allocate screen */
	sGraphics.pScreen = (uint8*)malloc(320*256);

	if(sGraphics.pScreen == NULL)
		report("Not enough memory for screen");

	/* Initialize assembler variables */
	Initialize_Asm(&sGraphics);

	/* Load and decompress graphics */
	Load_Graphics();

	time_GetDelta();

	/* Catch up with the timer */
	for(i=0; i<100; i++)
	{
		//VBlank();
 		time_GetDelta();
	}


	/* Clear all layers */
	memset(pLayer1,0,640*480);
	memset(pLayer2,0,640*480);
	memset(pLayer3,0,640*480);


#if(MUSIC)
	PlayModule();
	//if(GUS) start_play();											// Start playing
#endif

	/* Initialize timer */
 	timer_Initialize();
	time_GetDelta();

/*****************************************************************************
 * Main Demo Parts, Start
 *****************************************************************************/

 	Intro();
	Logo();
	City();
	AnimPlay2(aSEQ4_CHASE,28,120,0,pGraphics+file_offsets[gSEQ4_LAYER1],
																 pGraphics+file_offsets[gSEQ4_LAYER2]);

	AnimPlay(aSEQ5_MKID,6,110,6,pGraphics+file_offsets[gSEQ5_BACK]);
	AnimPlay3(aSEQ6_LEGS,16,180,40,pGraphics+file_offsets[gSEQ6_BACK]);

	NinjaScrollUp();

	MutantSurprise();

	AnimPlay(aSEQ8,4,200,1,pGraphics+file_offsets[gSEQ8_BACK]);


	NinjaJumpUp();
	NinjaInAir();
	NinjaFallDown();

	AnimPlay(aSEQ13,4,215,0,pGraphics+file_offsets[gSEQ13_BACK]);
	AnimPlay(aSEQ14,6,115,5,NULL);
	AnimPlay(aSEQ15,2,115,8,NULL);
	AnimPlay(aSEQ16,6,115,5,NULL);
	AnimPlay(aSEQ17,2,115,8,NULL);

	NinjaAttack();

	AnimPlay(aSEQ19,17,185,0,NULL);

	// LALALALALALA //
	DepackILBM(pGraphics+file_offsets[gSEQ20_STAND],pLayer2,0);
	ILBM_Palette(pGraphics+file_offsets[gSEQ20_STAND],64,0,0);
	DepackILBM(pGraphics+file_offsets[gSEQ6_BACK],pLayer1,64);
	ILBM_Palette(pGraphics+file_offsets[gSEQ6_BACK],64,64,0);
	DrawLayerVert(pLayer1,0);
	DrawLayerVert(pLayer2,0);
	ShowScreen();

	for(i=0; i<35; i++)
		VBlank();

	VBlank();
	ResetPalette();
	ClearScreen();
	VBlank();

	// And the rest //
	AnimPlay4(aSEQ21_LAUGH,2,115,5,pGraphics+file_offsets[gSEQ13_BACK]);
	AnimPlay4(aSEQ21_CUT,9,115,0,pGraphics+file_offsets[gSEQ13_BACK]);
	AnimPlay(aSEQ21_CUT+9,2,115,5,pGraphics+file_offsets[gSEQ13_BACK]);

	MutantHead();

	NinjaIntoFog();

/*****************************************************************************
 * Main Demo Parts, End
 *****************************************************************************/

	/* Deinitialize timer */
 	timer_DeInitialize();

	/* Free all loaded graphics, do it backwards, avoid memory leakage */
	free(sGraphics.pScreen);
	free(pLayer3);
	free(pLayer2);
	free(pLayer1);
	free(pVspace);
	free(pGraphics);

	/* Back to textmode */
	_setvideomode(0x3);

	/* Enable keyboard back */
	outp(0x21,OldIrq);

	#if(MUSIC)
		StopModule();
		//if(GUS) deinitialize_music();							// Remove music
	#endif
}
