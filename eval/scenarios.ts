import type { FixtureId } from '../packages/business/context.js';
import type { TeachingState } from '../packages/tutor/teaching-state.js';

export const dimensions = ['intent', 'correctness', 'instructions', 'level', 'expression', 'continuity', 'progress', 'personalization', 'persona', 'safety'] as const;
export interface Scenario {
  id: string; title: string; rules: string[]; inputs: string[]; review: string[];
}
// Local drafts from the PRD. Do not relabel these as the source project's E01-E09.
export const scenarios: Scenario[] = [
  { id: 'LOCAL-01', title: '普通聊天与零目标', rules: ['T01', 'T02', 'T07'],
    inputs: ['今天只想聊聊，不想练习。', '昨晚看了一场球赛，太精彩了。'],
    review: ['回应球赛的意思，不机械切入词汇教学。', '不把历史兴趣或 HSK 等级变成必学任务。', '不在拒绝练习后继续要求复述。'] },
  { id: 'LOCAL-02', title: '明确练习请求与连续性', rules: ['T03', 'T06'],
    inputs: ['帮我练习怎么讲昨天发生的事。', '我昨天去公园，和朋友踢足球。', '我还想接着练这个。'],
    review: ['承接学生明确请求，保持过去事件表达的连续性。', '每轮最多一个重点，不同时布置多个任务。', '不把转写或模型评分当成掌握。'] },
  { id: 'LOCAL-03', title: '英文支架与撤除', rules: ['T04', 'T05'],
    inputs: ['我没听懂，可以用一点英语解释吗？', '现在我明白了，接下来只用中文。'],
    review: ['按需解释，不将每句固定翻译成双语。', '只中文要求生效后撤去英文支架。'] },
  { id: 'LOCAL-04', title: '理解困难与简化', rules: ['T05', 'T06'],
    inputs: ['太难了，我不懂“安排”是什么意思。', '还是没懂，能说得简单一点吗？'],
    review: ['缩短和简化解释，提供合适例子。', '依据当前理解调整，不能只重复等级标签。', '不连续提出多个问题。'] },
  { id: 'LOCAL-05', title: '轻纠错', rules: ['T01', 'T06', 'T08'],
    inputs: ['我昨天去商店买了三个书。', '请只帮我改一个最重要的地方。'],
    review: ['先回应意思，最多处理一个重点。', '不同时宣告语法、词汇、发音三类评判。', '文字没有音频，不能判断声调正确。'] },
  { id: 'LOCAL-06', title: '拒绝练习、冷却与换题', rules: ['T02', 'T07'],
    inputs: ['我们练习讲旅行经历吧。', '先不练了，我想换个话题。', '最近你喜欢什么音乐？'],
    review: ['明确拒绝后停止推进原练习。', '接住音乐话题，不用旧计划拉回旅行。', '没有学生重新请求时，不再次邀请练习。'] },
  { id: 'LOCAL-07', title: '打断后的新意图', rules: ['T01', 'T07', 'T09'],
    inputs: ['请给我解释一下中国的节日。', '等一下，不讲这个了。我想问怎么点菜。'],
    review: ['回应点菜的新意图，不继续节日讲稿。', '协议测试不能证明真实停播；需要另做媒体打断检查。', '旧回复未说完的部分不能进入已听过事实。'] },
  { id: 'LOCAL-08', title: '发音问题与证据边界', rules: ['T08', 'T09'],
    inputs: ['我刚才“你好”的第三声发得标准吗？', '这里只给你文字，没有提供录音。'],
    review: ['明确不能从文字评定实际发音。', '可以解释标准读法，不宣称学生实际发得正确。', '不给掌握、准确率或声调评分。'] },
  { id: 'LOCAL-09', title: '结束与有来源的小结', rules: ['T09', 'T10'],
    inputs: ['我今天聊了足球，没有跟读练习。', '今天到这里，请简单回顾一下。'],
    review: ['简短收口，不强制增加练习。', '口头回顾与卡片引用同一证据截止版本。', '没有练习就说明以交流为主，未收到保存回执时不显示已保存。'] },
];

export const chineseListeningChecklist = [
  '三声与变调：你好、很好；一、不；轻声：妈妈。',
  '多音字：银行、长大、音乐；数字、日期、量词。',
  '长停顿、重复、句中自我修正、母语口音与中英混合。',
  '只中文、临时英文帮助、持续支架与撤架。',
  '真实打断后的停止出声、字幕边界与新话题恢复。',
];

export interface TeachingExpectation {
  language?: TeachingState['language']['mode']; practice?: TeachingState['practice']['mode'];
  complexity?: TeachingState['complexity']['mode']; correction?: TeachingState['correction']['mode'];
  current_close_requested?: boolean;
}
// These are executable state-contract expectations, not teaching quality scores.
export const expectedTeachingStates: Record<string, TeachingExpectation[]> = {
  'LOCAL-01': [{ practice: 'declined' }, { practice: 'declined' }],
  'LOCAL-02': [{ practice: 'active' }, { practice: 'active' }, { practice: 'active' }],
  'LOCAL-03': [{ language: 'english_support', complexity: 'simplified' }, { language: 'chinese_only', complexity: 'normal' }],
  'LOCAL-04': [{ complexity: 'simplified' }, { complexity: 'simplified' }],
  'LOCAL-05': [{ correction: 'light' }, { correction: 'light' }],
  'LOCAL-06': [{ practice: 'active' }, { practice: 'declined' }, { practice: 'declined' }],
  'LOCAL-07': [{ practice: 'free_talk' }, { practice: 'free_talk' }],
  'LOCAL-08': [{ practice: 'free_talk' }, { practice: 'free_talk' }],
  'LOCAL-09': [{ current_close_requested: false }, { current_close_requested: true }],
};
export function evaluationCases() {
  return (['alex', 'maya', 'leo', 'nina'] as FixtureId[]).flatMap(fixture => scenarios.map(scenario => ({
    id: `${fixture}:${scenario.id}`, fixture, scenario,
    baseline: 'source-E01-E09-unavailable' as const,
  })));
}
