import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Clock,
  Send,
  Mail,
  Bell,
  Activity,
  LogOut,
  Plus,
  Search,
  ExternalLink,
  Menu,
  X,
  RefreshCw
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api.client';
import { ComposeModal } from '../pages/ComposeModal';

export const DashboardLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [scheduledCount, setScheduledCount] = useState<number>(0);
  const [sentCount, setSentCount] = useState<number>(0);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{
    id: string;
    recipientEmail: string;
    subject: string;
    status: string;
    scheduledAt?: string;
    sentAt?: string;
    etherealPreviewUrl?: string;
  }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const fetchCounts = async () => {
    try {
      const [scheduledRes, sentRes] = await Promise.allSettled([
        api.getScheduledEmails({ limit: 1 }),
        api.getSentEmails({ limit: 1 }),
        api.getSystemHealth()
      ]);

      if (scheduledRes.status === 'fulfilled') {
        setScheduledCount(scheduledRes.value.pagination.totalRecords);
      }
      if (sentRes.status === 'fulfilled') {
        setSentCount(sentRes.value.pagination.totalRecords);
      }
    } catch {
      // Non-critical background count
    }
  };

  useEffect(() => {
    void fetchCounts();
  }, [location.pathname]);

  // Debounced search with Elasticsearch
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await api.searchEmails({ q: searchQuery.trim(), limit: 6 });
        setSearchResults(res.data);
        setSearchOpen(true);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
      isActive
        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-semibold shadow-sm'
        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
    }`;

  return (
    <div className="min-h-screen flex bg-[#F8F9FA] dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased font-sans">
      {/* Compose Email Modal */}
      <ComposeModal
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        onSuccess={() => {
          void fetchCounts();
          // Dispatch custom event to trigger refresh in active table
          window.dispatchEvent(new CustomEvent('reachinbox:refresh'));
        }}
      />

      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 space-y-6">
          {/* Logo Branding */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-md shadow-emerald-600/30">
                RI
              </div>
              <div>
                <span className="font-bold text-base tracking-tight text-slate-900 dark:text-white">ReachInbox</span>
                <span className="block text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                  Email Scheduler
                </span>
              </div>
            </div>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* User Profile Card */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/60 flex items-center space-x-3">
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name || user.email}
                className="w-9 h-9 rounded-full object-cover border border-emerald-500/40"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold flex items-center justify-center text-xs">
                {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                {user?.name || 'Authorized User'}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{user?.email}</p>
            </div>
          </div>

          {/* Big Pill Compose Button */}
          <button
            onClick={() => setIsComposeOpen(true)}
            className="w-full py-2.5 px-4 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm flex items-center justify-center space-x-2 shadow-md shadow-emerald-700/25 transition-all hover:scale-[1.01]"
          >
            <Plus className="w-4 h-4" />
            <span>Compose</span>
          </button>

          {/* Navigation Groups */}
          <nav className="space-y-5">
            {/* CORE Group */}
            <div>
              <p className="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Core</p>
              <div className="space-y-1">
                <NavLink to="/dashboard/scheduled" className={navItemClass}>
                  <div className="flex items-center space-x-2.5">
                    <Clock className="w-4 h-4" />
                    <span>Scheduled</span>
                  </div>
                  {scheduledCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 font-bold">
                      {scheduledCount}
                    </span>
                  )}
                </NavLink>

                <NavLink to="/dashboard/sent" className={navItemClass}>
                  <div className="flex items-center space-x-2.5">
                    <Send className="w-4 h-4" />
                    <span>Sent</span>
                  </div>
                  {sentCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold">
                      {sentCount}
                    </span>
                  )}
                </NavLink>
              </div>
            </div>

            {/* SETTINGS / INTEGRATIONS Group */}
            <div>
              <p className="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Settings</p>
              <div className="space-y-1">
                <NavLink to="/dashboard/senders" className={navItemClass}>
                  <div className="flex items-center space-x-2.5">
                    <Mail className="w-4 h-4" />
                    <span>Senders</span>
                  </div>
                </NavLink>

                <NavLink to="/dashboard/slack" className={navItemClass}>
                  <div className="flex items-center space-x-2.5">
                    <Bell className="w-4 h-4" />
                    <span>Slack Alerts</span>
                  </div>
                </NavLink>

                {/* Queue Monitoring Access (Bull Board) */}
                <a
                  href="http://localhost:5000/admin/queues"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all"
                >
                  <div className="flex items-center space-x-2.5">
                    <Activity className="w-4 h-4 text-emerald-600" />
                    <span>Bull Board</span>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                </a>
              </div>
            </div>
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-xs px-2 text-slate-500">
            <span className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Worker Node Active</span>
            </span>
            <span className="text-[10px] font-mono text-slate-400">v1.6</span>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center space-x-2 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 h-16 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between">
          <div className="flex items-center space-x-3 flex-1 max-w-xl">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-slate-500 hover:text-slate-800 dark:hover:text-white"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Elasticsearch Search Bar */}
            <div className="relative w-full max-w-md">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search recipient, subject, or sender..."
                className="w-full pl-9 pr-8 py-1.5 text-xs rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:bg-white text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Elasticsearch Dropdown Results */}
              {searchOpen && (
                <div className="absolute top-10 left-0 right-0 z-50 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-2 max-h-80 overflow-y-auto animate-fade-in">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                    <span>Elasticsearch Results ({searchResults.length})</span>
                    {isSearching && <span className="text-emerald-600 animate-pulse">Searching...</span>}
                  </div>
                  {searchResults.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">
                      No email records matched &ldquo;{searchQuery}&rdquo;
                    </div>
                  ) : (
                    searchResults.map((item) => (
                      <div
                        key={item.id}
                        className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-xs cursor-pointer border-b last:border-0 border-slate-100 dark:border-slate-800/60"
                        onClick={() => {
                          setSearchOpen(false);
                          if (item.status === 'SENT') {
                            navigate('/dashboard/sent');
                          } else {
                            navigate('/dashboard/scheduled');
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-900 dark:text-white truncate">
                            {item.recipientEmail}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                              item.status === 'SENT'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                        <p className="text-slate-500 truncate mt-0.5">{item.subject}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Top Actions */}
          <div className="flex items-center space-x-3">
            <button
              onClick={() => {
                void fetchCounts();
                window.dispatchEvent(new CustomEvent('reachinbox:refresh'));
              }}
              title="Refresh Records"
              className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Main Content Body */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
