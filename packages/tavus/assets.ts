export interface TavusAssetApi {
  getFace(id: string): Promise<Record<string, unknown>>;
  getVoice(id: string): Promise<Record<string, unknown>>;
}
export class AssetInputError extends Error { constructor() { super('invalid_asset_id'); } }
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const status = (value: unknown, allowed: string[]) => typeof value === 'string' && allowed.includes(value) ? value : 'unknown';

// GET snapshots only. Never turn callback `ready` into GET `completed`, nor
// training completion into brand approval or actual Chinese speech quality.
export async function assetReadiness(api: TavusAssetApi, faceId: string, selectedVoiceId?: string) {
  if (!id(faceId) || (selectedVoiceId !== undefined && !id(selectedVoiceId))) throw new AssetInputError();
  const face = await api.getFace(faceId);
  const faceMatches = face.face_id === faceId;
  const voiceId = selectedVoiceId ?? (id(face.default_voice_id) ? face.default_voice_id : undefined);
  const voice = faceMatches && voiceId ? await api.getVoice(voiceId) : undefined;
  const faceStatus = status(face.status, ['started', 'completed', 'error']);
  const finetune = status(face.finetune_status, ['started', 'completed', 'errored']);
  const voiceStatus = status(voice?.status, ['started', 'completed', 'error']);
  const voiceMatches = !!voiceId && voice?.voice_id === voiceId;
  const model = status(face.model_name, ['phoenix-4', 'phoenix-4.5']);
  const technicallyAvailable = faceMatches && faceStatus === 'completed' && voiceMatches && voiceStatus === 'completed';
  return { kind: 'asset-get-status-only', technicallyAvailable,
    formalPhoenix45TrainingComplete: technicallyAvailable && model === 'phoenix-4.5' && finetune === 'completed',
    face: { id: faceId, idMatches: faceMatches, status: faceStatus, model, finetuneStatus: finetune },
    voice: { id: voiceId ?? null, selection: selectedVoiceId ? 'explicit' : 'face-default', idMatches: voiceMatches, status: voiceStatus },
    brandApproval: 'not-evaluated', chineseVoiceQuality: 'not-evaluated', realMedia: 'not-run' };
}
