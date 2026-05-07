// Extract raw text from PDF (concatenate all Tj operator text)
// Works for Citibank PDFs where each char is individually positioned

import { inflateSync } from 'zlib';

export function extractRawPDFText(buffer: Buffer): string {
  const data = buffer.toString('latin1');
  let allText = '';

  // Find all stream...endstream blocks
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  let match;

  while ((match = streamRegex.exec(data)) !== null) {
    let streamContent = match[1];

    // Try FlateDecode
    try {
      const compressed = Buffer.from(streamContent, 'latin1');
      const decompressed = inflateSync(compressed);
      streamContent = decompressed.toString('utf-8');
    } catch {
      // not compressed
    }

    // Collect ALL text from Tj operators
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(streamContent)) !== null) {
      if (tjMatch[1].trim()) {
        allText += tjMatch[1];
      }
    }
  }

  return allText;
}

// Parse Citibank Singapore eStatement text
export function parseCitibankStatement(rawText: string): CitibankTxn[] {
  const transactions: CitibankTxn[] = [];
  const thisYear = 2026;

  // Find the transaction section — starts after "DATEDESCRIPTIONAMOUNT(SGD"
  const txnStartMarker = 'DATEDESCRIPTIONAMOUNT';
  let idx = rawText.indexOf(txnStartMarker);
  if (idx === -1) return transactions;

  // Move to the first page break after the header
  idx = rawText.indexOf('DATEDESCRIPTIONAMOUNT', idx + txnStartMarker.length);
  if (idx === -1) return transactions;

  // Now parse transactions until we hit the card number again
  const cardPattern = /(\d{16})/;
  let text = rawText.slice(idx);

  // Remove page headers, card numbers, etc.
  text = text.replace(/DATEDESCRIPTIONAMOUNT\(\w+/g, '\nHEADER\n');
  text = text.replace(/\d{16}/g, '\nCARD\n');
  text = text.replace(/Page\d+of\d+/g, ' ');
  text = text.replace(/CITIPRESTIGECARD/g, ' ');
  text = text.replace(/EPSTCSX\/\d+-\d+OF\d+\/\d+/g, ' ');

  // Split into segments
  const segments = text.split('\n');

  let currentYear = thisYear;
  // Detect month from statement header
  const monthMatch = rawText.match(/StatementDate\s*:\s*(\w+)\s+(\d{4})/i);
  if (monthMatch) {
    currentYear = parseInt(monthMatch[2]);
  }

  const months: Record<string, number> = {
    JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,
    JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11
  };

  // Try to find transaction patterns: DDMMM description SG amount
  const allText = segments.map(s => s.trim()).filter(Boolean).join(' ');

  // Pattern: DDMMMDESCRIPTIONSGXX.XX or DDMMMDESCRIPTIONSGX,XXX.XX
  const txnRegex = /(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(.+?)(?:SINGAPORE)?SG([\d,]+\.\d{2})/gi;

  let txnMatch;
  while ((txnMatch = txnRegex.exec(allText)) !== null) {
    const day = parseInt(txnMatch[1]);
    const monthName = txnMatch[2].toUpperCase();
    const monthIdx = months[monthName];
    const desc = txnMatch[3].trim();
    const amountStr = txnMatch[4].replace(/,/g, '');
    const amount = parseFloat(amountStr);

    if (isNaN(amount) || monthIdx === undefined) continue;

    // Build ISO date
    const month = String(monthIdx + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const dateStr = `${currentYear}-${month}-${dayStr}`;

    // Clean up description
    let cleanDesc = desc
      .replace(/XXXX-XXXX-XXXX-\d+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Try to unmash words (e.g., "SHENGSIONGSUPERMARKE" → "SHENG SIONG SUPERMARKE")
    // Simple heuristic: insert spaces before uppercase letters
    cleanDesc = cleanDesc.replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
    cleanDesc = cleanDesc.replace(/([a-z])([A-Z])/g, '$1 $2');
    cleanDesc = cleanDesc.replace(/  /g, ' ').trim();

    transactions.push({
      date: dateStr,
      description: cleanDesc,
      amount: amount,
      category: guessCitibankCategory(cleanDesc),
      month: dateStr.slice(0, 7),
      account: 'Citibank Prestige',
      raw: txnMatch[0],
    });
  }

  // Also detect MONEYSEND (transfers) which have a different format
  const sendRegex = /(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)MONEYSEND(.+?)SG\(([\d,]+\.\d{2})/gi;
  let sendMatch; while ((sendMatch = sendRegex.exec(allText)) !== null) {
    const day = parseInt(sendMatch[1]);
    const monthName = sendMatch[2].toUpperCase();
    const monthIdx = months[monthName];
    const desc = 'MONEYSEND ' + sendMatch[3].trim();
    const amountStr = sendMatch[4].replace(/,/g, '');
    const amount = parseFloat(amountStr);

    if (isNaN(amount) || monthIdx === undefined) continue;

    const month = String(monthIdx + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const dateStr = `${currentYear}-${month}-${dayStr}`;

    let cleanDesc = desc.replace(/\s+/g, ' ').trim();
    cleanDesc = cleanDesc.replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
    cleanDesc = cleanDesc.replace(/([a-z])([A-Z])/g, '$1 $2');
    cleanDesc = cleanDesc.replace(/  /g, ' ').trim();

    transactions.push({
      date: dateStr,
      description: cleanDesc,
      amount: amount,
      category: 'Transfer',
      month: dateStr.slice(0, 7),
      account: 'Citibank Prestige',
      raw: sendMatch[0],
    });
  }

  // De-duplicate by date+description+amount
  const seen = new Set<string>();
  return transactions.filter(t => {
    const key = `${t.date}|${t.description}|${t.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export interface CitibankTxn {
  date: string;
  description: string;
  amount: number;
  category: string;
  month: string;
  account: string;
  raw: string;
}

function guessCitibankCategory(desc: string): string {
  const d = desc.toLowerCase();
  // Transport
  if (d.includes('grab') || d.includes('gojek') || d.includes('simplygo') || d.includes('cdg') || d.includes('comfort') || d.includes('bus/mrt') || d.includes('taxi') || d.includes('ryde')) return 'Transport';
  // Groceries
  if (d.includes('fairprice') || d.includes('cold storage') || d.includes('sheng siong') || d.includes('giant') || d.includes('redmart') || d.includes('ntuc') || d.includes('fpxtra') || d.includes('hillview market') || d.includes('vanilla mart')) return 'Groceries';
  // Shopping
  if (d.includes('shopee') || d.includes('lazada') || d.includes('amazon') || d.includes('qoo10') || d.includes('decathlon') || d.includes('popular book') || d.includes('don don donki') || d.includes('dondondonki') || d.includes('daiso') || d.includes('uniqlo') || d.includes('klarra') || d.includes('willow label') || d.includes('nespresso') || d.includes('best denki') || d.includes('scarlett') || d.includes('mothercare') || d.includes('tangs') || d.includes('wan po tea') || d.includes('yamazaki')) return 'Shopping';
  // Food & Dining
  if (d.includes('mcdonald') || d.includes('mc donalds') || d.includes('kfc') || d.includes('subway') || d.includes('mosburger') || d.includes('shake shack') || d.includes('texas') || d.includes('restaurant') || d.includes('cafe') || d.includes('coffee') || d.includes('kopitiam') || d.includes('kopi fellas') || d.includes('hawker') || d.includes('toast box') || d.includes('food arena') || d.includes('food republic') || d.includes('starbucks') || d.includes('chagee') || d.includes('ya kun') || d.includes('yakun') || d.includes('soup cup') || d.includes('four leaves') || d.includes('pullman bakery') || d.includes('bird bakery') || d.includes('bakery cuisine') || d.includes('tai cheong') || d.includes('epidor') || d.includes('menya kokoro') || d.includes('ramen hitoyosh') || d.includes('tomisushi') || d.includes('tomizushi') || d.includes('sukiya') || d.includes('sushi') || d.includes('fried chicken') || d.includes('claypot') || d.includes('munchips') || d.includes('royce chocola') || d.includes('ottie pancake') || d.includes('xinshiroll') || d.includes('nanyang coffee') || d.includes('columbus coffee')) return 'Food & Dining';
  // Subscriptions
  if (d.includes('netflix') || d.includes('spotify') || d.includes('disney') || d.includes('youtube') || d.includes('subscription') || d.includes('apple.com/bill')) return 'Subscriptions';
  // Telco
  if (d.includes('singtel') || d.includes('starhub') || d.includes('m1 ltd') || d.includes('circles') || d.includes('simba') || d.includes('broadband') || d.includes('giga')) return 'Telco';
  // Utilities
  if (d.includes('sp group') || d.includes('sp services') || d.includes('utility') || d.includes('electric')) return 'Utilities';
  // Insurance
  if (d.includes('insurance') || d.includes('prudential') || d.includes('aia ') || d.includes('great eastern')) return 'Insurance';
  // Healthcare
  if (d.includes('hospital') || d.includes('clinic') || d.includes('pharmacy') || d.includes('doctor') || d.includes('guardian') || d.includes('watsons') || d.includes('unity ') || d.includes('dc lreservation')) return 'Healthcare';
  // Transfer / MoneySend
  if (d.includes('moneysend') || d.includes('transfer') || d.includes('paynow') || d.includes('paylah')) return 'Transfer';
  // Cashback
  if (d.includes('shopback') || d.includes('cashback') || d.startsWith('2c2*shop')) return 'Cashback';
  // Entertainment
  if (d.includes('sistic') || d.includes('mandai wildlife') || d.includes('science centre') || d.includes('globaltix') || d.includes('ticket')) return 'Entertainment';
  // Education / Books
  if (d.includes('popular book') || d.includes('booksh')) return 'Books';
  return 'Other';
}

// Generic fallback parser for non-Citibank PDFs
export function parseGenericText(text: string, filename: string): any[] {
  return [];
}
