import type { NextRequest, NextResponse } from "next/server";
import type { authenticated } from "../auth/session";
import type { readJson } from "./body";
export type PublicContext = {
  req: NextRequest;
  parts: string[];
  p: string;
  method: string;
  json: () => ReturnType<typeof readJson>;
  ok: (data: unknown) => NextResponse;
};
export type ApiContext = PublicContext & {
  owner: string;
  s: Awaited<ReturnType<typeof authenticated>>["session"];
};
export type ApiHandler = (context: ApiContext) => Promise<Response | undefined>;
