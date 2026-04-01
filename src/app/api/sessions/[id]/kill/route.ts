import { NextResponse } from "next/server";
import { scanSessions } from "@/lib/scanner";

export async function POST(
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

    if (session.status === "dead" || session.status === "completed") {
      return NextResponse.json(
        { error: "Session is not running" },
        { status: 400 }
      );
    }

    try {
      process.kill(session.pid, "SIGTERM");
    } catch (killError) {
      // ESRCH = process doesn't exist (already dead)
      if ((killError as NodeJS.ErrnoException).code === "ESRCH") {
        return NextResponse.json(
          { error: "Process already terminated" },
          { status: 410 }
        );
      }
      throw killError;
    }

    return NextResponse.json({ success: true, pid: session.pid });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to kill session ${id}:`, message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
