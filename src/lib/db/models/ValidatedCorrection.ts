import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IValidatedCorrection extends Document {
  interactionId: mongoose.Types.ObjectId;
  flowType: string;
  predictedValue: number;
  correctedValue: number;
  delta: number;
  deltaPercent: number;
  cropType: string;
  conditions: {
    hourOfDay: number;
    confidence: string;
    uncertaintyType: string;
  };
  validation: {
    confidenceScore: number;
    similarCorrections: number;
    consistencyScore: number;
    recommendation: 'accept' | 'pending' | 'reject';
    validatedAt: Date;
  };
  readyForTraining: boolean;
  usedInTraining: boolean;
  trainingBatchId?: string;
  failureReason?: {
    primaryCause: string;
    secondaryCause?: string;
    confidence: number;
    explanation: string;
    features: Record<string, unknown>;
    classifiedAt: Date;
  };
  createdAt: Date;
}

const ValidatedCorrectionSchema = new Schema<IValidatedCorrection>(
  {
    interactionId:  { type: Schema.Types.ObjectId, ref: 'Interaction', required: true },
    flowType:       { type: String, required: true },
    predictedValue: { type: Number, required: true },
    correctedValue: { type: Number, required: true },
    delta:          { type: Number, required: true },
    deltaPercent:   { type: Number, required: true },
    cropType:       { type: String, required: true },
    conditions: {
      hourOfDay:       { type: Number, required: true },
      confidence:      { type: String, required: true },
      uncertaintyType: { type: String, required: true },
    },
    validation: {
      confidenceScore:    { type: Number, required: true },
      similarCorrections: { type: Number, required: true },
      consistencyScore:   { type: Number, required: true },
      recommendation:     { type: String, required: true },
      validatedAt:        { type: Date,   required: true },
    },
    readyForTraining: { type: Boolean, default: false },
    usedInTraining:   { type: Boolean, default: false },
    trainingBatchId:  { type: String },
    failureReason: {
      primaryCause:   { type: String },
      secondaryCause: { type: String },
      confidence:     { type: Number },
      explanation:    { type: String },
      features:       { type: Schema.Types.Mixed },
      classifiedAt:   { type: Date },
    },
  },
  {
    collection: 'validated_corrections',
    timestamps: { createdAt: true, updatedAt: false },
  }
);

const ValidatedCorrection: Model<IValidatedCorrection> =
  mongoose.models.ValidatedCorrection ||
  mongoose.model<IValidatedCorrection>('ValidatedCorrection', ValidatedCorrectionSchema);

export default ValidatedCorrection;
