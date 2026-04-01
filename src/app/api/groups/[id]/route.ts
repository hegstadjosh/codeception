import { NextResponse } from "next/server";
import {
  getDb,
  getGroups,
  addSessionToGroup,
  removeSessionFromGroup,
} from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { name, color, sessionIds } = body as {
      name?: string;
      color?: string;
      sessionIds?: string[];
    };

    const db = getDb();

    // Update name/color if provided
    if (name !== undefined) {
      await db.execute({
        sql: "UPDATE groups SET name = ? WHERE id = ?",
        args: [name, id],
      });
    }
    if (color !== undefined) {
      await db.execute({
        sql: "UPDATE groups SET color = ? WHERE id = ?",
        args: [color, id],
      });
    }

    // Sync session membership if provided
    if (sessionIds !== undefined) {
      // Get current members
      const currentMembers = await db.execute({
        sql: "SELECT session_id FROM group_members WHERE group_id = ?",
        args: [id],
      });
      const currentIds = new Set(
        currentMembers.rows.map((r) => r.session_id as string)
      );
      const newIds = new Set(sessionIds);

      // Remove sessions no longer in the list
      for (const sid of currentIds) {
        if (!newIds.has(sid)) {
          await removeSessionFromGroup(id, sid);
        }
      }

      // Add new sessions
      for (const sid of newIds) {
        if (!currentIds.has(sid)) {
          await addSessionToGroup(id, sid);
        }
      }
    }

    // Return updated group
    const groups = await getGroups();
    const updated = groups.find((g) => g.id === id);

    if (!updated) {
      return NextResponse.json(
        { error: "Group not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error(`Failed to update group ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to update group" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    // Delete group members first (FK cascade should handle this, but be explicit)
    await db.execute({
      sql: "DELETE FROM group_members WHERE group_id = ?",
      args: [id],
    });

    const result = await db.execute({
      sql: "DELETE FROM groups WHERE id = ?",
      args: [id],
    });

    if (result.rowsAffected === 0) {
      return NextResponse.json(
        { error: "Group not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`Failed to delete group ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to delete group" },
      { status: 500 }
    );
  }
}
