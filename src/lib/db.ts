import { createClient, type Client } from "@libsql/client";
import path from "path";
import os from "os";
import type { Summary, SummaryTier, DashboardSettings, DEFAULT_SETTINGS } from "./types";

const DB_PATH = path.join(os.homedir(), ".claude", "claude-manager.db");

let _client: Client | null = null;

export function getDb(): Client {
  if (!_client) {
    _client = createClient({ url: `file:${DB_PATH}` });
    // Init is async but we call it eagerly
    initDb(_client);
  }
  return _client;
}

async function initDb(db: Client) {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS summaries (
      session_id TEXT NOT NULL,
      tier INTEGER NOT NULL,
      summary TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      message_count_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, tier)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      summary TEXT,
      color TEXT NOT NULL DEFAULT '#6366f1',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      PRIMARY KEY (group_id, session_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// ---- Summaries ----

export async function getSummary(
  sessionId: string,
  tier: SummaryTier
): Promise<Summary | null> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT * FROM summaries WHERE session_id = ? AND tier = ?",
    args: [sessionId, tier],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    sessionId: row.session_id as string,
    tier: row.tier as SummaryTier,
    summary: row.summary as string,
    generatedAt: row.generated_at as number,
    messageCountAt: row.message_count_at as number,
  };
}

export async function upsertSummary(summary: Summary): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO summaries (session_id, tier, summary, generated_at, message_count_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(session_id, tier) DO UPDATE SET
            summary = excluded.summary,
            generated_at = excluded.generated_at,
            message_count_at = excluded.message_count_at`,
    args: [
      summary.sessionId,
      summary.tier,
      summary.summary,
      summary.generatedAt,
      summary.messageCountAt,
    ],
  });
}

export async function getAllSummaries(
  sessionId: string
): Promise<Record<SummaryTier, string | null>> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT tier, summary FROM summaries WHERE session_id = ?",
    args: [sessionId],
  });
  const summaries: Record<number, string | null> = { 1: null, 2: null, 3: null };
  for (const row of result.rows) {
    summaries[row.tier as number] = row.summary as string;
  }
  return summaries as Record<SummaryTier, string | null>;
}

// ---- Groups ----

export async function getGroups() {
  const db = getDb();
  const groups = await db.execute("SELECT * FROM groups ORDER BY sort_order");
  const members = await db.execute("SELECT * FROM group_members");

  const memberMap = new Map<string, string[]>();
  for (const row of members.rows) {
    const gid = row.group_id as string;
    if (!memberMap.has(gid)) memberMap.set(gid, []);
    memberMap.get(gid)!.push(row.session_id as string);
  }

  return groups.rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    summary: row.summary as string | null,
    color: row.color as string,
    sortOrder: row.sort_order as number,
    sessionIds: memberMap.get(row.id as string) ?? [],
  }));
}

export async function createGroup(id: string, name: string, color: string) {
  const db = getDb();
  await db.execute({
    sql: "INSERT INTO groups (id, name, color) VALUES (?, ?, ?)",
    args: [id, name, color],
  });
}

export async function addSessionToGroup(groupId: string, sessionId: string) {
  const db = getDb();
  await db.execute({
    sql: "INSERT OR IGNORE INTO group_members (group_id, session_id) VALUES (?, ?)",
    args: [groupId, sessionId],
  });
}

export async function removeSessionFromGroup(groupId: string, sessionId: string) {
  const db = getDb();
  await db.execute({
    sql: "DELETE FROM group_members WHERE group_id = ? AND session_id = ?",
    args: [groupId, sessionId],
  });
}

// ---- Settings ----

export async function getSetting(key: string): Promise<string | null> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT value FROM settings WHERE key = ?",
    args: [key],
  });
  return result.rows.length > 0 ? (result.rows[0].value as string) : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [key, value],
  });
}
