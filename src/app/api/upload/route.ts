import { NextRequest, NextResponse } from 'next/server';
import { parseCSV } from '@/lib/parser';
import { appendTransactions } from '@/lib/store';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];
    
    if (files.length === 0) {
      return NextResponse.json({ error: 'No files uploaded' }, { status: 400 });
    }

    let totalAdded = 0;
    const errors: string[] = [];

    for (const file of files) {
      try {
        const text = await file.text();
        const transactions = parseCSV(text, file.name);
        
        if (transactions.length === 0) {
          errors.push(`${file.name}: no transactions found — wrong format?`);
          continue;
        }

        appendTransactions(transactions);
        totalAdded += transactions.length;
      } catch (e: any) {
        errors.push(`${file.name}: ${e.message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      added: totalAdded,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE() {
  const { clearTransactions } = await import('@/lib/store');
  clearTransactions();
  return NextResponse.json({ ok: true });
}
