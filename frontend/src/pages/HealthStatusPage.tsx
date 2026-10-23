import React, { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../services/api-client';
import {
  Activity,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Database,
  Radio,
  Search,
  Clock
} from 'lucide-react';

interface BackendHealthResponse {
  success: boolean;
  status: string;
  uptimeSeconds: number;
  timestamp: string;
  dependencies: {
    redis: string;
    database: string;
    elasticsearch: string;
  };
}

export const HealthStatusPage: React.FC = () => {
  const [data, setData] = useState<BackendHealthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<BackendHealthResponse>('/health');
      setData(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to backend server');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  return (
    <div className="space-y-6">
      {/* Page Title & Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2.5">
            <Activity className="w-6 h-6 text-brand-500" />
            <span>Monorepo Infrastructure Health</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time status of backend API server and containerized infrastructure services.
          </p>
        </div>
        <button
          onClick={fetchHealth}
          disabled={loading}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-sm font-medium rounded-lg text-white border border-slate-700 transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Status</span>
        </button>
      </div>

      {/* Backend API Server Status Banner */}
      <div
        className={`p-5 rounded-xl border ${
          error
            ? 'bg-rose-950/20 border-rose-800/40 text-rose-200'
            : 'bg-emerald-950/20 border-emerald-800/40 text-emerald-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {error ? (
              <XCircle className="w-6 h-6 text-rose-400" />
            ) : (
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            )}
            <div>
              <h2 className="font-semibold text-base">
                {error ? 'Backend API Unreachable' : 'Backend API Operational'}
              </h2>
              <p className="text-xs opacity-80 mt-0.5">
                {error
                  ? error
                  : `Express Server running in development mode (Uptime: ${data?.uptimeSeconds ?? 0}s)`}
              </p>
            </div>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-medium uppercase tracking-wider ${
              error
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
            }`}
          >
            {error ? 'Offline' : data?.status ?? 'Online'}
          </span>
        </div>
      </div>

      {/* Infrastructure Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* PostgreSQL */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400">
                <Database className="w-5 h-5" />
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                Port 5432
              </span>
            </div>
            <h3 className="font-semibold text-white">PostgreSQL 16</h3>
            <p className="text-xs text-slate-400 mt-1">
              Primary relational datastore for jobs, users, and audit records.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-500">Prisma Layer</span>
            <span className="text-blue-400 font-medium">{data?.dependencies.database ?? 'Configured'}</span>
          </div>
        </div>

        {/* Redis & BullMQ */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400">
                <Radio className="w-5 h-5" />
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                Port 6379
              </span>
            </div>
            <h3 className="font-semibold text-white">Redis 7 & BullMQ</h3>
            <p className="text-xs text-slate-400 mt-1">
              Distributed queue broker, delayed job sorted sets, and atomic rate counters.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-500">Broker Health</span>
            <span
              className={`font-medium ${
                data?.dependencies.redis === 'available' ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {data?.dependencies.redis ?? 'Checking...'}
            </span>
          </div>
        </div>

        {/* Elasticsearch */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-2.5 bg-purple-500/10 border border-purple-500/20 rounded-lg text-purple-400">
                <Search className="w-5 h-5" />
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                Port 9200
              </span>
            </div>
            <h3 className="font-semibold text-white">Elasticsearch 8.x</h3>
            <p className="text-xs text-slate-400 mt-1">
              Full-text tokenized search engine across recipients, subjects, and bodies.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-500">Search Engine</span>
            <span className="text-purple-400 font-medium">
              {data?.dependencies.elasticsearch ?? 'Configured'}
            </span>
          </div>
        </div>
      </div>

      {/* Foundation Architecture Notes Card */}
      <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/30 text-xs text-slate-400 space-y-2">
        <div className="flex items-center space-x-2 text-slate-200 font-medium">
          <Clock className="w-4 h-4 text-brand-500" />
          <span>Current Phase: Phase 1 — Repository Foundation & Infrastructure</span>
        </div>
        <p>
          The monorepo foundation is configured with strict TypeScript, Express.js backend, React 18 + Vite frontend, and Docker Compose infrastructure. Business models, scheduling logic, and OAuth flows will be implemented in subsequent phases.
        </p>
      </div>
    </div>
  );
};
