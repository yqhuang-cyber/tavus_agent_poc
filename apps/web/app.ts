import DailyImport, { type DailyCall, type DailyCallFactory } from '@daily-co/daily-js';
import { Captions, type ConversationEvent } from '../../packages/tavus/captions.js';
import type { NativeSessions } from '../server/session.js';

type View = ReturnType<NativeSessions['view']>;
// daily-js publishes a CJS entry with ESM declarations; the browser bundle uses its ESM factory.
const Daily = DailyImport as unknown as DailyCallFactory;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => el<HTMLButtonElement>(id);
const input = (id: string) => el<HTMLInputElement>(id);
const audio = el<HTMLAudioElement>('teacher-audio'); const video = el<HTMLVideoElement>('teacher-video');
let current: View | undefined; let selected = 'alex'; let live = false; let call: DailyCall | undefined;
let generation = 0; let starting = false; let leaving = false; let captionsOn = true; let micOn = true;
let mediaReady = false; let speaking = false; let generationPending = false; let mutedForInterrupt = false;
let activeInference = ''; const retired = new Set<string>(); let reducer: Captions | undefined;
let newOutputAllowed = true;
let poll: ReturnType<typeof setInterval> | undefined; let busyPoll = false; let heartbeatAt = 0; let inputFence = 0;
let contextSending = false; let lastContextVersion = -1; let eventQueue = Promise.resolve();
let noticeTimer: ReturnType<typeof setTimeout> | undefined; let startupAbort: AbortController | undefined;
const messages: Record<string, string> = {
  invalid_access_code: '访问码不正确，请填写本地 .env 中的 OPERATOR_TOKEN。', login_required: '演示登录已过期，请重新输入访问码。',
  session_limit: '已有两个会话，请先退出已有会话。', existing_session_resume_or_exit: '已有未结束会话，请先恢复或退出。',
  native_resources_require_reconciliation: '存在待核对的通话资源，请先处理清理状态。', stale_closing: '你已继续聊天，这份结束预览已失效。',
  runtime_or_upstream_failure: '服务调用未完成，请检查服务端运行状态。', tavus_request_failed: 'Tavus 请求未完成。',
  text_input_too_large: '这段文字比较长，请分成两段发送。', message_too_long: '消息超出实时通道大小，请缩短后重试。',
};
class ApiError extends Error { constructor(readonly code: string, readonly status: number, detail = '') { super((messages[code] ?? code) + detail); } }
function notify(text: string) { clearTimeout(noticeTimer); el('notice').textContent = text; el('notice').hidden = false;
  noticeTimer = setTimeout(() => { el('notice').hidden = true; }, 6500); }
async function api<T = View>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  if (data !== undefined && current && path.startsWith(`/api/sessions/${current.id}/`)) data = { epoch: current.epoch, ...data as Record<string, unknown> };
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal,
    ...(data === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }) });
  const body = await response.json();
  if (!response.ok) { const e = body.error ?? {}; throw new ApiError(e.code ?? 'request_failed', response.status,
    e.httpStatus || e.failureCode ? `（${[e.httpStatus, e.failureCode].filter(Boolean).join(' / ')}）` : ''); }
  return body as T;
}
const path = (action = '') => `/api/sessions/${current!.id}${action ? `/${action}` : ''}`;
function isOpen(s = current) { return !!s && !['closed', 'closing', 'failed'].includes(s.status); }
function showCaption(text: string) { el('caption').textContent = text; el('caption').hidden = !captionsOn || !text; }
function update(s: View) {
  if (current && current.id === s.id) {
    if (s.version < current.version || (['closing', 'closed'].includes(current.status) && !['closing', 'closed'].includes(s.status))) return;
  }
  current = s; render();
}
function render() {
  const s = current; const open = isOpen(); const usable = !!s && ['active', 'reviewing'].includes(s.status) && mediaReady && !leaving;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-profile]')) b.disabled = open || starting;
  input('chinese-only').disabled = open || starting; input('save-allowed').disabled = open || starting;
  button('start').disabled = starting || (open && mediaReady) || leaving;
  button('start').firstChild!.textContent = starting ? '正在准备… ' : open ? mediaReady ? '正在交流 ' : '恢复会话 ' : '开始聊天 ';
  button('exit').disabled = !starting && (!s || ['closed', 'failed'].includes(s.status));
  for (const id of ['mic', 'interrupt', 'end', 'send']) button(id).disabled = !usable;
  input('text').disabled = !usable;
  button('mic').textContent = micOn ? '麦克风开启' : '麦克风静音'; button('mic').setAttribute('aria-pressed', String(!micOn));
  button('captions').textContent = captionsOn ? '字幕开启' : '字幕关闭'; button('captions').setAttribute('aria-pressed', String(captionsOn));
  const labels: Record<string, string> = { preparing: '正在准备', joining: '正在连接', active: '交流中', reviewing: '回顾中', closing: '正在结束', closed: '已结束', failed: '连接未完成' };
  el('connection-status').innerHTML = '<i></i>';
  el('connection-status').append(document.createTextNode(starting ? '正在准备' : s ? (mediaReady ? labels[s.status]! : s.status === 'active' ? '等待重新连接' : labels[s.status]!) : '尚未开始'));
  el('connection-status').classList.toggle('active', usable);
  el('session-note').textContent = !live ? '离线演示 · 无真实房间、音视频或模型输出' : mutedForInterrupt ? '已停止本地播放，等待下一次新回复。'
    : open ? `摄像头关闭 · ${s?.profile.name ?? ''} · ${s?.latestPlan?.status === 'rule' ? 'Pi 规划暂不可用，当前为规则建议' : '会话最长 15 分钟'}` : '自在交流，不必每句话都变成练习。';
  const summary = s?.summary ?? s?.closing?.summary;
  el('summary-panel').hidden = !summary;
  if (summary && s) {
    el('summary-text').textContent = summary.oralReview;
    el('summary-excerpts').replaceChildren(...summary.excerpts.slice(0, 3).map(e => { const quote = document.createElement('div'); quote.className = 'quote'; quote.textContent = e.quote; return quote; }));
    el('summary-note').textContent = s.summary ? `${s.save.status === 'saved' ? '已保存（本地内存模拟，重启重置）。' : s.save.status === 'failed' ? '保存未收到回执，可以重试。' : '未保存到业务记录。'} ${s.playback === 'user-confirmed' ? '结束由你确认。' : '老师的实际播放完成尚未确认。'}`
      : '这是可撤销预览。听完回顾后可以确认结束；继续交流会使本预览失效。';
    button('confirm-end').hidden = !s.closing || !open; button('continue').hidden = !s.closing || !open;
    button('retry-save').hidden = !s.summary || !s.consent.allowed || s.save.status !== 'failed';
  }
  button('revoke-consent').hidden = !s?.consent.allowed;
  el('diagnostic-data').textContent = s ? JSON.stringify({ pipeline: 'native', mode: live ? 'live' : 'offline',
    state: s.status, inputCount: s.inputCount, inputProvenance: s.inputProvenance, coverageGaps: s.coverageGaps,
    planning: s.planCounts, latestPlan: s.latestPlan, context: s.context, toolCalls: s.toolCalls, cleanup: s.cleanup,
    postCall: s.postCallStatus, save: s.save.status, playback: s.playback }, null, 2) : '开始后显示运行状态。';
}
async function playAudio() {
  if (mutedForInterrupt || leaving) return;
  audio.muted = false;
  try { await audio.play(); button('unlock-audio').hidden = true; }
  catch { if (!leaving) button('unlock-audio').hidden = false; }
}
function localMute() { audio.muted = true; audio.pause(); showCaption(''); }
const disposed = new WeakMap<DailyCall, Promise<void>>();
function dispose(instance: DailyCall) {
  const previous = disposed.get(instance); if (previous) return previous;
  const task = (async () => {
    try { instance.setLocalAudio(false); instance.setLocalVideo(false);
      for (const track of Object.values(instance.participants().local?.tracks ?? {})) track?.persistentTrack?.stop(); } catch { /* SDK may already be destroyed. */ }
    try { await Promise.race([instance.leave(), new Promise<void>(resolve => setTimeout(resolve, 3000))]); }
    catch { /* Always try destroy even when leave fails. */ }
    finally { try { await instance.destroy(); } catch { /* Failure cannot restore the released local tracks. */ } }
  })(); disposed.set(instance, task); return task;
}
async function releaseMedia() {
  generation++; inputFence++; startupAbort?.abort(); localMute(); mediaReady = false;
  const old = call; call = undefined; if (old) await dispose(old);
  video.srcObject = null; audio.srcObject = null; el('placeholder').hidden = false; button('unlock-audio').hidden = true;
}
function refreshTracks(instance: DailyCall, token: number, ready?: () => void) {
  if (call !== instance || token !== generation || leaving) return;
  const remote = Object.values(instance.participants()).filter(p => !p.local);
  const audioTrack = remote.map(p => p.tracks.audio.persistentTrack).find(t => t?.readyState === 'live');
  const videoTrack = remote.map(p => p.tracks.video.persistentTrack).find(t => t?.readyState === 'live');
  if (videoTrack && !(video.srcObject as MediaStream | null)?.getTracks().includes(videoTrack)) {
    video.srcObject = new MediaStream([videoTrack]); void video.play().catch(() => {}); el('placeholder').hidden = true;
  }
  if (audioTrack && !(audio.srcObject as MediaStream | null)?.getTracks().includes(audioTrack)) {
    audio.srcObject = new MediaStream([audioTrack]); void playAudio();
  }
  if (videoTrack && audioTrack) ready?.();
}
function send(eventType: string, properties?: Record<string, unknown>) {
  if (!call || !current?.conversationId || leaving) return;
  const message = { message_type: 'conversation', event_type: eventType, conversation_id: current.conversationId, ...(properties ? { properties } : {}) };
  if (new TextEncoder().encode(JSON.stringify(message)).length > 4000) throw new ApiError('message_too_long', 400);
  call.sendAppMessage(message, '*');
}
function handleMessage(instance: DailyCall, token: number, data: ConversationEvent & { properties?: Record<string, unknown> }, fromId: string) {
  if (call !== instance || token !== generation || leaving || !current || data.conversation_id !== current.conversationId || data.message_type !== 'conversation') return;
  const peer = Object.values(instance.participants()).find(p => p.session_id === fromId && !p.local);
  if (!peer) return;
  const p = data.properties;
  const user = p?.role === 'user'; const teacher = p?.role === 'pal' || p?.role === 'replica' || p?.role === undefined;
  if (data.event_type === 'conversation.started_speaking' && teacher) {
    activeInference = data.inference_id ?? ''; speaking = true;
    if (newOutputAllowed && activeInference && !retired.has(activeInference)) { mutedForInterrupt = false; void playAudio(); }
  }
  if (data.event_type === 'conversation.stopped_speaking' && teacher && (!activeInference || data.inference_id === activeInference)) {
    speaking = false; generationPending = false;
  }
  const caption = reducer?.ingest(data);
  if (caption?.role === 'pal' && !mutedForInterrupt && !retired.has(caption.inferenceId)) showCaption(caption.text);
  if (caption?.role === 'user' && caption.final) { inputFence++; generationPending = true; }
  // Only accepted final inputs drive server planning; streaming snapshots are never appended.
  if (data.event_type === 'conversation.utterance' || (data.event_type === 'conversation.utterance.streaming' && p?.final === true)) {
    const sessionId = current.id; const epoch = current.epoch;
    eventQueue = eventQueue.then(async () => {
      if (token !== generation || current?.id !== sessionId || leaving) return;
      const result = await api<{ session: View; result: { accepted: boolean } }>(`/api/sessions/${sessionId}/event`, { event: data, epoch });
      if (token === generation && current?.id === sessionId) { if (result.result.accepted) newOutputAllowed = true; update(result.session); }
    }).catch(e => { if (isOpen() && !leaving) notify(e.message); });
  }
  if (user && data.event_type === 'conversation.started_speaking') { inputFence++; generationPending = true; }
}
async function join(s: View) {
  const token = ++generation;
  const info = await api<{ conversation_url?: string; meeting_token?: string; conversation_id: string; epoch: number; offline: boolean }>(`/api/sessions/${s.id}/join`);
  if (token !== generation || current?.id !== s.id || !isOpen() || leaving) return;
  reducer = new Captions(info.conversation_id); retired.clear(); activeInference = ''; speaking = false; generationPending = false; newOutputAllowed = true;
  if (info.offline) {
    const ready = await api(`/api/sessions/${s.id}/ready`, {});
    if (token !== generation || leaving) return;
    update(ready); mediaReady = true; showCaption('这是离线演示。你可以通过文字入口测试规划与小结。'); render(); return;
  }
  const instance = Daily.createCallObject({ videoSource: false, startVideoOff: true, startAudioOff: true,
    subscribeToTracksAutomatically: true, userName: s.profile.name }); call = instance;
  let readyReporting = false; let readyResolve!: () => void; let readyReject!: (e: unknown) => void;
  const mediaPromise = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  void mediaPromise.catch(() => {}); // A ready failure may arrive before join() settles.
  const reportReady = () => {
    if (readyReporting || token !== generation || leaving) return; readyReporting = true;
    void api<View>(`/api/sessions/${s.id}/ready`, {}).then(ready => {
      if (token !== generation || leaving) { readyResolve(); return; }
      update(ready); mediaReady = true;
      try { instance.setLocalVideo(false); instance.setLocalAudio(micOn); } catch { micOn = false; notify('麦克风未开启，可以用文字交流。'); }
      render(); readyResolve();
    }).catch(readyReject);
  };
  instance.on('track-started', e => {
    if (e?.participant?.local && (token !== generation || leaving || e.track.kind === 'video')) { e.track.enabled = false; e.track.stop(); return; }
    refreshTracks(instance, token, reportReady);
  }); instance.on('participant-updated', () => refreshTracks(instance, token, reportReady));
  instance.on('app-message', e => { if (e) handleMessage(instance, token, e.data, e.fromId); });
  instance.on('camera-error', () => { if (token === generation) { micOn = false; render(); notify('麦克风未开启，仍可使用文字辅助。'); } });
  instance.on('network-connection', e => { if (token === generation && e?.event === 'interrupted') void abandon('网络中断，已停止旧播放。请重新开始连接。'); });
  instance.on('error', () => { if (token === generation) void abandon('通话连接未完成，已停止本地设备。'); });
  instance.on('left-meeting', () => { if (token === generation && !leaving) void abandon('已离开房间。'); });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([(async () => {
      await instance.join({ url: info.conversation_url, token: info.meeting_token, videoSource: false, startVideoOff: true, startAudioOff: true });
      if (token !== generation || leaving) return;
      refreshTracks(instance, token, reportReady); await mediaPromise;
    })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('老师媒体连接超时，请重试。')), 20000); })]);
    if (token !== generation || leaving) { await dispose(instance); return; }
    refreshTracks(instance, token); render();
  } catch (e) { await dispose(instance); throw e; }
  finally { clearTimeout(timer); }
}
async function abandon(message?: string) {
  if (leaving) return; leaving = true; const id = current?.id;
  localMute(); const released = releaseMedia();
  try { if (id) update(await api(`/api/sessions/${id}/exit`, {})); } catch (e) { notify((e as Error).message); }
  await released; leaving = false; render(); if (message) notify(message);
}
async function contextUpdate() {
  if (!live || !call || !current || !isOpen() || speaking || generationPending || mutedForInterrupt || contextSending || leaving
    || current.latestPlan?.status === 'running' || current.version === lastContextVersion) return;
  const s = current; const fence = inputFence; const token = generation; contextSending = true;
  try {
    const command = await api<{ version: number; epoch: number; context: string }>(`/api/sessions/${s.id}/context?version=${s.version}`);
    if (token !== generation || fence !== inputFence || current?.version !== command.version || speaking || generationPending || leaving) return;
    send('conversation.overwrite_llm_context', { context: command.context }); lastContextVersion = command.version;
    update(await api(`/api/sessions/${s.id}/context-sent`, { version: command.version, epoch: command.epoch }));
  } catch (e) { if (!(e instanceof ApiError && e.status === 409)) notify((e as Error).message); }
  finally { contextSending = false; }
}
function startPolling() {
  clearInterval(poll);
  poll = setInterval(() => {
    if (busyPoll || !current) return; busyPoll = true;
    void (async () => {
      const id = current!.id; const s = await api<View>(`/api/sessions/${id}`); if (current?.id !== id) return;
      update(s);
      if (isOpen() && Date.now() - heartbeatAt > 10000) { heartbeatAt = Date.now(); await api(`/api/sessions/${id}/heartbeat`, {}); }
      if (['closed', 'closing', 'failed'].includes(s.status) && mediaReady && !leaving) { await releaseMedia(); render(); }
      await contextUpdate();
    })().catch(e => { if (e instanceof ApiError && e.status === 401) { void abandon(); clearInterval(poll); el('login').hidden = false; el('workspace').hidden = true; } })
      .finally(() => { busyPoll = false; });
  }, 1000);
}
async function boot() {
  const data = await api<{ mode: string; current: View[] }>('/api/bootstrap'); live = data.mode === 'live';
  el('mode').textContent = live ? 'Tavus 实时对话 · Pi 教学规划' : '离线演示 · 无真实通话';
  el('login').hidden = true; el('workspace').hidden = false;
  if (data.current[0]) { update(data.current[0]); selected = data.current[0].profile.name.toLowerCase(); startPolling(); }
  render();
}
el<HTMLFormElement>('login-form').addEventListener('submit', e => {
  e.preventDefault(); void api('/api/login', { token: input('access-code').value.trim() }).then(() => { input('access-code').value = ''; return boot(); }).catch(e => notify(e.message));
});
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-profile]')) b.addEventListener('click', () => {
  selected = b.dataset.profile!; for (const other of document.querySelectorAll('[data-profile]')) other.classList.toggle('selected', other === b);
  current = undefined; el('summary-panel').hidden = true; el('records').hidden = true; showCaption(''); render();
});
button('start').addEventListener('click', () => {
  if (starting) return; starting = true; leaving = false; micOn = true; lastContextVersion = -1; mutedForInterrupt = false; render();
  startupAbort = new AbortController();
  void (async () => {
    if (!isOpen()) {
      update(await api('/api/sessions', { fixture: selected, chineseOnly: input('chinese-only').checked, saveAllowed: input('save-allowed').checked }, startupAbort!.signal));
    } else update(await api(path('reconnect'), {}));
    startPolling(); await join(current!);
  })().catch(async e => { if (e.name !== 'AbortError') notify(e.message); if (current && isOpen()) await abandon(); })
    .finally(() => { starting = false; render(); });
});
button('mic').addEventListener('click', () => { micOn = !micOn; try { call?.setLocalAudio(micOn); } catch { micOn = false; } render(); });
button('captions').addEventListener('click', () => { captionsOn = !captionsOn; el('caption').hidden = !captionsOn || !el('caption').textContent; render(); });
button('unlock-audio').addEventListener('click', () => { void playAudio(); });
button('interrupt').addEventListener('click', () => {
  localMute(); inputFence++; mutedForInterrupt = true; newOutputAllowed = false;
  for (const c of reducer?.snapshot() ?? []) if (c.role === 'pal') { retired.add(c.inferenceId); reducer?.interrupt(c.inferenceId); }
  if (activeInference) { retired.add(activeInference); reducer?.interrupt(activeInference); }
  send('conversation.interrupt'); speaking = false; generationPending = false;
  void api(path('interrupt'), {}).then(update).catch(e => notify(e.message)); render();
});
el<HTMLFormElement>('text-form').addEventListener('submit', e => {
  e.preventDefault(); const text = input('text').value.trim(); if (!text || !current || leaving) return;
  input('text').value = ''; inputFence++; generationPending = true;
  void (async () => {
    const out = await api<{ session: View; result: { accepted: boolean }; offlineReply?: string }>(path('text'), { inputId: crypto.randomUUID(), text }); update(out.session);
    if (!out.result.accepted) return;
    newOutputAllowed = true;
    if (live) send('conversation.respond', { text }); else { generationPending = false; showCaption(out.offlineReply ?? '离线输入已接收。'); }
  })().catch(e => { generationPending = false; notify(e.message); });
});
button('end').addEventListener('click', () => {
  button('end').disabled = true; inputFence++;
  void (async () => {
    const out = await api<{ session: View; controlText: string }>(path('prepare-close'), {}); update(out.session);
    if (live) { newOutputAllowed = true; generationPending = true; send('conversation.respond', { text: out.controlText }); }
    else showCaption(out.session.closing!.summary.oralReview);
  })().catch(e => notify(e.message)).finally(render);
});
button('continue').addEventListener('click', () => {
  localMute(); if (activeInference) { retired.add(activeInference); reducer?.interrupt(activeInference); } mutedForInterrupt = true; newOutputAllowed = false;
  inputFence++; send('conversation.interrupt'); speaking = false; generationPending = false;
  void api(path('resume'), {}).then(update).catch(e => notify(e.message));
});
button('confirm-end').addEventListener('click', () => {
  if (!current?.closing) return; const id = current.id; const closingId = current.closing.id;
  leaving = true; localMute(); const released = releaseMedia();
  void api<View>(`/api/sessions/${id}/finish`, { closingId, confirmation: 'user-confirmed' }).then(update)
    .catch(e => notify(e.message)).finally(async () => { await released; leaving = false; render(); });
});
button('exit').addEventListener('click', () => { void abandon(); });
button('retry-save').addEventListener('click', () => { void api(path('save'), {}).then(update).catch(e => notify(e.message)); });
button('revoke-consent').addEventListener('click', () => { void api(path('consent'), { allowed: false }).then(update).catch(e => notify(e.message)); });
button('history').addEventListener('click', () => {
  void api<{ records: View[] }>('/api/records').then(({ records }) => {
    el('records').hidden = false;
    el('record-list').replaceChildren(...records.map(s => { const entry = document.createElement('div'); entry.className = 'record';
      const title = document.createElement('strong'); title.textContent = `${s.profile.name} · ${s.inputCount} 次输入`;
      const text = document.createElement('span'); text.textContent = s.summary?.oralReview ?? ''; entry.append(title, text); return entry; }));
    if (!records.length) el('record-list').textContent = '暂时没有已保存的会话小结。';
  }).catch(e => notify(e.message));
});
window.addEventListener('pagehide', () => {
  if (!current || !isOpen()) return; leaving = true; localMute();
  navigator.sendBeacon(path('exit'), new Blob([JSON.stringify({ epoch: current.epoch })], { type: 'application/json' })); void releaseMedia();
});
void boot().catch(e => { if (!(e instanceof ApiError && e.status === 401)) notify(e.message); el('login').hidden = false; el('mode').textContent = '内部演示'; });
