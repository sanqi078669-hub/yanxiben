import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
process.env.DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "yanxi-image-gates-"),
);
const { withImageProcessing, withUpload } =
  await import("../src/modules/images/processing");
const { extract, limited } = await import("../src/modules/ai/service");

test("图片处理最多两个任务，超额不开始，异常后释放容量", async () => {
  let releaseA!: () => void, releaseB!: () => void;
  const a = withImageProcessing(
    () =>
      new Promise<void>((resolve) => {
        releaseA = resolve;
      }),
  );
  const b = withImageProcessing(
    () =>
      new Promise<void>((resolve) => {
        releaseB = resolve;
      }),
  );
  let started = false;
  await assert.rejects(
    () =>
      withImageProcessing(async () => {
        started = true;
      }),
    /繁忙/,
  );
  assert.equal(started, false);
  releaseA();
  await a;
  await assert.rejects(
    () =>
      withImageProcessing(async () => {
        throw new Error("synthetic");
      }),
    /synthetic/,
  );
  assert(await withImageProcessing(async () => true));
  releaseB();
  await b;
});
test("上传账号并发与每分钟次数限制在读取正文前生效", async () => {
  const owner = randomUUID();
  let release!: () => void;
  const a = withUpload(
    owner,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    1000,
  );
  await assert.rejects(
    () => withUpload(owner, async () => true, 1000),
    /已有图片/,
  );
  release();
  await a;
  for (let i = 1; i < 30; i++)
    assert(await withUpload(owner, async () => true, 1000));
  await assert.rejects(
    () => withUpload(owner, async () => true, 1000),
    /每分钟/,
  );
  assert(await withUpload(owner, async () => true, 61001));
});
test("AI 忙时先拒绝提取，不查询不存在的图片或开始预处理", async () => {
  const owner = randomUUID();
  let release!: () => void;
  const held = limited(
    owner,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(
    () => extract(owner, { attachmentIds: [randomUUID()], consent: true }),
    (error) => (error as { code: string }).code === "AI_BUSY",
  );
  release();
  await held;
  await assert.rejects(
    () => extract(owner, { attachmentIds: [randomUUID()], consent: true }),
    /不存在或无权/,
  );
});
