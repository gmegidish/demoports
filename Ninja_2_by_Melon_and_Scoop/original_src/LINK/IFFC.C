//////////////////////////////////////////////////////////////////////////////
//
//  											(C)1995 SCOOP Productions
//
// Program : iffc.c
//
// Author : Einar Ingebrigtsen
//
// Created : 01.12.95
//
// Purpose : To provide an easy interface for dumping IFF chunks.
//
// $Log: iffc.cpp $
// Revision 1.1  1995/12/01  19:47:16  einar
// Initial revision
//
//
//////////////////////////////////////////////////////////////////////////////

#define program ""

// Includes //////////////////////////////////////////////////////////////////
#include <types.h>
#include <stdio.h>
#include <malloc.h>
#include <scoop.h>

// Defines ///////////////////////////////////////////////////////////////////

// Structures ////////////////////////////////////////////////////////////////

// Externals /////////////////////////////////////////////////////////////////

// Declarations //////////////////////////////////////////////////////////////
#ifdef __cplusplus
extern "C" {
#endif /* __cplusplus */

uint32 GetChunkPos(uint8 *buffer,uint32 Cname);

#ifdef __cplusplus
};
#endif /* __cplusplus */

// Functions /////////////////////////////////////////////////////////////////

// Main program //////////////////////////////////////////////////////////////
void main(int argc,char *argv[])
{
	FILE  *InFile;
	FILE  *OutFile;
	char  *chunk;
	long  FileSize;
	uint8 *Buffer=NULL;
	uint32 CName;
	uint32 CPos;
	uint32 CSize;

	printf("SCOOP IFF Chunk Dumper.\n\n");

	if(argc<4)
	{
		printf("Syntax : IFFDUMP <input-file> <output-file> <chunk-name>\n");
		printf("\n");
		printf("(C)1995 by SCOOP Productions\n");
		exit(0);
	}

	InFile = fopen(argv[1],"rb");

	chunk = argv[3];

	if(InFile == NULL)
	{
		printf("PANIC : Couldn't manage to open input file\n\n");
		printf("(C)1995 by SCOOP Productions\n");
		exit(0);
	}

	OutFile = fopen(argv[2],"wb");

	if(OutFile == NULL)
	{
		printf("PANIC : Couldn't manage to open input file\n\n");
		printf("(C)1995 by SCOOP Productions\n");
		exit(0);
	}

	fseek(InFile,0,SEEK_END);
	FileSize = ftell(InFile);
	fseek(InFile,0,SEEK_SET);

	Buffer = malloc(FileSize);

	if(Buffer == NULL)
	{
		printf("PANIC : Couldn't allocate memory for input file\n\n");
		printf("(C)1995 by SCOOP Productions\n");
		exit(0);
	}

	fread(Buffer,1,FileSize,InFile);

	printf("Searching for chunk : %s\n\n",chunk);

	CName = (uint32)(chunk[0])|(uint32)(chunk[1])<<8|(uint32)(chunk[2])<<16|(uint32)(chunk[3])<<24;
	CPos  = GetChunkPos(Buffer,CName);

	if(CPos==0)
	{
		printf("Chunk '%s' not found\n\n",chunk);
		printf("(C)1995 by SCOOP Productions\n");
		free(Buffer);
		fclose(InFile);
		fclose(OutFile);
		exit(0);
	}
	else
		printf("Chunk found at offset : 0x%08x\n",CPos);

	CSize = (uint32)(Buffer[CPos+4]<<24)|(uint32)(Buffer[CPos+5])<<16|(uint32)(Buffer[CPos+6])<<8|(uint32)(Buffer[CPos+7]);

	printf("Chunk size            : 0x%08x\n\n",CSize);

	fwrite(Buffer+CPos,1,CSize+8,OutFile);

	free(Buffer);
	fclose(InFile);
	fclose(OutFile);

	printf("(C)1995 by SCOOP Productions\n");
}
