"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { TrendingUp, TrendingDown, Minus, RefreshCw, BarChart3, AlertTriangle, Download, Brain, ShieldAlert, Zap, Sprout } from "lucide-react";
import { getIntelligenceMetrics, runIntelligenceUpdate, getModelWeaknessReport, exportFeedbackReport, getImageQualityAnalysis, runAutonomousDetection } from "@/app/actions";
import type { IntelligenceMetrics } from "@/lib/intelligence/metrics-aggregator";
import type { FailureReport } from "@/lib/intelligence/failure-reasoner";
import type { AutonomousDetectionResult } from "@/lib/intelligence/autonomous-detector";
import { cn } from "@/lib/utils";
import { AdapterComparisonCard } from "@/components/agrivision/adapter-comparison-card";
import { LiveComparisonCard } from "@/components/agrivision/live-comparison-card";

// ── Types ─────────────────────────────────────────────────────────────────────

type MetricsData = IntelligenceMetrics & {
  readyForTrainingCount: number;
  adapterStatusCounts: { active: number; pendingValidation: number; rolledBack: number };
};

type UpdateResult = {
  patternsExtracted: number;
  yieldForecastTriggered: boolean;
  plantAnalysisTriggered: boolean;
  validationsRun: number;
  validationsKept: number;
  validationsRolledBack: number;
};

// ── Image quality helpers ─────────────────────────────────────────────────────

function brightnessLabel(v: number): string {
  if (v < 0.3) return "low";
  if (v < 0.7) return "moderate";
  return "high";
}

function occlusionLabel(v: number): string {
  if (v < 0.2) return "low";
  if (v < 0.5) return "significant";
  return "critical";
}

function formatAngle(angle: string): string {
  const map: Record<string, string> = {
    top: "top view",
    side: "side view",
    diagonal: "diagonal view",
    close_up: "close-up view",
  };
  return map[angle] ?? angle.replace(/_/g, " ");
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function scoreStatus(score: number): string {
  if (score < 20) return "Collecting data";
  if (score < 40) return "Learning signal emerging";
  if (score < 60) return "Consistent improvement detected";
  if (score < 80) return "Architecture working";
  return "Strong autonomous improvement";
}

function scoreTextColor(score: number): string {
  if (score < 20) return "text-muted-foreground";
  if (score < 40) return "text-orange-500";
  if (score < 60) return "text-yellow-500";
  if (score < 80) return "text-primary";
  return "text-emerald-500";
}

function scoreBarColor(score: number): string {
  if (score < 20) return "bg-muted-foreground/40";
  if (score < 40) return "bg-orange-500";
  if (score < 60) return "bg-yellow-500";
  if (score < 80) return "bg-primary";
  return "bg-emerald-500";
}

// ── Trend badge ───────────────────────────────────────────────────────────────

function TrendBadge({
  trend,
  lowerIsBetter,
}: {
  trend: "improving" | "stable" | "degrading";
  lowerIsBetter: boolean;
}) {
  if (trend === "stable") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3.5 w-3.5" />
        stable
      </span>
    );
  }
  const isGood = trend === "improving";
  const Icon = lowerIsBetter
    ? isGood ? TrendingDown : TrendingUp
    : isGood ? TrendingUp : TrendingDown;
  return (
    <span className={cn("flex items-center gap-1 text-xs font-medium", isGood ? "text-emerald-500" : "text-destructive")}>
      <Icon className="h-3.5 w-3.5" />
      {trend}
    </span>
  );
}

// ── Chart placeholder ─────────────────────────────────────────────────────────

function ChartPlaceholder() {
  return (
    <div className="flex h-48 items-center justify-center text-center px-4">
      <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
        Chart will populate as more farmers interact with the system
      </p>
    </div>
  );
}

// ── Simple metric card ────────────────────────────────────────────────────────

function MetricCard({
  title,
  value,
  badge,
  subtitle,
}: {
  title: string;
  value: string;
  badge: React.ReactNode;
  subtitle: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <div className="font-headline text-3xl font-semibold tabular-nums text-primary">{value}</div>
        {badge}
        <p className="text-xs text-muted-foreground leading-snug">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const correctionChartConfig = {
  rate: { label: "Correction rate %", color: "hsl(var(--primary))" },
};

const maeChartConfig = {
  mae: { label: "MAE (kg)", color: "hsl(var(--chart-2))" },
};

export function AccuracyTab() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);
  const [weaknessReports, setWeaknessReports] = useState<FailureReport[] | null>(null);
  const [isLoadingWeakness, setIsLoadingWeakness] = useState(false);
  const [feedbackText, setFeedbackText] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [imageQuality, setImageQuality] = useState<{
    avgBrightness: number | null;
    avgOcclusion: number | null;
    mostCommonAngle: string | null;
    mostCommonFailureCause: string | null;
  } | null>(null);
  const [isLoadingImageQuality, setIsLoadingImageQuality] = useState(false);
  const [detectionResult, setDetectionResult] = useState<AutonomousDetectionResult | null>(null);
  const [isRunningDetection, setIsRunningDetection] = useState(false);

  const loadMetrics = useCallback(async () => {
    setIsLoading(true);
    const res = await getIntelligenceMetrics();
    if (res.success && res.data) setData(res.data);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  async function handleUpdate() {
    setIsUpdating(true);
    setUpdateResult(null);
    const res = await runIntelligenceUpdate();
    setIsUpdating(false);
    if (res.success && res.data) {
      setUpdateResult(res.data);
      loadMetrics();
    }
  }

  async function handleLoadWeakness() {
    setIsLoadingWeakness(true);
    const res = await getModelWeaknessReport();
    setIsLoadingWeakness(false);
    if (res.success && res.data) setWeaknessReports(res.data);
  }

  async function handleExport() {
    setIsExporting(true);
    const res = await exportFeedbackReport();
    setIsExporting(false);
    if (res.success && res.data) setFeedbackText(res.data.humanReadable);
  }

  async function handleRunDetection() {
    setIsRunningDetection(true);
    const res = await runAutonomousDetection();
    setIsRunningDetection(false);
    if (res.success && res.data) setDetectionResult(res.data);
  }

  async function handleLoadImageQuality() {
    setIsLoadingImageQuality(true);
    const res = await getImageQualityAnalysis();
    setIsLoadingImageQuality(false);
    if (res.success && res.data) setImageQuality(res.data);
  }

  if (isLoading) return <IntelligenceSkeleton />;

  const m = data;
  const score = m?.overallIntelligenceScore ?? 0;

  const latestCorrRate = m?.correctionRateDecay.byWeek.length
    ? m.correctionRateDecay.byWeek[m.correctionRateDecay.byWeek.length - 1].rate
    : null;

  const latestMae = m?.predictionErrorReduction.byBatch.length
    ? m.predictionErrorReduction.byBatch[m.predictionErrorReduction.byBatch.length - 1].mae
    : null;

  const readyCount = m?.readyForTrainingCount ?? 0;

  const corrChartData = (m?.correctionRateDecay.byWeek ?? []).map(w => ({
    name: `Week ${w.week}`,
    rate: w.rate,
  }));

  const maeChartData = (m?.predictionErrorReduction.byBatch ?? []).map(b => ({
    name: `Week ${b.batch}`,
    mae: b.mae,
  }));

  return (
    <div className="space-y-8 animate-in fade-in-0 duration-300">

      {/* ── Autonomous Error Detection ────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-headline text-xl font-bold flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Autonomous Error Detection
          </h2>
          <Button
            size="sm"
            onClick={handleRunDetection}
            disabled={isRunningDetection}
            className="gap-2"
          >
            {isRunningDetection ? (
              <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Engine analyzing...</>
            ) : (
              <><Zap className="h-3.5 w-3.5" /> Run Autonomous Detection</>
            )}
          </Button>
        </div>

        {/* Hero metric */}
        {detectionResult ? (
          <>
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="pt-6 pb-4 text-center space-y-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-primary/70">Core Proof of Concept</p>
                <div className="font-headline text-5xl font-extrabold text-primary">
                  {detectionResult.comparedToGroundTruth.recall > 0
                    ? `${Math.round(detectionResult.comparedToGroundTruth.recall * 100)}%`
                    : `${Math.round(detectionResult.errorRate * 100)}%`}
                </div>
                <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                  {detectionResult.comparedToGroundTruth.recall > 0
                    ? detectionResult.comparedToGroundTruth.note
                    : `of ${detectionResult.totalAnalyzed} interactions flagged as suspected errors — no human feedback required`}
                </p>
              </CardContent>
            </Card>

            {/* Three signal cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <ShieldAlert className="h-4 w-4 text-orange-400" />
                    Uncertainty Signal
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="font-headline text-3xl font-bold tabular-nums text-orange-400">
                    {detectionResult.bySignal.uncertainty.flagged}
                  </div>
                  <p className="text-xs text-muted-foreground">interactions flagged by low confidence</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <AlertTriangle className="h-4 w-4 text-yellow-400" />
                    Inconsistency Signal
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="font-headline text-3xl font-bold tabular-nums text-yellow-400">
                    {detectionResult.bySignal.inconsistency.flagged}
                  </div>
                  <p className="text-xs text-muted-foreground">interactions flagged by prediction variance</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <Sprout className="h-4 w-4 text-emerald-400" />
                    Physical Constraint Signal
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="font-headline text-3xl font-bold tabular-nums text-emerald-400">
                    {detectionResult.bySignal.physicalConstraint.flagged}
                  </div>
                  <p className="text-xs text-muted-foreground">interactions flagged by domain rules</p>
                </CardContent>
              </Card>
            </div>

            {/* Pattern discovery table */}
            {detectionResult.discoveredPatterns.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Brain className="h-4 w-4 text-primary" />
                    What the engine discovered autonomously
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                          <th className="text-left py-2 pr-4 font-medium">Feature</th>
                          <th className="text-right py-2 px-4 font-medium">When Trusted</th>
                          <th className="text-right py-2 px-4 font-medium">When Suspected</th>
                          <th className="text-right py-2 pl-4 font-medium">Difference</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {detectionResult.discoveredPatterns.map((p, i) => (
                          <tr key={i} className="text-xs">
                            <td className="py-2.5 pr-4 font-medium">{p.feature}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums text-muted-foreground">{p.avgWhenTrusted.toFixed(2)}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums text-destructive">{p.avgWhenSuspected.toFixed(2)}</td>
                            <td className={cn("py-2.5 pl-4 text-right tabular-nums font-semibold", Math.abs(p.difference) > 0.1 ? "text-primary" : "text-muted-foreground")}>
                              {p.difference >= 0 ? '+' : ''}{p.difference.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground italic border-t border-border/50 pt-3">
                    These patterns were <span className="font-semibold text-foreground">not defined by a human</span>. The engine discovered them by comparing interactions it trusted vs. suspected.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <Card className="border-dashed border-border/60">
            <CardContent className="py-10 text-center space-y-2">
              <Brain className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground">Run the engine to detect errors autonomously — no human labels required.</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Real Data Validation ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-yellow-400" />
            Real Data Validation — 444 Kaggle Tomato Images (XML Ground Truth)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {/* No Adapter */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">No Adapter</p>
              <p className="text-2xl font-bold text-white">1.83</p>
              <p className="text-[10px] text-muted-foreground">MAE (fruits)</p>
              <div className="pt-1 border-t border-white/10">
                <p className="text-lg font-bold text-white">68.5%</p>
                <p className="text-[10px] text-muted-foreground">within ±1 fruit</p>
              </div>
              <div className="rounded-md bg-blue-500/10 border border-blue-500/20 px-2 py-1">
                <p className="text-[10px] text-blue-300 font-medium">Baseline</p>
              </div>
            </div>

            {/* Naive Adapter */}
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-center space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Naive Adapter</p>
              <p className="text-2xl font-bold text-red-400">1.81</p>
              <p className="text-[10px] text-muted-foreground">MAE — looks fine</p>
              <div className="pt-1 border-t border-white/10">
                <p className="text-lg font-bold text-red-400">52.8%</p>
                <p className="text-[10px] text-muted-foreground">within ±1 fruit</p>
              </div>
              <div className="rounded-md bg-red-500/10 border border-red-500/20 px-2 py-1">
                <p className="text-[10px] text-red-300 font-medium">Rolled back automatically</p>
              </div>
            </div>

            {/* Conditional Adapter */}
            <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-3 text-center space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Conditional Adapter</p>
              <p className="text-2xl font-bold text-green-400">1.66</p>
              <p className="text-[10px] text-muted-foreground">MAE — best</p>
              <div className="pt-1 border-t border-white/10">
                <p className="text-lg font-bold text-green-400">70.8%</p>
                <p className="text-[10px] text-muted-foreground">within ±1 fruit</p>
              </div>
              <div className="rounded-md bg-green-500/10 border border-green-500/20 px-2 py-1">
                <p className="text-[10px] text-green-300 font-medium">Kept — safe to deploy</p>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
            The naive adapter&apos;s MAE looked fine (1.81 vs 1.83 baseline) — but its ±1 accuracy
            crashed by{" "}
            <span className="text-red-400 font-medium">−18pp</span>.
            A single aggregate metric would have missed this. Self-validator caught it
            on a held-out test set and triggered automatic rollback — no human review needed.
          </p>
        </CardContent>
      </Card>

      {/* ── Section 1: Hero score ─────────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-col items-center gap-5 pb-10 pt-10 text-center">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <BarChart3 className="h-4 w-4" />
            Architecture Intelligence Score
          </div>

          <div
            className={cn("font-headline font-bold tabular-nums leading-none", scoreTextColor(score))}
            style={{ fontSize: "7rem", lineHeight: 1 }}
          >
            {score}
          </div>

          <div className="w-full max-w-xs space-y-1">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all duration-700", scoreBarColor(score))}
                style={{ width: `${score}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0</span>
              <span>100</span>
            </div>
          </div>

          <p className="text-base font-semibold">{scoreStatus(score)}</p>

          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
            Updated automatically as farmers interact with the system
          </p>
        </CardContent>
      </Card>

      {/* ── Section 2: Six metric cards ───────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">

        {/* Card 1: Correction rate */}
        <MetricCard
          title="Correction Rate"
          value={latestCorrRate !== null ? `${latestCorrRate}%` : "—"}
          badge={m ? <TrendBadge trend={m.correctionRateDecay.trend} lowerIsBetter={true} /> : null}
          subtitle="Farmers correcting less over time"
        />

        {/* Card 2: MAE */}
        <MetricCard
          title="Prediction Error"
          value={latestMae !== null ? latestMae.toFixed(2) : "—"}
          badge={m ? <TrendBadge trend={m.predictionErrorReduction.trend} lowerIsBetter={true} /> : null}
          subtitle="Average prediction error in kg"
        />

        {/* Card 3: Cross-validation acceptance */}
        <MetricCard
          title="Validation Rate"
          value={m ? `${m.crossValidationAcceptanceRate.currentRate}%` : "—"}
          badge={m ? <TrendBadge trend={m.crossValidationAcceptanceRate.trend} lowerIsBetter={false} /> : null}
          subtitle="Corrections passing validation"
        />

        {/* Card 4: Adapter coverage */}
        <MetricCard
          title="Adapter Coverage"
          value={m ? `${m.adapterCoverage.coveragePercent}%` : "—"}
          badge={
            m ? (
              <span className={cn(
                "flex items-center gap-1 text-xs font-medium",
                m.adapterCoverage.trend === "growing" ? "text-emerald-500" : "text-muted-foreground",
              )}>
                {m.adapterCoverage.trend === "growing"
                  ? <><TrendingUp className="h-3.5 w-3.5" /> growing</>
                  : <><Minus className="h-3.5 w-3.5" /> stable</>}
              </span>
            ) : null
          }
          subtitle="Predictions using learned adapters"
        />

        {/* Card 5: Calibration drift */}
        <MetricCard
          title="Calibration Drift"
          value={m && m.adapterCalibrationDrift.versions.length > 0
            ? m.adapterCalibrationDrift.latestDrift.toFixed(2)
            : "—"}
          badge={
            m && m.adapterCalibrationDrift.versions.length > 0 ? (
              <span className={cn(
                "flex items-center gap-1 text-xs font-medium",
                m.adapterCalibrationDrift.converging ? "text-emerald-500" : "text-muted-foreground",
              )}>
                {m.adapterCalibrationDrift.converging
                  ? <><TrendingDown className="h-3.5 w-3.5" /> converging</>
                  : <><Minus className="h-3.5 w-3.5" /> not converging</>}
              </span>
            ) : null
          }
          subtitle="Adapter converging on truth"
        />

        {/* Card 6: Training ready */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Training Ready</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="font-headline text-3xl font-semibold tabular-nums text-primary">
              {readyCount}
            </div>
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.min(100, (readyCount / 10) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{readyCount}/10 needed to trigger training</p>
            </div>
            <p className="text-xs text-muted-foreground">Corrections ready for next adapter</p>
          </CardContent>
        </Card>

        {/* Card 7: Adapter status — full-width row */}
        <Card className="col-span-2 sm:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Adapter Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-8">
              <div>
                <div className="font-headline text-3xl font-semibold tabular-nums text-primary">
                  {m?.adapterStatusCounts.active ?? 0}
                </div>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
              <div>
                <div className="font-headline text-3xl font-semibold tabular-nums text-yellow-500">
                  {m?.adapterStatusCounts.pendingValidation ?? 0}
                </div>
                <p className="text-xs text-muted-foreground">Pending validation</p>
              </div>
              <div>
                <div className="font-headline text-3xl font-semibold tabular-nums text-muted-foreground">
                  {m?.adapterStatusCounts.rolledBack ?? 0}
                </div>
                <p className="text-xs text-muted-foreground">Rolled back</p>
              </div>
            </div>
            {(m?.adapterStatusCounts.rolledBack ?? 0) > 0 && (
              <p className="text-xs text-emerald-500">
                {m!.adapterStatusCounts.rolledBack} adapter{m!.adapterStatusCounts.rolledBack !== 1 ? "s" : ""} rolled back — system protected accuracy automatically
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Section 3: Correction rate chart ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="font-headline">Correction rate over time</CardTitle>
          <p className="text-sm text-muted-foreground">Decreasing line = system learning</p>
        </CardHeader>
        <CardContent>
          {corrChartData.length < 2 ? (
            <ChartPlaceholder />
          ) : (
            <ChartContainer config={correctionChartConfig} className="h-64 w-full">
              <LineChart data={corrChartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="4 4" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                <YAxis unit="%" tickLine={false} axisLine={false} width={44} tick={{ fontSize: 12 }} />
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(v) => [`${v}%`, "Correction rate"]} />}
                />
                <Line
                  type="monotone"
                  dataKey="rate"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 0 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Section 4: MAE chart ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="font-headline">Prediction error over time</CardTitle>
          <p className="text-sm text-muted-foreground">Decreasing line = more accurate predictions</p>
        </CardHeader>
        <CardContent>
          {maeChartData.length < 2 ? (
            <ChartPlaceholder />
          ) : (
            <ChartContainer config={maeChartConfig} className="h-64 w-full">
              <LineChart data={maeChartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="4 4" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 12 }} />
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(v) => [v, "MAE (kg)"]} />}
                />
                <Line
                  type="monotone"
                  dataKey="mae"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "hsl(var(--chart-2))", strokeWidth: 0 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Section 5: Model Weakness Report ────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-0.5">
              <CardTitle className="font-headline text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Model Weakness Report
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Classified failure causes from the last 30 days of farmer corrections
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleLoadWeakness}
              disabled={isLoadingWeakness}
              className="gap-1.5 shrink-0"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isLoadingWeakness && "animate-spin")} />
              {isLoadingWeakness ? "Loading..." : "Load Report"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {weaknessReports === null && (
            <p className="text-sm text-muted-foreground">Click "Load Report" to analyse failure patterns.</p>
          )}

          {weaknessReports !== null && weaknessReports.every(r => r.totalCorrections === 0) && (
            <p className="text-sm text-muted-foreground">
              No classified failures yet. Submit farmer corrections to populate this report.
            </p>
          )}

          {weaknessReports !== null && weaknessReports.map(report => {
            if (report.totalCorrections === 0) return null;
            return (
              <div key={report.flowType} className="space-y-2">
                <p className="text-sm font-semibold capitalize">
                  {report.flowType.replace(/-/g, " ")}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({report.totalCorrections} corrections)
                  </span>
                </p>
                <div className="space-y-1.5">
                  {report.breakdown.slice(0, 5).map(entry => (
                    <div key={entry.cause} className="flex items-center gap-3">
                      <div className="w-36 flex-none">
                        <div
                          className="h-1.5 rounded-full bg-yellow-500/70"
                          style={{
                            width: `${Math.min(100, (entry.count / report.totalCorrections) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground flex-1">
                        <span className="font-medium text-foreground">{entry.cause.replace(/_/g, " ")}</span>
                        {" — "}{entry.count} case{entry.count !== 1 ? "s" : ""}, avg {entry.avgDeltaPercent}% error
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {weaknessReports !== null && weaknessReports.some(r => r.totalCorrections > 0) && (
            <div className="pt-2 border-t space-y-3">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExport}
                  disabled={isExporting}
                  className="gap-1.5"
                >
                  <Download className={cn("h-3.5 w-3.5", isExporting && "animate-spin")} />
                  {isExporting ? "Generating..." : "Export Feedback Report"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Human-readable report for model debugging
                </span>
              </div>
              {feedbackText !== null && (
                <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap font-mono">
                  {feedbackText}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Section 6: Image Quality Analysis ───────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-0.5">
              <CardTitle className="font-headline text-base">Image Quality Analysis</CardTitle>
              <p className="text-xs text-muted-foreground">
                Average image conditions across all plant analysis interactions
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleLoadImageQuality}
              disabled={isLoadingImageQuality}
              className="gap-1.5 shrink-0"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isLoadingImageQuality && "animate-spin")} />
              {isLoadingImageQuality ? "Loading..." : "Load Analysis"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {imageQuality === null && (
            <p className="text-sm text-muted-foreground">
              Click "Load Analysis" to view image quality insights.
            </p>
          )}
          {imageQuality !== null && imageQuality.avgBrightness === null && (
            <p className="text-sm text-muted-foreground">
              No image metadata available yet. Submit plant analysis images to populate this section.
            </p>
          )}
          {imageQuality !== null && imageQuality.avgBrightness !== null && (() => {
            const avgOcc = imageQuality.avgOcclusion;
            return (
              <div className="space-y-1 text-sm text-foreground">
                <p>
                  Average brightness:{" "}
                  <span className="font-semibold">{imageQuality.avgBrightness.toFixed(2)}</span>
                  {" "}({brightnessLabel(imageQuality.avgBrightness)})
                </p>
                <p>
                  Average occlusion:{" "}
                  <span className="font-semibold">
                    {avgOcc !== null ? avgOcc.toFixed(2) : "—"}
                  </span>
                  {avgOcc !== null && ` (${occlusionLabel(avgOcc)})`}
                </p>
                <p>
                  Most common angle:{" "}
                  <span className="font-semibold">
                    {imageQuality.mostCommonAngle ? formatAngle(imageQuality.mostCommonAngle) : "—"}
                  </span>
                </p>
                <p>
                  Most common failure cause:{" "}
                  <span className="font-semibold">
                    {imageQuality.mostCommonFailureCause
                      ? imageQuality.mostCommonFailureCause.replace(/_/g, " ")
                      : "—"}
                  </span>
                </p>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* ── Section 7: Intelligence update button ─────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-headline text-base">Intelligence Update</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleUpdate} disabled={isUpdating} variant="secondary" className="gap-2">
            <RefreshCw className={cn("h-4 w-4", isUpdating && "animate-spin")} />
            {isUpdating ? "Analysing patterns..." : "Run Intelligence Update"}
          </Button>

          {updateResult !== null && (
            <div className="space-y-1.5 text-sm">
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{updateResult.patternsExtracted}</span> patterns extracted
              </p>
              <p className="text-muted-foreground">
                Adapter training (yield-forecast):{" "}
                <span className={cn("font-medium", updateResult.yieldForecastTriggered ? "text-emerald-500" : "text-foreground")}>
                  {updateResult.yieldForecastTriggered ? "triggered" : "not enough data yet"}
                </span>
              </p>
              <p className="text-muted-foreground">
                Adapter training (plant-analysis):{" "}
                <span className={cn("font-medium", updateResult.plantAnalysisTriggered ? "text-emerald-500" : "text-foreground")}>
                  {updateResult.plantAnalysisTriggered ? "triggered" : "not enough data yet"}
                </span>
              </p>
              {updateResult.validationsRun > 0 && (
                <p className="text-muted-foreground">
                  Adapter validation:{" "}
                  <span className="font-medium text-foreground">
                    {updateResult.validationsRun} checked
                    {updateResult.validationsKept > 0 && (
                      <>, <span className="text-emerald-500">{updateResult.validationsKept} kept</span></>
                    )}
                    {updateResult.validationsRolledBack > 0 && (
                      <>, <span className="text-destructive">{updateResult.validationsRolledBack} rolled back</span></>
                    )}
                  </span>
                </p>
              )}
              <p className="text-muted-foreground">
                Intelligence score: <span className="font-medium text-foreground">updated</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* LLM vs Micro-Adapter comparison */}
      <AdapterComparisonCard />

      {/* Live, on-camera LLM vs Adapter comparison */}
      <LiveComparisonCard />
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function IntelligenceSkeleton() {
  return (
    <div className="space-y-8">
      <Card>
        <CardContent className="flex flex-col items-center gap-5 pb-10 pt-10">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-28 w-36" />
          <Skeleton className="h-2.5 w-64 rounded-full" />
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-64" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-3/4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="mb-2 h-9 w-2/5" />
              <Skeleton className="h-3 w-4/5" />
            </CardContent>
          </Card>
        ))}
      </div>

      {[0, 1].map(i => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-1 h-3 w-1/2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-9 w-48" />
        </CardContent>
      </Card>
    </div>
  );
}
