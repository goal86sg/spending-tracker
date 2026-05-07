// PDF bank statement parser
// Extracts transaction text from PDFs, then delegates to CSV-style parsing

import { Transaction } from './types';

// Try to detect and parse transaction lines from raw PDF text
// Singapore bank statements follow fairly consistent patterns
export function parsePDFText(text: string, filename: string): Transaction[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const transactions: Transaction[] = [];
  let txnCounter = Math.floor(Math.random() * 100000);

  const account = (() => {
    const fn = filename.toLowerCase();
    if (fn.includes('dbs') || fn.includes('posb')) return 'DBS';
    if (fn.includes('ocbc')) return 'OCBC';
    if (fn.includes('uob')) return 'UOB';
    return 'PDF Upload';
  })();

  // Determine year from PDF header (banks usually show statement period)
  let year = new Date().getFullYear();
  const periodMatch = text.match(/(\d{2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{4})/i);
  if (periodMatch) year = parseInt(periodMatch[3]);

  // Patterns for transaction lines
  // Singapore banks typically format: DD/MM  Description  Amount
  // or: DD MMM  Description  Amount
  const txnPattern = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(.+?)\s+([\d,.]+\.?\d{0,2})\s*(CR)?$/i;
  const numericDatePattern = /^(\d{1,2})[\/\-](\d{1,2})(?:\/\d{4})?\s+(.+?)\s+([\d,.]+\.?\d{0,2})\s*$/;
  const dbsPattern = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+'?\d{2}\s+(.+?)\s+(\d[\d,.]*\.?\d{0,2})\s*$/i;

  // Months for parsing
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  for (const line of lines) {
    let match: RegExpMatchArray | null = null;
    let dateStr = '';
    let desc = '';
    let amount = 0;
    let isCredit = false;

    // Try DBS format first (has reference number)
    match = line.match(dbsPattern);
    if (match) {
      const day = parseInt(match[1]);
      const monthIdx = months[match[2].toLowerCase()];
      const monthStr = String(monthIdx + 1).padStart(2, '0');
      dateStr = `${year}-${monthStr}-${String(day).padStart(2, '0')}`;
      desc = match[3].trim();
      amount = parseFloat(match[4].replace(/,/g, ''));
    }

    // Try month-name format
    if (!match) {
      match = line.match(txnPattern);
      if (match) {
        const day = parseInt(match[1]);
        const monthIdx = months[match[2].toLowerCase()];
        const monthStr = String(monthIdx + 1).padStart(2, '0');
        dateStr = `${year}-${monthStr}-${String(day).padStart(2, '0')}`;
        desc = match[3].trim();
        amount = parseFloat(match[4].replace(/,/g, ''));
        isCredit = !!match[5];
      }
    }

    // Try numeric date format
    if (!match) {
      match = line.match(numericDatePattern);
      if (match) {
        const day = parseInt(match[1]);
        const month = parseInt(match[2]);
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
          dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          desc = match[3].trim();
          amount = parseFloat(match[4].replace(/,/g, ''));
        }
      }
    }

    if (!dateStr || !desc || amount === 0) continue;

    // Filter noise — skip headers and non-transaction lines
    if (desc.length < 3) continue;
    if (/^(balance|page|statement|card|account|total|opening|closing|payment due)/i.test(desc)) continue;

    const category = guessCategory(desc);
    const month = dateStr.slice(0, 7);
    const finalAmount = isCredit ? amount : -amount;

    transactions.push({
      id: `pdf-${++txnCounter}`,
      date: dateStr,
      description: desc,
      amount: finalAmount,
      category,
      account,
      month,
      raw: line,
    });
  }

  return transactions;
}

function guessCategory(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes('grab') || d.includes('gojek') || d.includes('taxi') || d.includes('simplygo') || d.includes('cdg')) return 'Transport';
  if (d.includes('fairprice') || d.includes('cold storage') || d.includes('sheng siong') || d.includes('giant') || d.includes('redmart') || d.includes('ntuc')) return 'Groceries';
  if (d.includes('shopee') || d.includes('lazada') || d.includes('amazon') || d.includes('qoo10')) return 'Shopping';
  if (d.includes('foodpanda') || d.includes('deliveroo') || d.includes('mcdonalds') || d.includes('kfc') || d.includes('subway') || d.includes('restaurant') || d.includes('cafe') || d.includes('food') || d.includes('coffee') || d.includes('kopitiam') || d.includes('hawker')) return 'Food & Dining';
  if (d.includes('netflix') || d.includes('spotify') || d.includes('disney') || d.includes('youtube') || d.includes('subscription') || d.includes('apple.com/bill')) return 'Subscriptions';
  if (d.includes('singtel') || d.includes('starhub') || d.includes('m1 ') || d.includes('circles') || d.includes('broadband')) return 'Telco';
  if (d.includes('sp group') || d.includes('sp services') || d.includes('utility') || d.includes('electric')) return 'Utilities';
  if (d.includes('giro') || d.includes('salary') || d.includes('payroll') || d.includes('income')) return 'Income';
  if (d.includes('insurance') || d.includes('prudential') || d.includes('aia ') || d.includes('great eastern')) return 'Insurance';
  if (d.includes('hospital') || d.includes('clinic') || d.includes('pharmacy') || d.includes('doctor') || d.includes('guardian') || d.includes('watsons') || d.includes('unity ')) return 'Healthcare';
  if (d.includes('transfer') || d.includes('paynow') || d.includes('paylah')) return 'Transfer';
  return 'Other';
}
