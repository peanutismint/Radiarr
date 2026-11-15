import {
  Check,
  Edit2,
  KeyRound,
  Lock,
  Plus,
  Shield,
  ShieldAlert,
  Trash2,
  User,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import type { UserProfile, UserRole } from '../../shared/types.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../utils/apiInterceptor.ts';

export function UsersManagementTab() {
  const { user: currentUser, authEnabled, hasAdminUser, toggleAuth, setupInitialAdmin } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<UserProfile | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<UserProfile | null>(null);
  const [showEnableAuthModal, setShowEnableAuthModal] = useState(false);
  const [showDisableAuthModal, setShowDisableAuthModal] = useState(false);

  // Form states for Add/Edit
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('listener');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 3500);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!formUsername.trim() || !formPassword) {
      setFormError('Username and password are required.');
      return;
    }
    if (formPassword.length < 4) {
      setFormError('Password must be at least 4 characters.');
      return;
    }

    setFormSubmitting(true);
    try {
      const res = await apiFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formUsername.trim(),
          password: formPassword,
          role: formRole,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create user');
      }

      setShowAddModal(false);
      setFormUsername('');
      setFormPassword('');
      setFormRole('listener');
      await fetchUsers();
      showToast('User created successfully.');
    } catch (err: any) {
      setFormError(err.message || 'Failed to create user');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditModal) return;
    setFormError(null);

    setFormSubmitting(true);
    try {
      const payload: { role?: UserRole; password?: string } = {
        role: formRole,
      };
      if (formPassword.trim()) {
        if (formPassword.length < 4) {
          throw new Error('New password must be at least 4 characters.');
        }
        payload.password = formPassword;
      }

      const res = await apiFetch(`/api/users/${encodeURIComponent(showEditModal.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update user');
      }

      setShowEditModal(null);
      setFormPassword('');
      await fetchUsers();
      showToast('User updated successfully.');
    } catch (err: any) {
      setFormError(err.message || 'Failed to update user');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!showDeleteModal) return;
    setFormSubmitting(true);
    try {
      const res = await apiFetch(`/api/users/${encodeURIComponent(showDeleteModal.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete user');
      }
      setShowDeleteModal(null);
      await fetchUsers();
      showToast('User removed.');
    } catch (err: any) {
      setError(err.message || 'Failed to delete user');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleToggleAuthSystem = async (enable: boolean) => {
    if (enable) {
      if (!hasAdminUser && users.length === 0) {
        setShowEnableAuthModal(true);
        return;
      }
      try {
        await toggleAuth(true);
        showToast('Password protection enabled.');
      } catch (err: any) {
        setError(err.message || 'Failed to enable password protection');
      }
    } else {
      setShowDisableAuthModal(true);
    }
  };

  const handleConfirmEnableWithAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formUsername.trim() || !formPassword || formPassword.length < 4) {
      setFormError('Username and password (min 4 chars) are required.');
      return;
    }
    setFormSubmitting(true);
    try {
      await setupInitialAdmin(formUsername.trim(), formPassword);
      setShowEnableAuthModal(false);
      setFormUsername('');
      setFormPassword('');
      await fetchUsers();
      showToast('Administrator created and password protection enabled!');
    } catch (err: any) {
      setFormError(err.message || 'Failed to create administrator');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleConfirmDisableAuth = async () => {
    try {
      await toggleAuth(false);
      setShowDisableAuthModal(false);
      showToast('Password protection disabled. Open access enabled.');
    } catch (err: any) {
      setError(err.message || 'Failed to disable authentication');
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast */}
      {successToast && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between animate-in fade-in">
          <span>{successToast}</span>
          <button
            type="button"
            onClick={() => setSuccessToast(null)}
            className="p-1 text-emerald-600 hover:text-emerald-800 dark:text-emerald-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Security & Access Protection Card */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-500" />
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Password Protection &amp; Multi-User Access
              </h3>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xl">
              When enabled, users must log in with a username and password. You can create
              dedicated accounts for family members or listeners with restricted permissions.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleToggleAuthSystem(!authEnabled)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
              authEnabled
                ? 'bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 hover:bg-rose-100'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {authEnabled ? (
              <>
                <Lock className="w-3.5 h-3.5" />
                <span>Disable Protection</span>
              </>
            ) : (
              <>
                <Shield className="w-3.5 h-3.5" />
                <span>Enable Password Protection</span>
              </>
            )}
          </button>
        </div>

        {/* Roles overview pill banner */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
              Admin
            </span>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-300 font-medium pt-1">
              Full Administrator
            </p>
            <p className="text-[10px] text-zinc-400 leading-snug">
              Access to Player, Guide, Curation, Settings, Library Scans, Backups, and User Accounts.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
              Curator
            </span>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-300 font-medium pt-1">
              Station Curator
            </p>
            <p className="text-[10px] text-zinc-400 leading-snug">
              Can edit, reorder, duplicate, and regenerate stations. Settings and user accounts are hidden.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border border-zinc-500/30">
              Listener
            </span>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-300 font-medium pt-1">
              Listen-Only Access
            </p>
            <p className="text-[10px] text-zinc-400 leading-snug">
              Access to Now Playing and Guide only. Station "Edit" shortcuts and Curation are disabled.
            </p>
          </div>
        </div>
      </div>

      {/* Users List Section */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              User Accounts ({users.length})
            </h3>
          </div>

          <button
            type="button"
            onClick={() => {
              setFormUsername('');
              setFormPassword('');
              setFormRole('listener');
              setFormError(null);
              setShowAddModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add User</span>
          </button>
        </div>

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {users.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
              No user accounts created yet.
            </div>
          ) : (
            users.map((u) => {
              const isSelf = currentUser?.id === u.id;
              const roleBadge =
                u.role === 'admin'
                  ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30'
                  : u.role === 'curator'
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                    : 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30';

              return (
                <div
                  key={u.id}
                  className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                      {u.username.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {u.username}
                        </span>
                        <span
                          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wider ${roleBadge}`}
                        >
                          {u.role}
                        </span>
                        {isSelf && (
                          <span className="text-[10px] text-zinc-400 font-medium">
                            (You)
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        Created {new Date(u.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEditModal(u);
                        setFormRole(u.role);
                        setFormPassword('');
                        setFormError(null);
                      }}
                      className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs transition cursor-pointer"
                      title="Edit role or change password"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      disabled={isSelf}
                      onClick={() => setShowDeleteModal(u)}
                      className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      title={isSelf ? 'Cannot delete your own account' : 'Delete user'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal: Add User */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowAddModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <User className="w-4 h-4 text-indigo-500" />
                <span>Add User Account</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3.5">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Username
                </label>
                <input
                  type="text"
                  required
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  placeholder="e.g. sarah"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder="Min 4 characters"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  User Role
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['listener', 'curator', 'admin'] as UserRole[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setFormRole(r)}
                      className={`p-2 rounded-xl border text-left cursor-pointer transition ${
                        formRole === r
                          ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                          : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      <div className="text-xs font-semibold capitalize">{r}</div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">
                        {r === 'admin'
                          ? 'Full Control'
                          : r === 'curator'
                            ? 'Edit Stations'
                            : 'Listen-Only'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs disabled:opacity-50"
                >
                  {formSubmitting ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit User */}
      {showEditModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowEditModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Edit User: {showEditModal.username}
              </h3>
              <button
                type="button"
                onClick={() => setShowEditModal(null)}
                className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
                {formError}
              </div>
            )}

            <form onSubmit={handleUpdateUser} className="space-y-3.5">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Role
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['listener', 'curator', 'admin'] as UserRole[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setFormRole(r)}
                      className={`p-2 rounded-xl border text-left cursor-pointer transition ${
                        formRole === r
                          ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                          : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      <div className="text-xs font-semibold capitalize">{r}</div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">
                        {r === 'admin'
                          ? 'Full Control'
                          : r === 'curator'
                            ? 'Edit Stations'
                            : 'Listen-Only'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Reset Password{' '}
                  <span className="text-zinc-400 font-normal">
                    (leave blank to keep current password)
                  </span>
                </label>
                <input
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder="New password (optional)"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowEditModal(null)}
                  className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs disabled:opacity-50"
                >
                  {formSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete User */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowDeleteModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Delete User Account?
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  Are you sure you want to delete account <strong>"{showDeleteModal.username}"</strong>?
                  Active sessions for this account will be invalidated immediately.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowDeleteModal(null)}
                className="px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteUser()}
                disabled={formSubmitting}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-xs disabled:opacity-50"
              >
                {formSubmitting ? 'Deleting...' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Enable Auth Initial Admin Setup */}
      {showEnableAuthModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowEnableAuthModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-2xl space-y-4"
          >
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Shield className="w-4 h-4 text-indigo-500" />
                <span>Create Administrator Account</span>
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                To enable password protection, define your primary Administrator credentials.
              </p>
            </div>

            {formError && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
                {formError}
              </div>
            )}

            <form onSubmit={handleConfirmEnableWithAdmin} className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Admin Username
                </label>
                <input
                  type="text"
                  required
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Admin Password
                </label>
                <input
                  type="password"
                  required
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder="Min 4 characters"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowEnableAuthModal(false)}
                  className="px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs disabled:opacity-50"
                >
                  {formSubmitting ? 'Enabling...' : 'Enable Password Protection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirm Disable Auth */}
      {showDisableAuthModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowDisableAuthModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Disable Password Protection?
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  Turning off password protection will allow any device or browser on your network
                  to access all stations, curation controls, and server settings without logging in.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowDisableAuthModal(false)}
                className="px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200"
              >
                Keep Protection
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDisableAuth()}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-xs"
              >
                Disable Protection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
