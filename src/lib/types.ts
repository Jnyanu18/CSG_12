
import { z } from 'zod';

export type Stage = 'immature' | 'ripening' | 'mature' | 'flower' | 'breaker' | 'pink' | 'fruitlet' | 'overripened';

export const AppControlsSchema = z.object({
  avgWeightG: z.number(),
  postHarvestLossPct: z.number(),
  numPlants: z.number(),
  forecastDays: z.number(),
  gddBaseC: z.number(),
  harvestCapacityKgDay: z.number(),
  useDetectionModel: z.boolean(),
  useLiveWeather: z.boolean(),
  includePriceForecast: z.boolean(),
  district: z.string(),
});
export type AppControls = z.infer<typeof AppControlsSchema>;


export interface DetectionBox {
  box: [number, number, number, number]; // [x1, y1, x2, y2] percentages
  stage: Stage;
}

// This remains useful for client-side calculations that might depend on specific known stages
export const StageCountsSchema = z.object({
    flower: z.number().optional(),
    immature: z.number().optional(),
    breaker: z.number().optional(),
    ripening: z.number().optional(),
    pink: z.number().optional(),
    mature: z.number().optional(),
    fruitlet: z.number().optional(),
    overripened: z.number().optional(),
}).passthrough(); // Allow other keys
export type StageCounts = z.infer<typeof StageCountsSchema>;

export interface DetectionResult {
  plantId: number;
  plantType: string;
  detections: number;
  boxes: DetectionBox[];
  stageCounts: StageCounts; // An object for quick lookups
  stages: { stage: string, count: number }[]; // A flexible array for dynamic UI rendering
  growthStage: 'Immature' | 'Ripening' | 'Mature' | 'Varies';
  avgBboxArea: number;
  confidence: number;
  imageUrl: string;
  summary?: string;
}

export const DailyForecastSchema = z.object({
  date: z.string(),
  ready_kg: z.number(),
  gdd_cum: z.number(),
});
export type DailyForecast = z.infer<typeof DailyForecastSchema>;

export const HarvestTaskSchema = z.object({
  date: z.string(),
  harvest_kg: z.number(),
});
export type HarvestTask = z.infer<typeof HarvestTaskSchema>;

export const HarvestWindowSchema = z.object({
    start: z.string().describe("The start date of the optimal harvest window."),
    end: z.string().describe("The end date of the optimal harvest window."),
});
export type HarvestWindow = z.infer<typeof HarvestWindowSchema>;

export const ForecastResultSchema = z.object({
    yield_now_kg: z.number(),
    sellable_kg: z.number(),
    daily: z.array(DailyForecastSchema),
    harvest_plan: z.array(HarvestTaskSchema),
    harvestWindow: HarvestWindowSchema.optional(),
    notes: z.array(z.string()),
});
export type ForecastResult = z.infer<typeof ForecastResultSchema>;


export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: React.ReactNode;
}


// == AI Flow Schemas ==

export const AnalyzePlantInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      "A photo of a plant, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  contentType: z.string().describe('The MIME type of the image, e.g., "image/jpeg".'),
});
export type AnalyzePlantInput = z.infer<typeof AnalyzePlantInputSchema>;


export const PlantAnalysisResultSchema = z.object({
  plantType: z.string().describe("The identified type of plant, e.g., 'Tomato', 'Lemon'."),
  summary: z.string().describe("A short summary of the detection results."),
  stages: z.array(z.object({
    stage: z.string().describe("The name of the growth stage (e.g., 'flower', 'immature', 'mature')."),
    count: z.number().describe("The number of items found in this stage."),
  })).describe("An array of stages and their respective counts."),
});
export type PlantAnalysisResult = z.infer<typeof PlantAnalysisResultSchema>;

export const YieldForecastInputSchema = z.object({
  analysis: PlantAnalysisResultSchema.describe("The result from the plant analysis flow, including stage counts."),
  controls: AppControlsSchema.describe("The user-defined parameters for the farm."),
});
export type YieldForecastInput = z.infer<typeof YieldForecastInputSchema>;

export const YieldForecastOutputSchema = z.object({
  totalExpectedYieldKg: z.number().describe("The total estimated yield in kilograms for the entire lifecycle of the current fruit generation."),
  yieldCurve: z.array(z.object({
    date: z.string().describe("The date for the data point (YYYY-MM-DD)."),
    yieldKg: z.number().describe("The estimated cumulative harvestable yield in kilograms on that date."),
  })).describe("An array of data points representing the yield curve over time."),
  confidence: z.number().min(0).max(1).describe("A confidence score (0 to 1) for the forecast."),
  notes: z.string().describe("A brief summary and any important notes about the forecast."),
  reasoning: z.string().describe("A step-by-step explanation of how the forecast was calculated, including the basis for the confidence score."),
});
export type YieldForecastOutput = z.infer<typeof YieldForecastOutputSchema>;


export const WeatherDataSchema = z.object({
    date: z.string().describe('The date for the forecast in YYYY-MM-DD format.'),
    temp_max_c: z.number().describe('The maximum forecasted temperature in Celsius.'),
    temp_min_c: z.number().describe('The minimum forecasted temperature in Celsius.'),
});
export type WeatherData = z.infer<typeof WeatherDataSchema>;

export const YieldForecastingInputSchema = z.object({
  detectionResult: PlantAnalysisResultSchema,
  weatherData: z.array(WeatherDataSchema),
  controls: AppControlsSchema,
});
export type YieldForecastingInput = z.infer<typeof YieldForecastingInputSchema>;

export type FailurePrediction = {
  probability: number;
  riskLevel: 'low' | 'medium' | 'high';
  reasons: string[];
  recommendation: string;
  shouldProceed: boolean;
};

export type CrossValidationResult = {
  isValid: boolean;
  confidenceScore: number;
  validationReason: string;
  similarCorrections: number;
  consistencyScore: number;
  recommendation: 'accept' | 'pending' | 'reject';
  readyForTraining: boolean;
};
