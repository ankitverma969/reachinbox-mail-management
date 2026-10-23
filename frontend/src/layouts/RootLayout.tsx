import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import { Mail, Activity, Server } from 'lucide-react';

export const RootLayout: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-brand-500/10 border border-brand-500/20 rounded-lg text-brand-500">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight text-white">ReachInbox</span>
              <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-500 border border-brand-500/20">
                Scheduler
              </span>
            </div>
          </div>

          <nav className="flex items-center space-x-4">
            <Link
              to="/"
              className="flex items-center space-x-1.5 text-sm font-medium text-slate-300 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-slate-800"
            >
              <Activity className="w-4 h-4 text-brand-500" />
              <span>System Health</span>
            </Link>
            <div className="flex items-center space-x-2 text-xs text-slate-400 border border-slate-800 px-3 py-1.5 rounded-md bg-slate-900">
              <Server className="w-3.5 h-3.5 text-emerald-400" />
              <span>Foundation v1.0.0</span>
            </div>
          </nav>
        </div>
      </header>

      {/* Main Outlet */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-4 bg-slate-950 text-center text-xs text-slate-500">
        ReachInbox Full-Stack Email Job Scheduler &copy; {new Date().getFullYear()} &bull; Foundation Layer
      </footer>
    </div>
  );
};
