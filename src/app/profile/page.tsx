"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Leaf } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

function getInitials(name: string | null, email: string | null) {
  const source = name ?? email ?? 'U';
  return source
    .split(/[\s@]/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase())
    .slice(0, 2)
    .join('');
}

export default function ProfilePage() {
  const { user } = useUser();
  const router = useRouter();
  const { toast } = useToast();

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(user?.displayName ?? '');

  const initials = getInitials(user?.displayName ?? null, user?.email ?? null);

  const handleEdit = () => {
    setName(user?.displayName ?? '');
    setIsEditing(true);
    setSaved(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setName(user?.displayName ?? '');
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ variant: 'destructive', title: 'Name cannot be empty.' });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ displayName: name.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save failed.');
      toast({ title: 'Profile updated' });
      setIsEditing(false);
      setSaved(true);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Simple header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-xl items-center gap-2 px-4">
          <Leaf className="h-5 w-5 text-primary" />
          <span className="font-headline font-semibold text-sm">AgriVisionAI</span>
          <span className="ml-auto text-sm text-muted-foreground">Profile</span>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-10 space-y-4">
        {/* Back link at top */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>

        <Card>
          <CardHeader className="flex flex-row items-center gap-4 pb-4">
            <Avatar className="h-14 w-14 shrink-0">
              <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <CardTitle className="text-lg truncate">{user?.displayName || 'Your Profile'}</CardTitle>
              <CardDescription className="truncate">{user?.email}</CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Display name field */}
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={isEditing ? name : (user?.displayName ?? '')}
                onChange={e => setName(e.target.value)}
                disabled={!isEditing}
                placeholder="Your name"
                autoComplete="off"
              />
            </div>

            {/* Email — always read-only */}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user?.email ?? ''} disabled />
              <p className="text-xs text-muted-foreground">Email address cannot be changed.</p>
            </div>

            {/* Action buttons */}
            <div className="pt-1 flex flex-wrap gap-2">
              {isEditing ? (
                <>
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
                    Cancel
                  </Button>
                </>
              ) : saved ? (
                <div className="flex flex-wrap items-center gap-3 w-full">
                  <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Profile saved
                  </div>
                  <Button onClick={() => router.push('/dashboard')}>
                    <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Dashboard
                  </Button>
                  <Button variant="ghost" onClick={handleEdit}>
                    Edit again
                  </Button>
                </div>
              ) : (
                <>
                  <Button variant="outline" onClick={handleEdit}>
                    Edit Profile
                  </Button>
                  <Button variant="ghost" onClick={() => router.push('/dashboard')}>
                    <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Dashboard
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
