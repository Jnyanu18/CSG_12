
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { YieldForecastOutput } from "@/lib/types";
import { format, parseISO } from "date-fns";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../ui/chart";
import { formatNumber } from "@/lib/utils";
import { AlertTriangle, ChevronDown, CheckCircle, Info, Package, Sparkles, TrendingUp, Wheat } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { recordActualOutcome, submitFarmerCorrection } from "@/app/actions";
import { useToast } from "@/hooks/use-toast";
import type { FailurePrediction } from "@/lib/types";

interface AdapterInfo {
    adapterId: string;
    multiplier: number;
    trainingSize: number;
    explanation: string;
}

interface YieldForecastTabProps {
    result: YieldForecastOutput | null;
    isLoading: boolean;
    interactionId?: string;
    failurePrediction?: FailurePrediction;
    onRetry?: () => void;
    adapterApplied?: boolean;
    adapterInfo?: AdapterInfo;
}

export function YieldForecastTab({
    result,
    isLoading,
    interactionId,
    failurePrediction,
    onRetry,
    adapterApplied,
    adapterInfo,
}: YieldForecastTabProps) {
    const { t } = useTranslation();
    const { toast } = useToast();

    const [isReasoningOpen, setIsReasoningOpen] = useState(false);

    // Record actual harvest
    const [actualKg, setActualKg] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [outcomeRecorded, setOutcomeRecorded] = useState(false);

    // Farmer correction + cross-validation
    const [correctionKg, setCorrectionKg] = useState('');
    const [isCorrecting, setIsCorrecting] = useState(false);
    const [correctionValidation, setCorrectionValidation] = useState<{
        recommendation: 'accept' | 'pending' | 'reject';
        confidenceScore: number;
        reason: string;
        readyForTraining: boolean;
    } | null>(null);

    // Adapter milestone — shown when a new adapter is built from corrections
    const [adapterMilestone, setAdapterMilestone] = useState<{
        trainingSize: number;
        multiplier: number;
    } | null>(null);

    useEffect(() => {
        setOutcomeRecorded(false);
        setActualKg('');
        setCorrectionKg('');
        setCorrectionValidation(null);
        setAdapterMilestone(null);
    }, [interactionId]);

    async function handleSubmitCorrection() {
        if (!interactionId || !correctionKg) return;
        const value = parseFloat(correctionKg);
        if (isNaN(value) || value < 0) return;
        setIsCorrecting(true);
        const res = await submitFarmerCorrection(interactionId, value);
        setIsCorrecting(false);
        if (res.success && res.validation) {
            setCorrectionValidation(res.validation);
            if (res.adapterBuilt && res.trainingSize && res.calibrationMultiplier) {
                setAdapterMilestone({
                    trainingSize: res.trainingSize,
                    multiplier:   res.calibrationMultiplier,
                });
            }
        } else {
            toast({ variant: 'destructive', title: 'Could not save correction', description: res.error });
        }
    }

    async function handleRecordHarvest() {
        if (!interactionId || !actualKg) return;
        const value = parseFloat(actualKg);
        if (isNaN(value) || value < 0) return;
        setIsSubmitting(true);
        const res = await recordActualOutcome(interactionId, value);
        setIsSubmitting(false);
        if (res.success) {
            setOutcomeRecorded(true);
            toast({ title: 'Harvest recorded', description: `Accuracy: ${res.data?.accuracyPercent.toFixed(1)}%` });
        } else {
            toast({ variant: 'destructive', title: 'Could not save', description: res.error });
        }
    }

    if (isLoading) {
        return <YieldForecastSkeleton />;
    }

    if (failurePrediction && !failurePrediction.shouldProceed) {
        return (
            <Card className="border-destructive/40 bg-destructive/5">
                <CardContent className="p-6 space-y-4">
                    <div className="flex items-center gap-3">
                        <AlertTriangle className="h-6 w-6 text-destructive shrink-0" />
                        <h3 className="font-headline text-lg font-semibold text-destructive">High failure risk detected</h3>
                    </div>
                    {failurePrediction.reasons.length > 0 && (
                        <ul className="space-y-1.5">
                            {failurePrediction.reasons.map((r, i) => (
                                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive/70" />
                                    {r}
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="text-sm text-muted-foreground">{failurePrediction.recommendation}</p>
                    <Button variant="outline" onClick={onRetry}>Retry</Button>
                </CardContent>
            </Card>
        );
    }

    if (!result) {
        return (
            <Card>
                <CardContent className="flex h-[50vh] flex-col items-center justify-center gap-4 p-12 text-center">
                    <Wheat className="h-16 w-16 text-muted-foreground" />
                    <h3 className="font-headline text-xl font-semibold">{t('no_yield_data_title')}</h3>
                    <p className="text-muted-foreground">{t('no_yield_data_desc')}</p>
                </CardContent>
            </Card>
        );
    }

    const { totalExpectedYieldKg, yieldCurve, confidence, notes, reasoning } = result;

    const chartConfig = {
        yieldKg: {
            label: t('yield_kg'),
            color: 'hsl(var(--primary))',
        },
    };

    const formattedYieldCurve = yieldCurve.map(d => ({
        ...d,
        date: parseISO(d.date).getTime(),
    }));

    const confidenceLabel =
        failurePrediction?.riskLevel === 'low'    ? 'high'
        : failurePrediction?.riskLevel === 'medium' ? 'medium'
        : failurePrediction?.riskLevel === 'high'   ? 'low'
        : null;
    const confidenceDot =
        failurePrediction?.riskLevel === 'low'    ? 'bg-green-500'
        : failurePrediction?.riskLevel === 'medium' ? 'bg-yellow-500'
        : 'bg-red-500';

    return (
        <div className="grid auto-rows-max items-start gap-4 md:gap-8 lg:col-span-2">

            {/* Metric cards */}
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="font-headline text-base">{t('total_exp_yield')}</CardTitle>
                        <Package className="h-5 w-5 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="font-headline text-3xl font-semibold tabular-nums">{formatNumber(totalExpectedYieldKg)} kg</div>
                        <p className="text-xs text-muted-foreground">{t('total_exp_yield_desc')}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="font-headline text-base">{t('forecast_confidence')}</CardTitle>
                        <TrendingUp className="h-5 w-5 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="font-headline text-3xl font-semibold tabular-nums">{(confidence * 100).toFixed(0)}%</div>
                        <p className="text-xs text-muted-foreground">{t('forecast_confidence_desc')}</p>
                        {failurePrediction && confidenceLabel && (
                            <div className="mt-2 flex items-center gap-1.5">
                                <span className={`h-2 w-2 rounded-full ${confidenceDot}`} />
                                <span className="text-xs text-muted-foreground">
                                    Prediction confidence: {confidenceLabel}
                                </span>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* AI-adjusted prediction banner — shown when an active adapter calibrated this result */}
            {adapterApplied && adapterInfo && (
                <Card className="border-primary/30 bg-primary/5">
                    <CardContent className="flex items-start gap-3 p-4">
                        <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-primary">AI-adjusted prediction</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Based on {adapterInfo.trainingSize} farmer corrections, this prediction has been
                                automatically calibrated for your conditions.
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">{adapterInfo.explanation}</p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Charts */}
            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="font-headline">{t('yield_curve_forecast')}</CardTitle>
                        <CardDescription>{notes}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ChartContainer config={chartConfig} className="h-[400px] w-full">
                            <AreaChart data={formattedYieldCurve} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                <CartesianGrid vertical={false} strokeDasharray="4 4" />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={(value) => format(new Date(value), 'MMM dd')}
                                    type="number"
                                    scale="time"
                                    domain={['dataMin', 'dataMax']}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <YAxis unit="kg" tickLine={false} axisLine={false} width={36} />
                                <ChartTooltip
                                    cursor={false}
                                    content={
                                        <ChartTooltipContent
                                            formatter={(value, name, props) => (
                                                <div className="flex flex-col">
                                                    <span>{format(new Date(props.payload.date), 'MMM dd, yyyy')}</span>
                                                    <span className="font-bold">{`${formatNumber(value as number)} kg`}</span>
                                                </div>
                                            )}
                                            labelFormatter={() => ''}
                                        />
                                    }
                                />
                                <Area
                                    type="monotone"
                                    dataKey="yieldKg"
                                    stroke="hsl(var(--primary))"
                                    fill="hsl(var(--primary))"
                                    fillOpacity={0.3}
                                    name={t('yield_kg')}
                                />
                            </AreaChart>
                        </ChartContainer>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="font-headline flex items-center gap-2">
                            <Info className="h-5 w-5" />
                            {t('ai_reasoning_title')}
                        </CardTitle>
                        <CardDescription>{t('ai_reasoning_desc')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-muted-foreground">
                        <Collapsible open={isReasoningOpen} onOpenChange={setIsReasoningOpen}>
                            <div className="flex items-center justify-between">
                                <div className="text-xs text-muted-foreground">How AI calculated this</div>
                                <CollapsibleTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-8 px-2">
                                        {isReasoningOpen ? "Hide" : "Show"}
                                        <ChevronDown className={isReasoningOpen ? "rotate-180 transition-transform" : "transition-transform"} />
                                    </Button>
                                </CollapsibleTrigger>
                            </div>
                            <CollapsibleContent className="mt-3 rounded-xl bg-muted p-4 text-sm text-muted-foreground ring-1 ring-border/60">
                                <p className="whitespace-pre-wrap leading-relaxed">{reasoning}</p>
                            </CollapsibleContent>
                        </Collapsible>
                    </CardContent>
                </Card>
            </div>

            {/* Record actual harvest */}
            {interactionId && (
                outcomeRecorded ? (
                    <Card className="border-primary/30 bg-primary/5">
                        <CardContent className="flex items-center gap-3 p-4">
                            <CheckCircle className="h-5 w-5 text-primary shrink-0" />
                            <p className="text-sm text-muted-foreground">Actual harvest recorded. Thank you for improving the model.</p>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="font-headline text-base">Record Actual Harvest</CardTitle>
                            <CardDescription>
                                Enter what you actually harvested to improve AI accuracy. Predicted:{' '}
                                <span className="font-medium text-foreground">{formatNumber(totalExpectedYieldKg)} kg</span>
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex gap-3">
                                <Input
                                    type="number"
                                    min={0}
                                    placeholder="Actual kg harvested"
                                    value={actualKg}
                                    onChange={e => setActualKg(e.target.value)}
                                    className="max-w-[200px]"
                                />
                                <Button onClick={handleRecordHarvest} disabled={isSubmitting || !actualKg}>
                                    {isSubmitting ? 'Saving...' : 'Submit'}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )
            )}

            {/* Correct AI prediction */}
            {interactionId && (
                correctionValidation ? (
                    <>
                        <CorrectionValidationBanner validation={correctionValidation} />
                        {adapterMilestone && (
                            <Card className="border-primary/40 bg-primary/5">
                                <CardContent className="flex items-start gap-3 p-4">
                                    <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-sm font-medium text-primary">New learning milestone reached</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            AI accuracy updated from your corrections. A calibration adapter (×{adapterMilestone.multiplier}) was
                                            built from {adapterMilestone.trainingSize} validated corrections and will be applied to all future forecasts.
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </>
                ) : (
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="font-headline text-base">Correct AI Prediction</CardTitle>
                            <CardDescription>
                                Think the forecast was wrong? Enter what you believe the correct yield should be.
                                Your correction will be cross-validated against similar cases.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex gap-3">
                                <Input
                                    type="number"
                                    min={0}
                                    placeholder="Correct yield (kg)"
                                    value={correctionKg}
                                    onChange={e => setCorrectionKg(e.target.value)}
                                    className="max-w-[200px]"
                                />
                                <Button
                                    variant="outline"
                                    onClick={handleSubmitCorrection}
                                    disabled={isCorrecting || !correctionKg}
                                >
                                    {isCorrecting ? 'Validating...' : 'Submit Correction'}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )
            )}
        </div>
    );
}


function CorrectionValidationBanner({
    validation,
}: {
    validation: {
        recommendation: 'accept' | 'pending' | 'reject';
        confidenceScore: number;
        reason: string;
        readyForTraining: boolean;
    };
}) {
    if (validation.recommendation === 'accept') {
        return (
            <Card className="border-green-500/30 bg-green-500/5">
                <CardContent className="flex items-start gap-3 p-4">
                    <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-medium text-green-700">Correction validated</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{validation.reason}</p>
                        {validation.readyForTraining && (
                            <p className="text-xs text-green-600 mt-1">Ready for model training.</p>
                        )}
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (validation.recommendation === 'pending') {
        return (
            <Card className="border-yellow-500/30 bg-yellow-500/5">
                <CardContent className="flex items-start gap-3 p-4">
                    <Info className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-medium text-yellow-700">Correction saved, needs more data</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{validation.reason}</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="flex items-start gap-3 p-4">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                    <p className="text-sm font-medium text-destructive">Correction conflicts with patterns</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{validation.reason}</p>
                </div>
            </CardContent>
        </Card>
    );
}

function YieldForecastSkeleton() {
    return (
        <div className="grid auto-rows-max items-start gap-4 md:gap-8 lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-2">
                {[...Array(2)].map((_, i) => (
                    <Card key={i}>
                        <CardHeader className="pb-2">
                            <Skeleton className="h-5 w-3/5" />
                        </CardHeader>
                        <CardContent>
                            <Skeleton className="h-8 w-2/5 mb-2" />
                            <Skeleton className="h-3 w-4/5" />
                        </CardContent>
                    </Card>
                ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <Skeleton className="h-6 w-1/2" />
                        <Skeleton className="h-4 w-3/4" />
                    </CardHeader>
                    <CardContent>
                        <Skeleton className="h-[400px] w-full" />
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <Skeleton className="h-6 w-1/2" />
                        <Skeleton className="h-4 w-3/4" />
                    </CardHeader>
                    <CardContent>
                        <Skeleton className="h-20 w-full" />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
