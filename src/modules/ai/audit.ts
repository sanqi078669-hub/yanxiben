import { randomUUID } from "node:crypto";
import { z } from "zod";
import { all, run, one, transaction } from "../../lib/db";
import { assert } from "../entries/service";
import { aiStatus } from "./provider";
import { aiUsage } from "./usage";
export { aiUsage } from "./usage";
import type { AiAuditRecord } from "../../lib/ai-audit-types";
import { estimate } from "./pricing";
function extras() {
  /* Schema is initialized centrally by lib/db. */
}
function init() {
  /* Schema is initialized centrally by lib/db. */
}
export async function audited<T>(
  owner: string,
  action: string,
  work: () => Promise<T>,
) {
  init();
  extras();
  const id = randomUUID(),
    started = Date.now(),
    created_at = new Date().toISOString(),
    config = aiStatus(owner),
    usage: NonNullable<ReturnType<typeof aiUsage.getStore>> = {
      tokens: null as number | null,
      input: null as number | null,
      output: null as number | null,
    };
  return aiUsage.run(usage, async () => {
    try {
      const result = await work();
      const cost =
        usage.cost === undefined
          ? estimate(
              owner,
              config.model,
              config.host,
              usage.input,
              usage.output,
            )
          : usage.cost;
      transaction(() => {
        run(
          "INSERT INTO ai_audit VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          id,
          owner,
          action,
          config.model,
          config.host,
          created_at,
          Date.now() - started,
          "success",
          usage.tokens,
          JSON.stringify(result),
          "",
        );
        run(
          "INSERT INTO ai_audit_extras VALUES(?,?,?)",
          id,
          owner,
          JSON.stringify({ cost }),
        );
      });
      return { ...result, audit: { id, model: config.model, created_at } };
    } catch (error) {
      transaction(() => {
        run(
          "INSERT INTO ai_audit VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          id,
          owner,
          action,
          config.model,
          config.host,
          created_at,
          Date.now() - started,
          "failed",
          usage.tokens,
          null,
          "",
        );
        const cost =
          usage.cost === undefined
            ? estimate(
                owner,
                config.model,
                config.host,
                usage.input,
                usage.output,
              )
            : usage.cost;
        run(
          "INSERT INTO ai_audit_extras VALUES(?,?,?)",
          id,
          owner,
          JSON.stringify({ cost }),
        );
      });
      throw error;
    }
  });
}
export function initAudit() {
  init();
  extras();
}
export function auditList(owner: string): AiAuditRecord[] {
  initAudit();
  return all(
    "SELECT a.*,x.payload extra FROM ai_audit a LEFT JOIN ai_audit_extras x ON x.id=a.id AND x.owner=a.owner WHERE a.owner=? ORDER BY a.created_at DESC LIMIT 100",
    owner,
  ).map((r) => ({
    id: r.id,
    action: r.action,
    model: r.model,
    host: r.host,
    created_at: r.created_at,
    duration: r.duration,
    status: r.status,
    tokens: r.tokens,
    feedback: r.feedback,
    result: r.result ? JSON.parse(r.result) : null,
    cost: r.extra ? JSON.parse(r.extra).cost : null,
  }));
}
export function auditFeedback(owner: string, raw: unknown) {
  init();
  const input = z
    .object({
      id: z.string().uuid(),
      feedback: z.string().trim().min(1).max(2000),
    })
    .strict()
    .parse(raw);
  assert(
    one("SELECT id FROM ai_audit WHERE id=? AND owner=?", input.id, owner),
    404,
    "NOT_FOUND",
    "建议记录不存在",
  );
  run(
    "UPDATE ai_audit SET feedback=? WHERE id=? AND owner=?",
    input.feedback,
    input.id,
    owner,
  );
  return true;
}
