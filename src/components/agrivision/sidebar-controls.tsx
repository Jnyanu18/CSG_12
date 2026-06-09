
"use client"

import React, { useRef } from 'react'
import type { AppControls } from '@/lib/types'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Loader2, UploadCloud, Wheat } from 'lucide-react'
import { Slider } from '../ui/slider'
import { useTranslation } from 'react-i18next'

interface SidebarControlsProps {
  controls: AppControls
  setControls: React.Dispatch<React.SetStateAction<AppControls>>
  onImageUpload: (file: File) => void
  onAnalyze: () => void
  onYieldForecast: () => void;
  isAnalysisLoading: boolean
  isForecastLoading: boolean;
  isYieldForecastDisabled: boolean;
}

export function SidebarControls({
  controls,
  setControls,
  onImageUpload,
  onAnalyze,
  onYieldForecast,
  isAnalysisLoading,
  isForecastLoading,
  isYieldForecastDisabled,
}: SidebarControlsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      onImageUpload(file)
    }
  }

  const handleInputChange = (
    key: keyof AppControls,
    value: string | number | boolean
  ) => {
    setControls(prev => ({ ...prev, [key]: value }))
  }

  const controlItems: {
    key: keyof AppControls;
    label: string;
    type: 'slider' | 'input';
    unit: string;
    min: number;
    max: number;
    step: number;
  }[] = [
    { key: 'avgWeightG', label: t('avg_fruit_weight'), type: 'slider', unit: 'g', min: 50, max: 250, step: 5 },
    { key: 'postHarvestLossPct', label: t('post_harvest_loss'), type: 'slider', unit: '%', min: 0, max: 30, step: 1 },
    { key: 'numPlants', label: t('num_plants'), type: 'input', unit: '', min: 1, max: 10000, step: 10 },
    { key: 'forecastDays', label: t('forecast_horizon'), type: 'input', unit: 'days', min: 7, max: 90, step: 1 },
    { key: 'harvestCapacityKgDay', label: t('harvest_capacity'), type: 'input', unit: 'kg/day', min: 1, max: 1000, step: 10 },
  ]
  
  return (
    <div className="flex h-full flex-col gap-4 p-2">
      <Button onClick={() => fileInputRef.current?.click()} variant="outline">
        <UploadCloud className="mr-2 h-4 w-4" />
        {t('upload_image')}
      </Button>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/png, image/jpeg"
      />

      <Separator />

      <div className="flex flex-col gap-4 overflow-y-auto pr-2">
        {controlItems.map(item => (
          <div key={item.key} className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor={item.key}>{item.label}</Label>
              <span className="text-xs text-muted-foreground">{controls[item.key as keyof AppControls]} {item.unit}</span>
            </div>
            {item.type === 'slider' ? (
               <Slider
                 id={item.key}
                 min={item.min}
                 max={item.max}
                 step={item.step}
                 value={[Number(controls[item.key as keyof AppControls])]}
                 onValueChange={(value) => handleInputChange(item.key, value[0])}
               />
            ) : (
              <Input
                id={item.key}
                type="number"
                value={String(controls[item.key as keyof AppControls])}
                onChange={e => handleInputChange(item.key, e.target.valueAsNumber || 0)}
                min={item.min}
                max={item.max}
                step={item.step}
              />
            )}
          </div>
        ))}
        
        <Separator />

        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <Label htmlFor="district">{t('district')}</Label>
                <Input
                    id="district"
                    value={controls.district}
                    onChange={(e) => handleInputChange('district', e.target.value)}
                    className="w-2/3"
                />
            </div>
        </div>

      </div>

      <div className="mt-auto space-y-2">
         <Button onClick={onYieldForecast} className="w-full" disabled={isForecastLoading || isYieldForecastDisabled} variant="secondary">
          {isForecastLoading ? <Loader2 className="animate-spin" /> : <><Wheat className="mr-2 h-4 w-4" /> {t('run_yield_forecast')}</>}
        </Button>
        <Button onClick={onAnalyze} className="w-full" disabled={isAnalysisLoading}>
          {isAnalysisLoading ? <Loader2 className="animate-spin" /> : t('analyze_harvest')}
        </Button>
      </div>
    </div>
  )
}
