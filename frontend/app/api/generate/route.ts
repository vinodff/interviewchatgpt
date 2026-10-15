// Legacy browser generation is disabled. Authorized live generation is handled
// exclusively by the authenticated backend WebSocket session.
export function POST() {
  return Response.json(
    { detail: "Legacy browser generation is disabled. Start an authorized live session through the backend." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
