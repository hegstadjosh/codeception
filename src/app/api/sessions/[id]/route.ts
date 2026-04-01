import { NextResponse } from "next/server";
import { scanSessions, getSessionMessages } from "@/lib/scanner";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const sessions = await scanSessions();
    const session = sessions.find((s) => s.id === id);

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    const messages = getSessionMessages(id, session.cwd);

    return NextResponse.json({ session, messages });
  } catch (error) {
    console.error(`Failed to get session ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to get session" },
      { status: 500 }
    );
  }
}
