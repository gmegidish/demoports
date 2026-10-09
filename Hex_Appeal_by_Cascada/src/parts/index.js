// The five parts in the order the loader runs them. `program` is the index of the MZ program in APPEAL.EXE.
// `loadRetraces`: retraces that pass between the previous part's exit and this part's first instruction, while
// the loader copies the part from XMS and relocates it (0040:05cb..08ae). Measured in the recording: the copy
// grows with the program (exe3 140 KB, exe4 124 KB, exe5 245 KB).
import { runIntro } from './exe2.js';
import { runIfsMorphs } from './exe3.js';
import { runEevi } from './exe4.js';
import { runCube } from './exe5.js';
import { runSlimy } from './exe6.js';

export const PARTS = [
  { program: 2, run: runIntro, loadRetraces: 0 },
  { program: 3, run: runIfsMorphs, loadRetraces: 0 },
  { program: 4, run: runEevi, loadRetraces: 3 },
  { program: 5, run: runCube, loadRetraces: 3 },
  { program: 6, run: runSlimy, loadRetraces: 0 },
];
