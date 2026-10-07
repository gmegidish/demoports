//////////////////////////////////////////////////////////////////////////////
//
//  											(C)1995 SCOOP Productions
//
// Program : LINK.CC
//
// Author : Einar Ingebrigtsen
//
// Created : 23.09.95
//
// Purpose : Link Several Bin Files into one File
//
// $Log: link.cc_ $
// Revision 1.2  1995/09/23  16:41:51  einar
// Added Memory system
//
// Revision 1.1  1995/09/23  16:10:53  einar
// Initial revision
//
//
//////////////////////////////////////////////////////////////////////////////

#define program "Link System"

// Includes //////////////////////////////////////////////////////////////////
#include <types.h>
#include <stdio.h>
#include <stdlib.h>
#include <graph.h>
#include <dos.h>
#include <conio.h>
#include <malloc.h>
#include <string.h>
#include <scoop.h>

// Defines ///////////////////////////////////////////////////////////////////
#define DESTINATION "ninja.000"									// Destination file name
#define NO_FILES		356 												// Number of files to add.

#define GR "graphics/"													// Graphics path.

// Structures ////////////////////////////////////////////////////////////////

// Externals /////////////////////////////////////////////////////////////////

// Declarations //////////////////////////////////////////////////////////////
FILE* fp2;


uint8* tmpbuffer=0;

char* files[NO_FILES] = {
		GR "SEQ1/LAYER1.LBM    ",
		GR "SEQ1/LAYER2.LBM    ",
		GR "SEQ1/LAYER3.LBM    ",
		GR "SEQ1/STAND01.LBM   ",
		GR "SEQ1/STAND02.LBM   ",
		GR "SEQ1/STAND03.LBM   ",
		GR "SEQ1/STAND04.LBM   ",
		GR "SEQ1/STAND05.LBM   ",
		GR "SEQ1/STAND06.LBM   ",
		GR "SEQ1/STAND07.LBM   ",
		GR "SEQ1/STAND08.LBM   ",
		GR "SEQ1/STAND09.LBM   ",
		GR "SEQ1/STAND10.LBM   ",
		GR "SEQ1/STAND11.LBM   ",
		GR "SEQ1/STAND12.LBM   ",
		GR "SEQ1/STAND13.LBM   ",
		GR "SEQ1/STAND14.LBM   ",
		GR "SEQ1/STAND15.LBM   ",
		GR "SEQ1/STAND16.LBM   ",
		GR "SEQ2/LOGO001.lbm   ",
		GR "SEQ2/LOGO002.lbm   ",
		GR "SEQ2/LOGO003.lbm   ",
		GR "SEQ2/LOGO004.lbm   ",
		GR "SEQ2/LOGO005.lbm   ",
		GR "SEQ2/LOGO006.lbm   ",
		GR "SEQ2/LOGO007.lbm   ",
		GR "SEQ2/LOGO008.lbm   ",
		GR "SEQ2/NINJA.LBM     ",
		GR "SEQ3/3LAYER1.LBM   ",
		GR "SEQ3/3LAYER2.LBM   ",
		GR "SEQ3/3LAYER3.LBM   ",
		GR "SEQ3/3001.LBM       ",
		GR "SEQ3/3002.LBM       ",
		GR "SEQ3/3003.LBM       ",
		GR "SEQ3/3004.LBM       ",
		GR "SEQ3/3005.LBM       ",
		GR "SEQ3/3006.LBM       ",
		GR "SEQ3/3007.LBM       ",
		GR "SEQ3/3008.LBM       ",
		GR "SEQ3/3009.LBM       ",
		GR "SEQ3/3010.LBM       ",
		GR "SEQ3/3011.LBM       ",
		GR "SEQ3/3012.LBM       ",
		GR "SEQ3/3013.LBM       ",
		GR "SEQ3/3014.LBM       ",
		GR "SEQ3/3015.LBM       ",
		GR "SEQ3/3016.LBM       ",
		GR "SEQ3/3017.LBM       ",
		GR "SEQ3/3018.LBM       ",
		GR "SEQ3/3019.LBM       ",
		GR "SEQ3/3020.LBM       ",
		GR "SEQ3/3021.LBM       ",
		GR "SEQ3/3022.LBM       ",
		GR "SEQ3/3023.LBM       ",
		GR "SEQ3/3024.LBM       ",
		GR "SEQ3/3025.LBM       ",
		GR "SEQ3/3026.LBM       ",
		GR "SEQ3/3027.LBM       ",
		GR "SEQ3/3028.LBM       ",
		GR "SEQ3/3029.LBM       ",
		GR "SEQ3/3030.LBM       ",
		GR "SEQ3/3031.LBM       ",
		GR "SEQ3/3032.LBM       ",
		GR "SEQ3/3033.LBM       ",
		GR "SEQ3/3034.LBM       ",
		GR "SEQ3/3035.LBM       ",
		GR "SEQ3/3036.LBM       ",
		GR "SEQ3/3037.LBM       ",
		GR "SEQ3/3038.LBM       ",
		GR "SEQ3/3039.LBM       ",
		GR "SEQ3/3040.LBM       ",
		GR "SEQ3/3041.LBM       ",
		GR "SEQ3/3042.LBM       ",
		GR "SEQ3/3043.LBM       ",
		GR "SEQ3/3044.LBM       ",
		GR "SEQ3/3045.LBM       ",
		GR "SEQ3/NEON.LBM      ",
		GR "SEQ3/NEON2.LBM     ",
		GR "SEQ4/CHASE001.lbm  ",
		GR "SEQ4/CHASE002.lbm  ",
		GR "SEQ4/CHASE003.lbm  ",
		GR "SEQ4/CHASE004.lbm  ",
		GR "SEQ4/CHASE005.lbm  ",
		GR "SEQ4/CHASE006.lbm  ",
		GR "SEQ4/CHASE007.lbm  ",
		GR "SEQ4/CHASE008.lbm  ",
		GR "SEQ4/CHASE009.lbm  ",
		GR "SEQ4/CHASE010.lbm  ",
		GR "SEQ4/CHASE011.lbm  ",
		GR "SEQ4/CHASE012.lbm  ",
		GR "SEQ4/CHASE013.lbm  ",
		GR "SEQ4/CHASE014.lbm  ",
		GR "SEQ4/CHASE015.lbm  ",
		GR "SEQ4/CHASE016.lbm  ",
		GR "SEQ4/CHASE017.lbm  ",
		GR "SEQ4/CHASE018.lbm  ",
		GR "SEQ4/CHASE019.lbm  ",
		GR "SEQ4/CHASE020.lbm  ",
		GR "SEQ4/CHASE021.lbm  ",
		GR "SEQ4/CHASE022.lbm  ",
		GR "SEQ4/CHASE023.lbm  ",
		GR "SEQ4/CHASE024.lbm  ",
		GR "SEQ4/CHASE025.lbm  ",
		GR "SEQ4/CHASE026.lbm  ",
		GR "SEQ4/CHASE027.lbm  ",
		GR "SEQ4/CHASE028.lbm  ",
		GR "SEQ4/LAYER1.LBM    ",
		GR "SEQ4/LAYER2.LBM    ",
		GR "SEQ5/5001.LBM      ",
		GR "SEQ5/5002.LBM      ",
		GR "SEQ5/5003.LBM      ",
		GR "SEQ5/5004.LBM      ",
		GR "SEQ5/5005.LBM      ",
		GR "SEQ5/5006.LBM      ",
		GR "SEQ5/BGROUND.LBM   ",
		GR "SEQ6/6BGROUND.LBM  ",
		GR "SEQ6/6LEGS01.LBM   ",
		GR "SEQ6/6LEGS02.LBM   ",
		GR "SEQ6/6LEGS03.LBM   ",
		GR "SEQ6/6LEGS04.LBM   ",
		GR "SEQ6/6LEGS05.LBM   ",
		GR "SEQ6/6LEGS06.LBM   ",
		GR "SEQ6/6LEGS07.LBM   ",
		GR "SEQ6/6LEGS08.LBM   ",
		GR "SEQ6/6LEGS09.LBM   ",
		GR "SEQ6/6LEGS10.LBM   ",
		GR "SEQ6/6LEGS11.LBM   ",
		GR "SEQ6/6LEGS12.LBM   ",
		GR "SEQ6/6LEGS13.LBM   ",
		GR "SEQ6/6LEGS14.LBM   ",
		GR "SEQ6/6LEGS15.LBM   ",
		GR "SEQ6/6LEGS16.LBM   ",
		GR "SEQ7/7BGROUND.LBM  ",
		GR "SEQ7/7BODY01.LBM   ",
		GR "SEQ7/7BODY02.LBM   ",
		GR "SEQ7/7BODY03.LBM   ",
		GR "SEQ7/7BODY04.LBM   ",
		GR "SEQ7/7BODY05.LBM   ",
		GR "SEQ7/7BODY06.LBM   ",
		GR "SEQ7/7HEAD01.LBM   ",
		GR "SEQ7/7HEAD02.LBM   ",
		GR "SEQ7/7HEAD03.LBM   ",
		GR "SEQ7/7HEAD04.LBM   ",
		GR "SEQ7/7HEAD05.LBM   ",
		GR "SEQ7/7HEAD06.LBM   ",
		GR "SEQ7/7HEAD07.LBM   ",
		GR "SEQ7/7HEAD08.LBM   ",
		GR "SEQ7/7NINJA.LBM    ",
		GR "SEQ8/01.LBM        ",
		GR "SEQ8/02.LBM        ",
		GR "SEQ8/03.LBM        ",
		GR "SEQ8/04.LBM        ",
		GR "SEQ8/back.LBM      ",
		GR "SEQ9/9FOG.LBM      ",
		GR "SEQ9/9LAYER1.LBM   ",
		GR "SEQ9/9LAYER2.LBM   ",
		GR "SEQ9/90001.LBM     ",
		GR "SEQ9/90002.LBM     ",
		GR "SEQ9/90003.LBM     ",
		GR "SEQ9/90004.LBM     ",
		GR "SEQ9/90005.LBM     ",
		GR "SEQ9/90006.LBM     ",
		GR "SEQ9/90007.LBM     ",
		GR "SEQ9/90008.LBM     ",
		GR "SEQ9/90009.LBM     ",
		GR "SEQ9/90010.LBM     ",
		GR "SEQ9/90011.LBM     ",
		GR "SEQ9/90012.LBM     ",
		GR "SEQ9/90013.LBM     ",
		GR "SEQ9/90014.LBM     ",
		GR "SEQ9/90015.LBM     ",
		GR "SEQ9/90016.LBM     ",
		GR "SEQ9/90017.LBM     ",
		GR "SEQ9/90018.LBM     ",
		GR "SEQ11/11MBLURR.LBM ",
		GR "SEQ11/CLOUDS.lbm   ",
		GR "SEQ11/NINJA001.lbm ",
		GR "SEQ11/NINJA002.lbm ",
		GR "SEQ11/NINJA003.lbm ",
		GR "SEQ11/NINJA004.lbm ",
		GR "SEQ11/NINJA005.lbm ",
		GR "SEQ11/NINJA006.lbm ",
		GR "SEQ11/NINJA007.lbm ",
		GR "SEQ11/NINJA008.lbm ",
		GR "SEQ11/NINJA009.lbm ",
		GR "SEQ11/NINJA010.lbm ",
		GR "SEQ11/NINJA011.lbm ",
		GR "SEQ11/NINJA012.lbm ",
		GR "SEQ11/NINJA013.lbm ",
		GR "SEQ11/NINJA014.lbm ",
		GR "SEQ11/NINJA015.lbm ",
		GR "SEQ11/NINJA016.lbm ",
		GR "SEQ11/NINJA017.lbm ",
		GR "SEQ11/NINJA018.lbm ",
		GR "SEQ11/NINJA019.lbm ",
		GR "SEQ11/NINJA020.lbm ",
		GR "SEQ11/NINJA021.lbm ",
		GR "SEQ11/NINJA022.lbm ",
		GR "SEQ11/NINJA023.lbm ",
		GR "SEQ11/NINJA024.lbm ",
		GR "SEQ11/NINJA025.lbm ",
		GR "SEQ11/NINJA026.lbm ",
		GR "SEQ11/NINJA027.lbm ",
		GR "SEQ11/NINJA028.lbm ",
		GR "SEQ11/NINJA029.lbm ",
		GR "SEQ11/NINJA030.lbm ",
		GR "SEQ11/OVERGANG.lbm ",
		GR "SEQ12/1201.LBM     ",
		GR "SEQ12/1202.LBM     ",
		GR "SEQ12/1203.LBM     ",
		GR "SEQ12/1204.LBM     ",
		GR "SEQ12/1205.LBM     ",
		GR "SEQ12/1206.LBM     ",
		GR "SEQ12/1207.LBM     ",
		GR "SEQ12/1208.LBM     ",
		GR "SEQ12/1209.LBM     ",
		GR "SEQ12/1210.LBM     ",
		GR "SEQ12/1211.LBM     ",
		GR "SEQ12/1212.LBM     ",
		GR "SEQ12/1213.LBM     ",
		GR "SEQ12/1214.LBM     ",
		GR "SEQ12/1215.LBM     ",
		GR "SEQ12/1216.LBM     ",
		GR "SEQ12/1217.LBM     ",
		GR "SEQ12/1218.LBM     ",
		GR "SEQ12/1219.LBM     ",
		GR "SEQ12/1220.LBM     ",
		GR "SEQ12/1221.LBM     ",
		GR "SEQ12/1222.LBM     ",
		GR "SEQ12/1223.LBM     ",
		GR "SEQ12/1224.LBM     ",
		GR "SEQ12/1225.LBM     ",
		GR "SEQ12/1226.LBM     ",
		GR "SEQ12/1227.LBM     ",
		GR "SEQ12/1228.LBM     ",
		GR "SEQ12/1229.LBM     ",
		GR "SEQ12/1230.LBM     ",
		GR "SEQ12/1231.LBM     ",
		GR "SEQ12/1232.LBM     ",
		GR "SEQ12/1233.LBM     ",
		GR "SEQ12/1234.LBM     ",
		GR "SEQ12/1235.LBM     ",
		GR "SEQ13/13BGR.LBM    ",
		GR "SEQ13/1301.LBM     ",
		GR "SEQ13/1302.LBM     ",
		GR "SEQ13/1303.LBM     ",
		GR "SEQ13/1304.LBM     ",
		GR "SEQ14/1401.LBM     ",
		GR "SEQ14/1402.LBM     ",
		GR "SEQ14/1403.LBM     ",
		GR "SEQ14/1404.LBM     ",
		GR "SEQ14/1405.LBM     ",
		GR "SEQ14/1406.LBM     ",
		GR "SEQ15/1501.LBM     ",
		GR "SEQ15/1502.LBM     ",
		GR "SEQ16/1601.LBM     ",
		GR "SEQ16/1602.LBM     ",
		GR "SEQ16/1603.LBM     ",
		GR "SEQ16/1604.LBM     ",
		GR "SEQ16/1605.LBM     ",
		GR "SEQ16/1606.LBM     ",
		GR "SEQ17/1701.LBM     ",
		GR "SEQ17/1702.LBM     ",
		GR "SEQ18/18ATTACK.LBM ",
		GR "SEQ19/1901.LBM     ",
		GR "SEQ19/1902.LBM     ",
		GR "SEQ19/1903.LBM     ",
		GR "SEQ19/1904.LBM     ",
		GR "SEQ19/1905.LBM     ",
		GR "SEQ19/1906.LBM     ",
		GR "SEQ19/1907.LBM     ",
		GR "SEQ19/1908.LBM     ",
		GR "SEQ19/1909.LBM     ",
		GR "SEQ19/1910.LBM     ",
		GR "SEQ19/1911.LBM     ",
		GR "SEQ19/1912.LBM     ",
		GR "SEQ19/1913.LBM     ",
		GR "SEQ19/1914.LBM     ",
		GR "SEQ19/1915.LBM     ",
		GR "SEQ19/1916.LBM     ",
		GR "SEQ19/1917.LBM     ",
		GR "SEQ20/20STAND.LBM  ",
		GR "SEQ21/21HEAD.LBM   ",
		GR "SEQ21/2101.LBM     ",
		GR "SEQ21/2102.LBM     ",
		GR "SEQ21/2103.LBM     ",
		GR "SEQ21/2104.LBM     ",
		GR "SEQ21/2105.LBM     ",
		GR "SEQ21/2106.LBM     ",
		GR "SEQ21/2107.LBM     ",
		GR "SEQ21/2108.LBM     ",
		GR "SEQ21/2109.LBM     ",
		GR "SEQ21/2110.LBM     ",
		GR "SEQ21/2111.LBM     ",
		GR "SEQ21/2112.LBM     ",
		GR "SEQ21/2113.LBM     ",
		GR "SEQ21/GUSH01.LBM   ",
		GR "SEQ21/GUSH02.LBM   ",
		GR "SEQ21/GUSH03.LBM   ",
		GR "SEQ21/GUSH04.LBM   ",
		GR "SEQ22/22BGR.LBM    ",
		GR "SEQ22/22FGR.LBM    ",
		GR "SEQ22/22FOG.LBM    ",
		GR "SEQ22/NINJA001.lbm ",
		GR "SEQ22/NINJA002.lbm ",
		GR "SEQ22/NINJA003.lbm ",
		GR "SEQ22/NINJA004.lbm ",
		GR "SEQ22/NINJA005.lbm ",
		GR "SEQ22/NINJA006.lbm ",
		GR "SEQ22/NINJA007.lbm ",
		GR "SEQ22/NINJA008.lbm ",
		GR "SEQ22/NINJA009.lbm ",
		GR "SEQ22/NINJA010.lbm ",
		GR "SEQ22/NINJA011.lbm ",
		GR "SEQ22/NINJA012.lbm ",
		GR "SEQ22/NINJA013.lbm ",
		GR "SEQ22/NINJA014.lbm ",
		GR "SEQ22/NINJA015.lbm ",
		GR "SEQ22/NINJA016.lbm ",
		GR "SEQ22/NINJA017.lbm ",
		GR "SEQ22/NINJA018.lbm ",
		GR "SEQ22/NINJA019.lbm ",
		GR "SEQ22/NINJA020.lbm ",
		GR "SEQ22/NINJA021.lbm ",
		GR "SEQ22/NINJA022.lbm ",
		GR "SEQ22/NINJA023.lbm ",
		GR "SEQ22/NINJA024.lbm ",
		GR "SEQ22/NINJA025.lbm ",
		GR "SEQ22/NINJA026.lbm ",
		GR "SEQ22/NINJA027.lbm ",
		GR "SEQ22/NINJA028.lbm ",
		GR "SEQ22/NINJA029.lbm ",
		GR "SEQ22/NINJA030.lbm ",
		GR "SEQ22/NINJA031.lbm ",
		GR "SEQ22/NINJA032.lbm ",
		GR "ANGRY/ANGRY01.lbm  ",
		GR "ANGRY/ANGRY02.lbm  ",
		GR "ANGRY/ANGRY03.lbm  ",
		GR "ANGRY/ANGRY04.lbm  ",
		GR "ANGRY/ANGRY05.lbm  ",
		GR "ANGRY/ANGRY06.lbm  ",
		GR "ANGRY/ANGRY07.lbm  ",
		GR "ANGRY/ANGRY08.lbm  ",
		GR "ANGRY/ANGRY09.lbm  ",
		GR "ANGRY/BGR.lbm      ",
		GR "2035.lbm           ",
		GR "credits.lbm        ",
		GR "credits6.lbm       ",
		GR "credits8.lbm       ",
		GR "credits7.lbm       ",
		GR "credits3.lbm       ",
		GR "credits5.lbm       ",
		GR "credits2.lbm       ",
		GR "credits4.lbm       ",
		GR "credits1.lbm       ",
		GR "melsco.lbm"
//		GR "joachim.lbm",
//		GR "mikael.lbm"
};

int offset=0;
int size=0;

int foffsets[NO_FILES];
int fsizes[NO_FILES];

// Prototypes ////////////////////////////////////////////////////////////////
#ifdef __cplusplus
extern "C" {
#endif /* __cplusplus */

uint32 GetChunkPos(uint8 *buffer,uint32 Cname);

#ifdef __cplusplus
};
#endif /* __cplusplus */

// Functions /////////////////////////////////////////////////////////////////

long fixIFF(uint8 *buffer, long size)
{
	uint8 *tmpbuffer;
	uint32	DPPS;
	uint32 	TINY;
	uint32	BODY;
	uint32	NewSize;
	uint32	Remove;

	tmpbuffer = (uint8*)malloc(size);

	memcpy(tmpbuffer,buffer,size);

	DPPS = GetChunkPos(tmpbuffer,0x53505044);
	//TINY = GetChunkPos(tmpbuffer,0x594e4954);
	BODY = GetChunkPos(tmpbuffer,0x59444f42);

	Remove = BODY-DPPS;

	memcpy(buffer,tmpbuffer,DPPS);
	memcpy(buffer+DPPS,tmpbuffer+BODY,size-BODY);

	free(tmpbuffer);

	return size-Remove;
}

void merge_file(char* fname)
{
	FILE* fp;
	long fsize=0;

	if(!(fp=fopen(fname,"rb")))
	{
		_setvideomode(0x3);
		printf("PANIC : Couldn't open file : %s\n",fname);
		exit(0);
	}

	tmpbuffer = 0;

	fseek(fp,0,SEEK_END);
	fsize = ftell(fp);
	fseek(fp,0,SEEK_SET);

	tmpbuffer = (uint8*)malloc(fsize);

	fread(tmpbuffer,1,fsize,fp);

	fsize = fixIFF(tmpbuffer,fsize);

	fwrite(tmpbuffer,1,fsize,fp2);

	offset+=fsize;
	size=fsize;

	free(tmpbuffer);

	fclose(fp);
}

// Main program //////////////////////////////////////////////////////////////
main()
{
	offset = 0;
	size = 0;

	if(!(fp2=fopen(DESTINATION,"wb")))
	{
		_setvideomode(0x3);
		printf("PANIC : Couldn't write file : %s\n",DESTINATION);
		exit(0);
	}

	for(int i=0; i<NO_FILES; i++)
	{
		foffsets[i] = offset;

		merge_file(files[i]);
		fsizes[i] 	= size;
	}

	fclose(fp2);

	if(!(fp2=fopen("files.h","w")))
	{
		_setvideomode(0x3);
		printf("PANIC : Couldn't write header file\n");
		exit(0);
	}

	fprintf(fp2,"int file_offsets[%i] = {\n",NO_FILES);

	for(i=0; i<NO_FILES; i++)
	{
		if(i!=NO_FILES-1)
			fprintf(fp2,"\t%i,\n",foffsets[i]);
		else
			fprintf(fp2,"\t%i\n",foffsets[i]);
	}

	fprintf(fp2,"};\n\n");



	fprintf(fp2,"int file_sizes[%i] = {\n",NO_FILES);

	for(i=0; i<NO_FILES; i++)
	{
		if(i!=NO_FILES-1)
			fprintf(fp2,"\t%i,\n",fsizes[i]);
		else
			fprintf(fp2,"\t%i\n",fsizes[i]);
	}

	fprintf(fp2,"};\n\n");
}

