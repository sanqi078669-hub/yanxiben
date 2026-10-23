import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readReviewSession,
  reviewSessionSnapshot,
} from "../src/lib/review-session";
import {
  REVIEW_ANSWER_MAX_LENGTH,
  reviewAttemptSchema,
  submissionWasRejected,
} from "../src/lib/review-contract";
const id = "00000000-0000-4000-8000-000000000001";
const now = Date.now();
const session = {
  owner: id,
  scope: "scheduled",
  updated: now,
  reviewId: id,
  entryId: id,
  title: "题目",
  version: 3,
  mode: "SCHEDULED",
  answer: "未提交的推导",
  revealed: true,
  hint: false,
  aiHint: true,
  rating: "EASY",
  key: id,
  pending: null,
};
test("复习中断恢复保留答案与提示限制，隔离账号和练习范围", () => {
  const result = readReviewSession(
    JSON.stringify(session),
    id,
    "scheduled",
    now,
  )!;
  assert.equal(result.answer, session.answer);
  assert.equal(result.hint, true);
  assert.equal(result.rating, "GOOD");
  assert.equal(
    readReviewSession(JSON.stringify(session), id, "practice", now),
    null,
  );
  assert.equal(
    readReviewSession(
      JSON.stringify(session),
      id.replace(/1$/, "2"),
      "scheduled",
      now,
    ),
    null,
  );
  assert.equal(
    readReviewSession(
      JSON.stringify(session),
      id,
      "scheduled",
      now + 8 * 86400000,
    ),
    null,
  );
  assert.equal(readReviewSession("broken", id, "scheduled", now), null);
});
test("中断提交保持原请求标识、旧版本与请求正文，避免恢复后制造新提交", () => {
  const pending = {
    key: id,
    body: {
      expectedVersion: 3,
      mode: "SCHEDULED",
      rating: "GOOD",
      hintUsed: true,
      answerMd: "答案",
    },
  };
  const result = readReviewSession(
    JSON.stringify({ ...session, pending }),
    id,
    "scheduled",
    now,
  )!;
  assert.deepEqual(result.pending, pending);
  assert.equal(result.version, 3);
});

test("客户端与服务端共享 50k 契约，确定失败可编辑，未知结果保持原请求", () => {
  const body = {
    expectedVersion: 3,
    mode: "SCHEDULED",
    rating: "GOOD",
    hintUsed: false,
    answerMd: "x".repeat(REVIEW_ANSWER_MAX_LENGTH),
  };
  assert.ok(reviewAttemptSchema.safeParse(body).success);
  assert.equal(
    reviewAttemptSchema.safeParse({ ...body, answerMd: body.answerMd + "x" })
      .success,
    false,
  );
  for (const status of [400, 413, 415, 422])
    assert.ok(submissionWasRejected({ status }));
  assert.ok(submissionWasRejected({ status: 409, code: "VERSION_CONFLICT" }));
  for (const status of [0, 200, 401, 403, 500, 502, 503])
    assert.equal(submissionWasRejected({ status }), false);
});

test("旧版超长答案与失败 pending 不丢失，反复刷新仍能完整恢复并缩短", () => {
  const text = "旧答案".repeat(30000);
  const pending = {
    key: id,
    body: {
      expectedVersion: 3,
      mode: "SCHEDULED",
      rating: "GOOD",
      hintUsed: true,
      answerMd: text,
    },
  };
  let result = readReviewSession(
    JSON.stringify({ ...session, answer: text, pending }),
    id,
    "scheduled",
    now,
  )!;
  assert.equal(result.answer, text);
  assert.equal(result.pending, null);
  assert.equal(result.hint, true);
  const snapshot = reviewSessionSnapshot(result);
  assert.equal(snapshot.answer, "");
  assert.equal(snapshot.recoveryAnswer, text);
  result = readReviewSession(JSON.stringify(snapshot), id, "scheduled", now)!;
  assert.equal(result.answer, text);
  const shortened = reviewSessionSnapshot({
    ...result,
    answer: "缩短后的答案",
  });
  assert.equal(shortened.recoveryAnswer, undefined);
  assert.equal(
    readReviewSession(JSON.stringify(shortened), id, "scheduled", now)!.answer,
    "缩短后的答案",
  );
});
