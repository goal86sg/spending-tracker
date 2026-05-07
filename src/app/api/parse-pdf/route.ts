import { NextRequest, NextResponse } from 'next/server';
import { parsePDFText } from '@/lib/pdf-parser';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Use pdfjs-dist directly (more reliable than pdf-parse v2)
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    });

    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => item.str || '')
        .join(' ');
      fullText += pageText + '\n';
    }

    if (!fullText || fullText.trim().length === 0) {
      return NextResponse.json({ error: 'No text could be extracted. Scanned PDFs (images) are not supported — try exporting as CSV from your bank instead.' }, { status: 400 });
    }

    const transactions = parsePDFText(fullText, file.name);

    return NextResponse.json({
      ok: true,
      transactions,
      pageCount: pdf.numPages,
      textPreview: fullText.slice(0, 500),
    });
  } catch (e: any) {
    console.error('PDF parse error:', e);
    return NextResponse.json({ error: e.message || 'Failed to parse PDF' }, { status: 500 });
  }
}
