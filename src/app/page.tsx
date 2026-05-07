'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Transaction, MonthlySummary } from '@/lib/types';
import { parseCSV, buildSummaries, buildTrend } from '@/lib/parser';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';

const COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#10b981'];

// localStorage helpers
const LS_KEY = 'spending-tracker-transactions';

function loadFromLocalStorage(): Transaction[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveToLocalStorage(txns: Transaction[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(txns)); } catch {}
}

export default function HomePage() {
  const [transactions, setTransactions] = useState<Transaction[]>(loadFromLocalStorage);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  const showMsg = (text: string, type: 'success' | 'error') => {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => setMessage(null), 4000);
  };

  const processFiles = useCallback(async (files: FileList | File[]) => {
    setUploading(true);
    let added = 0;

    for (const file of Array.from(files)) {
      try {
        let parsed: Transaction[] = [];

        if (file.name.toLowerCase().endsWith('.pdf')) {
          setMessage(`🔍 Processing PDF: ${file.name}...`);
          setMessageType('success');
          
          // Send PDF to server for parsing
          const fd = new FormData();
          fd.append('file', file);
          const res = await fetch('/api/parse-pdf', { method: 'POST', body: fd });
          const json = await res.json();
          if (json.ok && json.transactions?.length > 0) {
            parsed = json.transactions;
          } else {
            showMsg(`${file.name}: ${json.error || json.hint || 'No transactions found'}`, 'error');
            continue;
          }
        } else {
          // Parse CSV client-side
          const text = await file.text();
          parsed = parseCSV(text, file.name);
        }

        if (parsed.length > 0) {
          // Strip raw fields to keep localStorage size down
          const cleaned = parsed.map(({ raw, ...rest }) => rest);
          const existing = loadFromLocalStorage();
          const existingIds = new Set(existing.map(t => t.id));
          const unique = cleaned.filter(t => !existingIds.has(t.id));
          const merged = [...existing, ...unique].sort((a, b) => b.date.localeCompare(a.date));
          try {
            saveToLocalStorage(merged);
            setTransactions(merged);
            added += unique.length;
          } catch (e: any) {
            if (e.name === 'QuotaExceededError') {
              showMsg('Storage full — too much data. Clear and re-upload your latest statements.', 'error');
            } else {
              throw e;
            }
          }
        }
      } catch (e: any) {
        showMsg(`${file.name}: ${e.message || 'Parse failed'}`, 'error');
      }
    }

    setUploading(false);
    if (added > 0) {
      showMsg(`✅ Added ${added} transactions from ${Array.from(files).length} file(s)`, 'success');
    } else {
      showMsg('No new transactions found. Check CSV format — needs date, description, and amount columns.', 'error');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) processFiles(e.target.files);
  }, [processFiles]);

  const clearData = () => {
    saveToLocalStorage([]);
    setTransactions([]);
    showMsg('All transactions cleared', 'success');
  };

  // Derived data
  const summaries = useMemo(() => buildSummaries(transactions), [transactions]);
  const trend = useMemo(() => buildTrend(summaries, transactions), [summaries, transactions]);

  // Chart data: monthly spending
  const monthlyData = useMemo(() =>
    summaries.map(m => ({
      month: m.month,
      Spending: parseFloat(m.totalOut.toFixed(0)),
      Income: parseFloat(m.totalIn.toFixed(0)),
      Net: parseFloat(m.net.toFixed(0)),
    })), [summaries]);

  // Category breakdown for latest month
  const latestMonth = summaries[summaries.length - 1];
  const categoryData = useMemo(() => {
    if (!latestMonth) return [];
    return (Object.entries(latestMonth.categories) as [string, number][])
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [latestMonth]);

  const formatSGD = (val: number) =>
    new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', minimumFractionDigits: 0 }).format(val);

  if (transactions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-lg w-full text-center">
          <div className="text-6xl mb-4">💳</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Spending Tracker</h1>
          <p className="text-gray-500 text-sm mb-8">Upload your bank CSV exports to see spending trends, category breakdowns, and monthly patterns.</p>

          {/* Drop zone */}
          <label
            className={`block w-full border-2 border-dashed rounded-xl p-12 cursor-pointer transition-colors ${
              dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-gray-400 bg-white'
            }`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input type="file" multiple accept=".csv,.txt,.pdf" className="hidden" onChange={handleFileInput} />
            <div className="text-4xl mb-3">📁</div>
            <p className="text-sm font-medium text-gray-700">Drop CSV or PDF bank statements here</p>
            <p className="text-xs text-gray-400 mt-2">DBS, OCBC, UOB CSV exports · PDF statements</p>
          </label>

          <div className="mt-6 text-left bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">What's supported</p>
            <div className="space-y-2 text-xs text-gray-600">
              <div className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✅</span>
                <span><strong>CSV files</strong> — DBS, OCBC, UOB transaction exports (instant, client-side)</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✅</span>
                <span><strong>PDF statements</strong> — Text-based bank PDFs (DBS, OCBC, UOB — parsed server-side)</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-yellow-500 mt-0.5">⚠️</span>
                <span><strong>Screenshots</strong> — Can't auto-parse yet. Send them to me on Telegram and I'll transcribe them for you manually.</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-400 mt-4">Data stays in your browser. Nothing uploaded to any server.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Spending Tracker</h1>
          <p className="text-xs text-gray-500">
            {transactions.length} transactions · {summaries.length} months · {formatSGD(trend.grandTotal)} total expenses
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs px-3 py-2 bg-white border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 font-medium text-gray-600 transition-colors">
            + Add Files
            <input type="file" multiple accept=".csv,.txt,.pdf" className="hidden" onChange={handleFileInput} />
          </label>
          <button onClick={clearData} className="text-xs px-3 py-2 bg-white border border-red-200 rounded-lg text-red-500 hover:bg-red-50 font-medium transition-colors">
            Clear
          </button>
        </div>
      </header>

      {message && (
        <div className={`mb-6 text-xs px-4 py-2 rounded-lg font-medium ${
          messageType === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
          'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message}
          {uploading && <span className="ml-2 animate-pulse">Processing...</span>}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Monthly Average', value: formatSGD(trend.avgMonthly), sub: 'per-month expenditure', color: 'text-indigo-600' },
          { label: 'Biggest Month', value: summaries.length > 0 ? formatSGD(Math.max(...summaries.map(s => s.totalOut))) : '-', sub: summaries.length > 0 ? summaries.reduce((max, s) => s.totalOut > max.totalOut ? s : max, summaries[0]).month : '-', color: 'text-pink-600' },
          { label: 'Top Category', value: trend.topCategories[0]?.category || '-', sub: trend.topCategories[0] ? formatSGD(trend.topCategories[0].total) : '-', color: 'text-teal-600' },
          { label: 'Latest Month', value: latestMonth ? formatSGD(latestMonth.totalOut) : '-', sub: latestMonth ? `${latestMonth.transactionCount} txns` : '-', color: 'text-gray-900' },
        ].map(card => (
          <div key={card.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium mb-1">{card.label}</p>
            <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
            <p className="text-[11px] text-gray-400">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Monthly spending chart */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Monthly Spending Trend</h2>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={monthlyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <Tooltip formatter={(v: any) => formatSGD(Number(v))} />
            <Line type="monotone" dataKey="Spending" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Income" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Bottom grid: pie + bar */}
      <div className="grid grid-cols-2 gap-6">
        {/* Category breakdown */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Categories {latestMonth ? `· ${latestMonth.month}` : ''}
          </h2>
          {categoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={categoryData} cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={2} dataKey="value">
                  {categoryData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: any) => formatSGD(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-xs text-gray-400 text-center py-12">No data for this month</p>}
        </div>

        {/* Top categories bar */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">All-Time Top Categories</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={trend.topCategories} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} stroke="#9ca3af" />
              <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} stroke="#9ca3af" width={80} />
              <Tooltip formatter={(v: any) => formatSGD(Number(v))} />
              <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                {trend.topCategories.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
