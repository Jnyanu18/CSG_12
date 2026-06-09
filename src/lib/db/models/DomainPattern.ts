import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IDomainPattern extends Document {
  flowType: 'plant-analysis' | 'yield-forecast';
  patternType: 'time_based' | 'systematic_bias' | 'confidence_unreliable';
  pattern: string;
  insight: string;
  condition?: string;
  metadata: Record<string, unknown>;
  extractedAt: Date;
  interactionsAnalyzed: number;
  active: boolean;
}

const DomainPatternSchema = new Schema<IDomainPattern>(
  {
    flowType:              { type: String, required: true },
    patternType:           { type: String, required: true },
    pattern:               { type: String, required: true },
    insight:               { type: String, required: true },
    condition:             { type: String },
    metadata:              { type: Schema.Types.Mixed, default: {} },
    extractedAt:           { type: Date, default: Date.now },
    interactionsAnalyzed:  { type: Number, required: true },
    active:                { type: Boolean, default: true },
  },
  { collection: 'domain_patterns' }
);

const DomainPattern: Model<IDomainPattern> =
  mongoose.models.DomainPattern ||
  mongoose.model<IDomainPattern>('DomainPattern', DomainPatternSchema);

export default DomainPattern;
