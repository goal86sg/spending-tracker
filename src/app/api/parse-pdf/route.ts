import { NextRequest, NextResponse } from 'next/server';
import { extractRawPDFText, parseCitibankStatement } from '@/lib/pdf-parser';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'PDF too large. Max 10MB.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const rawText = extractRawPDFText(buffer);

    if (!rawText.trim()) {
      return NextResponse.json({
        error: 'No text could be extracted. Try CSV export from your bank instead.',
        ok: false,
      });
    }

    const isCitibank = rawText.includes('CITI') || rawText.includes('CITIPRESTIGE');
    let transactions: any[];

    if (isCitibank) {
      transactions = parseCitibankStatement(rawText).map(t => ({
        id: 'pdf-' + t.date + '-' + Math.random().toString(36).slice(2, 8),
        date: t.date,
        description: t.description,
        amount: -Math.abs(t.amount), // expenses are negative
        category: t.category,
        account: t.account,
        month: t.month,
        raw: t.raw,
      }));
    } else {
      // Fall back to generic parser
      const { parseGenericText } = await import('@/lib/pdf-parser');
      transactions = parseGenericText(rawText, file.name);
    }

    if (!transactions.length) {
      return NextResponse.json({
        error: 'No transactions found in this PDF.',
        hint: 'Try CSV export from your bank instead.',
        ok: false,
      });
    }

    return NextResponse.json({
      ok: true,
      transactions,
      count: transactions.length,
    });

  } catch (e: any) {
    return NextResponse.json({
      error: e.message || 'Failed to parse PDF',
      hint: 'Try CSV export from your bank instead.',
      ok: false,
    }, { status: 500 });
  }
}
