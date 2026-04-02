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
    const page = searchParams.get("page") || "1";
    const limit = searchParams.get("limit") || "50";
    const status = searchParams.get("status") || "";

    const params = new URLSearchParams({ page, limit });
    if (status) params.set("status", status);

    const res = await fetch(`${RECON}/api/sessions?${params}`);
    return proxyJson(res);
  } catch {
    return Response.json(
      { error: "Cannot reach recon serve at localhost:3100" },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${RECON}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return proxyJson(res);
  } catch {
    return Response.json(
      { error: "Cannot reach recon serve at localhost:3100" },
      { status: 502 }
    );
  }
}
