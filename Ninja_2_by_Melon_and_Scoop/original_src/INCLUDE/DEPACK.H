/*****************************************************************************
 *
 *  											(C)1995 SCOOP Productions
 *
 * Program : DEPACK.H
 *
 * Author  : Einar Ingebrigtsen
 *
 * Created : 22.09.95
 *
 * Purpose : Memory Object Header File
 *
 *  $Log: depack.h_ $
 * Revision 1.1  1995/09/22  18:56:47  einar
 * Initial revision
 *
 *
 *****************************************************************************/

#ifndef _DEPACK_H_INCLUDED_
#define _DEPACK_H_INCLUDED_

#include <scoop.h>

// Externals //////////////////////////////////////////////////////////////////
extern uint8* packed;
extern uint8* unpacked;
extern int pack_size;
extern int pack_position;
extern int unpack_position;

// Prototypes /////////////////////////////////////////////////////////////////
void decompress(char* fname);
//void read_file(char*,byte**);

#endif

