/*      MGLOBALS.H
 *
 * MIDAS Sound System global variables
 *
 * Copyright 1995 Petteri Kangaslampi and Jarno Paananen
 *
 * This file is part of the MIDAS Sound System, and may only be
 * used, modified and distributed under the terms of the MIDAS
 * Sound System license, LICENSE.TXT. By continuing to use,
 * modify or distribute this file you indicate that you have
 * read the license and understand and accept it fully.
*/

#ifndef __MGLOBALS_H
#define __MGLOBALS_H

#define NOEMS

#ifdef __cplusplus
extern "C" {
#endif


extern int GLOBALVAR mUseEMS;           /* 1 if EMS should be used */
extern int GLOBALVAR mEnableSurround;   /* 1 if surround sound is enabled */


#ifdef __cplusplus
}
#endif



#endif
