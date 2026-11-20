import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { db, DEMO_EMAIL, getUserById, newId } from '../db';
import type { User } from '../../src/shared/types';

export const SESSION_COOKIE = 'frameflow_session';

export interface AuthedRequest extends Request {
  user?: User;
}

export function createSession(userId: string): string {
  const token = crypto.randomBytes(24).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 14); // 14 days
  db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).run(token, userId, expires.toISOString(), now.toISOString());
  return token;
}

function isSecureRequest(req: Request): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return req.secure || forwardedProto === 'https';
}

export function extractSessionToken(req: Request): string | null {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim();
  }
  const queryToken = req.query?.token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }
  return null;
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const secure = isSecureRequest(req);
  const options: Record<string, unknown> = {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 14,
  };
  if (secure) {
    options.partitioned = true;
  }
  res.cookie(SESSION_COOKIE, token, options);
}

export function clearSessionCookie(req: Request, res: Response): void {
  const token = extractSessionToken(req);
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  const secure = isSecureRequest(req);
  const options: Record<string, unknown> = {
    path: '/',
    sameSite: secure ? 'none' : 'lax',
    secure,
  };
  if (secure) {
    options.partitioned = true;
  }
  res.clearCookie(SESSION_COOKIE, options);
}

export function resolveSessionUser(req: Request): User | null {
  const token = extractSessionToken(req);
  if (!token) return null;
  const session = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
    .get(token) as { user_id: string; expires_at: string } | undefined;
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return getUserById(session.user_id);
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const user = resolveSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  req.user = user;
  next();
}

export function registerUser(email: string, name: string, password: string): { user?: User; error?: string } {
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { error: 'Please enter a valid email address.' };
  }
  if (cleanName.length < 2) {
    return { error: 'Please enter your name (at least 2 characters).' };
  }
  if (password.length < 6) {
    return { error: 'Password must be at least 6 characters.' };
  }

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (exists) {
    return { error: 'An account with that email already exists.' };
  }

  const id = newId('usr');
  const now = new Date().toISOString();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, cleanEmail, cleanName, hash, 'Editor', now);

  return {
    user: { id, email: cleanEmail, name: cleanName, role: 'Editor', createdAt: now },
  };
}

export function authenticateUser(email: string, password: string): { user?: User; error?: string } {
  const cleanEmail = email.trim().toLowerCase();
  const row = db
    .prepare('SELECT id, email, name, password_hash, role, created_at FROM users WHERE email = ?')
    .get(cleanEmail) as Record<string, unknown> | undefined;

  if (!row || !bcrypt.compareSync(password, String(row.password_hash))) {
    return { error: 'Invalid email or password.' };
  }

  return {
    user: {
      id: String(row.id),
      email: String(row.email),
      name: String(row.name),
      role: String(row.role),
      createdAt: String(row.created_at),
    },
  };
}

export function getDemoUser(): User | null {
  const row = db
    .prepare('SELECT id, email, name, role, created_at FROM users WHERE email = ?')
    .get(DEMO_EMAIL) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: String(row.role),
    createdAt: String(row.created_at),
  };
}

export function assertProjectOwnership(projectId: string, userId: string): Record<string, unknown> | null {
  const row = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId) as Record<string, unknown> | undefined;
  return row || null;
}
