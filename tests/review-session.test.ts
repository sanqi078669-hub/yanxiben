import { test } from "node:test";
import assert from "node:assert/strict";
import { readReviewSession } from "../src/lib/review-session";
const id = "00000000-0000-4000-8000-000000000001";
const now = Date.now();
const session = {owner:id, scope:"scheduled", updated:now, reviewId:id, entryId:id, title:"题目", version:3,
  mode:"SCHEDULED", answer:"未提交的推导", revealed:true, hint:false, aiHint:true, rating:"EASY", key:id, pending:null};
test("复习中断恢复保留答案与提示限制，隔离账号和练习范围", () => {
  const result = readReviewSession(JSON.stringify(session),id,"scheduled",now)!;
  assert.equal(result.answer,session.answer);
  assert.equal(result.hint,true); assert.equal(result.rating,"GOOD");
  assert.equal(readReviewSession(JSON.stringify(session),id,"practice",now),null);
  assert.equal(readReviewSession(JSON.stringify(session),id.replace(/1$/, "2"),"scheduled",now),null);
  assert.equal(readReviewSession(JSON.stringify(session),id,"scheduled",now+8*86400000),null);
  assert.equal(readReviewSession("broken",id,"scheduled",now),null);
});
test("中断提交保持原请求标识、旧版本与请求正文，避免恢复后制造新提交", () => {
  const pending = {key:id, body:{expectedVersion:3,mode:"SCHEDULED",rating:"GOOD",hintUsed:true,answerMd:"答案"}};
  const result = readReviewSession(JSON.stringify({...session, pending}),id,"scheduled",now)!;
  assert.deepEqual(result.pending,pending);
  assert.equal(result.version,3);
});
