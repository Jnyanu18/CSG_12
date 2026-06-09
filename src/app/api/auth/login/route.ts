import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import * as z from 'zod';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/lib/db/models/User';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const INVALID_CREDENTIALS = 'Invalid email or password.';

export async function POST(req: NextRequest) {
  const parsed = loginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();

  await connectToDatabase();

  const user = await User.findOne({ email });
  if (!user) {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  const passwordMatches = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!passwordMatches) {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  const token = await createSessionToken({ uid: user.id, email: user.email, displayName: user.displayName });
  await setSessionCookie(token);

  return NextResponse.json({ user: { uid: user.id, email: user.email, displayName: user.displayName } });
}
