
'use client';

import Link from 'next/link';
import { Leaf, Bot, BarChart, ShoppingCart, LogOut, ArrowRight, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUser, useAuth } from '@/firebase';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { MangoScene } from '@/components/agrivision/mango-scene';

export default function HomePage() {
    const { user, isUserLoading } = useUser();
    const auth = useAuth();
    const router = useRouter();

    const handleLogout = async () => {
        await auth.logout();
        router.push('/');
    };

    const workflow = [
        {
            title: "Connect & Upload",
            description: "Upload up to 12 field samples. High-res images ensure the highest accuracy for our neural networks.",
            icon: <Camera className="h-6 w-6" />,
            color: "text-blue-500",
            bg: "bg-blue-500/10",
        },
        {
            title: "AI Detection",
            description: "Gemini Vision identifies every fruit and flower, categorizing them by 8 distinct maturity stages.",
            icon: <Bot className="h-6 w-6" />,
            color: "text-purple-500",
            bg: "bg-purple-500/10",
        },
        {
            title: "Yield Analysis",
            description: "We aggregate counts and apply GDD models to forecast your exact harvestable weight.",
            icon: <BarChart className="h-6 w-6" />,
            color: "text-green-500",
            bg: "bg-green-500/10",
        },
        {
            title: "Market Optimization",
            description: "Identify the peak profit window by matching your harvest curve with regional price trends.",
            icon: <ShoppingCart className="h-6 w-6" />,
            color: "text-orange-500",
            bg: "bg-orange-500/10",
        }
    ];

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-primary/30">
      <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center space-x-2 group">
            <div className="p-1.5 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
              <Leaf className="h-6 w-6 text-primary" />
            </div>
            <span className="font-headline font-bold text-xl tracking-tight">AgriVision<span className="text-primary">AI</span></span>
          </Link>
          <div className="flex items-center space-x-4">
             <nav className="hidden md:flex items-center space-x-1">
                {isUserLoading ? null : user ? (
                    <>
                        <Button variant="ghost" asChild>
                            <Link href="/dashboard">Dashboard</Link>
                        </Button>
                        <Button variant="ghost" onClick={handleLogout} className="text-muted-foreground hover:text-destructive transition-colors">
                            <LogOut className="mr-2 h-4 w-4"/>
                            Logout
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="ghost" asChild>
                             <Link href="/login">Sign In</Link>
                        </Button>
                        <Button asChild className="shadow-lg shadow-primary/20">
                            <Link href="/register">Join Platform</Link>
                        </Button>
                    </>
                )}
            </nav>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden py-24 lg:py-32">
           <div className="absolute inset-x-0 top-0 -z-10 h-[500px] w-full bg-gradient-to-b from-primary/5 to-transparent"></div>
           <div className="container relative grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="text-center lg:text-left">
                <Badge variant="outline" className="mb-6 py-1 px-4 border-primary/20 bg-primary/5 text-primary animate-in fade-in slide-in-from-bottom-2">
                    Next-Gen Agricultural Intelligence
                </Badge>
                <h1 className="font-headline text-5xl font-extrabold tracking-tighter sm:text-6xl md:text-7xl bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
                  Grow Your Profits. <br/>
                  <span className="text-primary/90">Optimize Your Yield.</span>
                </h1>
                <p className="mt-8 text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto lg:mx-0">
                    AgriVisionAI combines cutting-edge Gemini Vision with localized market trends to give you a 14-day head start on your harvest planning.
                </p>
                <div className="mt-12 flex flex-wrap justify-center lg:justify-start gap-4">
                  <Button
                    size="lg"
                    className="h-14 px-8 text-lg font-bold shadow-xl shadow-primary/20"
                    disabled={isUserLoading}
                    onClick={() => router.push(user ? '/dashboard' : '/login')}
                  >
                    Launch Dashboard <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                  <Button size="lg" variant="outline" asChild className="h-14 px-8 text-lg font-bold">
                    <Link href="#how-it-works">How it works</Link>
                  </Button>
                </div>
            </div>
            <MangoScene className="max-w-xl mx-auto w-full animate-in fade-in zoom-in-95 duration-700" />
          </div>
        </section>

        {/* How it Works - Flowchart Section */}
        <section id="how-it-works" className="py-24 bg-muted/30 border-y border-border/40">
            <div className="container">
                <div className="text-center mb-16">
                    <h2 className="font-headline text-3xl font-bold tracking-tight mb-4 sm:text-4xl">Platform Architecture</h2>
                    <p className="text-muted-foreground max-w-2xl mx-auto">Our four-step automated pipeline turns raw images into actionable financial intelligence.</p>
                </div>

                <div className="relative">
                    {/* Background Connector Line (Desktop) */}
                    <div className="hidden lg:block absolute top-1/2 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-border to-transparent -translate-y-1/2 -z-10" />

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                        {workflow.map((step, idx) => (
                            <div key={idx} className="relative flex flex-col items-center text-center group">
                                <div className={cn(
                                    "h-16 w-16 rounded-2xl flex items-center justify-center mb-6 transition-all duration-500 group-hover:scale-110 group-hover:rotate-3 shadow-sm",
                                    step.bg, step.color, "ring-1 ring-border/50 bg-background"
                                )}>
                                    {step.icon}
                                    <div className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shadow-lg">
                                        {idx + 1}
                                    </div>
                                </div>
                                <h3 className="font-headline text-xl font-bold mb-3">{step.title}</h3>
                                <p className="text-sm text-muted-foreground px-4 leading-relaxed italic">{step.description}</p>
                                
                                {idx < workflow.length - 1 && (
                                    <div className="lg:hidden h-12 w-px bg-gradient-to-b from-border to-transparent my-4" />
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-20 flex justify-center">
                    <Card className="max-w-4xl w-full bg-background/50 border-primary/10 shadow-2xl overflow-hidden group">
                        <div className="relative aspect-[21/9] bg-muted/20 flex items-center justify-center p-8">
                            <div className="relative flex items-center justify-center">
                                <Bot className="h-32 w-32 text-primary/10 animate-pulse" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="h-40 w-40 border-2 border-primary/20 rounded-full animate-[ping_3s_linear_infinite]" />
                                    <div className="h-60 w-60 border border-primary/10 rounded-full animate-[ping_4s_linear_infinite]" />
                                </div>
                                <div className="absolute text-center">
                                    <div className="text-xs font-bold uppercase tracking-[0.3em] text-primary/60 mb-2">Model Active</div>
                                    <div className="font-headline text-2xl font-bold italic tracking-wider">Gemini 1.5 Pro</div>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        </section>

        {/* Features/Description Section (Legacy) */}
        <section id="features" className="py-24">
          <div className="container">
            <div className="mx-auto max-w-4xl text-center mb-20">
              <h2 className="font-headline text-3xl font-bold tracking-tight mb-4">Powerful Core Capabilities</h2>
              <p className="text-muted-foreground">
                AgriVisionAI is a comprehensive, cloud-native web application designed to provide intelligent yield analysis and forecasting.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {[
                  { title: "Computer Vision", icon: <Camera className="h-8 w-8 text-primary" />, desc: "High-precision fruit counting and stage detection using Gemini Vision." },
                  { title: "Yield Prediction", icon: <BarChart className="h-8 w-8 text-primary" />, desc: "GDD-based thermal models predict harvestable weight with 92% accuracy." },
                  { title: "Market Insights", icon: <ShoppingCart className="h-8 w-8 text-primary" />, desc: "Localized regional price forecasting for optimized sell-side decisions." }
              ].map((f, i) => (
                <Card key={i} className="hover:border-primary/40 transition-colors shadow-sm bg-muted/10">
                    <CardHeader>
                        <div className="p-3 bg-background w-fit rounded-xl border mb-2">{f.icon}</div>
                        <CardTitle className="font-headline">{f.title}</CardTitle>
                        <CardDescription>{f.desc}</CardDescription>
                    </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-12 bg-muted/20">
        <div className="container flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="flex items-center gap-3">
                 <div className="p-1.5 bg-primary/10 rounded-lg">
                    <Leaf className="h-5 w-5 text-primary" />
                 </div>
                 <span className="font-headline font-bold text-lg">AgriVisionAI</span>
            </div>
            <p className="text-sm text-muted-foreground">
                © {new Date().getFullYear()} AgriPro Digital Systems. Built for resilient farming.
            </p>
        </div>
      </footer>
    </div>
  );
}

