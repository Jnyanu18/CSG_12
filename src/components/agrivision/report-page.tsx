

'use client';

import type { AppControls, DetectionResult, ForecastResult } from '@/lib/types';
import type { MarketPriceForecastingOutput } from '@/ai/flows/market-price-forecasting';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { formatNumber } from '@/lib/utils';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer } from '../ui/chart';
import { Separator } from '../ui/separator';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

interface ReportPageProps {
  imageUrl: string | null;
  detectionResult: DetectionResult | null;
  forecastResult: ForecastResult | null;
  marketResult: MarketPriceForecastingOutput | null;
  controls: AppControls;
}

const stageColors: { [key: string]: string } = {
  flower: "bg-pink-400",
  immature: "bg-green-500",
  breaker: "bg-lime-400",
  ripening: "bg-amber-500",
  pink: "bg-rose-400",
  mature: "bg-red-500",
  overripened: "bg-purple-700",
  fruitlet: "bg-yellow-300",
  default: "bg-gray-400",
};

const getStageColor = (stage: string) => {
  return stageColors[stage.toLowerCase()] || stageColors.default;
}

export function ReportPage({
  imageUrl,
  detectionResult,
  forecastResult,
  marketResult,
  controls,
}: ReportPageProps) {
  const { t } = useTranslation();
  if (!detectionResult || !forecastResult || !marketResult) {
    return null;
  }
  
  const totalHarvest = forecastResult.harvest_plan.reduce((a, b) => a + b.harvest_kg, 0);
  const expectedRevenue = forecastResult.sellable_kg * marketResult.bestPrice;
  const chartConfig = { ready_kg: { label: t('ready_kg'), color: 'hsl(var(--primary))' } };

  const formattedDaily = forecastResult.daily.map(d => ({
    ...d,
    date: parseISO(d.date).getTime(),
  }));

  return (
    <div className="absolute left-0 top-0 -z-50 h-full w-full bg-background font-body print:relative print:z-auto">
        <div className="hidden print:block p-8">
            <header className="flex items-center justify-between pb-8">
                <div>
                    <h1 className="font-headline text-3xl font-bold text-primary">{t('agrivision_ai')} Report</h1>
                    <p className="text-muted-foreground">{t('report_analysis_date', { date: new Date().toLocaleDateString() })}</p>
                </div>
                <p className="text-sm text-muted-foreground">{t('report_district', { district: controls.district })}</p>
            </header>

            <div className="space-y-6">
                <div className="grid grid-cols-3 gap-6">
                    {/* Column 1: Image & Detection */}
                    <div className="col-span-1 space-y-4">
                        <Card>
                            <CardHeader><CardTitle className="font-headline text-lg">{t('report_analyzed_image')}</CardTitle></CardHeader>
                            <CardContent>
                                {imageUrl && <Image src={imageUrl} alt="Plant Analysis" width={400} height={300} className="rounded-lg object-cover" />}
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader><CardTitle className="font-headline text-lg">{t('report_detection_summary_for', { plant: detectionResult.plantType })}</CardTitle></CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <p>{detectionResult.summary}</p>
                                {detectionResult.stages?.map(({stage, count}) => (
                                    <div key={stage} className="flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            <span className={cn("h-2 w-2 rounded-full", getStageColor(stage))} />
                                            <span className="capitalize">{t(stage.toLowerCase(), { defaultValue: stage })}:</span>
                                        </div>
                                        <span>{count}</span>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Column 2: Key Metrics & Chart */}
                    <div className="col-span-2 space-y-4">
                        <div className="grid grid-cols-3 gap-4">
                            <MetricCard title={t('metric_current_yield')} value={`${formatNumber(forecastResult.yield_now_kg)} kg`} />
                            <MetricCard title={t('metric_sellable_yield')} value={`${formatNumber(forecastResult.sellable_kg)} kg`} />
                            <MetricCard title={t('metric_total_harvest')} value={`${formatNumber(totalHarvest)} kg`} />
                        </div>
                        <Separator />
                        <div className="grid grid-cols-3 gap-4">
                             <MetricCard title={t('metric_best_sell_date')} value={new Date(marketResult.bestDate).toLocaleDateString('en-us', {month: 'short', day: 'numeric'})} />
                            <MetricCard title={t('metric_best_price')} value={`₹${formatNumber(marketResult.bestPrice)}/kg`} />
                            <MetricCard title={t('metric_est_revenue')} value={`₹${formatNumber(expectedRevenue)}`} />
                        </div>
                        <Card>
                            <CardHeader>
                                <CardTitle className="font-headline text-lg">{t('report_ready_harvest_forecast')}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ChartContainer config={chartConfig} className="h-[250px] w-full">
                                    <AreaChart data={formattedDaily} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis 
                                            dataKey="date" 
                                            tickFormatter={(value) => format(new Date(value), 'MMM dd')}
                                            type="number"
                                            scale="time"
                                            domain={['dataMin', 'dataMax']}
                                        />
                                        <YAxis unit="kg" />
                                        <Area type="monotone" dataKey="ready_kg" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.3} />
                                    </AreaChart>
                                </ChartContainer>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
}

const MetricCard = ({title, value}: {title: string, value: string}) => (
    <Card>
        <CardHeader className="p-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-primary">{value}</div>
        </CardContent>
    </Card>
)
