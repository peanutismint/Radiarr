import { ChevronDown, LogOut, Shield, ShieldAlert, User as UserIcon } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';

export function UserMenu() {
  const { user, authEnabled, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!authEnabled || !user) {
    return null;
  }

  const initials = user.username.slice(0, 2).toUpperCase();
  const roleBadgeStyle =
    user.role === 'admin'
      ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30'
      : user.role === 'curator'
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
        : 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30';

  const roleDescription =
    user.role === 'admin'
      ? 'Full Administrator'
      : user.role === 'curator'
        ? 'Station Curator'
        : 'Listener (Listen-Only)';

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 p-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-zinc-800 dark:text-zinc-200 text-xs font-medium transition cursor-pointer shadow-xs"
        title={`Signed in as ${user.username} (${user.role})`}
        aria-label={`User menu for ${user.username}`}
        aria-expanded={open}
      >
        <div className="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold tracking-tight shrink-0 select-none">
          {initials}
        </div>
        <ChevronDown className="w-3 h-3 text-zinc-400 mr-0.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-52 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl py-2 z-40 divide-y divide-zinc-100 dark:divide-zinc-800 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-3.5 py-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                {user.username}
              </span>
              <span
                className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wider ${roleBadgeStyle}`}
              >
                {user.role}
              </span>
            </div>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {roleDescription}
            </p>
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await logout();
              }}
              className="w-full px-3.5 py-2 text-left text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2 cursor-pointer transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
