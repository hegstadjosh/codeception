const RECON = "http://localhost:3100";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path") || "~";
  try {
    const res = await fetch(`${RECON}/api/fs/list?path=${encodeURIComponent(path)}`);
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      return Response.json(data, { status: res.status });
    } catch {
      return Response.json(
        { error: `recon returned non-JSON (HTTP ${res.status})` },
        { status: 502 }
      );
    }
  } catch {
    return Response.json(
      { error: "Cannot reach recon serve at localhost:3100" },
      { status: 502 }
    );
  }
}
