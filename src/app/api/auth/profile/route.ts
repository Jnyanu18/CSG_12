import { NextRequest, NextResponse } from 'next/server';
import * as z from 'zod';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/lib/db/models/User';
import { getSession, createSessionToken, setSessionCookie } from '@/lib/auth/session';

const schema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Name must be 1–80 characters.' }, { status: 400 });

  await connectToDatabase();
  const user = await User.findByIdAndUpdate(
    session.uid,
    { displayName: parsed.data.displayName },
    { new: true }
  );
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const token = await createSessionToken({ uid: user.id, email: user.email, displayName: user.displayName });
  await setSessionCookie(token);

  return NextResponse.json({ user: { uid: user.id, email: user.email, displayName: user.displayName } });
}
