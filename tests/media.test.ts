import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MediaController, type MediaBinding, type MediaEffect, type MediaEvent } from '../packages/media/controller.js';

// A simulated adapter records commands only; it is not a Daily or device receipt.
function rig(permission: 'granted' | 'denied' = 'granted') {
  const controller = new MediaController(); const commands: MediaEffect[] = [];
  const send = (event: MediaEvent) => { const effects = controller.dispatch(event); commands.push(...effects); return effects; };
  send({ type: 'start', userGesture: true, microphonePermission: permission });
  const binding: MediaBinding = { sessionId: 's1', roomId: 'r1', epoch: controller.snapshot().epoch };
  send({ type: 'connected', binding }); send({ type: 'media-ready', binding });
  const respond = (responseId: string, sequence: number) => send({ type: 'response-start', binding, responseId, inferenceId: `i-${responseId}`, sequence });
  const acknowledge = (effects: MediaEffect[], ok = true) => {
    for (const e of effects.filter(e => ['cancel-generation', 'interrupt-remote'].includes(e.type))) send({ type: 'effect-result', effectId: e.id, epoch: e.epoch, ok });
  };
  return { controller, commands, send, binding, respond, acknowledge };
}

test('media requires explicit start, never requests microphone when denied, and does not unmute at media-ready', () => {
  const idle = new MediaController(); assert.deepEqual(idle.dispatch({ type: 'start', userGesture: false, microphonePermission: 'granted' }), []);
  assert.equal(idle.snapshot().phase, 'idle');
  const f = rig('denied'); assert.equal(f.controller.snapshot().phase, 'ready');
  assert.equal(f.controller.snapshot().inputMode, 'text-assistance'); assert.equal(f.controller.snapshot().playback, 'muted-requested');
  assert.equal(f.commands.some(e => e.type === 'set-microphone-enabled' && e.enabled), false);
  assert.equal(f.commands[0]!.type, 'set-playback-muted'); assert.equal(f.controller.snapshot().presentation, 'unknown');
});

test('interrupt requests local mute before either remote action; failed cancellation cannot resume', () => {
  const f = rig(); f.respond('a', 1);
  const effects = f.send({ type: 'interrupt', binding: f.binding });
  assert.deepEqual(effects.map(e => e.type), ['set-playback-muted', 'cancel-generation', 'interrupt-remote']);
  assert.equal(f.controller.snapshot().remoteCancel, 'pending');
  f.send({ type: 'resume', binding: f.binding }); assert.equal(f.controller.snapshot().phase, 'interrupted');
  f.acknowledge(effects, false); assert.equal(f.controller.snapshot().remoteCancel, 'failed');
  f.send({ type: 'resume', binding: f.binding }); assert.deepEqual(f.respond('b', 2), []);
  assert.equal(f.controller.snapshot().playback, 'muted-requested');
});

test('successful dual acknowledgement permits a fresh response but never resumes an interrupted response ID', () => {
  const f = rig(); f.respond('a', 1); const stopping = f.send({ type: 'interrupt', binding: f.binding });
  const cancel = stopping.find(e => e.type === 'cancel-generation')!;
  f.send({ type: 'effect-result', effectId: cancel.id, epoch: cancel.epoch, ok: true });
  f.send({ type: 'resume', binding: f.binding }); assert.equal(f.controller.snapshot().phase, 'interrupted');
  f.acknowledge(stopping); f.send({ type: 'resume', binding: f.binding });
  assert.equal(f.controller.snapshot().playback, 'muted-requested');
  assert.deepEqual(f.respond('a', 999), []); assert.deepEqual(f.respond('b', 1), []);
  assert.equal(f.respond('b', 2)[0]!.type, 'set-playback-muted'); assert.equal(f.controller.snapshot().playback, 'unmuted-requested');
});

test('network loss invalidates old epochs and reconnect does not replay media or restore a revoked microphone', () => {
  const f = rig(); f.respond('a', 1); f.send({ type: 'microphone-revoked', binding: f.binding });
  const lost = f.send({ type: 'network-lost', binding: f.binding }); assert.equal(lost[0]!.type, 'set-playback-muted');
  assert.equal(f.controller.snapshot().phase, 'error');
  assert.deepEqual(f.send({ type: 'reconnect', userGesture: false }), []);
  f.send({ type: 'reconnect', userGesture: true });
  const next = { sessionId: 's1', roomId: 'r2', epoch: f.controller.snapshot().epoch };
  assert.deepEqual(f.send({ type: 'connected', binding: f.binding }), []);
  f.send({ type: 'connected', binding: next }); f.send({ type: 'media-ready', binding: next });
  assert.deepEqual(f.respond('old', 100), []);
  assert.deepEqual(f.send({ type: 'response-start', binding: { ...next, sessionId: 'other' }, responseId: 'x', inferenceId: 'x', sequence: 1 }), []);
  assert.equal(f.controller.snapshot().playback, 'muted-requested'); assert.equal(f.controller.snapshot().microphonePermission, 'denied');
});

test('exit remains terminal even with late acknowledgements, and failed device cleanup is visible', () => {
  const f = rig(); f.respond('a', 1);
  const effects = f.send({ type: 'exit' });
  assert.deepEqual(effects.map(e => e.type), ['set-playback-muted', 'set-microphone-enabled', 'cancel-generation', 'interrupt-remote', 'leave', 'destroy']);
  assert.equal(f.controller.snapshot().deviceRelease, 'pending');
  f.acknowledge(effects); const leave = effects.find(e => e.type === 'leave')!; const destroy = effects.find(e => e.type === 'destroy')!;
  f.send({ type: 'effect-result', effectId: leave.id, epoch: leave.epoch, ok: false });
  f.send({ type: 'effect-result', effectId: destroy.id, epoch: destroy.epoch, ok: true });
  assert.equal(f.controller.snapshot().deviceRelease, 'failed'); assert.equal(f.controller.snapshot().actualDeviceRelease, 'unverified');
  for (const event of [{ type: 'exit' }, { type: 'resume', binding: f.binding }, { type: 'media-ready', binding: f.binding },
    { type: 'reconnect', userGesture: true }] as MediaEvent[]) assert.deepEqual(f.send(event), []);
  assert.equal(f.controller.snapshot().phase, 'closed'); assert.equal(f.controller.snapshot().playback, 'muted-requested');
});
