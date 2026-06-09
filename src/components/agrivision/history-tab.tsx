"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { History, Calendar, Sprout, TrendingUp, ChevronRight, Search, RefreshCw } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Button } from "@/components/ui/button";
import { getInteractionHistory, type HistoryItem } from "@/app/actions";

const FLOW_LABELS: Record<string, string> = {
  'plant-analysis':  'Plant Analysis',
  'yield-forecast':  'Yield Forecast',
  'market-price':    'Market Price',
  'chat-assistant':  'AI Advisor',
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high:   'text-emerald-600',
  medium: 'text-yellow-600',
  low:    'text-red-500',
};

export function HistoryTab() {
  const [items, setItems]       = useState<HistoryItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    const res = await getInteractionHistory(100);
    if (res.success && res.data) setItems(res.data);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = items.filter(i => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.crop.toLowerCase().includes(q) ||
      i.location.toLowerCase().includes(q) ||
      i.flowType.toLowerCase().includes(q) ||
      FLOW_LABELS[i.flowType]?.toLowerCase().includes(q)
    );
  });

  const totalYield    = items.reduce((s, i) => s + (i.expectedYield ?? 0), 0);
  const avgDetections = items.filter(i => i.detections !== null).length > 0
    ? items.reduce((s, i) => s + (i.detections ?? 0), 0) /
      items.filter(i => i.detections !== null).length
    : 0;

  return (
    <div className="space-y-6 animate-in fade-in-0 duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-headline text-2xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-6 w-6 text-primary" />
            Analysis History
          </h2>
          <p className="text-muted-foreground text-sm">Review and compare your past field analysis reports.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search crop, location..."
              className="pl-9 bg-muted/30"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon" onClick={load} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="bg-primary/5 border-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Total Analyses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold flex items-baseline gap-2">
              {loading ? <Skeleton className="h-8 w-16" /> : items.length}
              <Badge variant="outline" className="text-[10px] font-bold bg-background">All Time</Badge>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Avg. Detections</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold italic text-primary">
              {loading ? <Skeleton className="h-8 w-16" /> : formatNumber(avgDetections, 1)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Across plant analyses</p>
          </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Total Forecasted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">
              {loading ? <Skeleton className="h-8 w-24" /> : <>{formatNumber(totalYield, 0)} <span className="text-sm font-normal text-muted-foreground">kg</span></>}
            </div>
            <div className="text-[10px] text-muted-foreground font-bold mt-1">
              {items.filter(i => i.expectedYield !== null).length} yield forecasts
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-lg border-primary/5 overflow-hidden">
        <ScrollArea className="h-[500px]">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : filtered.length > 0 ? (
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur-md">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[180px] font-bold uppercase text-[10px] tracking-widest">Date</TableHead>
                  <TableHead className="font-bold uppercase text-[10px] tracking-widest">Details</TableHead>
                  <TableHead className="font-bold uppercase text-[10px] tracking-widest">Type</TableHead>
                  <TableHead className="font-bold uppercase text-[10px] tracking-widest">Est. Yield</TableHead>
                  <TableHead className="font-bold uppercase text-[10px] tracking-widest">Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(item => (
                  <TableRow key={item.id} className="group hover:bg-muted/30 transition-colors cursor-pointer">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
                          <Calendar className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm">{format(parseISO(item.date), 'MMM dd, yyyy')}</span>
                          <span className="text-[10px] text-muted-foreground">{format(parseISO(item.date), 'hh:mm a')}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold flex items-center gap-1 italic">
                          <Sprout className="h-3 w-3 text-primary" />
                          {item.crop}
                        </span>
                        <span className="text-xs text-muted-foreground">{item.location}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">{FLOW_LABELS[item.flowType] ?? item.flowType}</span>
                        <span className={`text-[10px] font-bold ${CONFIDENCE_COLOR[item.confidence] ?? ''}`}>
                          {item.confidence} confidence
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {item.expectedYield !== null ? (
                        <>
                          <div className="text-sm font-bold tabular-nums text-primary">{formatNumber(item.expectedYield, 1)} kg</div>
                          <div className="text-[10px] text-muted-foreground italic">forecasted</div>
                        </>
                      ) : item.detections !== null ? (
                        <>
                          <div className="text-sm font-bold tabular-nums">{item.detections}</div>
                          <div className="text-[10px] text-muted-foreground">detections</div>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={item.status === 'Corrected' ? 'default' : 'secondary'}
                        className="text-[10px] font-bold px-2 py-0"
                      >
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center p-20 text-center">
              <div className="p-4 bg-primary/5 rounded-full mb-4">
                <History className="h-12 w-12 text-primary/30" />
              </div>
              <h3 className="font-headline text-lg font-semibold tracking-tight">
                {search ? 'No results match your search' : 'No History Records Found'}
              </h3>
              <p className="text-sm text-muted-foreground max-w-xs mt-2">
                {search
                  ? 'Try a different search term.'
                  : <>Start your first field analysis in the <span className="text-primary font-bold italic underline">Detect</span> tab to see records here.</>
                }
              </p>
            </div>
          )}
        </ScrollArea>
      </Card>

      <div className="p-4 rounded-xl border border-dashed border-primary/20 bg-primary/5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-background rounded-full shadow-sm">
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold italic">Comparative Insights</p>
            <p className="text-xs text-muted-foreground">
              {items.filter(i => i.hasCorrected).length} of {items.length} analyses were corrected by farmers — powering model improvement.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
