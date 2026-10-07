/*      SDEVICE.H
 *
 * Sound Device definitions
 *
 * Copyright 1995 Petteri Kangaslampi and Jarno Paananen
 *
 * This file is part of the MIDAS Sound System, and may only be
 * used, modified and distributed under the terms of the MIDAS
 * Sound System license, LICENSE.TXT. By continuing to use,
 * modify or distribute this file you indicate that you have
 * read the license and understand and accept it fully.
*/


#ifndef __SDEVICE_H
#define __SDEVICE_H

#ifdef __16__
#define SMPMAX 65519                    /* max sample length (65536-16 - 1) */
#else
#define SMPMAX 4294967279               /* max sample length (2^32 - 17) */
#endif
#define MAXSAMPLES 256                  /* maximum number of samples */

#define DMABUFLEN 25                    /* mixing buffer length is a 1/25th of
                                           a second */



/****************************************************************************\
*       enum sdSampleType
*       -----------------
* Description:  Sample types
\****************************************************************************/

enum sdSampleType
{
    smpNone = 0,                        /* no sample */
    smp8bit,                            /* 8-bit unsigned sample */
    smp16bit                            /* 16-bit signed sample */
};




/****************************************************************************\
*       enum sdLoopMode
*       ---------------
* Description:  Sample looping modes
\****************************************************************************/

enum sdLoopMode
{
    sdLoopNone = 0,                     /* no looping */
    sdLoop1 = 1,                        /* 1 loop, release ends note */
    sdLoop1Rel = 2,                     /* 1 loop, sample data after loop is
                                           played when note is released */
    sdLoop2 = 3,                        /* 2 loops, when note is released
                                           playing is continued looping the
                                           second loop */
    sdLoopAmigaNone = 4,                /* Amiga compatible looping, no
                                           loop - ALE logic enabled anyway */
    sdLoopAmiga = 5                     /* Amiga compatible looping - 1
                                           loop, ALE logic enabled */
};




/****************************************************************************\
*       enum sdLoopType
*       ---------------
* Description:  Sample looping type for one loop
\****************************************************************************/

enum sdLoopType
{
    loopNone = 0,                       /* no looping */
    loopUnidir = 1,                     /* unidirectional loop */
    loopBidir = 2                       /* bidirectional loop */
};




/****************************************************************************\
*       enum sdSmpPos
*       -------------
* Description:  Sample positions in memory
\****************************************************************************/

enum sdSmpPos
{
    sdSmpNone = 0,                   /* no sample */
    sdSmpConv,                       /* conventional memory */
    sdSmpEMS                         /* EMS */
};




/****************************************************************************\
*       struct sdSample
*       ---------------
* Description:  Sound Device sample information structure
\****************************************************************************/

typedef struct
{
    uchar       *sample;                /* sample data pointer */
    int         samplePos;              /* sample position in memory, see enum
                                           sdSmpPos */
    int         sampleType;             /* sample type, see enum
                                           sdSampleType */
    unsigned    sampleLength;           /* sample length */
    int         loopMode;               /* sample looping mode, see enum
                                           sdLoopMode */
    unsigned    loop1Start;             /* first loop start */
    unsigned    loop1End;               /* first loop end */
    int         loop1Type;              /* first loop type, see enum
                                           sdLoopType */
    unsigned    loop2Start;             /* second loop start */
    unsigned    loop2End;               /* second loop end */
    int         loop2Type;              /* second loop type, see enum
                                           sdLoopType */
} sdSample;




/****************************************************************************\
*       enum sdPanning
*       --------------
* Description:  Sound Device panning values. Legal values range from
*               panLeft to panRight, in steps of 1, plus panSurround.
*               Surround sound is played from middle if surround is not
*               enabled.
\****************************************************************************/

enum sdPanning
{
    panLeft = -64,                      /* left speaker */
    panMiddle = 0,                      /* middle (both speakers) */
    panRight = 64,                      /* right speaker */
    panSurround = 0x80                  /* surround sound */
};




/****************************************************************************\
*       enum sdMode
*       -----------
* Description:  Possible SoundDevice output modes
\****************************************************************************/

enum sdMode
{
    sdMono = 1,                         /* mono */
    sdStereo = 2,                       /* stereo */

    sd8bit = 4,                         /* 8-bit output */
    sd16bit = 8                         /* 16-bit output */
};




/****************************************************************************\
*       enum sdConfigBits
*       -----------------
* Description:  Sound Device configuration information bits
\****************************************************************************/

enum sdConfigBits
{
    sdUsePort = 1,                      /* SD uses an I/O port */
    sdUseIRQ = 2,                       /* SD uses an IRQ */
    sdUseDMA = 4,                       /* SD uses a DMA channel */
    sdUseMixRate = 8,                   /* SD uses the set mixing rate */
    sdUseOutputMode = 16,               /* SD uses the set output mode */
    sdUseDSM = 32                       /* SD uses software mixing (DSM) */
};




/****************************************************************************\
*       struct SoundDevice
*       ------------------
* Description:  SoundDevice structure. See SDEVICE.TXT for documentation
\****************************************************************************/

typedef struct
{
    unsigned    tempoPoll;
    unsigned    configBits;             /* Configuration info bits. See enum
                                           sdConfigBits. */
    unsigned    port;                   /* Sound Device I/O port address */
    unsigned    IRQ;                    /* Sound Device IRQ number */
    unsigned    DMA;                    /* Sound Device DMA channel number */
    unsigned    cardType;               /* Sound Device sound card type.
                                           Starting from 1, 0 means
                                           autodetect */
    unsigned    numCardTypes;           /* number of different sound card
                                           types for this Sound Device */
    unsigned    modes;                  /* Possible modes for this SD,
                                           see enum sdMode. Updated by
                                           Detect() */

    char        *name;                  /* pointer to Sound Device name */
    char        **cardNames;            /* pointer to an array of pointers to
                                           sound card name strings */
    unsigned    numPortAddresses;       /* number of possible port
                                           addresses in table */
    unsigned    *portAddresses;         /* pointer to an array of possible
                                           I/O port addresses */


    int CALLING (*Detect)(int *result);
    int CALLING (*Init)(unsigned mixRate, unsigned mode);
    int CALLING (*Close)(void);
    int CALLING (*GetMixRate)(unsigned *mixRate);
    int CALLING (*GetMode)(unsigned *mode);
    int CALLING (*OpenChannels)(unsigned channels);
    int CALLING (*CloseChannels)(void);
    int CALLING (*ClearChannels)(void);
    int CALLING (*Mute)(int mute);
    int CALLING (*Pause)(int pause);
    int CALLING (*SetMasterVolume)(unsigned masterVolume);
    int CALLING (*GetMasterVolume)(unsigned *masterVolume);
    int CALLING (*SetAmplification)(unsigned amplification);
    int CALLING (*GetAmplification)(unsigned *amplification);
    int CALLING (*PlaySound)(unsigned channel, ulong rate);
    int CALLING (*ReleaseSound)(unsigned channel);
    int CALLING (*StopSound)(unsigned channel);
    int CALLING (*SetRate)(unsigned channel, ulong rate);
    int CALLING (*GetRate)(unsigned channel, ulong *rate);
    int CALLING (*SetVolume)(unsigned channel, unsigned volume);
    int CALLING (*GetVolume)(unsigned channel, unsigned *volume);
    int CALLING (*SetSample)(unsigned channel, unsigned smpHandle);
    int CALLING (*GetSample)(unsigned channel, unsigned *smpHandle);
    int CALLING (*SetPosition)(unsigned channel, unsigned pos);
    int CALLING (*GetPosition)(unsigned channel, unsigned *pos);
    int CALLING (*GetDirection)(unsigned channel, int *direction);
    int CALLING (*SetPanning)(unsigned channel, int panning);
    int CALLING (*GetPanning)(unsigned channel, int *panning);
    int CALLING (*MuteChannel)(unsigned channel, int mute);
    int CALLING (*AddSample)(sdSample *sample, int copySample,
        unsigned *smpHandle);
    int CALLING (*RemoveSample)(unsigned smpHandle);
    int CALLING (*SetUpdRate)(unsigned updRate);
    int CALLING (*StartPlay)(void);
    int CALLING (*Play)(int *callMP);
} SoundDevice;



#endif
