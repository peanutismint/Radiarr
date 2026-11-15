// Browser stand-in for Node's built-in `node:sqlite`, backed by sql.js (SQLite compiled to WebAssembly).
// Only the parts Radiarr uses are implemented: exec, prepare().run/get/all, close.
import type { Database, Statement } from 'sql.js';

let activeDb: Database | null = null;
let generation = 0;

/** Called by the demo service worker once sql.js has loaded (and again after a reset). */
export function setActiveDatabase(db: Database): void {
  activeDb = db;
  generation += 1;
}

export function getActiveDatabase(): Database {
  if (!activeDb) throw new Error('Demo database is not ready yet.');
  return activeDb;
}

type Param = string | number | null | Uint8Array;

function normalize(params: unknown[]): Param[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'bigint') return Number(p);
    if (typeof p === 'number' || typeof p === 'string') return p;
    if (p instanceof Uint8Array) return p;
    return String(p);
  });
}

class StatementSync {
  private stmt: Statement | null = null;
  private stmtGeneration = -1;

  constructor(private readonly sql: string) {}

  private compiled(): Statement {
    if (!this.stmt || this.stmtGeneration !== generation) {
      this.stmt = getActiveDatabase().prepare(this.sql);
      this.stmtGeneration = generation;
    }
    return this.stmt;
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const db = getActiveDatabase();
    const stmt = this.compiled();
    stmt.bind(normalize(params));
    while (stmt.step()) {
      // drain
    }
    stmt.reset();
    const changes = db.getRowsModified();
    const idRow = db.exec('SELECT last_insert_rowid()');
    const lastInsertRowid = Number(idRow[0]?.values[0]?.[0] ?? 0);
    return { changes, lastInsertRowid };
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    const stmt = this.compiled();
    stmt.bind(normalize(params));
    const row = stmt.step() ? (stmt.getAsObject() as Record<string, unknown>) : undefined;
    stmt.reset();
    return row;
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    const stmt = this.compiled();
    stmt.bind(normalize(params));
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
    stmt.reset();
    return rows;
  }
}

export class DatabaseSync {
  constructor(_path?: string) {}
  exec(sql: string): void {
    getActiveDatabase().exec(sql);
  }
  prepare(sql: string): StatementSync {
    return new StatementSync(sql);
  }
  close(): void {}
}
