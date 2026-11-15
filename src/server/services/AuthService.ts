import crypto from 'node:crypto';
import { UserProfile, UserRole } from '../../shared/types.ts';
import { db } from '../db/index.ts';

const SESSION_COOKIE_NAME = 'radiarr_session';
const DEFAULT_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class AuthService {
  /**
   * Hashes a password using crypto.scryptSync with a cryptographically secure random salt
   */
  hashPassword(password: string, existingSalt?: string): { hash: string; salt: string } {
    const salt = existingSalt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { hash, salt };
  }

  /**
   * Constant-time password verification
   */
  verifyPassword(password: string, storedHash: string, salt: string): boolean {
    const computedHash = crypto.scryptSync(password, salt, 64).toString('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(storedHash, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Check whether authentication is currently enabled in server settings
   */
  isAuthEnabled(): boolean {
    const row = db.prepare(`SELECT value_json FROM settings WHERE key = 'auth_enabled'`).get() as
      | { value_json: string }
      | undefined;
    if (!row) return false;
    try {
      return JSON.parse(row.value_json) === true;
    } catch {
      return false;
    }
  }

  /**
   * Toggle global authentication on or off
   */
  setAuthEnabled(enabled: boolean): void {
    db.prepare(
      `INSERT INTO settings (key, value_json) VALUES ('auth_enabled', ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
    ).run(JSON.stringify(enabled));
  }

  /**
   * Count total registered users
   */
  getUserCount(): number {
    const row = db.prepare(`SELECT COUNT(*) as count FROM users`).get() as { count: number };
    return row?.count || 0;
  }

  /**
   * Count active admin users
   */
  getAdminCount(): number {
    const row = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'admin'`).get() as {
      count: number;
    };
    return row?.count || 0;
  }

  /**
   * List all user profiles (excluding password hash & salt)
   */
  listUsers(): UserProfile[] {
    const rows = db
      .prepare(`SELECT id, username, role, created_at, updated_at FROM users ORDER BY created_at ASC`)
      .all() as Array<{
      id: string;
      username: string;
      role: UserRole;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      role: r.role,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Fetch a single user profile by ID
   */
  getUserById(id: string): UserProfile | null {
    const row = db
      .prepare(`SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?`)
      .get(id) as
      | {
          id: string;
          username: string;
          role: UserRole;
          created_at: number;
          updated_at: number;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Create a new user with specified role
   */
  createUser(username: string, rawPassword: string, role: UserRole = 'listener'): UserProfile {
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      throw new Error('Username cannot be empty');
    }
    if (trimmedUsername.length < 2) {
      throw new Error('Username must be at least 2 characters long');
    }
    if (!rawPassword || rawPassword.length < 4) {
      throw new Error('Password must be at least 4 characters long');
    }

    const validRoles: UserRole[] = ['admin', 'curator', 'listener'];
    if (!validRoles.includes(role)) {
      throw new Error(`Invalid role '${role}'`);
    }

    const existing = db
      .prepare(`SELECT id FROM users WHERE lower(username) = lower(?)`)
      .get(trimmedUsername);
    if (existing) {
      throw new Error(`Username '${trimmedUsername}' is already taken`);
    }

    const { hash, salt } = this.hashPassword(rawPassword);
    const id = crypto.randomUUID();
    const now = Date.now();

    db.prepare(
      `INSERT INTO users (id, username, password_hash, salt, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, trimmedUsername, hash, salt, role, now, now);

    return {
      id,
      username: trimmedUsername,
      role,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Update an existing user
   */
  updateUser(
    id: string,
    updates: { username?: string; password?: string; role?: UserRole }
  ): UserProfile {
    const user = this.getUserById(id);
    if (!user) {
      throw new Error('User not found');
    }

    const now = Date.now();

    if (updates.username && updates.username.trim() !== user.username) {
      const trimmed = updates.username.trim();
      const existing = db
        .prepare(`SELECT id FROM users WHERE lower(username) = lower(?) AND id != ?`)
        .get(trimmed, id);
      if (existing) {
        throw new Error(`Username '${trimmed}' is already in use`);
      }
      db.prepare(`UPDATE users SET username = ?, updated_at = ? WHERE id = ?`).run(
        trimmed,
        now,
        id
      );
      user.username = trimmed;
    }

    if (updates.role && updates.role !== user.role) {
      // Prevent demoting the last admin
      if (user.role === 'admin' && updates.role !== 'admin' && this.getAdminCount() <= 1) {
        throw new Error('Cannot change the role of the only administrator');
      }
      db.prepare(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`).run(
        updates.role,
        now,
        id
      );
      user.role = updates.role;
    }

    if (updates.password) {
      if (updates.password.length < 4) {
        throw new Error('Password must be at least 4 characters long');
      }
      const { hash, salt } = this.hashPassword(updates.password);
      db.prepare(
        `UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?`
      ).run(hash, salt, now, id);
      // Invalidate existing sessions on password change
      this.deleteUserSessions(id);
    }

    user.updatedAt = now;
    return user;
  }

  /**
   * Delete a user by ID
   */
  deleteUser(id: string, currentAdminId?: string): void {
    const user = this.getUserById(id);
    if (!user) {
      throw new Error('User not found');
    }

    if (currentAdminId && currentAdminId === id) {
      throw new Error('You cannot delete your own active administrator account');
    }

    if (user.role === 'admin' && this.getAdminCount() <= 1) {
      throw new Error('Cannot delete the only administrator account');
    }

    db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    this.deleteUserSessions(id);
  }

  /**
   * Authenticate a username + password
   */
  authenticateUser(
    username: string,
    rawPassword: string
  ): { user: UserProfile; token: string; expiresAt: number } | null {
    const row = db
      .prepare(`SELECT id, username, password_hash, salt, role, created_at, updated_at FROM users WHERE lower(username) = lower(?)`)
      .get(username.trim()) as
      | {
          id: string;
          username: string;
          password_hash: string;
          salt: string;
          role: UserRole;
          created_at: number;
          updated_at: number;
        }
      | undefined;

    if (!row) return null;

    const matches = this.verifyPassword(rawPassword, row.password_hash, row.salt);
    if (!matches) return null;

    const session = this.createSession(row.id);

    return {
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Create a new session for a user
   */
  createSession(userId: string, durationMs = DEFAULT_SESSION_DURATION_MS): { token: string; expiresAt: number } {
    this.cleanupExpiredSessions();
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = now + durationMs;

    db.prepare(
      `INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
    ).run(token, userId, expiresAt, now);

    return { token, expiresAt };
  }

  /**
   * Validate a session token
   */
  validateSession(token: string): UserProfile | null {
    if (!token) return null;

    const row = db
      .prepare(
        `SELECT u.id, u.username, u.role, u.created_at, u.updated_at, s.expires_at
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.token = ?`
      )
      .get(token) as
      | {
          id: string;
          username: string;
          role: UserRole;
          created_at: number;
          updated_at: number;
          expires_at: number;
        }
      | undefined;

    if (!row) return null;

    if (Date.now() > row.expires_at) {
      this.deleteSession(token);
      return null;
    }

    return {
      id: row.id,
      username: row.username,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Delete a session
   */
  deleteSession(token: string): void {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  }

  /**
   * Delete all sessions for a specific user
   */
  deleteUserSessions(userId: string): void {
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  }

  /**
   * Remove expired sessions
   */
  cleanupExpiredSessions(): void {
    const now = Date.now();
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(now);
  }
}

export const authService = new AuthService();
export { SESSION_COOKIE_NAME };
