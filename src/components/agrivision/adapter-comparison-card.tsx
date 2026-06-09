"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  RefreshCw, Zap, CheckCircle, XCircle, MinusCircle,
  AlertTriangle, Brain, Layers,
} from "lucide-react";
import { getAdapterComparison, type AdapterComparisonResult } from "@/app/actions";
import { cn } from "@/lib/utils";

// ── Metric row (3-column comparison) ─────────────────────────────────────────

function MetricRow({
  label,
  raw,
  naive,
  smart,
  unit = "",
  higherIsBetter = false,
}: {
  label: string;
  raw: number;
  naive: number;
  smart: number;
  unit?: string;
  higherIsBetter?: boolean;
}) {
  const best = higherIsBetter
    ? Math.max(raw, naive, smart)
    : Math.min(raw, naive, smart);

  const cls = (v: number) =>
    v === best ? "font-bold text-green-400" : "text-white/60";

  return (
    <tr className="border-b border-white/5">
      <td className="py-2 pr-4 text-xs text-muted-foreground">{label}</td>
      <td className={cn("py-2 text-right text-xs tabular-nums", cls(raw))}>
        {raw}{unit}
      </td>
      <td className={cn("py-2 text-right text-xs tabular-nums", cls(naive))}>
        {naive}{unit}
        {!higherIsBetter && naive > raw ? (
          <span className="ml-1 text-[9px] text-red-400">↑worse</span>
        ) : null}
      </td>
      <td className={cn("py-2 text-right text-xs tabular-nums", cls(smart))}>
        {smart}{unit}
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AdapterComparisonCard() {
  const [data,    setData]    = useState<AdapterComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getAdapterComparison();
      setData(result);
    } catch {
      setData({ success: false, error: "Failed to load comparison data." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-400" />
            LLM vs Micro-Adapter: Real Accuracy Comparison
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!data?.success) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-400" />
            LLM vs Micro-Adapter: Real Accuracy Comparison
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm">
            <p className="font-semibold text-yellow-300 mb-1">Adapter not trained yet</p>
            <p className="text-xs text-muted-foreground">
              Run:{" "}
              <code className="bg-black/30 px-1 rounded font-mono">
                node -r ./scripts/patch-dns.cjs scripts/train-adapter.js
              </code>
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = [
    {
      label: "±1 fruit",
      "Raw LLM":             data.rawWithin1Pct,
      "Naive adapter":       data.naiveWithin1Pct,
      "Smart adapter":       data.smartWithin1Pct,
    },
    {
      label: "±2 fruits",
      "Raw LLM":             data.rawWithin2Pct,
      "Naive adapter":       null,
      "Smart adapter":       data.smartWithin2Pct,
    },
  ];

  const naiveWorse = (data.naiveWithin1Pct ?? 0) < (data.rawWithin1Pct ?? 0);
  const smartBetter = (data.smartWithin1Pct ?? 0) > (data.rawWithin1Pct ?? 0);

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-400" />
            LLM vs Micro-Adapter: Real Accuracy Comparison
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            v{data.adapterVersion} adapter · ×{data.multiplier} multiplier ·{" "}
            {data.totalCompared} ground-truth images · {data.trainingSize} training samples
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={load} className="h-8 w-8 shrink-0">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-5">

        {/* Key finding banner */}
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 space-y-2">
          <p className="text-xs font-semibold text-blue-300 flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5" />
            What this experiment proves
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            The raw Llama 4 Scout LLM achieves{" "}
            <strong className="text-white">{data.rawWithin1Pct}% accuracy</strong>{" "}
            (within ±1 fruit). A naive global multiplier{" "}
            <strong className="text-red-300">drops this to {data.naiveWithin1Pct}%</strong>{" "}
            — it destroys already-correct predictions. A smart conditional adapter{" "}
            (only applied on dense scenes) reaches{" "}
            <strong className={smartBetter ? "text-green-300" : "text-orange-300"}>
              {data.smartWithin1Pct}%
            </strong>. This shows the model{"'"}s errors are{" "}
            <strong className="text-white">condition-dependent</strong>, not random —
            which is exactly why the system collects image conditions, occlusion scores,
            and confidence metadata to build a smarter, feature-based adapter over time.
          </p>
        </div>

        {/* Distribution insight */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-[10px] text-muted-foreground mb-1">Low-density scenes (≤5 fruits)</p>
            <p className="text-xl font-bold text-white">{data.lowDensityCount}</p>
            <p className="text-[10px] text-muted-foreground">
              images · avg bias:{" "}
              <span className={(data.lowDensityBiasPct ?? 0) > 0 ? "text-orange-400" : "text-green-400"}>
                {(data.lowDensityBiasPct ?? 0) > 0 ? "+" : ""}{data.lowDensityBiasPct}%
              </span>
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-[10px] text-muted-foreground mb-1">High-density scenes (&gt;5 fruits)</p>
            <p className="text-xl font-bold text-white">{data.highDensityCount}</p>
            <p className="text-[10px] text-muted-foreground">
              images · avg bias:{" "}
              <span className={(data.highDensityBiasPct ?? 0) > 0 ? "text-orange-400" : "text-green-400"}>
                {(data.highDensityBiasPct ?? 0) > 0 ? "+" : ""}{data.highDensityBiasPct}%
              </span>
            </p>
          </div>
        </div>

        {/* 3-way comparison table */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            Three-way accuracy comparison
          </p>
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  <th className="py-2 px-3 text-left text-muted-foreground font-medium">Metric</th>
                  <th className="py-2 px-3 text-right text-orange-400 font-medium">Raw LLM</th>
                  <th className="py-2 px-3 text-right text-red-400 font-medium">Naive adapter</th>
                  <th className="py-2 px-3 text-right text-green-400 font-medium">Smart adapter</th>
                </tr>
              </thead>
              <tbody className="px-3">
                <MetricRow
                  label="MAE (avg fruits off)"
                  raw={data.rawMAE ?? 0}
                  naive={data.naiveMAE ?? 0}
                  smart={data.smartMAE ?? 0}
                  unit=" fruits"
                  higherIsBetter={false}
                />
                <MetricRow
                  label="Within ±1 fruit"
                  raw={data.rawWithin1Pct ?? 0}
                  naive={data.naiveWithin1Pct ?? 0}
                  smart={data.smartWithin1Pct ?? 0}
                  unit="%"
                  higherIsBetter
                />
                <MetricRow
                  label="Within ±2 fruits"
                  raw={data.rawWithin2Pct ?? 0}
                  naive={data.rawWithin2Pct ?? 0}
                  smart={data.smartWithin2Pct ?? 0}
                  unit="%"
                  higherIsBetter
                />
              </tbody>
            </table>
          </div>
        </div>

        {/* Warning: naive adapter fails */}
        {naiveWorse && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 flex gap-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-red-300">Why naive fine-tuning fails</p>
              <p className="text-muted-foreground">
                Applying a single ×{data.naiveMultiplier ?? data.multiplier} correction to ALL predictions destroys
                the {data.rawWithin1Pct}% of images the LLM already got right.
                The error is not uniform — it depends on scene density, occlusion,
                and lighting. A smarter adapter needs to learn WHEN to apply correction.
              </p>
            </div>
          </div>
        )}

        {/* Bar chart */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">Accuracy at ±1 fruit tolerance</p>
          <ChartContainer
            config={{
              "Raw LLM":       { color: "#f97316", label: "Raw LLM" },
              "Naive adapter": { color: "#ef4444", label: "Naive adapter" },
              "Smart adapter": { color: "#22c55e", label: "Smart adapter" },
            }}
            className="h-36 w-full"
          >
            <BarChart
              data={[{
                name: "Within ±1 fruit",
                "Raw LLM":       data.rawWithin1Pct,
                "Naive adapter": data.naiveWithin1Pct,
                "Smart adapter": data.smartWithin1Pct,
              }]}
              margin={{ top: 4, right: 8, bottom: 4, left: -8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.2)" />
              <YAxis tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.2)" domain={[0, 100]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="Raw LLM"       fill="#f97316" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Naive adapter" fill="#ef4444" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Smart adapter" fill="#22c55e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>

        {/* Sample predictions */}
        {data.samples && data.samples.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">
              Sample predictions (LLM vs Smart Adapter vs Ground Truth)
            </p>
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-2 py-1.5 text-left text-muted-foreground font-medium">Image</th>
                    <th className="px-2 py-1.5 text-right text-orange-400 font-medium">LLM</th>
                    <th className="px-2 py-1.5 text-right text-green-400 font-medium">Adapter</th>
                    <th className="px-2 py-1.5 text-right text-blue-400 font-medium">Truth</th>
                    <th className="px-2 py-1.5 text-right text-muted-foreground font-medium">LLM err</th>
                    <th className="px-2 py-1.5 text-right text-muted-foreground font-medium">Adp err</th>
                    <th className="px-2 py-1.5 text-center text-muted-foreground font-medium">Better?</th>
                  </tr>
                </thead>
                <tbody>
                  {data.samples.map((row, i) => (
                    <tr
                      key={i}
                      className={cn(
                        "border-b border-white/5",
                        i % 2 === 0 ? "bg-white/[0.02]" : ""
                      )}
                    >
                      <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
                        {row.filename.slice(0, 14)}
                      </td>
                      <td className="px-2 py-1 text-right text-orange-400">{row.predicted}</td>
                      <td className="px-2 py-1 text-right text-green-400">{row.adapted}</td>
                      <td className="px-2 py-1 text-right text-blue-400">{row.actual}</td>
                      <td className="px-2 py-1 text-right text-white/50">{row.rawError}</td>
                      <td className="px-2 py-1 text-right text-white/50">{row.adapterError}</td>
                      <td className="px-2 py-1 text-center">
                        {row.improved ? (
                          <CheckCircle className="h-3 w-3 text-green-400 inline" />
                        ) : row.adapterError === row.rawError ? (
                          <MinusCircle className="h-3 w-3 text-muted-foreground inline" />
                        ) : (
                          <XCircle className="h-3 w-3 text-red-400 inline" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Smart adapter ({data.smartBetterCount}/{data.totalCompared} improved ·{" "}
              {data.smartWorseCount} worsened). Adapter only applies to high-density scenes (&gt;5 fruits predicted).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
