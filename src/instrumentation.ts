export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { pathToFileURL } = await import("node:url");
    const { resolve } = await import("node:path");
    // Runtime modules, like the existing export worker, are built separately.
    // Keep private directory scans out of Next's instrumentation file tracing.
    const location = pathToFileURL(resolve("runtime/export-cleanup.mjs")).href;
    const { startExportCacheCleanup } = await import(
      /* turbopackIgnore: true */ location
    );
    startExportCacheCleanup();
  }
}
