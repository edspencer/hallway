// `npm run sync:guide`: rewrite the file-format reference in AGENT-GUIDE.md from the validator's schemas
// (server/store/schema.ts). The daemon and `hallway guide` regenerate it whenever they render the guide anyway; this
// keeps the committed copy (what GitHub and the npm page show) in step. test/guide.test.ts fails until it's run.
import fs from 'node:fs';
import { AGENT_GUIDE, withReference } from '../server/guide.ts';

const before = fs.readFileSync(AGENT_GUIDE, 'utf8');
const after = withReference(before);
if (after === before) console.log('AGENT-GUIDE.md is up to date');
else {
  fs.writeFileSync(AGENT_GUIDE, after);
  console.log('AGENT-GUIDE.md: file-format reference updated');
}
