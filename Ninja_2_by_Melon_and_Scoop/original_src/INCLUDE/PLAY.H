/*****************************************************************************
 *
 *  											(C)1995 SCOOP Productions
 *
 * Program : Midas.h
 *
 * Purpose : MIDAS Sound System
 *
 *****************************************************************************/

#ifndef _MIDAS_H_INCLUDED_
#define _MIDAS_H_INCLUDED_

// Prototypes ////////////////////////////////////////////////////////////////

#ifdef __cplusplus
extern "C" {
#endif

void		InitializeModule(char *psFileName);
void		PlayModule(void);
void		StopModule(void);

#ifdef __cplusplus
}
#endif


#endif


