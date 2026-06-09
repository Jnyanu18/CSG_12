import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Same Kaggle dataset directory used by scripts/batch-analyze.js
const IMAGE_DIR = 'C:/Users/jnyan/Downloads/archive/images';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;

  if (!/^tomato\d+\.(png|jpg|jpeg)$/i.test(filename)) {
    return new NextResponse('Invalid filename', { status: 400 });
  }

  const filePath = path.join(IMAGE_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filename).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

  return new NextResponse(buf, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
