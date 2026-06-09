
"use client";

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { MarketPriceForecastingOutput } from '@/ai/flows/market-price-forecasting';
import { runMarketPriceForecasting, recordActualOutcome } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Line, LineChart, CartesianGrid, ReferenceLine, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { formatNumber } from '@/lib/utils';
import { CalendarCheck, CheckCircle, DollarSign, LineChart as LineChartIcon, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface MarketTabProps {
  sellableKg: number;
  district: string;
  onMarketResultChange: (result: MarketPriceForecastingOutput | null) => void;
}

const formSchema = z.object({
  district: z.string().min(2, { message: 'District is required.' }),
  daysAhead: z.coerce.number().min(7, { message: 'Must be at least 7 days.' }).max(30, { message: 'Cannot exceed 30 days.' }),
});

export function MarketTab({ sellableKg, district, onMarketResultChange }: MarketTabProps) {
  const [result, setResult] = useState<MarketPriceForecastingOutput | null>(null);
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actualPrice, setActualPrice] = useState('');
  const [isPriceSubmitting, setIsPriceSubmitting] = useState(false);
  const [priceOutcomeRecorded, setPriceOutcomeRecorded] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    setPriceOutcomeRecorded(false);
    setActualPrice('');
  }, [interactionId]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      district: district || 'Coimbatore',
      daysAhead: 14,
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    setResult(null);
    setInteractionId(null);
    onMarketResultChange(null);

    const response = await runMarketPriceForecasting({ ...values, readyKg: sellableKg });
    setIsLoading(false);

    if (response.success && response.data) {
      setResult(response.data);
      setInteractionId(response.data.interactionId ?? null);
      onMarketResultChange(response.data);
    } else {
      toast({
        variant: 'destructive',
        title: 'Forecast Failed',
        description: response.error,
      });
    }
  }

  async function handleRecordPrice() {
    if (!interactionId || !actualPrice) return;
    const value = parseFloat(actualPrice);
    if (isNaN(value) || value < 0) return;
    setIsPriceSubmitting(true);
    const res = await recordActualOutcome(interactionId, value);
    setIsPriceSubmitting(false);
    if (res.success) {
      setPriceOutcomeRecorded(true);
      toast({ title: 'Price recorded', description: `Accuracy: ${res.data?.accuracyPercent.toFixed(1)}%` });
    } else {
      toast({ variant: 'destructive', title: 'Could not save', description: res.error });
    }
  }

  const chartConfig = {
    price: { label: 'Price (INR/kg)', color: 'hsl(var(--primary))' },
  };

  const expectedRevenue = result ? sellableKg * result.bestPrice : 0;

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-1 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="font-headline">{t('market_forecast')}</CardTitle>
            <CardDescription>{t('market_forecast_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="district"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('district')}</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Coimbatore" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="daysAhead"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('forecast_days')}</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={isLoading} className="w-full">
                  {isLoading ? t('forecasting') : t('forecast_prices')}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
        {result && (
          <>
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">{t('profit_outlook')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-start justify-between">
                        <div className="text-sm">
                            <div className="text-muted-foreground">{t('best_sell_date')}</div>
                            <div className="font-bold text-lg">{new Date(result.bestDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</div>
                        </div>
                        <CalendarCheck className="w-8 h-8 text-primary"/>
                    </div>
                     <div className="flex items-start justify-between">
                        <div className="text-sm">
                            <div className="text-muted-foreground">{t('est_price')}</div>
                            <div className="font-bold text-lg tabular-nums">INR {formatNumber(result.bestPrice, 2)} / kg</div>
                        </div>
                        <TrendingUp className="w-8 h-8 text-primary"/>
                    </div>
                     <div className="flex items-start justify-between">
                        <div className="text-sm">
                            <div className="text-muted-foreground">{t('expected_revenue')}</div>
                            <div className="font-bold text-lg tabular-nums">INR {formatNumber(expectedRevenue, 0)}</div>
                        </div>
                        <DollarSign className="w-8 h-8 text-primary"/>
                    </div>
                </CardContent>
            </Card>

            {interactionId && (
              priceOutcomeRecorded ? (
                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="flex items-center gap-3 p-4">
                    <CheckCircle className="h-5 w-5 text-primary shrink-0" />
                    <p className="text-sm text-muted-foreground">Actual price recorded. Thank you for improving the model.</p>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="font-headline text-base">Was this price accurate?</CardTitle>
                    <CardDescription>Enter the actual market price you saw. Predicted best price: <span className="font-medium text-foreground">INR {formatNumber(result.bestPrice, 2)}/kg</span></CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-3">
                      <Input
                        type="number"
                        min={0}
                        placeholder="Actual price (INR/kg)"
                        value={actualPrice}
                        onChange={e => setActualPrice(e.target.value)}
                        className="max-w-[200px]"
                      />
                      <Button onClick={handleRecordPrice} disabled={isPriceSubmitting || !actualPrice}>
                        {isPriceSubmitting ? 'Saving...' : 'Submit'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            )}
          </>
        )}
      </div>
      <div className="md:col-span-2">
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="font-headline">{t('price_forecast_chart')}</CardTitle>
            <CardDescription>
              {result ? t('price_forecast_chart_desc', { district: form.getValues('district'), days: form.getValues('daysAhead') }) : t('run_forecast_to_see_trends')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[400px] w-full" /> : 
            !result ? (
                <div className="flex h-[400px] items-center justify-center">
                  <div className="mx-auto w-full max-w-md">
                    <Card className="bg-card/60">
                      <CardContent className="flex flex-col items-center justify-center gap-4 p-10 text-center">
                        <LineChartIcon className="h-12 w-12 text-muted-foreground" />
                        <div>
                          <h3 className="font-headline text-xl font-semibold">{t('no_price_data')}</h3>
                          <p className="mt-1 text-muted-foreground">{t('no_price_data_desc')}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-[400px] w-full">
                <LineChart data={result.forecast} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid vertical={false} strokeDasharray="4 4" />
                  <XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                  <YAxis tickFormatter={(value) => `INR ${value}`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ReferenceLine
                    x={result.bestDate}
                    stroke="hsl(var(--primary))"
                    strokeOpacity={0.35}
                    strokeDasharray="4 4"
                  />
                  <Line type="monotone" dataKey="price" stroke="hsl(var(--primary))" strokeWidth={2} name="Price" dot={false} />
                </LineChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
