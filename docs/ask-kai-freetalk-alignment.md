# Ask Kai Free Talk 目标对照与 Tavus POC 验收

2026-10-19 · v1.1 · 配套 [PRD v0.5](tavus-agent-poc-prd.md)。这是设计审查及必要验收清单，尚无 Tavus 运行或真人通过结果。

## 1. 对照基线与结论

源仓库：`/Users/yuqinghuang/Documents/repos/ask_kai_freetalk`；HEAD：`23f936cfd19081235497a1cb146443045fed075a`；本次检查时无未提交修改。原仓库及其评测资料均未修改。

以当前 [README](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/README.md) 和 [implementation-plan](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/implementation-plan.md) 界定 Free Talk 范围，读取专项最新要求。早期原产品 PRD、旧三入口文档和历史固定句数规则不能覆盖已接受的 Free Talk 修订。源仓库尚未完成的真人体验不能当作本项目已具备的证据；源仓库注明“尚未实现”的难度设计在这里作为明确设计目标，而非既有功能。

**审查结论：v0.3 不能完整达到这些目标；v0.4 已补入缺失的必要要求和实现路径。能否实际达标须通过下表及原生能力验证，不能由文档完整推断产品已通过。** Tavus 仍负责实时口语生成；Pi 仍负责教学规划、工具、反馈与摘要审查。普通对话异步逐轮规划，不改成 Pi 生成所有回复。

v0.5 统一沿用源仓库的 M1–M5 顶层模块，组件归属见 [实施方案](implementation-plan.md)。A01–A19 目标与 G01–G06 验收保持不变；阶段编号使用 S0–S5，避免与模块混用。

## 2. 逐项对照

“已补入设计”不表示已实现；下列运行和体验验收目前均未执行。

| ID | 源仓库目标及依据 | v0.3 缺口 | v0.4 必要设计与验收 |
| --- | --- | --- | --- |
| A01 | [README](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/README.md)：只有 Free Talk，当前意图优先，允许零教学 | 已有方向，完成标准偏宽 | 保持 free；目标/知识点可空；不因新 Avatar 恢复固定课程或强迫练习 |
| A02 | [Mock 学习者](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/mock-learners.md)：四位成人、三份授权资料、来源/版本/覆盖状态 | 未明确切换界面和一致性验证 | 三类资料授权一致；版本冲突重读或失败；活动会话锁定身份；切换清理所有旧状态 |
| A03 | [初始计划](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/README.md)：先准备交流，初始不选目标 | “可为空”不够严格，固定开场未消费计划 | 初始模型只给交流字段；程序补 null/[]/[]；实际使用有效开场候选，准备绑定一次性票据和资料版本 |
| A04 | [逐轮规划](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/free-conversation-planner-summary.md)：每个有效学生回合观察和规划 | 缩成 Tavus 按需调用工具，普通聊天没有 Pi 反馈循环 | 有效 final 主动触发 Pi；普通回复并行生成；记录每轮结果或明确降级/失败；不依赖模型自主工具选择来覆盖普通回合 |
| A05 | [反馈设计](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/agent-feedback-design.md)：实际前文、提示/尝试/困难分开 | 只有工具入参和课后审查 | 逐轮输入含真实有限前文及前一回复实际范围；计划/生成稿/客户端报告不冒充听到、独立或掌握 |
| A06 | [目标生命周期](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/dynamic-goal-lifecycle.md)：局部求助与持续练习分开 | 缺少 catalog、先修、拒绝后的恢复边界 | 仅明确持续请求建立通用技能目标；active/paused/retired/unverified；关键词不恢复，未知先修不当不会，不读课程/Topic Pack |
| A07 | [自然教学](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/natural-teaching.md)：一个交流重心、教学冷却 | 未写两个有效回合的主动教学冷却 | 新点后两个有效学生回合不继续堆叠主动教学；当前求助仍可支持；不强制每句提问 |
| A08 | [澄清与纠正](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/clarification-and-correction.md)：正确句不误纠、歧义必要澄清一次 | 只写轻纠错 | 明确对象直接回答；含义不足仅澄清一次；不反复盘问、不凭转写诊断发音、不制造错误 |
| A09 | [语言请求](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/scoped-language-requests.md)：本轮/会话/画像分开 | 未定义临时求助失效和旧完成隔离 | 当前请求优先；只中文确认也只中文；英文输入不自动要求全英文；旧回复完成不清除新请求，长期保存走授权接口 |
| A10 | [当前回复策略](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/short-replies.md)：自然、有意义，无固定句数/字数 | 已取消句数上限，需要保护评测不恢复旧限制 | 保留无长度配额；一个主要动作可包含承接、相关补充和可选追问；旧长度指标只作历史诊断 |
| A11 | [中文难度修订](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/planner-speaking-difficulty-v2.md)：帮助程度/说话难度/语速独立，实际用词范围 | 只依据 HSK 泛泛调节，缺少三个难度维度 | 初始/逐轮 speaking_difficulty 及范围/理由/来源；普通主动词以已达等级为界，问词例外仅当前词；Nina 高级词分级未知保守处理；实际回复独立审查 |
| A12 | [语速](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/speech-pace.md)、[体验基线](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/experience-baseline.md)：慢速/正常、停顿、回声、真实插话、持续采音 | 有需求但 native auto 不证明配置或听感 | Tavus 支持的配置和真实中文听感验收；未验证的慢速按钮不能算通过；耳机/扬声器 E01–E09 分别测 |
| A13 | [字幕](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/progressive-captions.md)：渐进、跟随播放、中英顺序、取消清理 | 有累计文本适配，媒体时间边界仍未知 | 接累计 speech；发声/暂停/取消与媒体时间关联；不能按字数定时冒充同步；不显示未说完整稿为已播内容 |
| A14 | [结束流程](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/conversation-closing-design.md)：先同源总结，再播完自动关闭，可继续/立即退出 | 把同源要求降为“不矛盾”；缺收尾状态机 | prepare_session_close_v1 取审查后同一摘要，Tavus 自然讲述，匹配 closing_id/回复/摘要版本/播放边界；继续撤销，立即结束跳过；不能确认播放时必要项未过 |
| A15 | [总结结构](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/conversation-closing-design.md)：目标＋实际知识项＋交流回顾，覆盖早期内容 | 仅在结束后 post-call 生成，不支持结束前同源摘要 | 有界会话 recap 支撑结束前快照；口头、卡片、会话记录同 revision/hash；post-call 仅对账修订；零/部分/未知明确展示 |
| A16 | [会话保存](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/conversation-closing-design.md)：自动更新授权会话记录，详情读回、历史可查 | 仍笼统要求学生选择保存，缺记录接口 | ConversationRecordPort 自动 upsert/read/history；同版本幂等、旧版本拒绝；与自愿学习尝试写入分开；Mock 重启重置明确标注 |
| A17 | [四项反馈工程](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/agent-four-tasks.md)：来源、版本、更正、长会话、保守观察 | 只有通用“有来源”原则 | 通用技能保持 unassessed；表达候选需校准才可入正式观察；更正不加次数，目标变更不重标旧观察；长会话真实验证 |
| A18 | [评测规范](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/evaluation-policy-freeze.md)、[评测计划](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/agent-evaluation-plan.md)：固定案例/十维、实际输出、分层分母、未通过保持未完成 | 仅建议 36 场体验样本，不能覆盖内容目标 | 旧 40+8 内容集、四背景及 holdout、长会话与关键故障；语义/规则/真实回复/设备分开；不改 oracle/历史分数，无固定长度新要求另版本评审 |
| A19 | [Pi 理想设计](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/pi-ideal-tutor-harness-design.md)：身份/撤权/状态/工具/副作用由程序把关 | 基本原则已保留，需覆盖新增更新/收尾通路 | SessionState/Context/Closing/Record 共用授权和版本；新通路不绕过权限；配置/模型/源码/数据/rubric 版本可核对 |

## 3. 关键能力验证与失败处理

| Gate | S1 实际验证 | 不满足时如何判定 |
| --- | --- | --- |
| G01 有效话语与计划 | 同一 PAL 两个 Conversation，连续语音、重复、更正、乱序、回复早于 final，证明事件能进入正确本地回合 | 无法证明输入归属或有效回合覆盖时，不宣称逐轮规划完成 |
| G02 后续建议生效 | 原生 overwrite 上下文经数据通道发送，随后实际语音体现当前语言、拒绝、难度和目标；新输入打断旧更新 | 没有 ACK 就记录 sent/unknown；必要后续行为失败须修复，不用“异步”豁免 |
| G03 同步工具与竞争 | 原生工具结果回到 Gemma 并被采用；与同源后台 Pi 共享结果；超时、重试和旧结果不污染新回合 | 不重复执行计划/副作用；漏调用或错误采纳记录失败，不自动换成 Pi 回复生成 |
| G04 正常收尾 | 先取同源摘要、Tavus 正常回顾、页面卡片一致、实际媒体播放完成后关闭，期间可继续或立即退出 | 无法识别回复/播放边界时保留 unknown/failed；有界退出只算故障处理，不能算正常收尾达标 |
| G05 记录闭环 | 正常/立即/异常结束均保存获准最小记录，授权详情读回核对 revision/hash，课后修订只更新同一记录 | 缺许可不写；状态不明不能显示已保存；旧版本/重试不能污染历史 |
| G06 实际中文与 UI | 四背景的实际回复、语速、停顿/噪声/回声、字幕、真人 Face 与品牌声音 | 计划字段/DOM/静态 schema 不能代替真人内容和听感；必要项未通过保持 POC 未完成 |

优先调整 Tavus 官方支持的配置、提示词、工具定义、上下文编排及 Pi 规划；若原生能力仍有不可跨越的缺口，如实列阻断项并另行确定方案，不能在本轮未经决定替换实时回复模型、ASR/TTS 或将必要功能移到 P1。

## 4. 评测范围与记录

正式集在调优前冻结：原 FreeChat V3.1 共 40 案/244 轮及 8 组/11 轮语言对照；新增四背景 × 三类需要 12 场、每格独立 holdout 共 12 场，以及至少三场各 20–30 个有效学生回合的长会话，并验证 15 分钟或实际上下文裁剪边界。E01–E09 是设备/体验集，不能替代内容集。案例数字是最小覆盖设计，不能据此宣称统计显著。

沿用原十维 0/1/2 和权重：intent 15、correctness 15、instructions 10、level 12、expression 8、continuity 8、progress 10、personalization 5、persona 5、safety 12。旧固定句数/字数为历史评测契约，不作为本次自然回复的长度合格线；另版本评审内容承接、信息充分、自然延展和留给学生的表达空间，保留原作者逐项要求和历史结果。

运行模型只能看到已授权资料、当前输入与实际此前输出；评分规范、参考、未来输入和 holdout 预期不进运行上下文。内容 Judge 是辅助，教研校准未完成时不作最终质量通过结论。

每次记录 `source_commit/data_hash/agent_version/pi_model/tavus_model/pal_config_hash/face_id/voice_config/rubric_version`，以及 planned/accepted/sent/observed、rule/LLM、音频来源、实际设备和全部失败/缺失分母。不从原仓库既有测试数量或用户已验收的豆包页面推断 Tavus 新链路通过。

**当前状态：A01–A19 已写入设计要求；G01–G06、真实模型/设备和完整内容验收全部未运行。**
