// Parser for Singapore bank CSV/transaction exports
// Supports DBS, OCBC, UOB, and generic CSV formats

import { Transaction, MonthlySummary } from './types';
import Papa from 'papaparse';
import { parse } from 'date-fns';

// Try to guess the bank from the CSV headers
function detectBank(headers: string[]): 'dbs' | 'ocbc' | 'uob' | 'generic' {
  const h = headers.map(h => h.toLowerCase().trim());
  if (h.some(s => s.includes('transaction date') && s.includes('reference'))) return 'dbs';
  if (h.some(s => s.includes('transaction date') && s.includes('withdrawal'))) return 'ocbc';
  if (h.some(s => s.includes('posting date') || s.includes('value date'))) return 'uob';
  return 'generic';
}

// Parse dates in common Singapore bank formats
function parseDate(val: string): string | null {
  const cleaned = val.trim();
  const formats = [
    'dd/MM/yyyy', 'd/M/yyyy', 'dd-MM-yyyy',
    'yyyy-MM-dd', 'MM/dd/yyyy', 'dd MMM yyyy',
  ];
  for (const fmt of formats) {
    try {
      const d = parse(cleaned, fmt, new Date());
      if (!isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
      }
    } catch {}
  }
  return null;
}

// Simple category detection from description
function guessCategory(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes('grab') || d.includes('gojek') || d.includes('taxi') || d.includes('simplygo') || d.includes('comfortdelgro') || d.includes('cdg')) return 'Transport';
  if (d.includes('fairprice') || d.includes('cold storage') || d.includes('sheng siong') || d.includes('giant') || d.includes('redmart') || d.includes('grocery') || d.includes('ntuc')) return 'Groceries';
  if (d.includes('shopee') || d.includes('lazada') || d.includes('amazon') || d.includes('qoo10')) return 'Shopping';
  if (d.includes('foodpanda') || d.includes('deliveroo') || d.includes('mcdonalds') || d.includes('kfc') || d.includes('subway') || d.includes('restaurant') || d.includes('cafe') || d.includes('food') || d.includes('coffee') || d.includes('kopitiam') || d.includes('hawker') || d.includes('toast box') || d.includes('ya kun')) return 'Food & Dining';
  if (d.includes('netflix') || d.includes('spotify') || d.includes('disney') || d.includes('youtube') || d.includes('subscription') || d.includes('apple.com/bill')) return 'Subscriptions';
  if (d.includes('singtel') || d.includes('starhub') || d.includes('m1 ') || d.includes('circles') || d.includes('simba') || d.includes('broadband') || d.includes('telco')) return 'Telco';
  if (d.includes('sp group') || d.includes('sp services') || d.includes('utility') || d.includes('electric')) return 'Utilities';
  if (d.includes('giro') || d.includes('salary') || d.includes('payroll') || d.includes('income')) return 'Income';
  if (d.includes('insurance') || d.includes('prudential') || d.includes('aia ') || d.includes('great eastern') || d.includes('income ')) return 'Insurance';
  if (d.includes('hospital') || d.includes('clinic') || d.includes('pharmacy') || d.includes('doctor') || d.includes('guardian') || d.includes('watsons') || d.includes('unity ')) return 'Healthcare';
  if (d.includes('transfer') || d.includes('paynow') || d.includes('paylah')) return 'Transfer';
  return 'Other';
}

function detectAccount(headers: string[], filename: string): string {
  const fn = filename.toLowerCase();
  if (fn.includes('dbs')) return 'DBS';
  if (fn.includes('ocbc')) return 'OCBC';
  if (fn.includes('uob')) return 'UOB';
  return 'Uploaded Account';
}

let txnCounter = 0;

export function parseCSV(csvText: string, filename: string = 'upload.csv'): Transaction[] {
  const result = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  const headers: string[] = (result as any).meta.fields || [];

  if (headers.length === 0) return [];

  const bank = detectBank(headers);
  const account = detectAccount(headers, filename);
  const transactions: Transaction[] = [];

  // Bank-specific column mappings
  const dateCol: string = headers.find((h: string) => /date/i.test(h)) || headers[0];
  const descCol: string = headers.find((h: string) => /desc|narrative|details|particulars/i.test(h)) || headers[1];
  const debitCol: string = headers.find((h: string) => /debit|withdrawal|amount out/i.test(h)) || '';
  const creditCol: string = headers.find((h: string) => /credit|deposit|amount in/i.test(h)) || '';
  const amtCol: string = headers.find((h: string) => /amount$/i.test(h)) || '';

  for (const row of (result as any).data as Record<string, string>[]) {
    const dateStr = parseDate(row[dateCol] || '');
    if (!dateStr) continue;

    const desc = (row[descCol] || '').trim();
    if (!desc) continue;

    let amount = 0;

    // Try debit/credit columns first (standard bank format)
    const debit = parseFloat((row[debitCol] || '').replace(/[$,]/g, ''));
    const credit = parseFloat((row[creditCol] || '').replace(/[$,]/g, ''));

    if (!isNaN(debit) && debit > 0) {
      amount = -debit; // debit = money going out
    } else if (!isNaN(credit) && credit > 0) {
      amount = credit; // credit = money coming in
    } else {
      // Try single amount column
      const amt = parseFloat((row[amtCol] || '').replace(/[$,]/g, ''));
      if (!isNaN(amt)) amount = amt;
      else continue;
    }

    const category = guessCategory(desc);
    const month = dateStr.slice(0, 7);

    transactions.push({
      id: `txn-${++txnCounter}`,
      date: dateStr,
      description: desc.replace(/\s+/g, ' ').trim(),
      amount,
      category,
      account,
      month,
      raw: JSON.stringify(row),
    });
  }

  return transactions;
}

// Build monthly summaries from transactions
export function buildSummaries(transactions: Transaction[]): MonthlySummary[] {
  const monthMap: Record<string, Transaction[]> = {};

  for (const t of transactions) {
    if (!monthMap[t.month]) monthMap[t.month] = [];
    monthMap[t.month].push(t);
  }

  const months = Object.keys(monthMap).sort();

  return months.map(month => {
    const txns = monthMap[month];
    let totalIn = 0, totalOut = 0;
    const categories: Record<string, number> = {};

    for (const t of txns) {
      if (t.amount > 0) totalIn += t.amount;
      else totalOut += Math.abs(t.amount);

      categories[t.category] = (categories[t.category] || 0) + Math.abs(Math.min(0, t.amount));
    }

    return {
      month,
      totalIn,
      totalOut: Math.round(totalOut * 100) / 100,
      net: Math.round((totalIn - totalOut) * 100) / 100,
      transactionCount: txns.length,
      categories,
    };
  });
}

// Build trend data
export function buildTrend(summaries: MonthlySummary[], transactions: Transaction[]) {
  const totalSpend = summaries.reduce((s, m) => s + m.totalOut, 0);
  const avgMonthly = summaries.length > 0 ? totalSpend / summaries.length : 0;

  // Top categories across all months
  const catTotal: Record<string, number> = {};
  for (const t of transactions) {
    if (t.amount < 0) {
      catTotal[t.category] = (catTotal[t.category] || 0) + Math.abs(t.amount);
    }
  }
  const topCategories = Object.entries(catTotal)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }));

  return {
    months: summaries,
    grandTotal: Math.round(totalSpend * 100) / 100,
    avgMonthly: Math.round(avgMonthly * 100) / 100,
    topCategories,
  };
}
