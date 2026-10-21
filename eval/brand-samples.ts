export interface BrandSample {
  id: string; category: 'pronunciation' | 'numbers' | 'teaching' | 'identity';
  kind: 'fixed-utterance' | 'dialogue-stimulus'; text: string; observe: string[];
}
export const brandSamples: BrandSample[] = [
  { id: 'CN-01', category: 'pronunciation', kind: 'fixed-utterance', text: '你好，今天过得很好吗？', observe: ['三声变调与句子自然度', '口型及人物相似度'] },
  { id: 'CN-02', category: 'pronunciation', kind: 'fixed-utterance', text: '一个苹果，一本书；不是今天，也不太晚。', observe: ['一、不的变调', '短语连接自然'] },
  { id: 'CN-03', category: 'pronunciation', kind: 'fixed-utterance', text: '妈妈喜欢和朋友一起走走。', observe: ['轻声与重音', '不过度逐字朗读'] },
  { id: 'CN-04', category: 'pronunciation', kind: 'fixed-utterance', text: '我去银行办事，长大以后想学习音乐。', observe: ['银行、长大、音乐的多音字', '词语分界'] },
  { id: 'CN-05', category: 'pronunciation', kind: 'fixed-utterance', text: '四是四，十是十；这张纸上写着十个字。', observe: ['平翘舌的可辨性', '口型持续错位'] },
  { id: 'CN-06', category: 'pronunciation', kind: 'fixed-utterance', text: '蓝色的天空下，女孩正在认真听老师说话。', observe: ['n/l、前后鼻音的清晰度', '人物侧向或表情漂移'] },
  { id: 'CN-07', category: 'pronunciation', kind: 'fixed-utterance', text: '吃饭了吗？今天真好！请慢慢说，我在听。', observe: ['疑问、感叹及安抚语调', '表情与语意匹配'] },
  { id: 'CN-08', category: 'pronunciation', kind: 'fixed-utterance', text: '我们先听一遍，然后一起看看这个例子。', observe: ['连续普通话的节奏', '声音稳定且无明显机械断裂'] },
  { id: 'CN-09', category: 'numbers', kind: 'fixed-utterance', text: '今天是二〇二六年十月十九日，星期一。', observe: ['年份、日期读法', '数字处口型与声音同步'] },
  { id: 'CN-10', category: 'numbers', kind: 'fixed-utterance', text: '这本书二十五块五，下午三点半见面。', observe: ['金额与时间表达', '连读清楚'] },
  { id: 'CN-11', category: 'numbers', kind: 'fixed-utterance', text: '三本书、两杯茶和一张照片，都放在桌上。', observe: ['数量及量词', '列表节奏不过快'] },
  { id: 'CN-12', category: 'teaching', kind: 'dialogue-stimulus', text: 'Alex：我刚开始学中文。今天想聊吃饭，不想练习。', observe: ['初学者适配', '回应吃饭话题，拒绝后不安排练习'] },
  { id: 'CN-13', category: 'teaching', kind: 'dialogue-stimulus', text: 'Maya：我不懂“安排”，可以用一点英语解释吗？', observe: ['短英文支架自然', '不过度双语重复'] },
  { id: 'CN-14', category: 'teaching', kind: 'dialogue-stimulus', text: 'Maya：明白了，接下来只用中文吧。', observe: ['撤去英文支架', '语言切换不更换人物或声音'] },
  { id: 'CN-15', category: 'teaching', kind: 'dialogue-stimulus', text: 'Leo：我昨天买了三个书，只帮我改一个重要的地方。', observe: ['单个文字表达重点', '不从文本评价实际发音或掌握'] },
  { id: 'CN-16', category: 'teaching', kind: 'dialogue-stimulus', text: 'Nina：工作以后，保持生活和学习的平衡对我来说很难。', observe: ['成熟话题与较高水平适配', '自然接话，至多一个追问'] },
  { id: 'CN-17', category: 'identity', kind: 'fixed-utterance', text: '你好，我是 Kai 的 AI 数字人老师。今天想聊什么？', observe: ['与已授权老师的脸和声音对照', 'AI 身份说明清楚，开场不重复'] },
  { id: 'CN-18', category: 'identity', kind: 'fixed-utterance', text: '不用急，我在听。你可以想一想，再慢慢说。', observe: ['温和耐心的人格', '等待表情与口部稳定'] },
  { id: 'CN-19', category: 'identity', kind: 'dialogue-stimulus', text: '等一下，不讲节日了，我想问怎么点菜。', observe: ['真人打断后旧声音与旧字幕停止', '新话题恢复及人脸连续性；固定文字回放不能替代通话'] },
  { id: 'CN-20', category: 'identity', kind: 'dialogue-stimulus', text: '今天聊了足球，没有跟读练习。请简单回顾，然后结束。', observe: ['自然结束且不强加练习', '有来源回顾，形象声音在收尾无阻断性漂移'] },
];

export function prepareBrandReview() {
  return { timestamp: new Date().toISOString(), kind: 'offline-review-preparation', origin: 'local-prd-draft',
    source_baseline_alignment: 'pending-original-E01-E09-and-scoring-anchors', sample_count: brandSamples.length,
    candidate: { faceId: null, faceModel: null, finetuneStatus: null, voiceId: null, piModel: null, ttsConfig: null },
    real_outputs: 'not-run', brand_approval: 'not-evaluated', generated_audio_video: false,
    samples: brandSamples.map(sample => ({ ...structuredClone(sample), review: { status: 'not-run', reviewer: null, reviewedAt: null,
      recordingReference: null, referenceTeacherAsset: null, device: null, networkRegion: null,
      actualText: null, blockingIssues: null, chineseQuality: null, identityConsistency: null, brandApproval: null } })) };
}
