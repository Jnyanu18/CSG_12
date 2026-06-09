import { NextResponse } from "next/server";

// This app primarily uses Next.js Server Actions (src/app/actions.ts) to invoke Genkit flows.
// Keeping this route minimal avoids build breaks from version mismatches in @genkit-ai/next.

export async function GET() {
  return NextResponse.json({ ok: true, message: "Genkit route is disabled. Use Server Actions." });
}

export async function POST() {
  return NextResponse.json({ ok: false, message: "Genkit route is disabled. Use Server Actions." }, { status: 404 });
}
