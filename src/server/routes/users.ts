import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.ts';
import { authService } from '../services/AuthService.ts';

const usersRouter = Router();

// All user management routes require 'admin' role
usersRouter.use(requireAuth('admin'));

/**
 * List all users
 */
usersRouter.get('/', (_req, res) => {
  const users = authService.listUsers();
  res.json({ users });
});

/**
 * Create a new user (admin, curator, or listener)
 */
usersRouter.post('/', (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  try {
    const user = authService.createUser(username, password, role || 'listener');
    res.status(201).json({ success: true, user });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create user' });
  }
});

/**
 * Update an existing user's role, username, or password
 */
usersRouter.put('/:id', (req, res) => {
  const { id } = req.params;
  const { username, password, role } = req.body || {};

  try {
    const updated = authService.updateUser(id, { username, password, role });
    res.json({ success: true, user: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update user' });
  }
});

/**
 * Delete a user
 */
usersRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  const currentAdminId = req.user?.id;

  try {
    authService.deleteUser(id, currentAdminId);
    res.json({ success: true, deletedId: id });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to delete user' });
  }
});

export { usersRouter };
