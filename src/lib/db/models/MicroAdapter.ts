import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ITimeCalibration {
  timeWindow: 'morning' | 'afternoon' | 'evening' | 'night';
  averageDeltaPercent: number;
  sampleSize: number;
  active: boolean;
}

export interface IMicroAdapter extends Document {
  flowType: string;
  batchId: string;
  version: number;
  builtAt: Date;
  trainingSize: number;
  overallCalibration: {
    averageDeltaPercent: number;
    direction: 'overestimate' | 'underestimate';
    magnitude: 'small' | 'medium' | 'large';
  };
  timeCalibrations: ITimeCalibration[];
  calibrationFunction: {
    formula: string;
    multiplier: number;
  };
  validationScore: number;
  status: 'active' | 'pending_validation' | 'rolled_back';
  replacedBy?: string;
  createdAt: Date;
}

const MicroAdapterSchema = new Schema<IMicroAdapter>(
  {
    flowType:     { type: String, required: true },
    batchId:      { type: String, required: true, unique: true },
    version:      { type: Number, required: true },
    builtAt:      { type: Date,   required: true },
    trainingSize: { type: Number, required: true },
    overallCalibration: {
      averageDeltaPercent: { type: Number, required: true },
      direction:           { type: String, required: true },
      magnitude:           { type: String, required: true },
    },
    timeCalibrations: [
      {
        timeWindow:          { type: String, required: true },
        averageDeltaPercent: { type: Number, required: true },
        sampleSize:          { type: Number, required: true },
        active:              { type: Boolean, required: true },
      },
    ],
    calibrationFunction: {
      formula:    { type: String, required: true },
      multiplier: { type: Number, required: true },
    },
    validationScore: { type: Number, required: true },
    status:          { type: String, required: true, default: 'active' },
    replacedBy:      { type: String },
  },
  {
    collection: 'micro_adapters',
    timestamps: { createdAt: true, updatedAt: false },
  }
);

const MicroAdapter: Model<IMicroAdapter> =
  mongoose.models.MicroAdapter ||
  mongoose.model<IMicroAdapter>('MicroAdapter', MicroAdapterSchema);

export default MicroAdapter;
