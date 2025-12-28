/**
 * SQLite PII Storage Provider
 * Server-side persistence with dual-runtime support (Node.js + Bun)
 */

import type { EncryptedPIIMap } from "../types/index.js";
import type {
  PIIStorageProvider,
  PIIMapMetadata,
  StoredPIIMap,
  ListOptions,
} from "./types.js";

// ============================================================================
// Type Definitions for SQLite Drivers
// ============================================================================

/**
 * Minimal interface for SQLite database operations
 * Compatible with both better-sqlite3 and bun:sqlite
 */
interface SQLiteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SQLiteStatement;
  close(): void;
}

/**
 * Minimal interface for prepared statements
 * Compatible with both better-sqlite3 and bun:sqlite
 */
interface SQLiteStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/**
 * Row type for PII map storage
 */
interface PIIMapRow {
  conversation_id: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  entity_counts: string | null;
  model_version: string | null;
  created_at: number;
  updated_at: number | null;
}

// ============================================================================
// Runtime Detection
// ============================================================================

/**
 * Check if running in Bun runtime
 */
function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

/**
 * Load the appropriate SQLite driver based on runtime
 */
async function loadSQLiteDriver(dbPath: string): Promise<SQLiteDatabase> {
  if (isBun()) {
    // Bun: use built-in bun:sqlite
    // Use dynamic import with string to avoid TypeScript trying to resolve the module
    const bunSqlite = "bun:sqlite";
    const bunModule = (await import(/* @vite-ignore */ bunSqlite)) as { Database: new (path: string) => SQLiteDatabase };
    return new bunModule.Database(dbPath);
  } else {
    // Node.js: use better-sqlite3
    try {
      const betterSqlite3 = await import(/* @vite-ignore */ "better-sqlite3");
      const Database = betterSqlite3.default;
      return new Database(dbPath) as unknown as SQLiteDatabase;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("Cannot find module") ||
          error.message.includes("MODULE_NOT_FOUND"))
      ) {
        throw new Error(
          "SQLitePIIStorageProvider requires 'better-sqlite3' package on Node.js.\n" +
            "Install it with: npm install better-sqlite3\n" +
            "Note: On Bun, the built-in bun:sqlite is used automatically."
        );
      }
      throw error;
    }
  }
}

// ============================================================================
// SQLite Storage Provider
// ============================================================================

/**
 * SQLite implementation of PIIStorageProvider
 *
 * Works on both Node.js (using better-sqlite3) and Bun (using bun:sqlite).
 * The runtime is auto-detected, so no configuration is needed.
 *
 * @example
 * ```typescript
 * // Create with file path (works on both Node.js and Bun)
 * const storage = new SQLitePIIStorageProvider('./pii-maps.db');
 * await storage.initialize();
 *
 * // Or use in-memory database for testing
 * const storage = new SQLitePIIStorageProvider(':memory:');
 * await storage.initialize();
 *
 * await storage.save('conv-123', encryptedPiiMap, {
 *   createdAt: Date.now(),
 *   entityCounts: { PERSON: 2 }
 * });
 * ```
 */
export class SQLitePIIStorageProvider implements PIIStorageProvider {
  private db: SQLiteDatabase | null = null;
  private readonly dbPath: string;
  private initialized = false;

  /**
   * Create a new SQLite storage provider
   * @param dbPath - Path to SQLite database file, or ':memory:' for in-memory
   */
  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * Initialize the database connection and create tables
   * Must be called before using other methods
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.db = await loadSQLiteDriver(this.dbPath);

    // Create table and index
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pii_maps (
        conversation_id TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        entity_counts TEXT,
        model_version TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pii_maps_created_at 
      ON pii_maps(created_at)
    `);

    this.initialized = true;
  }

  /**
   * Ensure database is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized || this.db === null) {
      throw new Error(
        "SQLitePIIStorageProvider not initialized. Call initialize() first."
      );
    }
  }

  /**
   * Save an encrypted PII map
   */
  save(
    conversationId: string,
    piiMap: EncryptedPIIMap,
    metadata?: Partial<PIIMapMetadata>
  ): Promise<void> {
    try {
      this.ensureInitialized();
    } catch (error) {
      return Promise.reject(error);
    }

    const now = Date.now();

    // Check if entry exists to preserve createdAt
    // bun:sqlite returns null, better-sqlite3 returns undefined for no results
    const existing = this.db!.prepare(
      "SELECT created_at, entity_counts, model_version FROM pii_maps WHERE conversation_id = ?"
    ).get(conversationId) as Pick<PIIMapRow, "created_at" | "entity_counts" | "model_version"> | null | undefined;

    const createdAt = existing?.created_at ?? metadata?.createdAt ?? now;
    const existingEntityCounts = existing?.entity_counts;
    const entityCounts = metadata?.entityCounts ?? 
      (typeof existingEntityCounts === "string" && existingEntityCounts.length > 0 
        ? (JSON.parse(existingEntityCounts) as Record<string, number>) 
        : {});
    const modelVersion = metadata?.modelVersion ?? existing?.model_version ?? null;

    this.db!.prepare(`
      INSERT OR REPLACE INTO pii_maps 
      (conversation_id, ciphertext, iv, auth_tag, entity_counts, model_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      conversationId,
      piiMap.ciphertext,
      piiMap.iv,
      piiMap.authTag,
      JSON.stringify(entityCounts),
      modelVersion,
      createdAt,
      now
    );

    return Promise.resolve();
  }

  /**
   * Load an encrypted PII map
   */
  load(conversationId: string): Promise<StoredPIIMap | null> {
    try {
      this.ensureInitialized();
    } catch (error) {
      return Promise.reject(error);
    }

    const row = this.db!.prepare(
      "SELECT * FROM pii_maps WHERE conversation_id = ?"
    ).get(conversationId) as PIIMapRow | null | undefined;

    // bun:sqlite returns null, better-sqlite3 returns undefined for no results
    if (row == null) return Promise.resolve(null);

    const entityCountsRaw = row.entity_counts;
    return Promise.resolve({
      piiMap: {
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
      },
      metadata: {
        createdAt: row.created_at,
        updatedAt: row.updated_at ?? undefined,
        entityCounts: typeof entityCountsRaw === "string" && entityCountsRaw.length > 0 
          ? (JSON.parse(entityCountsRaw) as Record<string, number>) 
          : {},
        modelVersion: row.model_version ?? undefined,
      },
    });
  }

  /**
   * Delete a PII map
   */
  delete(conversationId: string): Promise<boolean> {
    try {
      this.ensureInitialized();
    } catch (error) {
      return Promise.reject(error);
    }

    const result = this.db!.prepare(
      "DELETE FROM pii_maps WHERE conversation_id = ?"
    ).run(conversationId);

    return Promise.resolve(result.changes > 0);
  }

  /**
   * Check if a PII map exists
   */
  exists(conversationId: string): Promise<boolean> {
    try {
      this.ensureInitialized();
    } catch (error) {
      return Promise.reject(error);
    }

    const row = this.db!.prepare(
      "SELECT 1 FROM pii_maps WHERE conversation_id = ?"
    ).get(conversationId);

    // bun:sqlite returns null, better-sqlite3 returns undefined for no results
    return Promise.resolve(row != null);
  }

  /**
   * List stored conversation IDs
   */
  list(options?: ListOptions): Promise<string[]> {
    try {
      this.ensureInitialized();
    } catch (error) {
      return Promise.reject(error);
    }

    let sql = "SELECT conversation_id FROM pii_maps";
    const params: unknown[] = [];

    if (options?.olderThan !== undefined) {
      sql += " WHERE created_at < ?";
      params.push(options.olderThan.getTime());
    }

    sql += " ORDER BY created_at DESC";

    if (options?.limit !== undefined && options.limit > 0) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = this.db!.prepare(sql).all(...params) as Array<{
      conversation_id: string;
    }>;

    return Promise.resolve(rows.map((row) => row.conversation_id));
  }

  /**
   * Delete entries older than the specified date
   */
  cleanup(olderThan: Date): Promise<number> {
    try {
      this.ensureInitialized();
    } catch (error) {
      return Promise.reject(error);
    }

    const result = this.db!.prepare(
      "DELETE FROM pii_maps WHERE created_at < ?"
    ).run(olderThan.getTime());

    return Promise.resolve(result.changes);
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db !== null) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }

  /**
   * Check if the provider is initialized
   */
  get isInitialized(): boolean {
    return this.initialized;
  }
}

