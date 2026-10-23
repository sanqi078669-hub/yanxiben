import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "yanxi-statistics-"));
const {summarize,statisticsQuery,learningStatistics} = await import("../src/modules/review/statistics");
const {run} = await import("../src/lib/db");
const {defaults} = await import("../src/lib/model");
const {entrySchema} = await import("../src/lib/model");
const {createEntry,addReview,trashEntry,attempt} = await import("../src/modules/entries/service");
test("本次错因独立于题目标签，提交重试幂等且拒绝未知分类", () => {
  const owner = randomUUID();
  run("INSERT INTO users VALUES(?,?,?,?)",owner,owner,"hash",JSON.stringify(defaults));
  const entry = createEntry(owner,entrySchema.parse({type:"MATH",title:"错因验收",subject:"高等数学",body:"题目",errors:["概念"]}));
  const review = addReview(owner,entry.id,true);
  const body = {expectedVersion:review.version,mode:"PRACTICE",rating:"HARD",hintUsed:false,answerMd:"答案",errorCauses:["计算"]};
  const key = randomUUID();
  assert.deepEqual(attempt(owner,review.id,body,key),attempt(owner,review.id,body,key));
  assert.throws(()=>attempt(owner,review.id,{...body,errorCauses:["任意类别"]},randomUUID()));
  const stats = learningStatistics(owner,{from:"2000-01-01",to:"2099-12-31"});
  assert.equal(stats.total,1);
  const month = Object.values(stats.errorMonthly)[0];
  assert.equal(month.known,1); assert.equal(month.counts["计算"],1); assert.equal(month.counts["概念"],0);
});
test("自评统计区分提示和模式，去重，分母正确", () => {
  const row = {id:"1",entryId:"a",date:"2026-10-01",rating:"HARD",mode:"PRACTICE",hint:false};
  const result = summarize([row,row,{...row,id:"2",rating:"AGAIN"},{...row,id:"3",rating:"GOOD",hint:true},{...row,id:"4",rating:"GOOD",mode:"SCHEDULED"}]);
  assert.equal(result.total,4); assert.equal(result.independent,1); assert.equal(result.hints,1);
  assert.equal(result.repeated,1); assert.equal(result.repeatBase,3); assert.equal(result.practice,3);
  assert.equal(summarize([]).total,0);
  assert.throws(()=>statisticsQuery.parse({from:"2026-02-30",to:"2026-03-01"}));
  assert.throws(()=>statisticsQuery.parse({from:"2026-03-02",to:"2026-03-01"}));
});
test("错因快照按月聚合，旧日志保持未知，重复提交不增加标签计数", () => {
  const row = {id:"1",entryId:"a",date:"2026-10-01",rating:"HARD",mode:"PRACTICE",hint:false,errorCauses:["计算","计算","方法"]};
  const result = summarize([row,row,{...row,id:"2",errorCauses:undefined},{...row,id:"3",date:"2026-11-01",errorCauses:[]}]);
  assert.equal(result.errorMonthly["2026-10"].known,1);
  assert.equal(result.errorMonthly["2026-10"].unknown,1);
  assert.equal(result.errorMonthly["2026-10"].counts["计算"],1);
  assert.equal(result.errorMonthly["2026-10"].counts["方法"],1);
  assert.equal(result.errorMonthly["2026-11"].known,1);
  assert.equal(result.errorMonthly["2026-11"].counts["计算"],0);
});
test("统计筛选隔离账号和删除记录，不发送答案原文", () => {
  for(const owner of ["a","b"]) {
    run("INSERT INTO users VALUES(?,?,?,?)",owner,owner,"hash",JSON.stringify(defaults));
    for(const deleted of [false,true]) {
      const entry = createEntry(owner,entrySchema.parse({type:"MATH",title:"题目",subject:"高等数学",body:"body"}));
      const review = addReview(owner,entry.id,true);
      run("INSERT INTO logs VALUES(?,?,?,?,?,?,?,?)",randomUUID(),owner,review.id,"PRACTICE","GOOD","2026-10-01",JSON.stringify({answer:"不应返回的答案",hintUsed:false}),"2026-10-01T00:00:00Z");
      if(deleted)trashEntry(owner,entry.id);
    }
  }
  const result = learningStatistics("a",{from:"2026-10-01",to:"2026-10-31"});
  assert.equal(result.total,1);
  assert.ok(!JSON.stringify(result).includes("不应返回的答案"));
  assert.equal(learningStatistics("a",{from:"2026-10-02",to:"2026-10-31"}).total,0);
  assert.equal(learningStatistics("a",{from:"2026-10-01",to:"2026-10-31",mode:"SCHEDULED"}).total,0);
});
