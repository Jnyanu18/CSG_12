import { connectToDatabase } from '@/lib/mongodb';
import Interaction, { type IInteraction, type IImageMetadata } from '@/lib/db/models/Interaction';

const IMAGE_METADATA_KEYS: (keyof IImageMetadata)[] = [
  'brightnessScore',
  'contrastScore',
  'estimatedOcclusion',
  'imageSharpness',
  'imagingAngle',
  'lightingCondition',
  'backgroundClutter',
];

function extractImageMetadata(geminiOutput: Record<string, unknown>): IImageMetadata | undefined {
  const hasAny = IMAGE_METADATA_KEYS.some(k => geminiOutput[k] !== undefined);
  if (!hasAny) return undefined;

  return {
    brightnessScore:    typeof geminiOutput.brightnessScore   === 'number' ? geminiOutput.brightnessScore   : 0.5,
    contrastScore:      typeof geminiOutput.contrastScore     === 'number' ? geminiOutput.contrastScore     : 0.5,
    estimatedOcclusion: typeof geminiOutput.estimatedOcclusion === 'number' ? geminiOutput.estimatedOcclusion : 0.5,
    imageSharpness:     typeof geminiOutput.imageSharpness    === 'number' ? geminiOutput.imageSharpness    : 0.5,
    imagingAngle:       typeof geminiOutput.imagingAngle      === 'string' ? geminiOutput.imagingAngle      : 'side',
    lightingCondition:  typeof geminiOutput.lightingCondition === 'string' ? geminiOutput.lightingCondition : 'mixed',
    backgroundClutter:  typeof geminiOutput.backgroundClutter === 'string' ? geminiOutput.backgroundClutter : 'medium',
  };
}

type SaveInteractionData = {
  userId: string;
  flowType: IInteraction['flowType'];
  imageUrl?: string;
  inputData: Record<string, unknown>;
  geminiOutput: Record<string, unknown>;
  confidence?: IInteraction['confidence'];
  uncertaintyType?: IInteraction['uncertaintyType'];
  reasoning?: string;
};

export async function saveInteraction(data: SaveInteractionData): Promise<IInteraction> {
  await connectToDatabase();

  const confidence      = data.confidence      ?? 'medium';
  const uncertaintyType = data.uncertaintyType ?? 'model';
  const reasoning       = data.reasoning       ?? 'No reasoning provided';

  const routedToDataset = confidence === 'high' && uncertaintyType !== 'model';

  const imageMetadata = extractImageMetadata(data.geminiOutput);

  const doc = await Interaction.create({
    ...data,
    confidence,
    uncertaintyType,
    reasoning,
    routedToDataset,
    ...(imageMetadata ? { imageMetadata } : {}),
  });

  return doc;
}

export async function saveCorrection(
  interactionId: string,
  correctedValue: unknown
): Promise<IInteraction | null> {
  await connectToDatabase();

  const doc = await Interaction.findByIdAndUpdate(
    interactionId,
    {
      farmerCorrection: {
        correctedValue,
        correctedAt: new Date(),
        trustLevel: 'verified',
      },
    },
    { new: true }
  );

  return doc;
}

export async function getDataset(): Promise<IInteraction[]> {
  await connectToDatabase();

  return Interaction.find({ routedToDataset: true })
    .sort({ timestamp: -1 })
    .lean() as unknown as IInteraction[];
}
