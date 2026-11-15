import { Router } from 'express';
import { extractToken, requireAuth } from '../middleware/authMiddleware.ts';
import { authService, SESSION_COOKIE_NAME } from '../services/AuthService.ts';

const authRouter = Router();

/**
 * Returns current auth system status (enabled or disabled, admin existence, current user)
 */
authRouter.get('/status', (req, res) => {
  const authEnabled = authService.isAuthEnabled();
  const hasAdminUser = authService.getAdminCount() > 0;
  const token = extractToken(req);
  const user = token ? authService.validateSession(token) : null;

  res.json({
    authEnabled,
    hasAdminUser,
    user: authEnabled ? user : { id: 'default-admin', username: 'admin', role: 'admin', createdAt: 0, updatedAt: 0 },
  });
});

/**
 * Login with username and password
 */
authRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  const result = authService.authenticateUser(username, password);
  if (!result) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  // Set session cookie (30 days) with cross-site iframe support when on HTTPS
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(SESSION_COOKIE_NAME, result.token, {
    httpOnly: true,
    sameSite: isSecure ? 'none' : 'lax',
    secure: Boolean(isSecure),
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.json({
    success: true,
    user: result.user,
    token: result.token,
  });
});

/**
 * Logout and clear session
 */
authRouter.post('/logout', (req, res) => {
  const token = extractToken(req);
  if (token) {
    authService.deleteSession(token);
  }

  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.json({ success: true });
});

/**
 * Return current session info
 */
authRouter.get('/me', (req, res) => {
  const authEnabled = authService.isAuthEnabled();
  if (!authEnabled) {
    res.json({
      authEnabled: false,
      user: { id: 'default-admin', username: 'admin', role: 'admin', createdAt: 0, updatedAt: 0 },
    });
    return;
  }

  const token = extractToken(req);
  const user = token ? authService.validateSession(token) : null;
  res.json({
    authEnabled: true,
    user,
  });
});

/**
 * First-time setup: Create initial Administrator account and enable authentication
 */
authRouter.post('/setup-initial-admin', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  // Only allowed if no admin exists yet
  if (authService.getAdminCount() > 0) {
    res.status(400).json({ error: 'An administrator account already exists' });
    return;
  }

  try {
    const admin = authService.createUser(username, password, 'admin');
    authService.setAuthEnabled(true);
    const session = authService.createSession(admin.id);

    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie(SESSION_COOKIE_NAME, session.token, {
      httpOnly: true,
      sameSite: isSecure ? 'none' : 'lax',
      secure: Boolean(isSecure),
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      user: admin,
      token: session.token,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create administrator' });
  }
});

/**
 * Toggle authentication on or off (Admin only)
 */
authRouter.put('/toggle', requireAuth('admin'), (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'Field "enabled" must be a boolean' });
    return;
  }

  if (enabled && authService.getAdminCount() === 0) {
    res.status(400).json({ error: 'Cannot enable authentication without at least one administrator account' });
    return;
  }

  authService.setAuthEnabled(enabled);
  res.json({ success: true, authEnabled: enabled });
});

export { authRouter };
