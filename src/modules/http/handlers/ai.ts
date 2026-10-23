import sharp from "sharp";
import { z } from "zod";
import { assert } from "../../entries/service";
import { publicConfig, saveConfig } from "../../ai/config";
import { aiStatus, complete } from "../../ai/provider";
import { extract, limited, study } from "../../ai/service";
import { related, relatedPreview } from "../../ai/related";
import { diagnose, diagnosisPreview } from "../../ai/diagnosis";
import { audited, auditList, auditFeedback } from "../../ai/audit";
import { priceList, savePrice } from "../../ai/pricing";
import { budgetStatus } from "../../ai/budget";
import type { ApiContext } from "../context";
export async function aiHandler(context: ApiContext) {
  const { req, p, method, owner, json, ok } = context;
  if (p === "ai/history" && method === "GET") return ok(auditList(owner));
  if (p === "ai/budget" && method === "GET") return ok(budgetStatus(owner));
  if (p === "ai/prices" && method === "GET") return ok(priceList(owner));
  if (p === "ai/prices" && method === "POST")
    return ok(savePrice(owner, await json()));
  if (p === "ai/feedback" && method === "POST")
    return ok(auditFeedback(owner, await json()));
  if (
    method === "POST" &&
    ["ai/extract", "ai/study", "ai/related", "ai/diagnosis"].includes(p)
  ) {
    const target = req.headers.get("x-ai-target");
    assert(
      target === aiStatus(owner).target,
      409,
      "AI_TARGET_CHANGED",
      "模型配置已改变，请刷新页面并重新确认发送目标",
    );
  }
  if (p === "ai/config") {
    if (method === "GET") return ok(publicConfig(owner));
    if (method === "POST") return ok(saveConfig(owner, await json()));
  }
  if (p === "ai/status" && method === "GET") return ok(aiStatus(owner));
  if (p === "ai/test" && method === "POST") {
    const body = z
      .object({ vision: z.boolean().optional() })
      .strict()
      .parse(await json());
    if (body.vision) {
      const png = await sharp({
        create: {
          width: 48,
          height: 48,
          channels: 3,
          background: { r: 0, g: 0, b: 255 },
        },
      })
        .png()
        .toBuffer();
      return ok(
        await audited(owner, "图片能力测试", () =>
          limited(owner, () =>
            complete(
              '判断图片主色，只返回 {"color":"蓝色"}，若不是蓝色请返回实际颜色。',
              "固定测试色块，不含个人材料",
              z.object({ color: z.literal("蓝色") }),
              ["data:image/png;base64," + png.toString("base64")],
              fetch,
              owner,
            ),
          ),
        ),
      );
    }
    return ok(
      await audited(owner, "连接测试", () =>
        limited(owner, () =>
          complete(
            '返回 {"ok":true}。',
            "连接测试，不含学习资料",
            z.object({ ok: z.literal(true) }),
            [],
            fetch,
            owner,
          ),
        ),
      ),
    );
  }
  if (p === "ai/extract" && method === "POST") {
    const body = await json();
    return ok(await audited(owner, "图片识别", () => extract(owner, body)));
  }
  if (p === "ai/study" && method === "POST") {
    const body = await json();
    return ok(
      await audited(
        owner,
        "study:" +
          (typeof body.action === "string"
            ? body.action.slice(0, 40)
            : "unknown"),
        () => study(owner, body),
      ),
    );
  }
  if (p === "ai/related" && method === "GET")
    return ok(
      relatedPreview(
        owner,
        req.nextUrl.searchParams.get("entryId") || "",
        z
          .enum(["basic", "semantic"])
          .parse(req.nextUrl.searchParams.get("mode") || "basic"),
      ),
    );
  if (p === "ai/related" && method === "POST") {
    const body = await json();
    return ok(await audited(owner, "相似题比较", () => related(owner, body)));
  }
  if (p === "ai/diagnosis" && method === "GET")
    return ok(diagnosisPreview(owner));
  if (p === "ai/diagnosis" && method === "POST") {
    const body = await json();
    return ok(await audited(owner, "学习诊断", () => diagnose(owner, body)));
  }
}
