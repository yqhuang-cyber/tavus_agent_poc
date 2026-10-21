import { MediaController, type MediaBinding, type MediaEffect, type MediaEvent } from './controller.js';

export interface InputLease { setEnabled(enabled: boolean): void; stop(): void }
export interface MediaConnection { binding: MediaBinding; leave(): Promise<void>; destroy(): Promise<void> }
export interface MediaPort {
  setPlaybackMuted(muted: boolean, epoch: number): void;
  connect(epoch: number, signal: AbortSignal): Promise<MediaConnection>;
  // Returned tracks must remain disabled until setEnabled(true).
  acquireInput(connection: MediaConnection, signal: AbortSignal): Promise<InputLease>;
  cancelGeneration(binding: MediaBinding, responseId: string, signal: AbortSignal): Promise<void>;
  interruptRemote(binding: MediaBinding, inferenceId: string, signal: AbortSignal): Promise<void>;
}
interface ConnectionState {
  epoch: number; signal: AbortController; connection?: MediaConnection; lease?: InputLease;
  inputSignal?: AbortController; inputQueue: Promise<void>; timer?: ReturnType<typeof setTimeout>;
  leaving?: Promise<void>; destroying?: Promise<void>;
}

// Injected-port executor: no browser globals, Daily SDK, credentials or autoplay.
// Promise settlement acknowledges adapter execution, never actual sound/RTC billing.
export class MediaExecutor {
  private controller = new MediaController();
  private connections = new Map<number, ConnectionState>();
  private jobs = new Set<Promise<void>>(); private failures = new Set<string>();
  constructor(private port: MediaPort, private limits = { connectMs: 10000, commandMs: 5000 }) {
    if (![limits.connectMs, limits.commandMs].every(n => Number.isFinite(n) && n > 0)) throw new Error('invalid_media_deadline');
  }
  snapshot() { return { ...this.controller.snapshot(), pendingExecutions: this.jobs.size,
    failures: [...this.failures], adapter: 'injected-port', actualDeviceRelease: 'unverified' }; }
  dispatch(event: MediaEvent) {
    const effects = this.controller.dispatch(event);
    for (const state of this.connections.values()) {
      if (!this.current(state)) { state.signal.abort(); clearTimeout(state.timer); this.stopInput(state); }
      else if (this.controller.snapshot().phase === 'ready') clearTimeout(state.timer);
    }
    for (const effect of effects) this.execute(effect);
    return effects;
  }
  private current(state: ConnectionState) {
    const s = this.controller.snapshot(); return s.epoch === state.epoch && !['closed', 'error', 'idle'].includes(s.phase);
  }
  private track(task: Promise<void>) {
    const safe = task.catch(() => { this.failures.add('adapter-operation-failed'); });
    this.jobs.add(safe); void safe.finally(() => this.jobs.delete(safe));
  }
  async settled() { while (this.jobs.size) await Promise.allSettled([...this.jobs]); }
  private stopInput(state: ConnectionState) {
    state.inputSignal?.abort();
    if (state.lease) { this.releaseLease(state.lease); state.lease = undefined; }
  }
  private releaseLease(lease: InputLease) {
    try { lease.setEnabled(false); } catch { this.failures.add('input-disable-failed'); }
    try { lease.stop(); } catch { this.failures.add('input-release-failed'); }
  }
  private async bounded(call: (signal: AbortSignal) => Promise<void>) {
    const c = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.resolve().then(() => call(c.signal)), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { c.abort(); reject(new Error('media_command_timeout')); }, this.limits.commandMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  private leave(state: ConnectionState) {
    return state.leaving ??= this.bounded(async () => { await state.connection!.leave(); });
  }
  private destroy(state: ConnectionState) {
    return state.destroying ??= (async () => {
      this.stopInput(state); await this.leave(state).catch(() => {});
      await this.bounded(async () => { await state.connection!.destroy(); });
      this.connections.delete(state.epoch);
    })();
  }
  private execute(effect: MediaEffect) {
    if (effect.type === 'set-playback-muted') {
      try { this.port.setPlaybackMuted(effect.muted, effect.epoch); }
      catch { this.failures.add('playback-command-failed'); this.dispatch({ type: 'execution-failed', epoch: effect.epoch }); }
      return;
    }
    if (effect.type === 'connect') {
      if (effect.epoch !== this.controller.snapshot().epoch || this.controller.snapshot().phase !== 'connecting') return;
      const state: ConnectionState = { epoch: effect.epoch, signal: new AbortController(), inputQueue: Promise.resolve() };
      this.connections.set(effect.epoch, state);
      state.timer = setTimeout(() => this.dispatch({ type: 'connection-timeout', epoch: state.epoch }), this.limits.connectMs);
      this.track((async () => {
        try {
          const connection = await this.port.connect(effect.epoch, state.signal.signal); state.connection = connection;
          if (!this.current(state) || connection.binding.epoch !== state.epoch || !connection.binding.sessionId || !connection.binding.roomId) {
            if (this.current(state)) this.dispatch({ type: 'effect-result', effectId: effect.id, epoch: effect.epoch, ok: false });
            await this.destroy(state); return;
          }
          this.dispatch({ type: 'connected', binding: connection.binding });
        } catch {
          clearTimeout(state.timer);
          if (state.connection) this.failures.add('connection-cleanup-failed');
          if (!state.connection) this.connections.delete(state.epoch);
          this.dispatch({ type: 'effect-result', effectId: effect.id, epoch: effect.epoch, ok: false });
        }
      })()); return;
    }
    const state = this.connections.get(effect.epoch);
    if (effect.type === 'set-microphone-enabled') {
      if (!state) return;
      if (!effect.enabled) { this.stopInput(state); return; }
      const permitted = () => this.current(state) && this.controller.snapshot().phase === 'ready'
        && this.controller.snapshot().microphonePermission === 'granted';
      state.inputQueue = state.inputQueue.catch(() => {}).then(async () => {
        if (!permitted() || !state.connection || state.lease) return;
        const c = new AbortController(); state.inputSignal = c;
        const timer = setTimeout(() => {
          c.abort(); this.failures.add('input-acquisition-timeout'); this.dispatch({ type: 'execution-failed', epoch: state.epoch });
        }, this.limits.commandMs);
        const clearAcquisitionDeadline = () => clearTimeout(timer);
        c.signal.addEventListener('abort', clearAcquisitionDeadline, { once: true });
        try {
          const lease = await this.port.acquireInput(state.connection, c.signal);
          if (!permitted() || c.signal.aborted) { this.releaseLease(lease); return; }
          state.lease = lease; lease.setEnabled(true);
        } catch {
          if (!c.signal.aborted && this.current(state)) {
            this.failures.add('input-acquisition-failed'); this.stopInput(state);
            this.dispatch({ type: 'execution-failed', epoch: state.epoch });
          }
        } finally { clearTimeout(timer); c.signal.removeEventListener('abort', clearAcquisitionDeadline); }
      }); this.track(state.inputQueue); return;
    }
    this.track((async () => {
      let ok = true;
      try {
        if (effect.type === 'cancel-generation') await this.bounded(signal => this.port.cancelGeneration(effect.binding, effect.responseId, signal));
        else if (effect.type === 'interrupt-remote') await this.bounded(signal => this.port.interruptRemote(effect.binding, effect.inferenceId, signal));
        else if (!state?.connection) throw new Error('connection_unavailable');
        else if (effect.type === 'leave') await this.leave(state);
        else if (effect.type === 'destroy') await this.destroy(state);
      } catch { ok = false; this.failures.add(`${effect.type}-failed`); }
      this.dispatch({ type: 'effect-result', effectId: effect.id, epoch: effect.epoch, ok });
    })());
  }
}
