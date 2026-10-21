import type { InputEvidence } from '../evidence/journal.js';

export type DirectiveKind = 'CHINESE_ONLY' | 'ENGLISH_SUPPORT' | 'CHINESE_FIRST' | 'PRACTICE_REQUEST'
  | 'DECLINE_PRACTICE' | 'SWITCH_TOPIC' | 'NO_CORRECTION' | 'LIGHT_CORRECTION' | 'SIMPLIFY' | 'UNDERSTOOD' | 'CLOSE';
export interface DirectiveRef { kind: DirectiveKind; evidenceId: string; turnId: string; inputVersion: number; quote: string }
export interface TeachingState {
  version: number;
  language: { mode: 'chinese_first' | 'chinese_only' | 'english_support'; source?: DirectiveRef };
  practice: { mode: 'free_talk' | 'active' | 'declined'; request?: DirectiveRef; source?: DirectiveRef };
  correction: { mode: 'light' | 'off'; source?: DirectiveRef };
  complexity: { mode: 'normal' | 'simplified'; source?: DirectiveRef };
  current: { closeRequested: boolean; topicSwitched: boolean; evidenceId?: string; modality: InputEvidence['modality'] };
  limits: { questions: 1; newTeachingPoints: 1; correctionPoints: 1; pronunciationAssessment: false; masteryAssessment: false };
  recognition: 'bounded-explicit-requests';
}

// Deliberately bounded direct-command grammar, not a general intent classifier.
// Unknown language stays in the user data for Pi; it cannot silently mutate state.
const prefix = '(?:(?:请|现在|接下来|以后|今天|这次|先|但是|不过|还是|麻烦你)\\s*){0,3}';
const cn = (expression: string) => new RegExp(`^${prefix}(?:${expression})(?:好吗|可以吗|谢谢|吧)?$`, 'u');
const matchers: [DirectiveKind, RegExp][] = [
  ['CHINESE_ONLY', cn('只(?:用|说|讲)中文|(?:不要|别)(?:用|说|讲)(?:英语|英文)')],
  ['ENGLISH_SUPPORT', cn('(?:(?:可以|能))?(?:用|说|讲)(?:一点|一些|点)?(?:英语|英文)(?:解释(?:一下)?)?(?:吗)?')],
  ['CHINESE_FIRST', cn('中文为主|主要用中文')],
  ['DECLINE_PRACTICE', cn('(?:我|我们)?(?:今天|现在|这次)?(?:(?:不想|不愿意|不需要|不要|不再|不)(?:再)?(?:练习|练|跟读)(?:了)?|只想(?:聊聊|聊天))|只(?:聊聊|聊天)')],
  ['PRACTICE_REQUEST', cn('(?:帮我|我们|我想|我希望)(?:一起)?(?:练习|练).{0,160}|我还想接着练.{1,160}|继续练习')],
  ['SWITCH_TOPIC', cn('(?:我想)?换个话题|不(?:讲|说)这个了')],
  ['NO_CORRECTION', cn('(?:不要|别)(?:纠正我|纠错)|我不想被纠正')],
  ['LIGHT_CORRECTION', cn('(?:帮我|给我)(?:纠错|改一下)|只帮我改一个(?:最重要的)?地方')],
  ['SIMPLIFY', cn('(?:我)?(?:没听懂|听不懂|没懂)|太难了|(?:能|可以)(?:说得)?简单(?:一点|一些)(?:吗)?')],
  ['UNDERSTOOD', cn('(?:我)?(?:明白了|听懂了|懂了)')],
  ['CLOSE', cn('(?:我们)?(?:今天)?(?:就|先)?(?:聊)?到这里|结束聊天|结束对话')],
  ['CHINESE_ONLY', /^(?:please )?(?:only (?:use|speak) chinese|chinese only|no english)$/iu],
  ['ENGLISH_SUPPORT', /^(?:please )?(?:explain (?:it )?in english|use (?:a little |some )?english)$/iu],
  ['CHINESE_FIRST', /^(?:please )?(?:mainly (?:use|speak) chinese|chinese first)$/iu],
  ['DECLINE_PRACTICE', /^(?:please )?(?:i (?:don't|do not|don’t) want to practi[cs]e|no (?:practice|drills)|(?:i )?just (?:want to )?chat)$/iu],
  ['PRACTICE_REQUEST', /^(?:please )?(?:help me practi[cs]e|i want to practi[cs]e|let's practi[cs]e).{0,160}$/iu],
  ['SWITCH_TOPIC', /^(?:please )?(?:change (?:the )?topic|let's change (?:the )?topic)$/iu],
  ['NO_CORRECTION', /^(?:please )?(?:don't|do not|don’t) correct me$/iu],
  ['LIGHT_CORRECTION', /^(?:please )?correct (?:me|one thing)$/iu],
  ['SIMPLIFY', /^(?:please )?(?:i (?:don't|do not|don’t) understand|make it simpler|say it more simply)$/iu],
  ['UNDERSTOOD', /^i understand now$/iu],
  ['CLOSE', /^(?:please )?(?:let's stop here|that's all for today|end (?:the )?conversation)$/iu],
];

export function explicitDirectives(input: InputEvidence): DirectiveRef[] {
  const result: DirectiveRef[] = [];
  const withoutQuotes = input.text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|‘[^’]*’|"[^"\n]*"/gu, '\uFFFD');
  for (const sentence of withoutQuotes.split(/[。！？!?；;\n]+|\.(?=\s|$)/u)) {
    const trimmed = sentence.trim();
    if (/^(?:如果|假如|比如|例如|他说|她说|老师说|学生说|我朋友说|if\b|suppose\b|for example\b|he said\b|she said\b)/iu.test(trimmed)) continue;
    for (const raw of sentence.split(/[，,]+/u)) {
      const quote = raw.trim();
      if (!quote || quote.includes('\uFFFD') || !input.text.includes(quote)) continue;
      const normalized = quote.normalize('NFKC').replace(/[ \t]+/gu, ' ');
      const kind = matchers.find(([, pattern]) => pattern.test(normalized))?.[0];
      if (kind) result.push({ kind, quote, evidenceId: input.id, turnId: input.turnId, inputVersion: input.stateVersion });
    }
  }
  return result;
}

export function deriveTeachingState(chineseOnly: boolean, inputs: InputEvidence[], version: number): TeachingState {
  const state: TeachingState = { version, language: { mode: chineseOnly ? 'chinese_only' : 'chinese_first' },
    practice: { mode: 'free_talk' }, correction: { mode: 'light' }, complexity: { mode: 'normal' },
    current: { closeRequested: false, topicSwitched: false, modality: inputs.at(-1)?.modality ?? 'unknown', evidenceId: inputs.at(-1)?.id },
    limits: { questions: 1, newTeachingPoints: 1, correctionPoints: 1, pronunciationAssessment: false, masteryAssessment: false },
    recognition: 'bounded-explicit-requests' };
  for (const input of inputs) {
    const latest = input === inputs.at(-1);
    for (const source of explicitDirectives(input)) {
      switch (source.kind) {
        case 'CHINESE_ONLY': state.language = { mode: 'chinese_only', source }; break;
        case 'ENGLISH_SUPPORT': state.language = { mode: 'english_support', source }; break;
        case 'CHINESE_FIRST': state.language = { mode: 'chinese_first', source }; break;
        case 'DECLINE_PRACTICE': state.practice = { mode: 'declined', source }; break;
        case 'PRACTICE_REQUEST':
          state.practice = { mode: 'active', source, request: source };
          if (latest) state.current.closeRequested = false;
          break;
        case 'SWITCH_TOPIC':
          state.practice = { mode: state.practice.mode === 'declined' ? 'declined' : 'free_talk', source };
          if (latest) { state.current.topicSwitched = true; state.current.closeRequested = false; }
          break;
        case 'NO_CORRECTION': state.correction = { mode: 'off', source }; break;
        case 'LIGHT_CORRECTION': state.correction = { mode: 'light', source }; break;
        case 'SIMPLIFY': state.complexity = { mode: 'simplified', source }; break;
        case 'UNDERSTOOD': state.complexity = { mode: 'normal', source }; break;
        case 'CLOSE':
          state.practice = { mode: state.practice.mode === 'declined' ? 'declined' : 'free_talk', source };
          if (latest) state.current.closeRequested = true;
          break;
      }
    }
  }
  return state;
}

export function teachingInstructions(state: TeachingState) {
  // Only program-owned enum values and instructions enter the system prompt.
  // Student quotes/goal requests remain data in the user payload.
  return [
    '以下是服务端校验的当前教学状态，优先于历史对话中的旧偏好和旧计划：',
    state.language.mode === 'chinese_only' ? '当前只用中文；不要逐句附英文。专名不代表英文支架。'
      : state.language.mode === 'english_support' ? '当前允许按需短英文支架，中文仍优先，不逐句固定双语。' : '当前中文优先，仅在确有需要时提供短英文支架。',
    state.practice.mode === 'declined' ? '学生已拒绝练习：不要邀请复述、跟读、练习或推进旧目标，直到学生明确重新请求。'
      : state.practice.mode === 'active' ? '学生有明确练习请求；保持连续性，但先回应当前意思，允许随时换题或拒绝。' : '自由聊天，当前没有必学或必练目标，不自行设定学习任务。',
    state.correction.mode === 'off' ? '学生要求暂停纠错，不纠正或变相安排纠错。' : '允许轻纠错，最多一个重点。',
    state.complexity.mode === 'simplified' ? '学生表示理解困难：简化措辞和解释，可提供一个简单例子；不只调整 HSK 标签。' : '按当前理解给自然完整的回应。',
    state.current.topicSwitched ? '学生已换题，旧练习目标已失效，不拉回旧题。' : '',
    state.current.closeRequested ? '学生本轮请求结束：简短确认与有来源的回顾，不增加任务；这不代表媒体已结束或记录已保存。' : '',
    '每轮最多一个追问、一个新教学点、一个纠错重点。不能根据文字评定实际发音、声调或掌握。',
    state.current.modality === 'text' ? '当前输入是文字，不把它称为语音练习。' : '当前只有转写/未知来源的文字，不能据此认定学生实际说错或发音正确。',
  ].filter(Boolean).join('\n');
}
