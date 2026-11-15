import { NextFunction, Request, Response } from 'express';
import { UserProfile, UserRole } from '../../shared/types.ts';
import { authService, SESSION_COOKIE_NAME } from '../services/AuthService.ts';

declare global {
  namespace Express {
    interface Request {
      user?: UserProfile | null;
    }
  }
}

/**
 * Extracts session token from cookie header or Authorization: Bearer <token>
 */
export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith(`${SESSION_COOKIE_NAME}=`)) {
        return cookie.slice(SESSION_COOKIE_NAME.length + 1).trim();
      }
    }
  }

  return null;
}

/**
 * Middleware that loads user session if present, or populates open admin if auth is disabled
 */
export function loadUserSession(req: Request, _res: Response, next: NextFunction): void {
  if (!authService.isAuthEnabled()) {
    req.user = {
      id: 'default-admin',
      username: 'admin',
      role: 'admin',
      createdAt: 0,
      updatedAt: 0,
    };
    return next();
  }

  const token = extractToken(req);
  if (token) {
    const user = authService.validateSession(token);
    if (user) {
      req.user = user;
    }
  }

  next();
}

/**
 * Role-based authorization middleware
 */
export function requireAuth(minRole: UserRole = 'listener') {
  return (req: Request, res: Response, next: NextFunction): void => {
    // If authentication is disabled in server settings, allow all requests as admin
    if (!authService.isAuthEnabled()) {
      req.user = {
        id: 'default-admin',
        username: 'admin',
        role: 'admin',
        createdAt: 0,
        updatedAt: 0,
      };
      return next();
    }

    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = authService.validateSession(token);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    req.user = user;

    if (minRole === 'admin' && user.role !== 'admin') {
      res.status(403).json({ error: 'Administrator permission required' });
      return;
    }

    if (minRole === 'curator' && user.role === 'listener') {
      res.status(403).json({ error: 'Curator permission required' });
      return;
    }

    next();
  };
}
