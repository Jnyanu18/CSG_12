"use client";

import { useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Radio, Sparkles } from "lucide-react";
import { runLiveAdapterComparison, type LiveComparisonResult } from "@/app/actions";
import { cn } from "@/lib/utils";

const SAMPLE_IMAGES = [
  { filename: "tomato101.png", label: "The famous outlier" },
  { filename: "tomato11.png",  label: "Dense cluster" },
  { filename: "tomato108.png", label: "High count" },
  { filename: "tomato0.png",   label: "Medium count" },
  { filename: "tomato104.png", label: "Low count — exact" },
  { filename: "tomato1.png",   label: "Heavy occlusion" },
];

export function LiveComparisonCard() {
  const [selected, setSelected]   = useState(SAMPLE_IMAGES[0].filename);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult]       = useState<LiveComparisonResult | null>(null);

  async function handleRun() {
    setIsLoading(true);
    setResult(null);
    const res = await runLiveAdapterComparison(selected);
    setResult(res);
    setIsLoading(false);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Radio className="h-4 w-4 text-red-400" />
          Live Comparison — Raw LLM vs Adapter-Corrected
        </CardTitle>
        <CardDescription className="text-xs">
          Pick a real Kaggle tomato image, run it through the AI right now, and watch the adapter correct the result in real time — side by side with the actual ground truth.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {SAMPLE_IMAGES.map(s => (
            <button
              key={s.filename}
              onClick={() => { setSelected(s.filename); setResult(null); }}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                selected === s.filename
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
              )}
            >
              {s.filename.replace(/\.(png|jpg|jpeg)$/i, "")} · {s.label}
            </button>
          ))}
        </div>

        <Button onClick={handleRun} disabled={isLoading} className="w-full sm:w-auto">
          {isLoading
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Calling the live AI...</>
            : <><Sparkles className="mr-2 h-4 w-4" /> Run Live Comparison</>}
        </Button>

        {result && result.success && (
          <div className="space-y-4 pt-2 animate-in fade-in-0 duration-300">
            <div className="flex items-center gap-3">
              <div className="relative h-20 w-28 overflow-hidden rounded-lg border shrink-0">
                <Image
                  src={result.imageUrl!}
                  alt={result.filename!}
                  fill
                  className="object-cover"
                  sizes="112px"
                  unoptimized
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">{result.filename}</p>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    result.source === "live"
                      ? "border-red-500/40 text-red-300 bg-red-500/10"
                      : "border-blue-500/40 text-blue-300 bg-blue-500/10"
                  )}
                >
                  {result.source === "live"
                    ? "● LIVE — analyzed just now by Groq"
                    : "▸ Replaying saved analysis (live AI is rate-limited right now)"}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Raw LLM says</p>
                <p className="text-3xl font-bold text-white">{result.rawPrediction}</p>
                <p className="text-[10px] text-muted-foreground">tomatoes — no correction</p>
              </div>
              <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-3 text-center space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">+ Adapter says</p>
                <p className="text-3xl font-bold text-green-400">{result.adapterPrediction}</p>
                <p className="text-[10px] text-muted-foreground">
                  {result.adapterApplied
                    ? `×${result.finalMultiplier} applied (${result.conditionAdjustment})`
                    : "no correction needed"}
                </p>
              </div>
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 text-center space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Actual count</p>
                <p className="text-3xl font-bold text-blue-400">{result.groundTruth ?? "—"}</p>
                <p className="text-[10px] text-muted-foreground">from XML ground truth</p>
              </div>
            </div>

            {result.groundTruth != null && result.rawPrediction != null && result.adapterPrediction != null && (
              <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
                Raw LLM was off by <span className="font-medium text-white">{Math.abs(result.rawPrediction - result.groundTruth)}</span> fruits
                {"  ·  "}
                Adapter was off by <span className="font-medium text-white">{Math.abs(result.adapterPrediction - result.groundTruth)}</span> fruits
                {result.explanation ? <> · {result.explanation}</> : null}
              </p>
            )}
          </div>
        )}

        {result && !result.success && (
          <p className="text-xs text-destructive">{result.error}</p>
        )}
      </CardContent>
    </Card>
  );
}
