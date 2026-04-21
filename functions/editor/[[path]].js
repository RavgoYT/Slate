export async function onRequest(context) {
  // Directly look up the static asset (no SPA fallback)
  const response = await context.env.ASSETS.fetch(context.request);
  if (response.status !== 404) return response;

  // Asset not found — fall back to SPA entry point
  return context.env.ASSETS.fetch(
    new Request(new URL("/editor/index.html", context.request.url))
  );
}
