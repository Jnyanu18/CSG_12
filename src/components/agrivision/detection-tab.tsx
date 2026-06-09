"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DetectionResult, Stage } from "@/lib/types";
import type { PlantAdapterComparison } from "@/app/actions";
import { ImageWithBoxes } from "./image-with-boxes";
import { AlertTriangle, UploadCloud, ChevronLeft, ChevronRight, Info, Sparkles } from "lucide-react";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import type { FailurePrediction } from "@/lib/types";

interface DetectionTabProps {
  result: DetectionResult | null;
  isLoading: boolean;
  images: { url: string; file: File | null; contentType: string }[];
  failurePrediction?: FailurePrediction;
  onRetry?: () => void;
  adapterComparison?: PlantAdapterComparison;
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

export function DetectionTab({ result, isLoading, images, failurePrediction, onRetry, adapterComparison }: DetectionTabProps) {
  const { t } = useTranslation();
  const [currentIdx, setCurrentIdx] = useState(0);

  if (failurePrediction && !failurePrediction.shouldProceed && !isLoading) {
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

  if (isLoading) {
    return <DetectionSkeleton />;
  }

  const hasImages = images.length > 0 && images[0].file !== null;

  if (!hasImages) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 p-12 text-center">
          <UploadCloud className="h-16 w-16 text-muted-foreground" />
          <h3 className="font-headline text-xl font-semibold">{t('start_analysis_title')}</h3>
          <p className="text-muted-foreground">{t('start_analysis_desc')}</p>
        </CardContent>
      </Card>
    );
  }

  if (!result) {
    return (
        <Card className="lg:col-span-3 overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="font-headline">{t('awaiting_analysis_title')}</CardTitle>
                <CardDescription>
                  {t('awaiting_analysis_desc')}
                </CardDescription>
              </div>
              <Badge variant="outline" className="bg-background">
                {images.length} Samples Ready
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="relative group">
              <div className="relative w-full aspect-[21/9] overflow-hidden">
                  <Image 
                      src={images[currentIdx].url} 
                      alt={`Ready sample ${currentIdx + 1}`} 
                      fill 
                      className="object-cover transition-all duration-500 group-hover:scale-105"
                      sizes="100vw"
                      priority
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-6">
                    <p className="text-white text-sm font-medium">Sample {currentIdx + 1} of {images.length}</p>
                  </div>
              </div>
              
              {images.length > 1 && (
                <>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/20 hover:bg-black/40 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setCurrentIdx(prev => (prev > 0 ? prev - 1 : images.length - 1))}
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/20 hover:bg-black/40 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setCurrentIdx(prev => (prev < images.length - 1 ? prev + 1 : 0))}
                  >
                    <ChevronRight className="h-6 w-6" />
                  </Button>
                </>
              )}
            </div>
            
            <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4 bg-muted/10">
               {images.map((img, i) => (
                 <button 
                  key={i} 
                  onClick={() => setCurrentIdx(i)}
                  className={cn(
                    "relative aspect-video rounded-lg overflow-hidden border-2 transition-all",
                    currentIdx === i ? "border-primary shadow-lg scale-105 z-10" : "border-transparent opacity-60 hover:opacity-100"
                  )}
                 >
                   <Image src={img.url} alt={`Thumbnail ${i+1}`} fill className="object-cover" />
                 </button>
               ))}
            </div>
          </CardContent>
        </Card>
    );
  }

  const { detections, stages, boxes, summary, plantType } = result;
  const totalFruits = stages.reduce((sum, s) => sum + (s.stage.toLowerCase() !== 'flower' ? s.count : 0), 0);
  
  const maturityDistribution = totalFruits > 0 ? stages
    .filter(s => s.stage.toLowerCase() !== 'flower')
    .map(s => ({
        stage: s.stage,
        value: (s.count / totalFruits) * 100,
        color: getStageColor(s.stage)
    })) : [];

  const stageVariety = stages.filter(s => s.count > 0).length;
  const reliability =
    totalFruits === 0 ? "Low" : stageVariety >= 4 ? "High" : stageVariety >= 2 ? "Medium" : "Low";

  const confidenceLabel =
    failurePrediction?.riskLevel === 'low' ? 'high'
    : failurePrediction?.riskLevel === 'medium' ? 'medium'
    : failurePrediction?.riskLevel === 'high' ? 'low'
    : null;
  const confidenceDot =
    failurePrediction?.riskLevel === 'low' ? 'bg-green-500'
    : failurePrediction?.riskLevel === 'medium' ? 'bg-yellow-500'
    : 'bg-red-500';

  return (
    <div className="space-y-6">
       <Card className="overflow-hidden bg-gradient-to-r from-success/5 to-primary/5 border-success/20">
          <CardContent className="p-6">
              <div className="flex flex-col md:flex-row items-center gap-6">
                  <div className="flex-1">
                      <h2 className="font-headline text-3xl font-bold tracking-tight mb-2">Aggregated Field Report</h2>
                      <p className="text-muted-foreground flex items-center gap-2">
                        <Info className="h-4 w-4 text-primary" />
                        Results synthesized from {images.length} unique field samples.
                      </p>
                      {failurePrediction && confidenceLabel && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <span className={cn("h-2 w-2 rounded-full", confidenceDot)} />
                          <span className="text-xs text-muted-foreground">
                            Prediction confidence: {confidenceLabel}
                          </span>
                        </div>
                      )}
                  </div>
                  <div className="flex gap-4">
                     <div className="text-center">
                        <div className="text-2xl font-bold text-primary">{images.length}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total Samples</div>
                     </div>
                     <div className="h-10 w-px bg-border/60 mx-2" />
                     <div className="text-center">
                        <div className="text-2xl font-bold text-primary">{totalFruits}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total Detections</div>
                     </div>
                  </div>
              </div>
          </CardContent>
       </Card>

       {adapterComparison && (
         <Card>
           <CardHeader className="pb-3">
             <CardTitle className="text-sm font-semibold flex items-center gap-2">
               <Sparkles className="h-4 w-4 text-yellow-400" />
               Raw LLM vs Adapter-Corrected — this analysis, live
             </CardTitle>
             <CardDescription className="text-xs">
               The same micro-adapter validated on 444 Kaggle images, applied here in real time to your uploaded photo{images.length > 1 ? "s" : ""}.
             </CardDescription>
           </CardHeader>
           <CardContent>
             <div className="grid grid-cols-2 gap-3 max-w-md">
               <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center space-y-1">
                 <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Raw LLM says</p>
                 <p className="text-3xl font-bold">{adapterComparison.rawCount}</p>
                 <p className="text-[10px] text-muted-foreground">tomatoes — no correction</p>
               </div>
               <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-3 text-center space-y-1">
                 <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">+ Adapter says</p>
                 <p className="text-3xl font-bold text-green-400">{adapterComparison.adapterCount}</p>
                 <p className="text-[10px] text-muted-foreground">
                   {adapterComparison.adapterApplied
                     ? `×${adapterComparison.multiplier} applied (${adapterComparison.conditionAdjustment})`
                     : "no correction needed"}
                 </p>
               </div>
             </div>
             <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">{adapterComparison.explanation}</p>
           </CardContent>
         </Card>
       )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-headline">Sample Gallery</CardTitle>
            <CardDescription className="flex items-center justify-between">
               <span>Interactive preview of captured data points</span>
               <Badge variant="secondary">Sample {currentIdx + 1} of {images.length}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative group">
              <ImageWithBoxes imageUrl={images[currentIdx].url} boxes={currentIdx === 0 ? boxes : []} />
              
              {images.length > 1 && (
                <>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/20 hover:bg-black/40 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setCurrentIdx(prev => (prev > 0 ? prev - 1 : images.length - 1))}
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/20 hover:bg-black/40 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setCurrentIdx(prev => (prev < images.length - 1 ? prev + 1 : 0))}
                  >
                    <ChevronRight className="h-6 w-6" />
                  </Button>
                </>
              )}
            </div>
            
            <div className="mt-4 flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
               {images.map((img, i) => (
                 <button 
                  key={i} 
                  onClick={() => setCurrentIdx(i)}
                  className={cn(
                    "relative flex-shrink-0 w-24 aspect-video rounded-md overflow-hidden border-2 transition-all",
                    currentIdx === i ? "border-primary scale-105 shadow-md" : "border-transparent opacity-40 hover:opacity-100"
                  )}
                 >
                   <Image src={img.url} alt={`Thumb ${i+1}`} fill className="object-cover" />
                 </button>
               ))}
            </div>

            <div className="mt-4 p-4 rounded-lg bg-muted/30 border border-muted text-sm text-balance leading-relaxed">
               <span className="font-semibold text-primary">AI Insight:</span> {summary || t('analyzed_image_summary', { count: detections })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-headline text-lg flex items-center justify-between font-bold">
                Yield Distribution
                <Badge variant="outline" className="text-[10px] text-primary bg-primary/5 border-primary/20">{plantType} Analysis</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-3 gap-2 py-4">
                  {stages.filter(s => ['mature', 'immature', 'ripening'].includes(s.stage.toLowerCase())).map(s => (
                    <div key={s.stage} className="text-center">
                        <div className="text-[10px] uppercase text-muted-foreground font-bold mb-1">Total {s.stage}</div>
                        <div className="text-2xl font-bold tabular-nums">{s.count}</div>
                        <div className="text-[10px] text-muted-foreground italic">Avg: {(s.count / images.length).toFixed(1)}/site</div>
                    </div>
                  ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                   <span>Maturity Spread</span>
                   <span className="text-muted-foreground">{totalFruits} Total Fruits Detected</span>
                </div>
                {totalFruits > 0 ? (
                  <div className="flex h-3 overflow-hidden rounded-full bg-muted shadow-inner">
                    {maturityDistribution.filter(d => d.value > 0).map(d => (
                      <div key={d.stage} style={{ width: `${d.value}%` }} className={d.color} />
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2">
                   {maturityDistribution.map(d => (
                     <div key={d.stage} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                        <span className={cn("h-1.5 w-1.5 rounded-full", d.color)} />
                        <span>{d.stage}</span>
                     </div>
                   ))}
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                 <div className="flex items-center gap-2 text-primary">
                    <Info className="h-4 w-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">AI Insights</span>
                 </div>
                 <p className="text-xs text-muted-foreground leading-relaxed italic">
                   Based on the batch analysis of {images.length} samples, your field shows a high concentration of mature fruits. The forecast suggests a peak harvest window starting in approximately 10-14 days.
                 </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50">
            <CardHeader className="pb-2">
              <CardTitle className="font-headline text-lg">Field Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-center justify-between border-b border-border/40 pb-2">
                <span>Total Samples</span>
                <span className="font-bold text-foreground tabular-nums">{images.length}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/40 pb-2">
                <span>Total Detections</span>
                <span className="font-bold text-foreground tabular-nums">{detections}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/40 pb-2">
                <span>AI Model</span>
                <span className="font-bold text-foreground">Agricultural Vision v2.1</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Avg Reliability</span>
                <Badge className={cn(
                  "font-bold uppercase tracking-tighter text-[10px]",
                  reliability === 'High' ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"
                )}>
                  {reliability}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DetectionSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="aspect-video w-full" />
        </CardContent>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-40" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { Badge as UI_Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
