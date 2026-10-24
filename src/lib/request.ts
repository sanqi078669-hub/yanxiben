/** Shared browser transport. Never display upstream HTML or raw response bodies. */
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public requestId = "",
  ) {
    super(
      requestId && !message.includes(requestId)
        ? `${message}（请求编号：${requestId}）`
        : message,
    );
    this.name = "RequestError";
  }
}
const identifier = (value: unknown) =>
  typeof value === "string" && /^[\w-]{1,200}$/.test(value) ? value : "";
type RequestOptions = RequestInit & { timeoutMs?: number };
const deadlines = new WeakMap<
  Response,
  { timeout: AbortSignal; caller?: AbortSignal | null }
>();
function checkCancellation(response: Response) {
  const deadline = deadlines.get(response);
  if (deadline?.caller?.aborted) throw deadline.caller.reason;
  if (deadline?.timeout.aborted) throw timeoutError();
}
const timeoutError = () =>
  new RequestError(
    "服务响应超时，结果尚未确认，请核对后重试",
    0,
    "REQUEST_TIMEOUT",
  );
export async function readEnvelope<T = any>(response: Response): Promise<T> {
  let body: any;
  const headerId = identifier(response.headers.get("x-request-id"));
  if (
    /\bapplication\/(?:[\w.-]+\+)?json\b/i.test(
      response.headers.get("content-type") || "",
    )
  ) {
    try {
      body = await response.json();
    } catch {
      checkCancellation(response);
      /* Invalid JSON is a protocol failure. */
    }
  }
  const requestId = identifier(body?.meta?.requestId) || headerId;
  if (!response.ok)
    throw new RequestError(
      typeof body?.error?.message === "string"
        ? body.error.message
        : `请求失败（HTTP ${response.status}），请稍后重试`,
      response.status,
      typeof body?.error?.code === "string" ? body.error.code : "HTTP_ERROR",
      requestId,
    );
  if (!body || typeof body !== "object" || !Object.hasOwn(body, "data"))
    throw new RequestError(
      "服务返回的数据格式无法读取，请重试",
      response.status,
      "INVALID_RESPONSE",
      requestId,
    );
  return body.data as T;
}
export async function requestResponse(
  path: string,
  options: RequestOptions = {},
) {
  const {
    timeoutMs = path.startsWith("ai/")
      ? 210000
      : path === "data/restore-preview"
        ? 180000
        : path === "exports"
          ? 150000
          : 30000,
    ...init
  } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  const headers = new Headers(init.headers);
  headers.set("X-Requested-With", "yanxiben");
  if (typeof init.body === "string" && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch("/api/v1/" + path, { ...init, headers, signal });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    if (timeout.aborted) throw timeoutError();
    throw new RequestError(
      "无法连接本地服务，请检查服务是否启动后重试",
      0,
      "NETWORK_ERROR",
    );
  }
  deadlines.set(response, { timeout, caller: init.signal });
  if (!response.ok) await readEnvelope(response);
  return response;
}
export async function request<T = any>(
  path: string,
  init: RequestOptions = {},
): Promise<T> {
  return readEnvelope<T>(await requestResponse(path, init));
}
export function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
  headers?: Record<string, string>,
): Promise<T> {
  return request<T>(path, {
    method: method || (body !== undefined ? "POST" : "GET"),
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
