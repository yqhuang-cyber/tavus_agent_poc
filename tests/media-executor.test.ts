import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MediaController } from '../packages/media/controller.js';
import { MediaExecutor, type InputLease, type MediaConnection, type MediaPort } from '../packages/media/executor.js';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function until(check: () => boolean) { const end = Date.now() + 2000; while (!check()) { assert.ok(Date.now() < end); await new Promise(r => setTimeout(r, 5)); } }
function fixture(limits = { connectMs: 500, commandMs: 500 }) {
  const calls: string[] = []; const connections: MediaConnection[] = [];
  const lease: InputLease = { setEnabled: enabled => { calls.push(`input:${enabled}`); }, stop: () => { calls.push('input:stop'); } };
  const makeConnection = (epoch: number) => {
    const value: MediaConnection = { binding: { sessionId: 's1', roomId: `r${epoch}`, epoch },
      leave: async () => { calls.push(`leave:${epoch}`); }, destroy: async () => { calls.push(`destroy:${epoch}`); } };
    connections.push(value); return value;
  };
  const port: MediaPort = { setPlaybackMuted: muted => { calls.push(`mute:${muted}`); },
    connect: async epoch => { calls.push(`connect:${epoch}`); return makeConnection(epoch); },
    acquireInput: async () => { calls.push('acquire'); return lease; },
    cancelGeneration: async () => { calls.push('cancel'); }, interruptRemote: async () => { calls.push('interrupt'); } };
  const executor = new MediaExecutor(port, limits);
  const start = () => executor.dispatch({ type: 'start', userGesture: true, microphonePermission: 'granted' });
  const ready = async () => { await executor.settled(); const binding = connections.at(-1)!.binding;
    executor.dispatch({ type: 'media-ready', binding }); await executor.settled(); return binding; };
  return { calls, port, executor, connections, lease, makeConnection, start, ready };
}

test('failed connect effect leaves connecting and permits explicit reconnect', () => {
  const c = new MediaController(); const connecting = c.dispatch({ type: 'start', userGesture: true, microphonePermission: 'denied' }).find(e => e.type === 'connect')!;
  c.dispatch({ type: 'effect-result', effectId: connecting.id, epoch: connecting.epoch, ok: false });
  assert.equal(c.snapshot().phase, 'error'); assert.ok(c.dispatch({ type: 'reconnect', userGesture: true }).some(e => e.type === 'connect'));
});

test('executor turns connection rejection into recoverable error and stops superseded connection timer', async () => {
  const f = fixture(); f.port.connect = async () => { throw new Error('PRIVATE-adapter-error'); }; f.start(); await f.executor.settled();
  assert.equal(f.executor.snapshot().phase, 'error');
  f.port.connect = async epoch => f.makeConnection(epoch); f.executor.dispatch({ type: 'reconnect', userGesture: true });
  await f.ready(); assert.equal(f.executor.snapshot().phase, 'ready');
  f.executor.dispatch({ type: 'exit' }); await f.executor.settled(); assert.doesNotMatch(JSON.stringify(f.executor.snapshot()), /PRIVATE/);
});

test('connect timeout invalidates epoch and releases a connection returned late by an adapter ignoring cancellation', async () => {
  const f = fixture({ connectMs: 15, commandMs: 200 }); const late = deferred<MediaConnection>();
  f.port.connect = async () => late.promise; const effects = f.start(); const epoch = effects.find(e => e.type === 'connect')!.epoch;
  await until(() => f.executor.snapshot().phase === 'error'); late.resolve(f.makeConnection(epoch)); await f.executor.settled();
  assert.deepEqual(f.calls.filter(c => /leave:|destroy:/u.test(c)), [`leave:${epoch}`, `destroy:${epoch}`]);
  assert.equal(f.calls.includes('input:true'), false); assert.equal(f.executor.snapshot().phase, 'error');
});

test('media-ready deadline also covers a connection that joins without ever becoming media-ready', async () => {
  const f = fixture({ connectMs: 15, commandMs: 200 }); f.start(); await f.executor.settled();
  assert.equal(f.executor.snapshot().phase, 'joining'); await until(() => f.executor.snapshot().phase === 'error'); await f.executor.settled();
  assert.ok(f.calls.includes('leave:1') && f.calls.includes('destroy:1')); assert.equal(f.calls.includes('input:true'), false);
});

test('exit releases a late connection and late microphone lease without ever enabling its input', async () => {
  const first = fixture(); const connect = deferred<MediaConnection>(); first.port.connect = async () => connect.promise;
  first.start(); first.executor.dispatch({ type: 'exit' }); connect.resolve(first.makeConnection(1)); await first.executor.settled();
  assert.equal(first.executor.snapshot().phase, 'closed'); assert.ok(first.calls.includes('destroy:1'));
  const f = fixture(); const acquisition = deferred<InputLease>(); f.port.acquireInput = async () => { f.calls.push('acquire'); return acquisition.promise; };
  f.start(); await f.executor.settled(); const binding = f.connections[0]!.binding;
  f.executor.dispatch({ type: 'media-ready', binding }); await until(() => f.calls.includes('acquire'));
  f.executor.dispatch({ type: 'exit' }); acquisition.resolve(f.lease); await f.executor.settled();
  assert.equal(f.calls.includes('input:true'), false); assert.ok(f.calls.includes('input:false') && f.calls.includes('input:stop'));
  assert.equal(f.calls.filter(c => c === 'destroy:1').length, 1); assert.equal(f.executor.snapshot().phase, 'closed');
});

test('input revocation fences an asynchronous enable and duplicate media-ready cannot restart capture', async () => {
  const f = fixture(); const acquisition = deferred<InputLease>(); f.port.acquireInput = async () => acquisition.promise;
  f.start(); await f.executor.settled(); const binding = f.connections[0]!.binding;
  f.executor.dispatch({ type: 'media-ready', binding }); await Promise.resolve();
  f.executor.dispatch({ type: 'microphone-revoked', binding }); acquisition.resolve(f.lease); await f.executor.settled();
  f.executor.dispatch({ type: 'media-ready', binding }); assert.equal(f.calls.includes('input:true'), false);
  f.executor.dispatch({ type: 'exit' }); await f.executor.settled();
});

test('local mute executes synchronously before remote cancellation, and remote failure cannot unmute', async () => {
  const f = fixture(); f.start(); const binding = await f.ready();
  f.executor.dispatch({ type: 'response-start', binding, responseId: 'p1', inferenceId: 'i1', sequence: 1 });
  f.port.cancelGeneration = async () => { f.calls.push('cancel'); throw new Error('synthetic'); };
  const offset = f.calls.length; f.executor.dispatch({ type: 'interrupt', binding }); assert.equal(f.calls[offset], 'mute:true');
  await f.executor.settled(); f.executor.dispatch({ type: 'resume', binding });
  assert.equal(f.executor.snapshot().phase, 'interrupted'); assert.equal(f.executor.snapshot().remoteCancel, 'failed');
  f.executor.dispatch({ type: 'exit' }); await f.executor.settled();
});

test('destroy is attempted after failed leave and the failure remains visible', async () => {
  const f = fixture(); f.start(); await f.ready();
  f.connections[0]!.leave = async () => { f.calls.push('leave-failed'); throw new Error('synthetic'); };
  f.executor.dispatch({ type: 'exit' }); await f.executor.settled();
  assert.ok(f.calls.indexOf('leave-failed') < f.calls.indexOf('destroy:1'));
  assert.equal(f.executor.snapshot().deviceRelease, 'failed'); assert.equal(f.executor.snapshot().actualDeviceRelease, 'unverified');
});

test('input acquisition deadline fences a late lease, and failed local mute cannot start a connection', async () => {
  const f = fixture({ connectMs: 200, commandMs: 15 }); const late = deferred<InputLease>(); f.port.acquireInput = async () => late.promise;
  f.start(); await f.executor.settled(); f.executor.dispatch({ type: 'media-ready', binding: f.connections[0]!.binding });
  await until(() => f.executor.snapshot().phase === 'error'); late.resolve(f.lease); await f.executor.settled();
  assert.equal(f.calls.includes('input:true'), false); assert.ok(f.calls.includes('input:stop'));
  const g = fixture(); g.port.setPlaybackMuted = () => { throw new Error('synthetic'); }; g.start(); await g.executor.settled();
  assert.equal(g.executor.snapshot().phase, 'error'); assert.equal(g.connections.length, 0);
});
