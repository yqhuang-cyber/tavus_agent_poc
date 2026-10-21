export interface MediaBinding { sessionId: string; roomId: string; epoch: number }
type Scoped = { binding: MediaBinding };
type Phase = 'idle' | 'connecting' | 'joining' | 'ready' | 'interrupted' | 'error' | 'closed';
type MediaCommand =
  { type: 'set-playback-muted'; muted: boolean }
  | { type: 'set-microphone-enabled'; enabled: boolean }
  | { type: 'connect' }
  | { type: 'cancel-generation'; binding: MediaBinding; responseId: string }
  | { type: 'interrupt-remote'; binding: MediaBinding; inferenceId: string }
  | { type: 'leave' | 'destroy'; binding: MediaBinding };
export type MediaEffect = { id: number; epoch: number } & MediaCommand;
export type MediaEvent =
  | { type: 'start'; userGesture: boolean; microphonePermission: 'granted' | 'denied' }
  | { type: 'connected'; binding: MediaBinding }
  | ({ type: 'media-ready' | 'interrupt' | 'resume' | 'microphone-revoked' | 'network-lost' } & Scoped)
  | ({ type: 'response-start'; responseId: string; inferenceId: string; sequence: number } & Scoped)
  | { type: 'reconnect'; userGesture: boolean }
  | { type: 'effect-result'; effectId: number; epoch: number; ok: boolean }
  | { type: 'connection-timeout'; epoch: number }
  | { type: 'execution-failed'; epoch: number }
  | { type: 'exit' };

// Ordered commands and explicit acknowledgements only. A browser/Daily adapter
// must execute local mute synchronously, serialize device changes per epoch,
// and release late-acquired tracks. This core cannot prove actual playback/leave.
export class MediaController {
  private phase: Phase = 'idle'; private epoch = 0; private sequence = 0; private nextId = 0;
  private binding?: MediaBinding; private permission: 'granted' | 'denied' = 'denied';
  private playback: 'muted-requested' | 'unmuted-requested' = 'muted-requested';
  private response?: { responseId: string; inferenceId: string };
  private remoteCancel: 'not-requested' | 'pending' | 'acknowledged' | 'failed' = 'not-requested';
  private pendingCancel?: number;
  private pendingConnect?: number;
  private remoteInterrupt: 'not-requested' | 'pending' | 'acknowledged' | 'failed' = 'not-requested';
  private pendingInterrupt?: number;
  private retiredResponses = new Set<string>();
  private cleanup = new Map<number, { type: 'leave' | 'destroy'; epoch: number }>();
  private cleanupFailed = false;
  private matches(binding: MediaBinding) { return !!this.binding && binding.epoch === this.epoch
    && binding.sessionId === this.binding.sessionId && binding.roomId === this.binding.roomId; }
  snapshot() { return { phase: this.phase, epoch: this.epoch, playback: this.playback,
    microphonePermission: this.permission, inputMode: this.permission === 'granted' ? 'microphone-permitted' : 'text-assistance',
    remoteCancel: this.remoteCancel, remoteInterrupt: this.remoteInterrupt,
    deviceRelease: this.cleanupFailed ? 'failed' : this.cleanup.size ? 'pending' : 'no-pending-command',
    actualDeviceRelease: 'unverified', presentation: 'unknown' }; }
  dispatch(event: MediaEvent): MediaEffect[] {
    const effects: MediaEffect[] = [];
    const add = (effect: MediaCommand) => {
      const value = { ...effect, id: ++this.nextId, epoch: this.epoch } as MediaEffect;
      effects.push(value); return value.id;
    };
    const mute = () => { this.playback = 'muted-requested'; add({ type: 'set-playback-muted', muted: true }); };
    const stopResponse = () => {
      if (!this.response || !this.binding) return;
      this.remoteCancel = 'pending';
      this.remoteInterrupt = 'pending';
      this.retiredResponses.add(this.response.responseId);
      this.pendingCancel = add({ type: 'cancel-generation', binding: { ...this.binding }, responseId: this.response.responseId });
      this.pendingInterrupt = add({ type: 'interrupt-remote', binding: { ...this.binding }, inferenceId: this.response.inferenceId });
      this.response = undefined;
    };
    const release = () => {
      if (!this.binding) return;
      for (const type of ['leave', 'destroy'] as const) {
        const id = add({ type, binding: { ...this.binding } }); this.cleanup.set(id, { type, epoch: this.epoch });
      }
      this.binding = undefined;
    };
    const failConnection = () => {
      mute(); add({ type: 'set-microphone-enabled', enabled: false }); stopResponse(); release();
      this.pendingConnect = undefined; this.phase = 'error'; this.epoch++;
    };
    if (event.type === 'connection-timeout' || event.type === 'execution-failed') {
      if (event.epoch === this.epoch && !['idle', 'closed', 'error'].includes(this.phase)
        && (event.type === 'execution-failed' || ['connecting', 'joining'].includes(this.phase))) failConnection();
      return effects;
    }
    if (event.type === 'effect-result') {
      if (this.phase === 'connecting' && event.epoch === this.epoch && event.effectId === this.pendingConnect && !event.ok) {
        failConnection(); return effects;
      }
      const cleaning = this.cleanup.get(event.effectId);
      if (cleaning?.epoch === event.epoch) { this.cleanup.delete(event.effectId); if (!event.ok) this.cleanupFailed = true; }
      if (this.phase !== 'closed' && event.epoch === this.epoch && event.effectId === this.pendingCancel) {
        this.remoteCancel = event.ok ? 'acknowledged' : 'failed'; this.pendingCancel = undefined;
      }
      if (this.phase !== 'closed' && event.epoch === this.epoch && event.effectId === this.pendingInterrupt) {
        this.remoteInterrupt = event.ok ? 'acknowledged' : 'failed'; this.pendingInterrupt = undefined;
      }
      return effects; // An acknowledgement can never unmute or resume.
    }
    if (this.phase === 'closed') return effects;
    if (event.type === 'start') {
      if (this.phase !== 'idle' || !event.userGesture) return effects;
      this.epoch++; this.permission = event.microphonePermission; this.phase = 'connecting';
      mute(); add({ type: 'set-microphone-enabled', enabled: false }); this.pendingConnect = add({ type: 'connect' });
      return effects;
    }
    if (event.type === 'exit') {
      mute(); add({ type: 'set-microphone-enabled', enabled: false }); stopResponse(); release();
      this.epoch++; this.phase = 'closed'; return effects;
    }
    if (event.type === 'reconnect') {
      if (!event.userGesture || !['error', 'ready', 'interrupted'].includes(this.phase)) return effects;
      mute(); add({ type: 'set-microphone-enabled', enabled: false }); stopResponse(); release();
      this.epoch++; this.phase = 'connecting'; this.sequence = 0; this.pendingCancel = undefined; this.remoteCancel = 'not-requested';
      this.pendingInterrupt = undefined; this.remoteInterrupt = 'not-requested'; this.retiredResponses.clear();
      this.pendingConnect = add({ type: 'connect' }); return effects;
    }
    if (event.type === 'connected') {
      if (this.phase !== 'connecting' || event.binding.epoch !== this.epoch || !event.binding.roomId || !event.binding.sessionId) return effects;
      this.pendingConnect = undefined; this.binding = { ...event.binding }; this.phase = 'joining'; return effects;
    }
    if (!this.matches(event.binding)) return effects;
    if (event.type === 'network-lost') {
      mute(); add({ type: 'set-microphone-enabled', enabled: false }); stopResponse(); release();
      this.phase = 'error'; this.epoch++; return effects;
    }
    if (event.type === 'microphone-revoked') {
      this.permission = 'denied'; mute(); add({ type: 'set-microphone-enabled', enabled: false }); stopResponse();
      if (this.phase !== 'joining') this.phase = 'interrupted'; return effects;
    }
    if (event.type === 'media-ready' && this.phase === 'joining') {
      this.phase = 'ready'; add({ type: 'set-microphone-enabled', enabled: this.permission === 'granted' }); return effects;
    }
    if (event.type === 'interrupt' && ['ready', 'interrupted'].includes(this.phase)) {
      mute(); stopResponse(); this.phase = 'interrupted'; return effects;
    }
    if (event.type === 'resume' && this.phase === 'interrupted'
      && !['pending', 'failed'].includes(this.remoteCancel) && !['pending', 'failed'].includes(this.remoteInterrupt)) {
      if (this.retiredResponses.size >= 200) { this.phase = 'error'; return effects; }
      this.phase = 'ready'; return effects;
    }
    if (event.type === 'response-start' && this.phase === 'ready' && Number.isSafeInteger(event.sequence) && event.sequence > this.sequence
      && event.responseId && event.inferenceId && !this.retiredResponses.has(event.responseId)) {
      this.sequence = event.sequence; this.response = { responseId: event.responseId, inferenceId: event.inferenceId };
      this.playback = 'unmuted-requested'; add({ type: 'set-playback-muted', muted: false });
    }
    return effects;
  }
}
