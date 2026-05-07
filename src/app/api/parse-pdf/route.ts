import { NextRequest, NextResponse } from 'next/server';
import { parsePDFText } from '@/lib/pdf-parser';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Check size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'PDF too large. Max 5MB. Try exporting CSV instead.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();

    // Set up pdfjs to run without workers (Vercel serverless compatible)
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      useWorkerFetch: false,
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
    });

    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      
      // Group text items by approximate y-position to reconstruct lines
      const items: { y: number; text: string }[] = [];
      for (const item of content.items) {
        if ('str' in item && (item as any).str?.trim()) {
          items.push({ y: Math.round((item as any).transform[5]), text: (item as any).str });
        }
      }
      
      // Sort by y descending (top to bottom), then by x
      items.sort((a, b) => b.y - a.y);
      
      let currentY = items[0]?.y;
      let currentLine = '';
      
      for (const item of items) {
        if (Math.abs(item.y - (currentY ?? item.y)) > 2) {
          fullText += currentLine.trim() + '\n';
          currentLine = item.text + ' ';
          currentY = item.y;
        } else {
          currentLine += item.text + ' ';
        }
      }
      fullText += currentLine.trim() + '\n';
    }

    if (!fullText.trim()) {
      return NextResponse.json({ 
        error: 'No text extracted. This might be a scanned/image PDF — try downloading the CSV version from your bank instead.',
        textPreview: '',
      }, { status: 400 });
    }

    const transactions = parsePDFText(fullText, file.name);

    return NextResponse.json({
      ok: true,
      transactions,
      count: transactions.length,
      pageCount: pdf.numPages,
      textPreview: fullText.slice(0, 300),
    });
  } catch (e: any) {
    console.error('PDF parse error:', e);
    return NextResponse.json({ 
      error: e.message || 'Failed to parse PDF',
      hint: 'Try downloading as CSV from your bank instead',
    }, { status: 500 });
  }
}
