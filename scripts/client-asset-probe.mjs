// Local QA reverse proxy: records only static asset paths and byte counts.
// Browser interactions remain manual or through the browser automation tool.
import { createServer, request } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
const port = Number(process.env.PROBE_PORT || 3130),
  upstream = Number(process.env.PROBE_UPSTREAM_PORT || 3128);
if (
  ![port, upstream].every((p) => Number.isInteger(p) && p >= 1024 && p <= 65535)
)
  throw Error("Invalid QA port");
const heavy = readdirSync(".next/static/chunks").filter(
  (name) =>
    name.endsWith(".js") &&
    /KaTeX parse error|react-markdown/.test(
      readFileSync(".next/static/chunks/" + name, "utf8"),
    ),
);
const assets = [];
let failuresLeft = Number(process.env.PROBE_FAIL_ATTEMPTS || 0);
if (!Number.isInteger(failuresLeft) || failuresLeft < 0 || failuresLeft > 5)
  throw Error("Invalid QA fault count");
const attempts = [];
mkdirSync("test-results", { recursive: true });
createServer((incoming, outgoing) => {
  const pathname = new URL(incoming.url, "http://127.0.0.1").pathname;
  if (
    incoming.method === "POST" &&
    /^\/api\/v1\/review-items\/[^/]+\/attempts$/.test(pathname)
  ) {
    const simulatedFailure = failuresLeft > 0;
    if (simulatedFailure) failuresLeft--;
    attempts.push({
      simulatedFailure,
      keyHash: createHash("sha256")
        .update(String(incoming.headers["idempotency-key"] || ""))
        .digest("hex"),
    });
    writeFileSync(
      "test-results/fix12-pending-requests.json",
      JSON.stringify(attempts, null, 2),
    );
    if (simulatedFailure) {
      incoming.resume();
      outgoing.writeHead(503, { "Content-Type": "text/html" });
      outgoing.end("<h1>Synthetic QA outage</h1>");
      return;
    }
  }
  const proxy = request(
    {
      hostname: "127.0.0.1",
      port: upstream,
      path: incoming.url,
      method: incoming.method,
      headers: incoming.headers,
    },
    (response) => {
      outgoing.writeHead(response.statusCode, response.headers);
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
      });
      response.on("end", () => {
        if (
          pathname.startsWith("/_next/static/") &&
          /\.(js|css|woff2?)$/.test(pathname)
        ) {
          assets.push({
            pathname,
            status: response.statusCode,
            bytes,
            heavy: heavy.some((name) => pathname.endsWith("/" + name)),
          });
          writeFileSync(
            "test-results/fix11-browser-assets.json",
            JSON.stringify(
              {
                timestamp: new Date().toISOString(),
                heavyChunks: heavy,
                assets,
              },
              null,
              2,
            ),
          );
        }
      });
      response.pipe(outgoing);
    },
  );
  proxy.on("error", () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end("QA upstream unavailable");
  });
  incoming.pipe(proxy);
  outgoing.on("close", () => proxy.destroy());
}).listen(port, "127.0.0.1", () =>
  console.log(`QA asset probe http://127.0.0.1:${port} -> ${upstream}`),
);
