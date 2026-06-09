

"use client";

import type { ForecastResult } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart as BarChartIcon, CalendarDays, PackageCheck, Shovel, Trees } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Skeleton } from '../ui/skeleton';
import { formatNumber } from '@/lib/utils';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

interface ForecastTabProps {
  result: ForecastResult | null;
  isLoading: boolean;
}

export function ForecastTab({ result, isLoading }: ForecastTabProps) {
  const { t } = useTranslation();
  if (isLoading) {
    return <ForecastSkeleton />;
  }

  if (!result) {
    return (
      <Card>
        <CardContent className="flex h-[50vh] flex-col items-center justify-center gap-4 p-12 text-center">
          <BarChartIcon className="h-16 w-16 text-muted-foreground" />
          <h3 className="font-headline text-xl font-semibold">{t('no_forecast_data_title')}</h3>
          <p className="text-muted-foreground">{t('no_forecast_data_desc')}</p>
        </CardContent>
      </Card>
    );
  }

  const { yield_now_kg, sellable_kg, daily, harvest_plan, harvestWindow, notes } = result;

  const chartConfig = {
    ready_kg: {
      label: t('ready_kg'),
      color: 'hsl(var(--primary))',
    },
  };

  const totalHarvest = harvest_plan.reduce((a, b) => a + b.harvest_kg, 0);

  return (
    <div className="grid auto-rows-max items-start gap-4 md:gap-8 lg:col-span-2">
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-headline text-base">{t('current_yield')}</CardTitle>
            <Trees className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatNumber(yield_now_kg)} kg</div>
            <p className="text-xs text-muted-foreground">{t('current_yield_desc')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-headline text-base">{t('sellable_yield')}</CardTitle>
            <PackageCheck className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatNumber(sellable_kg)} kg</div>
            <p className="text-xs text-muted-foreground">{t('sellable_yield_desc')}</p>
          </CardContent>
        </Card>
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="font-headline text-base">{t('harvest_window')}</CardTitle>
                <CalendarDays className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                {harvestWindow ? (
                <>
                    <div className="text-xl font-bold">
                        {format(new Date(harvestWindow.start), 'MMM d')} - {format(new Date(harvestWindow.end), 'MMM d')}
                    </div>
                    <p className="text-xs text-muted-foreground">{t('harvest_window_desc')}</p>
                </>
                ) : (
                <>
                    <div className="text-xl font-bold">-</div>
                    <p className="text-xs text-muted-foreground">{t('no_harvest_scheduled')}</p>
                </>
                )}
            </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-headline text-base">{t('total_forecasted')}</CardTitle>
            <Shovel className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatNumber(totalHarvest)} kg</div>
            <p className="text-xs text-muted-foreground">{t('total_forecasted_desc')}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-headline">{t('ready_harvest_forecast')}</CardTitle>
            <CardDescription>{t('ready_harvest_forecast_desc', { days: daily.length })}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px] w-full">
              <AreaChart data={daily} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                <YAxis unit="kg" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="ready_kg" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.3} name={t('ready_kg')}/>
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-headline">{t('harvest_plan')}</CardTitle>
            <CardDescription>{t('harvest_plan_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[300px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('date')}</TableHead>
                  <TableHead className="text-right">{t('harvest_kg')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {harvest_plan.length > 0 ? harvest_plan.map(item => (
                  <TableRow key={item.date}>
                    <TableCell>{new Date(item.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</TableCell>
                    <TableCell className="text-right font-medium">{formatNumber(item.harvest_kg)}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground">{t('no_harvest_in_period')}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ForecastSkeleton() {
  return (
    <div className="grid auto-rows-max items-start gap-4 md:gap-8 lg:col-span-2">
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-5 w-2/4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-1/2 mb-2" />
               <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[300px] w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[300px] w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
