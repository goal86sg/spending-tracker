// Minimal PDF text extractor — no dependencies, no workers, no native modules
// Works on Vercel serverless, any Node.js environment

import { parsePDFText } from '@/lib/pdf-parser';
import { NextRequest, NextResponse } from 'next/server';

// Extract text from PDF buffer using regex patterns
// Handles most bank statement PDFs (uncompressed text streams)
function extractTextFromPDF(buffer: Buffer): string {
  const data = buffer.toString('latin1');
  const texts: string[] = [];
  
  // Find all stream...endstream blocks
  const streamRegex = /stream\s*\n([\s\S]*?)endstream/g;
  let match;
  
  while ((match = streamRegex.exec(data)) !== null) {
    let streamContent = match[1];
    
    // Try to handle FlateDecode (deflated) streams
    // Most bank PDFs have simple uncompressed text, but some are deflated
    try {
      const zlib = require('zlib');
      const compressed = Buffer.from(streamContent, 'latin1');
      const decompressed = zlib.inflateSync(compressed);
      streamContent = decompressed.toString('utf-8');
    } catch {
      // Not compressed or couldn't decompress — use as-is
    }
    
    // Extract text from BT (Begin Text) ... ET (End Text) blocks
    const textRegex = /BT([\s\S]*?)ET/g;
    let textMatch;
    
    while ((textMatch = textRegex.exec(streamContent)) !== null) {
      let block = textMatch[1];
      
      // Extract text from Tj operators: (text) Tj
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch;
      let lineText = '';
      
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        lineText += tjMatch[1] + ' ';
      }
      
      // Also try TJ arrays: [(text) num (text)] TJ
      const tJArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
      let tJMatch;
      
      while ((tJMatch = tJArrayRegex.exec(block)) !== null) {
        const inner = tJMatch[1];
        const innerTjRegex = /\(([^)]*)\)/g;
        let innerMatch;
        while ((innerMatch = innerTjRegex.exec(inner)) !== null) {
          lineText += innerMatch[1];
        }
      }
      
      if (lineText.trim()) {
        texts.push(lineText.trim());
      }
    }
  }
  
  return texts.join('\n');
}

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

    const text = extractTextFromPDF(buffer);

    if (!text.trim()) {
      return NextResponse.json({ 
        error: 'No text could be extracted from this PDF. It may be a scanned/image PDF — try CSV export from your bank instead.',
        ok: false,
      }, { status: 400 });
    }

    const transactions = parsePDFText(text, file.name);

    return NextResponse.json({
      ok: true,
      transactions,
      count: transactions.length,
      textPreview: text.slice(0, 300),
    });

  } catch (e: any) {
    console.error('PDF parse error:', e);
    return NextResponse.json({ 
      error: e.message || 'Failed to parse PDF',
      hint: 'Try downloading as CSV from your bank instead',
      ok: false,
    }, { status: 500 });
  }
}
