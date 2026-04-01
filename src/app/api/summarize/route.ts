import { NextResponse } from "next/server";
import { getSessionMessages } from "@/lib/scanner";
import { summarizeSession } from "@/lib/summarizer";

/**
 * POST /api/summarize
 *
 * Force-regenerate summaries for a session.
 * Body: { sessionId: string, cwd: string }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionId?: string; cwd?: string };

    if (!body.sessionId || !body.cwd) {
      return NextResponse.json(
        { error: "Missing required fields: sessionId, cwd" },
        { status: 400 }
      );
    }

    const messages = getSessionMessages(body.sessionId, body.cwd);

    if (messages.length === 0) {
      return NextResponse.json(
        { error: "No messages found for this session" },
        { status: 404 }
      );
    }

    const summaries = await summarizeSession(
      body.sessionId,
      messages,
      messages.length,
      true // force regeneration
    );

    return NextResponse.json({
      sessionId: body.sessionId,
      ...summaries,
    });
  } catch (error) {
    console.error("Failed to summarize session:", error);
    return NextResponse.json(
      { error: "Failed to summarize session" },
      { status: 500 }
    );
  }
}
