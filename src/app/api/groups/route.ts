import { NextResponse } from "next/server";
import { getGroups, createGroup } from "@/lib/db";

export async function GET() {
  try {
    const groups = await getGroups();
    return NextResponse.json(groups);
  } catch (error) {
    console.error("Failed to get groups:", error);
    return NextResponse.json(
      { error: "Failed to get groups" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, color } = body as { name: string; color: string };

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'name' field" },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    const groupColor = color || "#6366f1";

    await createGroup(id, name, groupColor);

    return NextResponse.json(
      { id, name, color: groupColor, summary: null, sortOrder: 0, sessionIds: [] },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create group:", error);
    return NextResponse.json(
      { error: "Failed to create group" },
      { status: 500 }
    );
  }
}
