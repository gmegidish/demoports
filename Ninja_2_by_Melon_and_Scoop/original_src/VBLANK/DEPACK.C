#include <stdio.h>
#include <stdlib.h>
#include <graph.h>
#include <types.h>
#include <malloc.h>
#include <scoop.h>
#include "lzw2.h"

uint8* packed=0;
uint8* unpacked=0;
int pack_size;
int pack_position=0;
int unpack_position=0;

quit()
{
	_setvideomode(0x3);

	exit(0);
}

void read_file(char* name,uint8** dest)
{
	FILE* fp;
	int fsize;

	if(!(fp=fopen(name,"rb")))
	{
		printf("PANIC : File not found : %s\n",name);
		exit(0);
	}

	fseek(fp,0,SEEK_END);
	fsize = ftell(fp);
	if(!(*dest = (uint8*)malloc(fsize)))
	{
		_setvideomode(0x3);
		printf("PANIC : Not enough memory for : %s\n",name);
		exit(0);
	}
	fseek(fp,0,SEEK_SET);

	if(!(fread(*dest,1,fsize,fp)))
	{
		_setvideomode(0x3);
		printf("PANIC : Error reading file : %s\n",name);
		exit(0);
	}

//	pack_size = fsize;

	fclose(fp);
}


write_file(char* name,uint8** dest,int fsize)
{
	FILE* fp;

	if(!(fp=fopen(name,"wb")))
	{
		_setvideomode(0x3);
		printf("PANIC : Couldn't write file : %s\n",name);
		quit();
	}

	if(!(fwrite(*dest,1,fsize,fp)))
	{
		_setvideomode(0x3);
		printf("PANIC : Error writing file : %s\n",name);
		quit();
	}

	fclose(fp);
}



char getbyte()
{
	char data;

	if(pack_position>=pack_size) error=1;

	pack_position++;

	data = fgetc(packfp);

	return data;
}


void putbyte(char data)
{
	unpacked[unpack_position] = data;
	unpack_position++;
}



/*
void depack()
{
	read_file("ninja.pak",&packed);

	if(!(unpacked = new uint8[193078]))
	{
		_setvideomode(0x3);
		printf("PANIC : Not enough memory for NINJA_DATA\n");
		exit(0);
	}

	decompress();


	delete packed;


	write_file("ninja.unp",&unpacked,193078);

	delete unpacked;
}
 */

/*
main()
{
	depack();
}
 */


