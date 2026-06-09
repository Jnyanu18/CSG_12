

"use client";

import { Download, Globe, Leaf, LogOut, Search, UserRound } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from '@/firebase';
import { useRouter } from 'next/navigation';
import { ScrollArea } from '../ui/scroll-area';
import { useTranslation } from 'react-i18next';
import { supportedLngs } from '@/lib/i18n';

export function AgriVisionHeader() {
  const auth = useAuth();
  const router = useRouter();
  const { t, i18n } = useTranslation();

  const handleLogout = async () => {
    await auth.logout();
    router.push('/login');
  };

  const handlePrint = () => {
    window.print();
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur print:hidden">
      <div className="mx-auto flex h-12 max-w-5xl items-center gap-3 px-4">
        <div className="flex items-center gap-2">
        <Leaf className="h-6 w-6 text-primary" />
        <h1 className="font-headline text-base font-semibold tracking-tight">{t('agrivision_ai')}</h1>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => window.dispatchEvent(new Event("agrivision:quickactions"))}
          aria-label="Quick actions"
          title="Quick actions (Ctrl/Cmd + K)"
        >
          <Search className="h-5 w-5" />
        </Button>

        <Button variant="ghost" size="sm" onClick={handlePrint} className="h-9 px-3">
          <Download className="mr-2 h-4 w-4" />
          {t('download_report')}
        </Button>

        <Dialog>
          <DialogTrigger asChild>
            <span className="hidden" />
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="font-headline text-2xl">{t('project_report_title')}</DialogTitle>
              <DialogDescription>
                {t('project_report_description')}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh] pr-6">
                <div className="space-y-6 text-sm text-muted-foreground">
                    <p className="font-semibold text-foreground">
                        AgriVisionAI is a comprehensive, cloud-native web application designed to provide intelligent yield analysis and forecasting for tomato farmers. It leverages a modern tech stack to deliver a seamless user experience, from image upload to AI-powered insights.
                    </p>

                    <div className="space-y-2">
                        <h3 className="font-headline text-lg font-semibold text-foreground">1. Frontend & User Interface (Next.js & ShadCN UI)</h3>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><span className="font-semibold">Modern Dashboard:</span> A responsive, tab-based interface for Detection, Forecast, Market Price, and an AI Chat Assistant.</li>
                            <li><span className="font-semibold">Interactive Controls:</span> A collapsible sidebar for adjusting forecast parameters and uploading plant images.</li>
                            <li><span className="font-semibold">Authentication Flow:</span> Secure user registration and login using Firebase Authentication. The main dashboard is a protected route.</li>
                        </ul>
                    </div>

                    <div className="space-y-2">
                        <h3 className="font-headline text-lg font-semibold text-foreground">2. AI-Powered Vision Analysis (Genkit & Gemini)</h3>
                        <ul className="list-disc pl-5 space-y-1">
                             <li><span className="font-semibold">Tomato Detection:</span> The app uses a Genkit AI flow calling the Gemini vision model to analyze uploaded tomato plant images.</li>
                            <li><span className="font-semibold">Analysis Process:</span> The model counts all visible tomatoes and classifies them by growth stage (flower, immature, ripening, mature), returning a structured JSON object with the results.</li>
                        </ul>
                    </div>

                    <div className="space-y-2">
                        <h3 className="font-headline text-lg font-semibold text-foreground">3. Yield & Harvest Forecasting</h3>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><span className="font-semibold">Data-Driven Forecast:</span> Tomato counts from the AI analysis are fed into a sophisticated forecasting function.</li>
                            <li><span className="font-semibold">Calculations:</span> Estimates current yield, sellable yield, and projects a "Ready-to-Harvest" curve.</li>
                             <li><span className="font-semibold">Optimal Harvest Plan:</span> Creates a daily harvest schedule based on the forecast and the user's specified harvest capacity.</li>
                        </ul>
                    </div>
                    
                    <div className="space-y-2">
                        <h3 className="font-headline text-lg font-semibold text-foreground">4. Market Price Forecasting & Profit Analysis</h3>
                         <ul className="list-disc pl-5 space-y-1">
                            <li><span className="font-semibold">AI-Powered Market Insights:</span> A dedicated Genkit flow forecasts future tomato prices for a specified district.</li>
                            <li><span className="font-semibold">Profit Optimization:</span> The flow identifies the best date to sell for maximum profit and calculates expected revenue.</li>
                        </ul>
                    </div>
                    
                    <div className="space-y-2">
                        <h3 className="font-headline text-lg font-semibold text-foreground">5. AI Chat Assistant</h3>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><span className="font-semibold">Context-Aware:</span> An integrated assistant answers natural language questions using the latest detection, forecast, and market data as context.</li>
                        </ul>
                    </div>

                     <div className="space-y-2">
                        <h3 className="font-headline text-lg font-semibold text-foreground">6. Firebase Integration</h3>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><span className="fontsemibold">User Management:</span> Firebase Authentication handles the entire user lifecycle.</li>
                            <li><span className="font-semibold">Security:</span> The app uses standard Firebase client-side practices, with security enforced by Firestore Security Rules.</li>
                        </ul>
                    </div>
                </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                    <Globe className="h-5 w-5" />
                    <span className="sr-only">Change language</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                 {Object.entries(supportedLngs).map(([code, name]) => (
                    <DropdownMenuItem
                        key={code}
                        onClick={() => i18n.changeLanguage(code)}
                        disabled={i18n.resolvedLanguage === code}
                    >
                        {name}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Profile menu">
              <UserRound className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push('/profile')}>
              <UserRound className="mr-2 h-4 w-4" />
              {t('profile') || 'Profile'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              {t('logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>
    </header>
  );
}
