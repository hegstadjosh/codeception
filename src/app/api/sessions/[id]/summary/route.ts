const RECON = "http://localhost:3100";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const res = await fetch(`${RECON}/api/sessions/${id}/summary`, {
      method: "DELETE",
    });
    const text = await res.text();
    try {
      return Response.json(JSON.parse(text), { status: res.status });
    } catch {
      return Response.json({ error: "non-JSON response" }, { status: 502 });
    }
  } catch {
    return Response.json(
      { error: "Cannot reach recon serve at localhost:3100" },
      { status: 502 }
    );
  }
}
