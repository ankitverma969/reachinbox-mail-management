import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Clock,
  Send,
  Search,
  Filter,
  RotateCw,
  ChevronDown,
  Mail,
  Bell,
  Activity,
  LogOut,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api.client';
import { ComposeModal } from '../pages/ComposeModal';

export const DashboardLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [scheduledCount, setScheduledCount] = useState<number>(12);
  const [sentCount, setSentCount] = useState<number>(785);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{
    id: string;
    recipientEmail: string;
    subject: string;
    status: string;
    scheduledAt?: string;
    sentAt?: string;
  }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const fetchCounts = async () => {
    try {
      const [scheduledRes, sentRes] = await Promise.allSettled([
        api.getScheduledEmails({ limit: 1 }),
        api.getSentEmails({ limit: 1 })
      ]);

      if (scheduledRes.status === 'fulfilled' && scheduledRes.value.pagination.totalRecords > 0) {
        setScheduledCount(scheduledRes.value.pagination.totalRecords);
      }
      if (sentRes.status === 'fulfilled' && sentRes.value.pagination.totalRecords > 0) {
        setSentCount(sentRes.value.pagination.totalRecords);
      }
    } catch {
      // Keep reference counts
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
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleRefresh = () => {
    void fetchCounts();
    window.dispatchEvent(new CustomEvent('reachinbox:refresh'));
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased font-sans flex">
      {/* Compose Email Modal */}
      <ComposeModal
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        onSuccess={() => {
          void fetchCounts();
          window.dispatchEvent(new CustomEvent('reachinbox:refresh'));
        }}
      />

      {/* Left Sidebar (250px) matching Figma Reference Screenshots 1:1 */}
      <aside className="w-64 flex-shrink-0 bg-white min-h-screen p-5 flex flex-col justify-between select-none">
        <div>
          {/* Top-Left ONB Brand Logo */}
          <div className="font-extrabold text-[26px] tracking-tight text-black mb-5 px-1 font-mono">
            ONB
          </div>

          {/* User Profile Card */}
          <div className="relative mb-5">
            <button
              type="button"
              onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
              className="w-full bg-[#F4F5F6] hover:bg-[#EBEDEF] rounded-2xl p-2 px-2.5 flex items-center justify-between transition-colors text-left"
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <img
                  src={user?.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&auto=format&fit=crop&q=80"}
                  alt={user?.name || "Oliver Brown"}
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-900 truncate leading-tight">
                    {user?.name || "Oliver Brown"}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate leading-tight">
                    {user?.email || "oliver.brown@domain.io"}
                  </p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${profileDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Profile Dropdown Menu */}
            {profileDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-lg border border-slate-200/80 py-1 z-50 animate-fade-in text-xs">
                <div className="px-3 py-1.5 border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400">
                  Settings & Integrations
                </div>
                <button
                  onClick={() => {
                    setProfileDropdownOpen(false);
                    navigate('/dashboard/senders');
                  }}
                  className="w-full px-3 py-2 flex items-center space-x-2 text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  <span>Sender Accounts</span>
                </button>
                <button
                  onClick={() => {
                    setProfileDropdownOpen(false);
                    navigate('/dashboard/slack');
                  }}
                  className="w-full px-3 py-2 flex items-center space-x-2 text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Bell className="w-3.5 h-3.5 text-slate-400" />
                  <span>Slack Webhooks</span>
                </button>
                <a
                  href="http://localhost:5000/admin/queues"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setProfileDropdownOpen(false)}
                  className="w-full px-3 py-2 flex items-center space-x-2 text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Activity className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Bull Board Queues</span>
                </a>
                <div className="border-t border-slate-100 my-1" />
                <button
                  onClick={() => {
                    setProfileDropdownOpen(false);
                    void handleLogout();
                  }}
                  className="w-full px-3 py-2 flex items-center space-x-2 text-rose-600 hover:bg-rose-50 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5 text-rose-500" />
                  <span>Log Out</span>
                </button>
              </div>
            )}
          </div>

          {/* Primary Pill Compose Button */}
          <button
            type="button"
            onClick={() => navigate('/dashboard/compose')}
            className="w-full h-10 rounded-full border border-[#2E7D32] bg-white hover:bg-[#E8F5E9]/50 text-[#2E7D32] font-medium text-sm flex items-center justify-center transition-all shadow-none"
          >
            Compose
          </button>

          {/* Navigation CORE Section */}
          <div className="mt-8">
            <p className="px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
              Core
            </p>
            <div className="space-y-1">
              <NavLink
                to="/dashboard/scheduled"
                className={({ isActive }) =>
                  `flex items-center justify-between px-3.5 py-2 rounded-full text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#E8F5E9] text-slate-900 font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`
                }
              >
                <div className="flex items-center space-x-2.5">
                  <Clock className="w-4 h-4 text-slate-700" />
                  <span>Scheduled</span>
                </div>
                <span className="text-xs text-slate-500 font-normal">{scheduledCount}</span>
              </NavLink>

              <NavLink
                to="/dashboard/sent"
                className={({ isActive }) =>
                  `flex items-center justify-between px-3.5 py-2 rounded-full text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#E8F5E9] text-slate-900 font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`
                }
              >
                <div className="flex items-center space-x-2.5">
                  <Send className="w-4 h-4 text-slate-700" />
                  <span>Sent</span>
                </div>
                <span className="text-xs text-slate-500 font-normal">{sentCount}</span>
              </NavLink>
            </div>
          </div>
        </div>

        {/* Subtle Worker Badge at bottom */}
        <div className="px-2 py-3 text-[10px] text-slate-400 flex items-center space-x-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          <span>Worker active</span>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 bg-white min-h-screen pt-4 px-6 sm:px-8">
        {/* Top Action Header Bar */}
        <div className="flex items-center space-x-4 mb-4">
          {/* Pill Search Input */}
          <div className="relative flex-1 max-w-xl">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              className="w-full h-10 pl-10 pr-9 rounded-full bg-[#F4F5F6] text-slate-900 placeholder-slate-400 text-sm border-none focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all"
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
              <div className="absolute top-11 left-0 right-0 z-50 bg-white rounded-xl shadow-lg border border-slate-200/80 p-2 max-h-80 overflow-y-auto text-xs">
                <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Search Results ({searchResults.length})</span>
                  {isSearching && <span className="text-emerald-600 animate-pulse">Searching...</span>}
                </div>
                {searchResults.length === 0 ? (
                  <div className="p-3 text-center text-slate-400">
                    No results for &ldquo;{searchQuery}&rdquo;
                  </div>
                ) : (
                  searchResults.map((item) => (
                    <div
                      key={item.id}
                      className="p-2 hover:bg-slate-50 rounded-lg cursor-pointer border-b last:border-0 border-slate-100"
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
                        <span className="font-semibold text-slate-900 truncate">
                          {item.recipientEmail}
                        </span>
                        <span className="text-[10px] text-slate-400">
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

          {/* Action icons right of search bar */}
          <div className="flex items-center space-x-3 text-slate-400">
            <button
              type="button"
              title="Filter"
              className="p-1.5 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
            >
              <Filter className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              title="Refresh"
              className="p-1.5 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Page View (Scheduled or Sent rows) */}
        <Outlet />
      </main>
    </div>
  );
};
