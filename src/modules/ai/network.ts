import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupAllOptions } from "node:dns";
import { request } from "node:https";
import { Readable } from "node:stream";
import { AppError } from "../entries/service";

const denied = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["192.88.99.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  denied.addSubnet(address, prefix, "ipv6");
export function publicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !denied.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !denied.check(address, "ipv6");
}
function blocked(): never {
  throw new AppError(
    400,
    "AI_TARGET_BLOCKED",
    "AI 接口必须指向公网 HTTPS 服务，不允许本机、私网或保留地址",
  );
}
export function publicTarget(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return blocked();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    blocked();
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (!hostname.includes(".") && !isIP(hostname))
  )
    blocked();
  if (isIP(hostname) && !publicAddress(hostname)) blocked();
  return url;
}
type Resolver = (
  hostname: string,
  options: LookupAllOptions,
) => Promise<LookupAddress[]>;
export async function resolvePublic(
  value: string,
  resolver: Resolver = lookup,
) {
  const url = publicTarget(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const answers = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolver(hostname, { all: true, verbatim: true });
  if (
    !answers.length ||
    answers.some((answer) => !publicAddress(answer.address))
  )
    blocked();
  return {
    url,
    address: answers[0].address,
    family: answers[0].family as 4 | 6,
  };
}
/** Resolve once, reject mixed public/private DNS, and pin the connection to that
 * address while retaining the original HTTPS hostname/certificate validation. */
export function createPublicTransport(
  resolver: Resolver = lookup,
  send = request,
): typeof fetch {
  return async (input, init) => {
    const value = String(input);
    const pending = resolvePublic(value, resolver),
      signal = init?.signal;
    const { url, address, family } = await new Promise<Awaited<typeof pending>>(
      (resolve, reject) => {
        const abort = () => reject(signal?.reason || new Error("aborted"));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        pending
          .then(resolve, reject)
          .finally(() => signal?.removeEventListener("abort", abort));
      },
    );
    init?.signal?.throwIfAborted();
    return new Promise<Response>((resolve, reject) => {
      const req = send(
        url,
        {
          method: init?.method || "POST",
          headers: Object.fromEntries(new Headers(init?.headers)),
          signal: init?.signal || undefined,
          agent: false,
          family,
          lookup: (_hostname, _options, callback) =>
            callback(null, address, family),
        },
        (res) => {
          if ((res.statusCode || 0) >= 300 && (res.statusCode || 0) < 400) {
            res.destroy();
            reject(
              new AppError(
                502,
                "AI_REDIRECT_BLOCKED",
                "AI 接口返回重定向，请核对服务商的最终接口地址",
              ),
            );
            return;
          }
          const headers = new Headers();
          for (let i = 0; i < res.rawHeaders.length; i += 2)
            headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
          resolve(
            new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, {
              status: res.statusCode || 502,
              headers,
            }),
          );
        },
      );
      req.once("error", reject);
      req.end(init?.body as string | undefined);
    });
  };
}
export const publicFetch = createPublicTransport();
