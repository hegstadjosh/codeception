const RECON = "http://localhost:3100";

async function proxyJson(res: Response): Promise<Response> {
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
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit") || "20";
    const params = new URLSearchParams({ limit });

    const res = await fetch(`${RECON}/api/manager/messages?${params}`);
    return proxyJson(res);
  } catch {
    return Response.json(
      { error: "Cannot reach recon serve at localhost:3100" },
      { status: 502 }
    );
  }
}
