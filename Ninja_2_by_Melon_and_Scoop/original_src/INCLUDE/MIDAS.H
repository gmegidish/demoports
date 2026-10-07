/*      MIDAS.H
 *
 * Simplified MIDAS Sound System API
 *
 * Copyright 1995 Petteri Kangaslampi and Jarno Paananen
 *
 * This file is part of the MIDAS Sound System, and may only be
 * used, modified and distributed under the terms of the MIDAS
 * Sound System license, LICENSE.TXT. By continuing to use,
 * modify or distribute this file you indicate that you have
 * read the license and understand and accept it fully.
*/

#ifndef __MIDAS_H
#define __MIDAS_H



/****************************************************************************\
*      NULL pointer definition (independence on library includes):
\****************************************************************************/

#ifndef NULL
    #define NULL 0L
#endif



/****************************************************************************\
*      MIDAS version defines
\****************************************************************************/

#define MVERSION 0.50a
#define MVERSTR "0.50a"
#define MVERNUM 0x0050



/****************************************************************************\
*      MIDAS header files:
\****************************************************************************/

#include <scoop.h>
#include "lang.h"
//#include "mtypes.h"

#include "errors.h"
#include "mglobals.h"
#include "mmem.h"
#include "file.h"
#include "sdevice.h"
#include "gmplayer.h"
#include "timer.h"
#include "dma.h"
#include "dsm.h"
#include "mutils.h"
#ifndef NOEMS
#include "ems.h"
#endif



#ifdef __cplusplus
extern "C" {
#endif



/****************************************************************************\
*      MIDAS global variables:
\****************************************************************************/

#if defined(__WINDOWS__) || defined(__NT__)

extern SoundDevice GLOBALVAR WinWave;   /* Windows Wave Sound Device */

#define NUMSDEVICES 1                   /* total number of Sound Devices */

#else /* Windows or NT */

extern SoundDevice GLOBALVAR GUS;       /* Gravis UltraSound Sound Device */
extern SoundDevice GLOBALVAR PAS;       /* Pro Audio Spectrum Sound Device */
extern SoundDevice GLOBALVAR WSS;       /* Windows Sound System Sound Device*/
extern SoundDevice GLOBALVAR SB;        /* Sound Blaster Sound Device */
extern SoundDevice GLOBALVAR NoSound;   /* No Sound Sound Device */

#define NUMSDEVICES 5                   /* total number of Sound Devices */

#endif

extern SoundDevice GLOBALVAR *midasSD;  /* current Sound Device */

    /* array to pointers to all Sound Devices, in numbering and detection
       order - GUS is SD #1: */
extern SoundDevice * GLOBALVAR midasSoundDevices[NUMSDEVICES];

extern gmpPlayHandle GLOBALVAR midasPlayHandle;  /* Generic Module Player
                                                    playing handle */
extern int GLOBALVAR midasDisableEMS;   /* 1 if EMS usage is disabled
                                           (default 0) */
extern int GLOBALVAR midasSDNumber;     /* Sound Device number (-1 for
                                           autodetect, default -1) */
extern int GLOBALVAR midasSDPort;       /* Sound Device I/O port number
                                           (-1 for autodetect or SD default,
                                           default -1) */
extern int GLOBALVAR midasSDIRQ;        /* Sound Device IRQ number (-1 for
                                           autodetect or SD default,
                                           default -1) */
extern int GLOBALVAR midasSDDMA;        /* Sound Device DMA channel number
                                           (-1 for autodetect or SD default,
                                           default -1) */
extern int GLOBALVAR midasSDCard;       /* Sound Device sound card type
                                           (-1 for autodetect or SD default,
                                           default -1) */
extern unsigned GLOBALVAR midasMixRate; /* Sound Device mixing rate */
extern unsigned GLOBALVAR midasOutputMode; /* Sound Device output mode force
                                           bits, default 0 (SD default) */
extern int GLOBALVAR midasAmplification;  /* Forced amplification level or -1
                                             for SD default (default -1) */
extern int GLOBALVAR midasChannels;     /* number of channels open or 0 if no
                                           channels have been opened using
                                           midasOpenChannels() */
extern int GLOBALVAR midasPlayerNum;    /* timer music player number */


extern int GLOBALVAR midasEMSInit;      /* is EMS heap manager initialized? */
extern int GLOBALVAR midasTMRInit;      /* is TempoTimer initialized? */
extern int GLOBALVAR midasTMRPlay;      /* is sound beind player with timer?*/
extern int GLOBALVAR midasSDInit;       /* is Sound Device initialized? */
extern int GLOBALVAR midasSDChans;      /* are Sound Device channels open? */
extern int GLOBALVAR midasGMPInit;      /* is GMP initialized? */
extern int GLOBALVAR midasGMPPlay;      /* is GMP playing? */
extern int GLOBALVAR midasTMRMusic;     /* is music being player with timer?*/




/****************************************************************************\
*      MIDAS constants:
\****************************************************************************/



/****************************************************************************\
*      MIDAS global functions from MIDAS.C:
\****************************************************************************/


/****************************************************************************\
*
* Function:     void midasError(int errNum)
*
* Description:  Prints a MIDAS error message to stderr and exits to DOS
*
* Input:        int errNum              MIDAS error code
*
\****************************************************************************/

void CALLING midasError(int errNum);




/****************************************************************************\
*
* Function:     void midasUninitError(int errNum)
*
* Description:  Prints an error message to stderr and exits to DOS without
*               uninitializing MIDAS. This function should only be used
*               from midasClose();
*
* Input:        int errNum              MIDAS error code
*
\****************************************************************************/

void CALLING midasUninitError(int errNum);



/****************************************************************************\
*
* Function:     void midasDetectSD(void)
*
* Description:  Attempts to detect a Sound Device. Sets the global variable
*               midasSD to point to the detected Sound Device or NULL if no
*               Sound Device was detected
*
\****************************************************************************/

void CALLING midasDetectSD(void);



/****************************************************************************\
*
* Function:     void midasInit(void)
*
* Description:  Initializes MIDAS Sound System
*
\****************************************************************************/

void CALLING midasInit(void);



/****************************************************************************\
*
* Function:     void midasClose(void)
*
* Description:  Uninitializes MIDAS Sound System
*
\****************************************************************************/

void CALLING midasClose(void);



/****************************************************************************\
*
* Function:     void midasSetDefaults(void)
*
* Description:  Initializes MIDAS Sound System variables to their default
*               states. MUST be the first MIDAS function to be called.
*
\****************************************************************************/

void CALLING midasSetDefaults(void);




/****************************************************************************\
*
* Function:     void midasOpenChannels(int numChans);
*
* Description:  Opens Sound Device channels for sound and music output.
*
* Input:        int numChans            Number of channels to open
*
* Notes:        Channels opened with this function can be used for sound
*               playing, and modules played with midasPlayModule() will be
*               played through the last of these channels. This function is
*               provided so that the same number of channels can be open
*               the whole time throughout the execution of the program,
*               keeping the volume level constant. Note that you must ensure
*               that you open enough channels for all modules, otherwise
*               midasPlayModule() will fail.
*
\****************************************************************************/

void CALLING midasOpenChannels(int numChans);




/****************************************************************************\
*
* Function:     void midasCloseChannels(void);
*
* Description:  Closes Sound Device channels opened with midasOpenChannels().
*               Do NOT call this function unless you have opened the sound
*               channels used yourself with midasOpenChannels().
*
\****************************************************************************/

void CALLING midasCloseChannels(void);




/****************************************************************************\
*
* Function:     midasPlayModule(gmpModule *module, int numEffectChns)
*
* Description:  Starts playing a Generic Module Player module loaded to memory
*
* Input:        gmpModule *module       Pointer to loaded module structure
*               int numEffectChns       Number of channels to open for sound
*                                       effects. Ignored if sound channels
*                                       have already been opened with
*                                       midasOpenChannels().
*
* Returns:      Pointer to module structure. This function can not fail,
*               as it will call midasError() to handle all error cases.
*
* Notes:        The Sound Device channels available for sound effects are the
*               _first_ numEffectChns channels. So, for example, if you use
*               midasPlayModule(module, 3), you can use channels 0-2 for sound
*               effects. If you already have opened channels with
*               midasOpenChannels(), the module will be played with the last
*               possible channels, so that the first channels will be
*               available for sound effects. Note that if not enough channels
*               are open this function will fail.
*
\****************************************************************************/

void CALLING midasPlayModule(gmpModule *module, int numEffectChns);




/****************************************************************************\
*
* Function:     void midasStopModule(gmpModule *module)
*
* Input:        gmpModule *module       the module which is being played
*
* Description:  Stops playing a module and uninitializes the Module Player.
*               If sound channels were NOT opened through midasOpenChannels(),
*               but by letting midasPlayModule() open them, they will be
*               closed. Sound channels opened with midasOpenChannels() are NOT
*               closed and must be closed separately.
*
\****************************************************************************/

void CALLING midasStopModule(gmpModule *module);


#ifdef __cplusplus
}
#endif


#endif
