import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
process.env.DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-backup-upgrade-"),
);
const { upgradeBackup } =
  await import("../src/modules/data-management/backup-upgrade");

test("备份升级只补齐 v1 已知默认值，v2 不猜测修补", () => {
  const data = {
    knowledge: [{ archived: undefined }],
    ai_audit: [{ feedback: undefined }],
  };
  upgradeBackup(data, { schemaVersion: 1, counts: {} });
  assert.equal(data.knowledge[0].archived, 0);
  assert.equal(data.ai_audit[0].feedback, "");
  const newer = { knowledge: [{}] };
  upgradeBackup(newer, { schemaVersion: 2, counts: {} });
  assert.deepEqual(newer, { knowledge: [{}] });
  assert.throws(
    () => upgradeBackup({}, { schemaVersion: 999, counts: {} }),
    /不支持/,
  );
});

test("固定 v1 fixture 恢复后可编辑、复习并导出 v2，未知缺列仍拒绝", () => {
  const fixture = JSON.parse(
    readFileSync("tests/fixtures/backup-v1.json", "utf8"),
  );
  for (const invalid of [false, true]) {
    const data = structuredClone(fixture);
    if (invalid) delete data.entries[0].body;
    const bytes = strToU8(JSON.stringify(data));
    const manifest = {
      schemaVersion: 1,
      counts: Object.fromEntries(
        Object.entries(data)
          .filter(([k]) => k !== "profile")
          .map(([k, rows]) => [k, (rows as any[]).length]),
      ),
      files: [
        {
          name: "data.json",
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ],
    };
    const folder = mkdtempSync(path.join(os.tmpdir(), "yanxi-v1-fixture-"));
    const file = path.join(folder, "v1.zip");
    writeFileSync(
      file,
      zipSync({
        "data.json": bytes,
        "manifest.json": strToU8(JSON.stringify(manifest)),
      }),
    );
    const script = `
      import { readFileSync } from 'node:fs';
      import { restore, backup } from './src/modules/data-management/backup.ts';
      import { one } from './src/lib/db.ts';
      import { getEntry, updateEntry, addReview, attempt } from './src/modules/entries/service.ts';
      import { unzipSync, strFromU8 } from 'fflate';
      try {
        const result = await restore(readFileSync(process.env.FIXTURE_FILE), 'fixture', 'hash');
        const id = '${fixture.entries[0].id}';
        updateEntry(result.owner, id, { expectedVersion: 1, title: 'restored-and-edited', manual: true });
        if (getEntry(result.owner, id).title !== 'restored-and-edited') throw Error('edit failed');
        const review = addReview(result.owner, id);
        attempt(result.owner, review.id, { expectedVersion: 1, mode: 'SCHEDULED', rating: 'GOOD', hintUsed: false, answerMd: '2x' }, 'fixture-attempt');
        const files = unzipSync(backup(result.owner));
        const manifest = JSON.parse(strFromU8(files['manifest.json']));
        if (manifest.schemaVersion !== 2 || manifest.counts.logs !== 1) throw Error('export failed');
        console.log('v1-restored-edited-reviewed-exported-v2');
      } catch(error) {
        if (${invalid} && error.code === 'INVALID_BACKUP' && one('SELECT count(*) n FROM users').n === 0) { console.log('invalid-rejected-without-data'); }
        else throw error;
      }
    `;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DATA_DIR: path.join(folder, "data"),
          FIXTURE_FILE: file,
        },
        windowsHide: true,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      invalid
        ? /invalid-rejected-without-data/
        : /v1-restored-edited-reviewed-exported-v2/,
    );
  }
});
