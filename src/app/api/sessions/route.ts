import { NextResponse } from "next/server";
import { scanSessions } from "@/lib/scanner";

export async function GET() {
  try {
    const sessions = await scanSessions();
    return NextResponse.json(sessions);
  } catch (error) {
    console.error("Failed to scan sessions:", error);
    return NextResponse.json(
      { error: "Failed to scan sessions" },
      { status: 500 }
    );
  }
}
