import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import * as z from 'zod';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/lib/db/models/User';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().trim().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = registerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please provide a valid email and a password of at least 6 characters.' }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const displayName = parsed.data.displayName?.trim() || email.split('@')[0];

  await connectToDatabase();

  const existing = await User.findOne({ email });
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await User.create({ email, passwordHash, displayName });

  const token = await createSessionToken({ uid: user.id, email: user.email, displayName: user.displayName });
  await setSessionCookie(token);

  return NextResponse.json({ user: { uid: user.id, email: user.email, displayName: user.displayName } }, { status: 201 });
}
