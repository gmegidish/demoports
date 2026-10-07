/*****************************************************************************
 *
 *  											(C)1995 SCOOP Productions
 *
 * Program : Ninja.h
 *
 * Purpose : Main Header File for NINJA the sequal
 *
 *  $Log: visions.h_ $
 * Revision 1.1  1995/09/22  18:56:52  einar
 * Initial revision
 *
 *
 *****************************************************************************/

#ifndef _NINJA_H_INCLUDED_
#define _NINJA_H_INCLUDED_

// Includes ///////////////////////////////////////////////////////////////////
#include <types.h>
#include <scoop.h>

// Structures /////////////////////////////////////////////////////////////////

/* All Graphics Data Pointers */
typedef struct Graphics_s
{
	uint8 *pScreen;
}Graphics_t;

/* Timer Object */
typedef struct Timer_s
{
	uint32	vPrevious;
	uint32	vCurrent;
	uint32	vDelta;
	uint32	vPreviousDelta;
}Timer_t;

typedef struct Sprite_s
{
	uint8*	screen;								/* Pointer to Screen_t */
	uint8* 	sprite;								/* Pointer to SPRITE */
	int 		xscreen1;							/* X clip 1 */
	int			yscreen1;							/* X clip 2 */
  int 		xscreen2;							/* X size of screen */
	int			yscreen2;							/* Y size of screen */
	int			modulo;								/* Modulo of real screen */
	uint32	xpos;									/* X position of sprite */
	uint32	ypos;									/* Y position of sprite */
	uint8* 	vsprite;							/* Virtual Depack Area Of Sprite */
	int			xflip;								/* Flag if X flipped */
	int			yflip;								/* Flag if Y flipped */
	int			xsize;								/* X size of sprite */
	int			ysize;								/* Y size of sprite */
}Sprite_t;

typedef struct Zoom_s
{
	uint8 	*pGraphics;						/* Pointer to graphics to zoom... */
	uint32	nXpos;								/* X position inside bitmap */
	uint32	nYpos;								/* Y position inside bitmap */
	uint32	nScaleX;							/* X Scale value according to xsize, which
																	 should be 320 */
	uint32	nScaleY;							/* Y Scale value according to ysize, which
                        	 				 should be 256 */
	uint32	nSXpos;								/* X position on screen */
	uint32	nSYpos;								/* Y position on screen */
}Zoom_t;

// Externals //////////////////////////////////////////////////////////////////
#ifdef __cplusplus
extern "C" {
#endif /* __cplusplus */

void 	 DrawLayerVert(uint8 *pLayer, uint32 nYpos);
void 	 DrawLayerHor(uint8 *pLayer, uint32 nXpos, uint32 nXsize, uint32 nYpos);
void 	 DrawFog(uint8 *pLayer, uint32 nXpos, uint32 nXsize, uint32 nYpos);
void 	 Initialize_Asm(Graphics_t *psGraphics);
void 	 ShowScreen(void);
void   SetPalette(uint8 *pPalette, uint32 nOffset, uint32 nNumCols);
void	 timer_Initialize(void);
void	 timer_DeInitialize(void);
uint32 timer_GetTime(void);
uint32 DepackILBM(uint8 *pSource, uint8 *pDestination, uint8 nColAdd);
void	 ILBM_Palette(uint8 *pSource, uint32 nNumCols, uint8 nColOff, uint8 nFade);
uint32 ILBM_GetXSize(uint8 *pSource);
uint32 ILBM_GetYSize(uint8 *pSource);
void	 Sprite_Draw(Sprite_t *pSprite);
void	 VBlank(void);
void	 ResetPalette(void);
void	 BitmapZoom(Zoom_t *psZoom);
void	 MotionBlurr(uint8 *pGraphics);
void	 Pentium_InitCycle(void);
uint32 Pentium_GetCycle(void);
void	 VerticalBlank(void);

#ifdef __cplusplus
}
#endif /* __cplusplus */

#endif /* _NINJA_H_INCLUDED_ */



