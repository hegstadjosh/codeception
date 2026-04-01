const RECON = "http://localhost:3100";

export async function GET() {
  try {
    const res = await fetch(`${RECON}/api/sessions/resumable`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json(
      { error: "Cannot reach recon serve at localhost:3100" },
      { status: 502 }
    );
  }
}
