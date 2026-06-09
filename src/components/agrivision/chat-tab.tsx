
"use client";

import { useState, useRef, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, Sparkles } from 'lucide-react';
import type { ChatMessage } from '@/lib/types';
import { runChatAssistant } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { MarketPriceForecastingOutput } from '@/ai/flows/market-price-forecasting';
import type { AppControls, DetectionResult, ForecastResult } from '@/lib/types';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';

interface ChatTabProps {
  appState: {
    controls: AppControls;
    detectionResult: DetectionResult | null;
    forecastResult: ForecastResult | null;
    marketResult: MarketPriceForecastingOutput | null;
  }
  chatHistory: ChatMessage[];
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

export function ChatTab({ appState, chatHistory, setChatHistory }: ChatTabProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  const suggestions = [
    "When should I harvest for best profit?",
    "How can I increase yield this week?",
    "What risks should I watch for?",
  ];

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({ top: scrollAreaRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [chatHistory]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const newUserMessage: ChatMessage = { id: Date.now().toString(), role: 'user', content: input };
    setChatHistory(prev => [...prev, newUserMessage]);
    setInput('');
    setIsLoading(true);

    const response = await runChatAssistant({
      query: input,
      detectionResult: appState.detectionResult,
      forecastResult: appState.forecastResult,
      marketResult: appState.marketResult,
    });
    
    setIsLoading(false);
    
    if (response.success && response.data) {
      const newAssistantMessage: ChatMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: response.data.reply };
      setChatHistory(prev => [...prev, newAssistantMessage]);
    } else {
      toast({
        variant: 'destructive',
        title: 'Assistant Error',
        description: response.error,
      });
      setChatHistory(prev => prev.slice(0, -1)); // Remove the user message if API fails
    }
  };

  return (
    <div className="flex min-h-[60vh] flex-col md:h-[calc(100vh-16rem)]">
      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
        <div className="space-y-6">
          {chatHistory.length === 0 ? (
            <Card className="mx-auto w-full max-w-2xl">
              <CardContent className="flex flex-col items-center justify-center gap-4 p-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-border/60">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-headline text-xl font-semibold">{t('ai_assistant_title')}</h3>
                  <p className="mt-1 text-muted-foreground">{t('ai_assistant_desc')}</p>
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {suggestions.map(s => (
                    <button
                      key={s}
                      type="button"
                      className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground ring-1 ring-border/60 transition-colors hover:bg-muted/70 hover:text-foreground"
                      onClick={() => setInput(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            chatHistory.map(message => (
              <div key={message.id} className={cn('flex items-start gap-4', message.role === 'user' ? 'justify-end' : '')}>
                {message.role === 'assistant' && (
                  <Avatar className="h-8 w-8">
                    <AvatarFallback><Sparkles className="h-4 w-4" /></AvatarFallback>
                  </Avatar>
                )}
                <div className={cn(
                  'max-w-md rounded-2xl p-3 text-sm leading-relaxed shadow-sm ring-1 ring-border/60',
                  message.role === 'user' ? 'bg-primary text-primary-foreground ring-primary/20' : 'bg-card/70'
                )}>
                  {message.content}
                </div>
              </div>
            ))
          )}
           {isLoading && (
              <div className="flex items-start gap-4">
                <Avatar className="h-8 w-8">
                  <AvatarFallback><Sparkles className="h-4 w-4" /></AvatarFallback>
                </Avatar>
                <div className="max-w-md rounded-2xl p-3 text-sm bg-card/70 animate-pulse shadow-sm ring-1 ring-border/60">
                    {t('thinking')}
                </div>
              </div>
            )}
        </div>
      </ScrollArea>
      <div className="border-t bg-background/70 p-4 backdrop-blur">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={t('ask_about_yield')}
            disabled={isLoading}
          />
          <Button type="submit" disabled={isLoading || !input.trim()}>
            <Send className="h-4 w-4" />
            <span className="sr-only">Send</span>
          </Button>
        </form>
      </div>
    </div>
  );
}
