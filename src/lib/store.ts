// Simple JSON file storage for transactions
// Writes to data/transactions.json

import fs from 'fs';
import path from 'path';
import { Transaction } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'transactions.json');

export function loadTransactions(): Transaction[] {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      return [];
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveTransactions(transactions: Transaction[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(transactions, null, 2));
}

export function appendTransactions(newTxns: Transaction[]): Transaction[] {
  const existing = loadTransactions();
  const existingIds = new Set(existing.map(t => t.id));
  const unique = newTxns.filter(t => !existingIds.has(t.id));
  const merged = [...existing, ...unique];
  // Sort by date
  merged.sort((a, b) => b.date.localeCompare(a.date));
  saveTransactions(merged);
  return merged;
}

export function clearTransactions(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, '[]');
}

export function getAllData(): Transaction[] {
  return loadTransactions();
}
