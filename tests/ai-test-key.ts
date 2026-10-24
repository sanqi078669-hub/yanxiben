import { after } from "node:test";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

// Never use a caller's real AI master key or leave test secrets in the checkout.
const root = realpathSync(os.tmpdir());
const directory = mkdtempSync(path.join(root, "yanxi-test-master-"));
const previous = process.env.AI_KEY_FILE;
process.env.AI_KEY_FILE = path.join(directory, "master.key");
after(() => {
  assert.equal(path.dirname(realpathSync(directory)), root);
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.AI_KEY_FILE;
  else process.env.AI_KEY_FILE = previous;
});
