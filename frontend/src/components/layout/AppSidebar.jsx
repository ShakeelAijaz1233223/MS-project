import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home,
  Globe2,
  History,
  Heart,
  Settings,
  PlaySquare,
  Disc3,
  UserPlus,
  LogIn,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

export function AppSidebar() {
  const location = useLocation();
  const { favorites, downloadQueue, user } = useApp();

  const items = [
    { to: '/', label: 'Home & Analyzer', icon: Home },
    { to: '/albums', label: 'Album & Mix Search', icon: Disc3 },
    { to: '/sites', label: 'Supported Sites', icon: Globe2 },
    { to: '/player', label: 'Built-in Player', icon: PlaySquare },
    { to: '/downloads', label: 'Download History', icon: History, badge: downloadQueue.length },
    { to: '/favorites', label: 'Favorites', icon: Heart, badge: favorites.length },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="hidden xl:flex flex-col w-60 shrink-0 ud-card p-3.5 h-fit sticky top-20">
      <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        Workspace Menu
      </p>
      <div className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                active
                  ? 'bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 text-white shadow-[0_8px_20px_rgba(124,58,237,0.35)]'
                  : 'ud-text-secondary hover:bg-purple-50 hover:text-violet-700'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon size={16} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </span>
              {item.badge > 0 && (
                <span
                  className={`shrink-0 px-1.5 py-0.5 text-[10px] rounded-full font-bold border ${
                    active
                      ? 'bg-white/20 text-white border-white/40'
                      : 'bg-violet-100 text-violet-700 border-violet-200'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-5 pt-4 border-t border-purple-200">
        <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          User Access
        </p>
        {user ? (
          <div className="px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-semibold break-words">
            Signed in: {user.fullName || user.displayName || user.email}
          </div>
        ) : (
          <div className="space-y-1">
            <Link
              to="/login"
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold ud-text-secondary hover:bg-purple-50 hover:text-violet-700"
            >
              <LogIn size={15} className="text-violet-600 shrink-0" />
              <span>Login</span>
            </Link>
            <Link
              to="/register"
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold ud-text-secondary hover:bg-purple-50 hover:text-violet-700"
            >
              <UserPlus size={15} className="text-violet-600 shrink-0" />
              <span>Register</span>
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
}
