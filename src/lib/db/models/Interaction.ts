import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IActualOutcome {
  type: 'yield' | 'market_price';
  predictedValue: number;
  actualValue: number;
  recordedAt: Date;
  errorMargin: number;
  accuracyPercent: number;
}

export interface IImageMetadata {
  brightnessScore: number;
  contrastScore: number;
  estimatedOcclusion: number;
  imageSharpness: number;
  imagingAngle: string;
  lightingCondition: string;
  backgroundClutter: string;
}

export interface IInteraction extends Document {
  userId: string;
  flowType: 'plant-analysis' | 'yield-forecast' | 'market-price' | 'chat-assistant';
  imageUrl?: string;
  inputData: Record<string, unknown>;
  geminiOutput: Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low';
  uncertaintyType: 'data' | 'domain' | 'model';
  reasoning: string;
  routedToDataset: boolean;
  imageMetadata?: IImageMetadata;
  farmerCorrection?: {
    correctedValue: unknown;
    correctedAt: Date;
    trustLevel: 'verified';
  };
  actualOutcome?: IActualOutcome;
  timestamp: Date;
  createdAt: Date;
}

const InteractionSchema = new Schema<IInteraction>({
  userId:          { type: String, required: true },
  flowType:        { type: String, required: true },
  imageUrl:        { type: String },
  inputData:       { type: Schema.Types.Mixed, required: true },
  geminiOutput:    { type: Schema.Types.Mixed, required: true },
  confidence:      { type: String, required: true, default: 'medium' },
  uncertaintyType: { type: String, required: true, default: 'model' },
  reasoning:       { type: String, required: true, default: 'No reasoning provided' },
  routedToDataset: { type: Boolean, default: false },
  imageMetadata:   { type: Schema.Types.Mixed },
  farmerCorrection: {
    correctedValue: { type: Schema.Types.Mixed },
    correctedAt:    { type: Date },
    trustLevel:     { type: String },
  },
  actualOutcome: { type: Schema.Types.Mixed },
  timestamp:  { type: Date, default: Date.now },
  createdAt:  { type: Date, default: Date.now },
});

const Interaction: Model<IInteraction> =
  mongoose.models.Interaction ||
  mongoose.model<IInteraction>('Interaction', InteractionSchema);

export default Interaction;
