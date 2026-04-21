export async function onRequest(context) {
  // Try to serve the actual static asset first
  const response = await context.next();
  if (response.status !== 404) return response;

  // Asset not found — fall back to SPA entry point
  return context.env.ASSETS.fetch(
    new Request(new URL("/editor/index.html", context.request.url))
  );
}
