import { NextResponse } from "next/server";
import { execSync } from "child_process";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  try {
    const body = await request.json();
    const { text } = body as { text: string };

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'text' field" },
        { status: 400 }
      );
    }

    // Escape single quotes for shell safety: replace ' with '\''
    const escaped = text.replace(/'/g, "'\\''");

    const output = execSync(
      `claude --resume ${sessionId} --print '${escaped}'`,
      { encoding: "utf-8", timeout: 120_000 }
    );

    return NextResponse.json({ success: true, output });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to reply to session ${sessionId}:`, message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
