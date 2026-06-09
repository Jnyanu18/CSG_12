
import { addDays, format } from 'date-fns';
import type { AppControls, DetectionBox, DetectionResult, ForecastResult, Stage, StageCounts } from './types';

// Mocks the output of a tomato detection model.
export function mockTomatoDetection(imageUrl: string): DetectionResult {
  const detections = Math.floor(Math.random() * 25) + 10; // 10 to 34 detections
  const stages: { stage: string, count: number }[] = [
      { stage: 'flower', count: Math.floor(Math.random() * 5) },
      { stage: 'immature', count: Math.floor(Math.random() * 10) },
      { stage: 'breaker', count: Math.floor(Math.random() * 5) },
      { stage: 'ripening', count: Math.floor(Math.random() * 5) },
      { stage: 'pink', count: Math.floor(Math.random() * 5) },
      { stage: 'mature', count: Math.floor(Math.random() * 5) },
  ];
  
  const stageCounts: StageCounts = stages.reduce((acc, s) => {
    acc[s.stage as keyof StageCounts] = s.count;
    return acc;
    }, {} as StageCounts);

  const boxes: DetectionBox[] = [];

  const growthStage = (stageCounts.mature || 0) > detections / 2 ? 'Mature' : (stageCounts.ripening || 0) > detections / 3 ? 'Ripening' : 'Immature';
  const avgBboxArea = 0;

  return {
    plantId: 1,
    plantType: "Tomato",
    detections,
    boxes,
    stageCounts,
    stages,
    growthStage,
    avgBboxArea,
    confidence: 0.85 + Math.random() * 0.1,
    imageUrl,
  };
}

// Mocks the yield forecasting and harvest scheduling logic.
export function calculateYieldForecast(
  detectionResult: DetectionResult,
  controls: AppControls
): ForecastResult {
  const { stageCounts } = detectionResult;
  const { avgWeightG, postHarvestLossPct, numPlants, forecastDays, gddBaseC, harvestCapacityKgDay } = controls;

  const totalDetections = (stageCounts.immature || 0) + (stageCounts.ripening || 0) + (stageCounts.mature || 0) + (stageCounts.breaker || 0) + (stageCounts.pink || 0);
  const yield_now_kg_per_plant = ((stageCounts.mature || 0) * avgWeightG) / 1000;
  const yield_now_kg = yield_now_kg_per_plant * numPlants;
  const sellable_kg = yield_now_kg * (1 - postHarvestLossPct / 100);

  // Simulate GDD and ripening
  const daily: ForecastResult['daily'] = [];
  const breakerGDD = 70;
  const ripeningGDD = 80;
  const pinkGDD = 40;
  const maturingGDD = 55;
  
  let immatureCount = stageCounts.immature || 0;
  let breakerCount = stageCounts.breaker || 0;
  let ripeningCount = stageCounts.ripening || 0;
  let pinkCount = stageCounts.pink || 0;
  
  let cumGDD = 0;

  for (let i = 0; i < forecastDays; i++) {
    const date = addDays(new Date(), i);
    const dailyGDD = gddBaseC / 2 + Math.random() * 8; // Synthetic GDD
    cumGDD += dailyGDD;

    const newBreaker = immatureCount * Math.min(1, (dailyGDD / breakerGDD));
    const newRipening = breakerCount * Math.min(1, (dailyGDD / ripeningGDD));
    const newPink = ripeningCount * Math.min(1, (dailyGDD / pinkGDD));
    const newMature = pinkCount * Math.min(1, (dailyGDD / maturingGDD));
    
    immatureCount -= newBreaker;
    breakerCount += newBreaker - newRipening;
    ripeningCount += newRipening - newPink;
    pinkCount += newPink - newMature;
    const matureCount = totalDetections - immatureCount - breakerCount - ripeningCount - pinkCount;

    daily.push({
      date: format(date, 'yyyy-MM-dd'),
      ready_kg: (matureCount * avgWeightG / 1000) * numPlants,
      gdd_cum: cumGDD,
    });
  }

  // Greedy harvest scheduling
  const harvest_plan: ForecastResult['harvest_plan'] = [];
  let cumulativeReadyKg = 0;
  let lastHarvestedKg = 0;
  for (const day of daily) {
      cumulativeReadyKg += (day.ready_kg - lastHarvestedKg);
      const canHarvest = Math.min(cumulativeReadyKg, harvestCapacityKgDay);
      if(canHarvest > 0.1) {
        harvest_plan.push({
            date: day.date,
            harvest_kg: canHarvest,
        });
        cumulativeReadyKg -= canHarvest;
      }
      lastHarvestedKg = day.ready_kg;
  }
  
  const harvestWindow = harvest_plan.length > 0
  ? { start: harvest_plan[0].date, end: harvest_plan[harvest_plan.length - 1].date }
  : undefined;

  return {
    yield_now_kg,
    sellable_kg,
    daily,
    harvest_plan,
    harvestWindow,
    notes: [
      `Forecast assumes an average daily GDD accumulation.`,
      `Harvest plan is optimized for a capacity of ${harvestCapacityKgDay} kg/day.`,
    ],
  };
}
