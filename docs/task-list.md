# Tavus Agent POC task list

2026-10-19 · v1.1 · 基于 [实施方案](implementation-plan.md) 与 [PRD v0.5](tavus-agent-poc-prd.md)。本清单拆分工程工作，不变更已确认的 Tavus/Pi 职责或 Free Talk 完成标准。

## 1. 状态与依赖规则

本清单的 42 项原生方案任务当前仍登记为 **todo，未验收**。主干已合入此前自定义 LLM 方案的离线运行时及可复用核心；尚未逐项映射到本清单，不以旧方案测试直接勾选 TA 任务。尚无真实付费 API、素材上传、部署或真人验收结果。合入范围和待迁移项见 [主干合并说明](mainline-merge-notes.md)。角色是拟承担职责，不代表已分派人员或创建其他聊天。

状态使用 todo / in_progress / implemented / verified / blocked；只有交付物和该任务必要验证齐备，才将“完成”框勾选并登记证据。implemented 不等于真实模型、供应商或真人通过。blocked 必须写具体输入/能力、能继续的部分和解除条件；不把可合成实现的部分一并停下。

依赖表示复用前置产物，不自动表示相应供应商 Gate 已通过。S1 任务完成报告也可以得出 fail/unknown；正式里程碑仍需相关 Gate pass。D01–D04 的定义见实施方案；默认不新增实时回复模型/ASR/TTS 选型。

## 2. M1–M5 顶层模块与任务归属

M 编号仅表示顶层职责模块，S 编号表示排期阶段；例如 S2 对话与教学会同时涉及 M1 Web、M2 编排、M3 Agent Core、M4 资料和 M5 模型/媒体。任务编号 TA-01–42、依赖和验收不变。内部组件的完整归属见 [实施方案第 2 节](implementation-plan.md)。

| 顶层模块 | 内部组件/能力 | 主要实施任务 |
| --- | --- | --- |
| M1 Web 交互与呈现 | MediaAdapter、字幕、PlaybackAdapter、SummaryView、资料/记录页面 | TA-08、TA-23–25、TA-29；协作 TA-36/41 |
| M2 会话网关与运行编排 | SessionActor、PolicyKernel、TavusClient/EventAdapter、ToolDispatcher、ClosingCoordinator、JobStore/CleanupWorker | TA-07、TA-09–13、TA-16、TA-28、TA-31–32、TA-36 |
| M3 Agent Core | PiPlanner、PlanningCoordinator、教学/语言/难度/目标策略、ContextCompiler、Recap/SummaryBuilder | TA-05、TA-11、TA-17–22、TA-26–27、TA-35 |
| M4 学习者资料与会话记录 | LearnerContextPort、PreferencePort、ConversationRecordPort、Mock adapters | TA-04、TA-13、TA-30；协作 TA-17/20/31/36 |
| M5 实时音视频与模型服务 | Tavus/Daily/Gemma/Face/Voice、独立规划模型 provider | TA-07–14、TA-33–35；由 M1/M2/M3 实现本地适配 |

TA-01–03 的共用工程/契约及 TA-06、TA-37–42 的独立验证属于支撑工作，不增加新的顶层业务模块。任务的“模块归属”表示实际责任边界与协作，不能按代码包名称或外部能力名称另建一套状态真相。

## 3. 实施阶段 S0–S5 总览

| 阶段 | 任务 | 阶段产物 |
| --- | --- | --- |
| S0 | TA-01–06 | 基线、可运行基础、契约、Mock、Pi adapter、冻结评测 |
| S1 | TA-07–15 | 最小原生链路与六个 Gate 的真实能力结论 |
| S2 | TA-16–25 | 逐轮 Free Talk、目标/语言/难度、媒体控制和页面 |
| S3 | TA-26–32 | 同源小结、可撤销结束、记录、post-call 和恢复 |
| S4 | TA-33–36 | 正式老师、中文配置、质量校准与系统嵌入 |
| S5 | TA-37–42 | 原内容、个性化/holdout、长会话、设备与最终裁决 |

先执行 S0，再用最小实现做 S1；独立离线策略与素材准备可按依赖推进。S1 前不预定整体验收日期。每项的路径是拟实现位置，文件不存在不表示已经实现。


## S0 任务

### TA-01 冻结需求、源仓库基线与待决策项

- [ ] 完成

状态：todo。依赖：无。角色：工程/教研。外部条件：无。

模块归属：跨模块支撑：M1–M5 需求/基线。

交付：登记 PRD v0.5、源仓库 commit/文件 hash、A01–A19、G01–G06、原数据与历史规则边界；登记 D01–D04，维护选型/输入状态。

落点：`docs/reference/、docs/decisions/（拟建）`。

验收：能区分已确认职责、尚未实现的难度目标、历史长度规则及真实未验证项；源仓库不被修改。

覆盖：A01,A18,A19。证据：待登记。

### TA-02 建立 TypeScript/Node.js 最小工程与离线检查

- [ ] 完成

状态：todo。依赖：TA-01。角色：全栈。外部条件：无。

模块归属：跨模块工程基础：M1/M2/M3/M4；M5 适配配置。

交付：建立单进程服务和轻量 Web、workspace/锁文件、配置 schema、环境变量示例、忽略目录、verify/replay 命令；核对 Node/Pi 兼容版本。

落点：`workspace、apps/server/、apps/web/、packages/、scripts/`。

验收：无 key 可启动离线健康页并运行确定性检查；未配置真实能力明确报未配置；默认命令不请求供应商、不启动采音，前端构建不含服务密钥。

覆盖：A19。证据：待登记。

### TA-03 定义业务契约、状态版本与事实等级

- [ ] 完成

状态：todo。依赖：TA-02。角色：后端/Agent。外部条件：无。

模块归属：跨模块共用契约；M2 负责提交校验。

交付：定义 Session/Turn/InputRevision/Plan/Context/Tool/Closing/Summary/Record/Job schema、错误、授权和版本；planned/accepted/sent/client_reported/verified 等来源分开。

落点：`packages/contracts/`。

验收：非法枚举、缺来源、跨 owner/session、旧 revision、伪造已应用/已掌握被拒绝；契约中的业务 ID 不冒充供应商 wire 字段。

覆盖：A03,A04,A05,A14,A15,A16,A17,A19。证据：待登记。

### TA-04 接入四位 Mock 学习者和最小授权业务接口

- [ ] 完成

状态：todo。依赖：TA-03。角色：后端。外部条件：无。

模块归属：M4 主责；M2 授权与调用。

交付：移植四位资料、三类一致性聚合、偏好和历史读取；准备一次性票据/会话归属及 ConversationRecordPort 的最小 Mock 存取。

落点：`packages/business/、fixtures/learners/`。

验收：三份 owner/learner/snapshot/revision 不一致时重读或失败；跨人拒绝；同摘要 revision/hash 可写回读回，Mock 重启重置明确标注。

覆盖：A02,A03,A16,A19。证据：待登记。

### TA-05 从第一天引入 Pi adapter 与有界执行配置

- [ ] 完成

状态：todo。依赖：TA-03、TA-04。角色：Agent。外部条件：D01（真实模型部分）。

模块归属：M3 主责；调用 M5 独立规划模型。

交付：封装 Pi 初始、逐轮、结束前审查、课后核对执行；provider/model/key 由服务端配置，工具白名单；外部请求可取消，输出结构化提案。

落点：`packages/tutor/pi/`。

验收：合成模型验证 deadline/abort/无效结果；规则与 LLM 来源分开；不开放 coding-agent shell/文件工具，不把 tavus-gemma-4 当 Pi 推理端点。真实样例另标未运行。

覆盖：A03,A04,A05,A15,A19。证据：待登记。

### TA-06 冻结内容评测协议、输入及 holdout 管理

- [ ] 完成

状态：todo。依赖：TA-01、TA-03。角色：评测/教研。外部条件：无。

模块归属：独立评测支撑；覆盖 M1–M5。

交付：冻结原 40 案/244 轮、8 组/11 轮及源 hash；编写四背景/长会话/故障覆盖与独立预期，登记旧长度规则适用性，隔离参考/oracle。

落点：`eval/datasets/、eval/rubric/、eval/manifests/`。

验收：模型运行输入只含当时实际材料；十维权重/安全不降；新自然度审阅另版本；正式采集前完成协议冻结且不能由 Agent 输出反定义正确答案。

覆盖：A10,A11,A18。证据：待登记。

## S1 任务

### TA-07 实现 Tavus REST、版本配置与资源账本

- [ ] 完成

状态：todo。依赖：TA-02、TA-03。角色：后端。外部条件：D02。

模块归属：M2 主责；适配 M5 Tavus。

交付：最小 TavusClient；复用稳定 PAL/Tools、每次新建 Conversation；显式 full/Gemma、私有房间、默认关闭摄像头/Raven/录制；配置核对与创建结果未知时对账。

落点：`packages/tavus/、config/、scripts/`。

验收：真实 create/get/end/get 可复核；无 token 加入失败；不调用不存在的 speak/interrupt REST；创建超时不盲目重复建资源，不随会话删共享资产。

覆盖：A19。证据：待登记。

### TA-08 打通最小 Daily 音视频、就绪与设备边界

- [ ] 完成

状态：todo。依赖：TA-07。角色：前端/音视频。外部条件：D02。

模块归属：M1 主责；直连 M5 Daily/Tavus。

交付：最小页面显示老师视频、接收音频和交互事件；关闭麦克风加入，确认 PAL/媒体及授权后启用；手动停止和退出最小实现。

落点：`apps/web/media/、scripts/probes/`。

验收：真实 join 与媒体/可采音状态分开；记录 SDK 权限/采集/上传实际时点；退出释放设备；无麦克风/摄像头权限可恢复或明确辅助文字输入，文字不算语音证据。

覆盖：A12,A13,A19。证据：待登记。

### TA-09 验证连续语音回合、事件归属与输入更正

- [ ] 完成

状态：todo。依赖：TA-03、TA-08。角色：后端/音视频。外部条件：D02。

模块归属：M2 主责；M1 事件转送、M5 事件来源。

交付：规范化 pal/replica/user、seq/inference/participant、累计 speech/final；本地学生回合与 input revision 映射，授权转送，最小双会话账本。

落点：`packages/tavus/events/、apps/server/session/`。

验收：真实连续语音不依赖 respond 的 turn_idx 递增；重复/乱序/迟到、更正和回复早于 final 均有确定处理；归属不明隔离并报告缺口；G01 证据可复核。

覆盖：A04,A05,A13,A17,A19。证据：待登记。

### TA-10 注册三个原生工具并验证 HMAC/结果回传

- [ ] 完成

状态：todo。依赖：TA-05、TA-07、TA-08、TA-09。角色：后端/Agent。外部条件：D02；D01 用于真实 Pi 结果。

模块归属：M2 ToolDispatcher 主责；协作 M3/M5。

交付：注册并关联教学/结束前/post-call 三工具；raw body 验签、conversation 映射、参数和幂等；in_call 用 silent/generate_response。可先用标记为 synthetic 的结构化结果排协议。

落点：`apps/server/hooks/、config/tools/、scripts/probes/`。

验收：真实 HMAC/HTTPS 调用及 Gemma 使用结果；无签名/伪签名拒绝；超时/一次重试/同键异参和未知会话受控；协议 stub 成功不计 Pi 真实规划通过。

覆盖：A04,A14,A15,A16,A19。证据：待登记。

### TA-11 验证逐轮 Pi、原生上下文更新与工具竞争

- [ ] 完成

状态：todo。依赖：TA-05、TA-08、TA-09、TA-10。角色：Agent/后端。外部条件：D01,D02。

模块归属：M3 主责；协作 M1/M2/M5。

交付：有效 final 主动触发最小 Pi 规划，与 Tavus 回复并行；编译后续上下文经页面发送 overwrite；同步工具和后台任务共享同源版本结果。

落点：`packages/tutor/、apps/server/session/、scripts/probes/`。

验收：普通聊天有 Pi 结果或明确失败；G01/G02/G03 的真实样例覆盖计划正确但未遵循、无 ACK、修订输入、取消/迟到、相同文本双会话；不能以 sent 判 applied。

覆盖：A03,A04,A05,A09,A11,A19。证据：待登记。

### TA-12 验证结束前同源摘要、回复关联与播放边界

- [ ] 完成

状态：todo。依赖：TA-08、TA-09、TA-10、TA-11。角色：音视频/后端/教研。外部条件：D01,D02。

模块归属：M2 ClosingCoordinator 主责；协作 M1/M3/M5。

交付：用最小 recap 与实际 Pi 审查结果跑结束工具、Tavus 回顾及同版本预览；寻找可测量的 Daily/WebRTC 客户端播放完成关联。

落点：`scripts/probes/、apps/web/media/、apps/server/closing/`。

验收：G04 覆盖未调用先告别、工具返回后发问、正常播完、继续/立即退出、静音/暂停/旧回复/超时；记录可证明边界。若只有 stopped_speaking 或固定等待，Gate 必须 unknown/fail。

覆盖：A14,A15,A19。证据：待登记。

### TA-13 验证会话记录读回、post-call 与最小可靠接收

- [ ] 完成

状态：todo。依赖：TA-04、TA-09、TA-10、TA-12。角色：后端。外部条件：D02。

模块归属：M4 记录接口、M2 任务与调用；协作 M3/M5。

交付：同源摘要 upsert/read、课后候选对账与重复投递；最小 JobStore 先落入站任务再返回 202，并验证恢复/撤权处理。

落点：`packages/business/、apps/server/jobs/、scripts/probes/`。

验收：G05：同 revision/hash 读回；旧版本不覆盖；post-call 与口头结果只更新同一记录；无对话/转写晚到/投递失败有状态；进程重启不能把已接收任务无声丢失或复活旧授权。

覆盖：A15,A16,A19。证据：待登记。

### TA-14 验证中文、原生语速配置与真人素材路径

- [ ] 完成

状态：todo。依赖：TA-08、TA-10。角色：音视频/教研/品牌。外部条件：D02；D03 用于真人部分。

模块归属：M5 媒体/资产能力；M1/M2 验证与配置。

交付：初测四背景中文/中英、停顿与打断、慢速/正常；登记本人参考/训练素材和 Face 训练路径、状态/声音，必要时用 stock 先排媒体问题。

落点：`scripts/probes/、docs/assets/、config/voice/`。

验收：G06 初步真实样例保留配置与听感；不能用模型 pace 字段或按钮证明语速；真人素材不可用时明确品牌验证 pending，不把 stock 当最终通过。

覆盖：A11,A12,A13。证据：待登记。

### TA-15 形成 S1 能力结论、阻断项与后续估算

- [ ] 完成

状态：todo。依赖：TA-06、TA-07、TA-08、TA-09、TA-10、TA-11、TA-12、TA-13、TA-14。角色：工程/教研。外部条件：无。

模块归属：跨模块能力审查：M1–M5。

交付：汇总 G01–G06 的 pass/fail/unknown/blocked、证据与范围；登记最小实现可复用部分、原生缺口、正式开发顺序和重新估算。

落点：`docs/evidence/m0/（拟建）、task-list.md`。

验收：每个 Gate 均有真实结论或明确未执行原因；未通过项不得包装为成功。可行性审查完成不等于六个 Gate 全通过；正式里程碑依赖相应 Gate 实际通过。

覆盖：A01,A18,A19。证据：待登记。

## S2 任务

### TA-16 完善 SessionActor、授权与跨回合状态控制

- [ ] 完成

状态：todo。依赖：TA-03、TA-04、TA-09。角色：后端。外部条件：无。

模块归属：M2 SessionActor/PolicyKernel。

交付：实现按会话串行提交、异步任务令牌、epoch/输入/状态/授权版本、连接/教学两类状态；重连恢复最小允许摘要。

落点：`apps/server/session/、packages/contracts/`。

验收：两会话并发、撤权、重复/旧回调、模型忽略 abort、新 epoch 和旧输入更正不能覆盖当前状态；断线不重播旧音频，不恢复旧授权。

覆盖：A04,A05,A17,A19。证据：待登记。

### TA-17 完成初始规划、准备票据和开场消费

- [ ] 完成

状态：todo。依赖：TA-04、TA-05、TA-16。角色：Agent/后端。外部条件：D01；端到端需 D02。

模块归属：M3 初始规划；M2 准备/提交，M4 资料，M5 推理。

交付：三类资料→Pi 交流字段→校验→编译空目标→选择实际开场→一次性准备；偏好/语速/身份/版本/有效期绑定。

落点：`packages/tutor/initialization/、apps/server/session/`。

验收：模型初始越界目标字段拒绝；15 秒含修复/校验；切换/取消使旧准备失效；四人开场真实差异有来源，不能仅后台字段变化；降级原因可见。

覆盖：A02,A03,A10,A11。证据：待登记。

### TA-18 产品化逐轮 PlanningCoordinator 与反馈输入

- [ ] 完成

状态：todo。依赖：TA-05、TA-11、TA-16、TA-17。角色：Agent/后端。外部条件：D01；真实遵循需 D02/G01–G03。

模块归属：M3 PlanningCoordinator/Feedback；M2 接受提案。

交付：每有效 final 产生观察和单一提案；引用实际有限前文、前一回复范围、当前目标/语言/拒绝；同步工具结果共享同源任务；提交前复核。

落点：`packages/tutor/planning/、packages/evidence/feedback/`。

验收：2 秒覆盖排队/修复/提交；每轮 LLM/rule/失败有分母；合法重复不吞、同一更正不加次数；历史示范和当前未知时序不变成独立使用事实。

覆盖：A04,A05,A17,A19。证据：待登记。

### TA-19 实现 Skill catalog 与目标生命周期

- [ ] 完成

状态：todo。依赖：TA-04、TA-05、TA-16、TA-18。角色：Agent。外部条件：无。

模块归属：M3 教学策略；M2 提交目标/冷却状态。

交付：通用技能版本/先修、局部帮助、持续练习意图、active/paused/retired/unverified、拒绝/恢复及新点后的两个有效回合冷却。

落点：`packages/tutor/goals/`。

验收：初始空目标；求助不建整场目标；关键词不恢复已拒绝目标；先修未知不当不会；单次困难/英文/短句不自动退级；Free 不读取课程/Topic Pack。

覆盖：A01,A06,A07,A17。证据：待登记。

### TA-20 实现语言、帮助请求与偏好作用范围

- [ ] 完成

状态：todo。依赖：TA-04、TA-16、TA-18。角色：Agent。外部条件：无。

模块归属：M3 语言策略；M2 提交范围，M4 保存获准偏好。

交付：当前回复/会话/授权画像分层；本次理解或表达求助到期；中文优先和对应英文；偏好更正更新最小上下文并撤销旧准备。

落点：`packages/tutor/language/`。

验收：只中文确认不夹英文；英文回答不自动转全英文；引语/否定不改偏好；旧完成不清除新请求；临时求助不保存长期画像；真实语言对照独立验证。

覆盖：A09,A19。证据：待登记。

### TA-21 实现个性化中文难度与保守降级

- [ ] 完成

状态：todo。依赖：TA-04、TA-05、TA-18、TA-19、TA-20。角色：Agent/教研。外部条件：D01（模型选择）；语义需教研复核。

模块归属：M3 难度/澄清/纠错策略；M4 来源，M5 生成执行。

交付：support_level 与 speaking_difficulty 独立；三个难度维度、当前范围/reason/refs；同版 HSK、问词局部例外、Nina 分级未知边界；正确句/歧义规则。

落点：`packages/tutor/difficulty/、fixtures/hsk/`。

验收：同等级不同理解的成对案例通过；不按姓名固定答案；正确句不造错，必要澄清一次；不增加句数/字数配额；字段合格与真实用词语义合格分别报告。

覆盖：A07,A08,A10,A11。证据：待登记。

### TA-22 产品化 ContextCompiler 与原生控制传输

- [ ] 完成

状态：todo。依赖：TA-11、TA-16、TA-18、TA-19、TA-20、TA-21。角色：后端/音视频。外部条件：D02；正式能力依赖 G02/G03。

模块归属：M3 ContextCompiler；M2 调度，M1 转送至 M5。

交付：编译基础规则/资料/当前状态/后续建议；安全回复边界发送最新完整上下文，记录 hash/scope/sent，合并过时更新；控制通路校验会话与授权。

落点：`packages/tutor/context/、apps/web/control/`。

验收：裁剪不丢基础约束或把旧目标塞回新回合；取消/结束待决时不发送旧计划；不伪造版本 ACK；真实后续内容遵循必要约束；失败计实际失败。

覆盖：A04,A06,A09,A11,A19。证据：待登记。

### TA-23 完成手动/语音打断、采音与重连恢复

- [ ] 完成

状态：todo。依赖：TA-08、TA-09、TA-16、TA-22。角色：音视频/前端/后端。外部条件：D02；真实听感需设备。

模块归属：M1 媒体控制、M2 取消/恢复；协作 M5。

交付：本地先停旧播放/字幕，原生 interrupt 与 Pi 取消协调；媒体恢复边界、静音/权限、设备变化、新 epoch 和资源结束。

落点：`apps/web/media/、apps/server/session/`。

验收：E02–E07 的停顿/噪声/回声/真正插话分别测；手动停止仍保留学生采音，未确认旧输出停止不提前放音；重复/迟到结果不能复活旧话题。

覆盖：A12,A13,A19。证据：待登记。

### TA-24 完成渐进字幕与媒体状态关联

- [ ] 完成

状态：todo。依赖：TA-08、TA-09、TA-23。角色：前端/音视频。外部条件：D02（真实媒体）。

模块归属：M1 字幕组件；M2 归属校验，M5 事件来源。

交付：累计 speech 按 content_index 更新，pal/replica 去重，停播/中断/乱序清理；中英顺序与可访问的字号/显隐控制，未知对齐有标记。

落点：`apps/web/captions/`。

验收：不重复 append，不把完整生成稿的未说部分显示为已播放；不按固定每字延时冒充同步；DOM、供应商事件与真人音画体验分别留证。

覆盖：A09,A12,A13。证据：待登记。

### TA-25 完成 Free Talk 页面、资料切换与观察面板

- [ ] 完成

状态：todo。依赖：TA-04、TA-08、TA-17、TA-18、TA-20、TA-23、TA-24。角色：前端。外部条件：无。

模块归属：M1 Web；协作 M2/M3/M4。

交付：四位 Mock 选择、三类资料、准备/就绪/失败、语速/字幕、文字辅助；默认隐藏诊断及有界导出，显示规划/规则/上下文/工具状态。

落点：`apps/web/`。

验收：活动会话锁身份；切换/新开清旧字幕/总结/准备；移动端可读；未就绪不假装连接/说话，诊断丢失不改变教学或媒体，不导出密钥和完整对话。

覆盖：A02,A03,A04,A12,A13,A19。证据：待登记。

## S3 任务

### TA-26 实现有来源的会话 recap 与保守观察

- [ ] 完成

状态：todo。依赖：TA-09、TA-16、TA-18、TA-19。角色：Agent/后端。外部条件：无。

模块归属：M3 Recap/Feedback 计算；M2 接受状态。

交付：维护实际话题、目标历史、知识项候选、学生尝试候选与覆盖状态；更正/取消/角色/早期内容有界保留，来源引用可核对。

落点：`packages/evidence/recap/`。

验收：教师示范/引语/否定/自述不会变成学生尝试；未校准通用技能 unassessed；目标变化不重标旧观察；裁剪/缺来源明确 partial，不保存完整逐字稿。

覆盖：A05,A06,A15,A17。证据：待登记。

### TA-27 实现 Pi 审查与同源 SummaryBuilder

- [ ] 完成

状态：todo。依赖：TA-05、TA-20、TA-21、TA-26。角色：Agent/教研。外部条件：D01（真实 Pi 审查）。

模块归属：M3 SummaryBuilder/Pi 审查；M2 接纳快照。

交付：objective/knowledge_points/conversation_recap 共用 snapshot；版本/hash/cutoff/source_refs、可选拼音/释义校验；支持 empty/partial/unknown。

落点：`packages/evidence/summary/、packages/tutor/review/`。

验收：目标不等于成果，提到/示范/尝试不混用；自由交流无知识项可诚实回顾；口头、卡片、保存引用同一摘要；模型摘要需来源与语义复核。

覆盖：A10,A11,A14,A15,A17。证据：待登记。

### TA-28 产品化 ClosingCoordinator 与结束前工具

- [ ] 完成

状态：todo。依赖：TA-10、TA-12、TA-16、TA-22、TA-27。角色：后端/Agent。外部条件：D02；正式能力依赖 G04。

模块归属：M2 ClosingCoordinator/ToolDispatcher；协作 M3/M5。

交付：有效结束→取消旧规划→摘要预览→Tavus 回顾→等待播放→记录→关闭；绑定 closing/输入/回复/摘要；继续撤销、立即退出、阶段超时。

落点：`apps/server/closing/、apps/server/hooks/`。

验收：引用/翻译/否定不能挂断；工具无独立关闭权限；继续后旧预览/回执失效；总结后不再追问；未经 G04 可行性证据不宣称正常收尾通过。

覆盖：A14,A15,A19。证据：待登记。

### TA-29 完成客户端收尾播放确认与同源卡片

- [ ] 完成

状态：todo。依赖：TA-12、TA-24、TA-25、TA-27、TA-28。角色：前端/音视频。外部条件：D02、G04。

模块归属：M1 PlaybackAdapter/SummaryView；协作 M2/M3。

交付：依实际验证的媒体边界生成有归属播放报告；同 revision 卡片、正在总结/继续/立即结束、语音完成/未确认与保存状态。

落点：`apps/web/closing/、apps/web/summary/`。

验收：静音/暂停/无音频/缓存/旧回复/字幕未完不假报完成；收尾保持可插话；固定超时只做失败退出；卡片不暴露内部来源 ID 或将未知变已学。

覆盖：A13,A14,A15。证据：待登记。

### TA-30 产品化自动会话记录、详情与近期历史

- [ ] 完成

状态：todo。依赖：TA-04、TA-16、TA-27、TA-28。角色：后端/前端。外部条件：无。

模块归属：M4 ConversationRecordPort；M2 授权/写回，M1 展示。

交付：同一会话自动 upsert、授权读回/近期历史、revision/hash/record_revision、pending/accepted/failed/unknown；学习尝试单独接口/许可。

落点：`packages/business/records/、apps/server/records/、apps/web/history/`。

验收：正常/立即/异常结束记录实际结果；无需旧保存勾选；同版异文冲突、旧版拒绝、重试幂等；仅确认并读回才显示已保存；Mock 重启重置不称持久历史。

覆盖：A15,A16,A19。证据：待登记。

### TA-31 完善 post-call 持久入站、审查与对账

- [ ] 完成

状态：todo。依赖：TA-05、TA-10、TA-13、TA-26、TA-27、TA-30。角色：后端/Agent。外部条件：D02（真实投递）；D01（模型审查）。

模块归属：M2 JobStore/ToolDispatcher；M3 审查、M4 记录，M5 回调。

交付：最小持久 JobStore、先写后 202、异步等待获准转写/记录、重试/去重、同记录校正；收尾口头版本不可被事后改写。

落点：`apps/server/jobs/、apps/server/hooks/、packages/evidence/`。

验收：重复投递/超时/进程重启/转写晚到/缺映射可恢复或明确拒绝；无对话不伪造任务；撤权后不写入；任务接收成功、审查完成、记录保存状态分开。

覆盖：A15,A16,A17,A19。证据：待登记。

### TA-32 完善远端清理、启动恢复与失败对账

- [ ] 完成

状态：todo。依赖：TA-07、TA-16、TA-23、TA-28、TA-30、TA-31。角色：后端。外部条件：D02（远端结束/费用）。

模块归属：M2 CleanupWorker/SessionActor；协作 M1/M5。

交付：资源账本、无人加入/离开/最大时长/断线 end/get、持久清理任务、有界重试和启动对账；最小状态保留期/擦除路径。

落点：`apps/server/lifecycle/、apps/server/jobs/`。

验收：浏览器崩溃/服务重启后旧 Conversation 不无声继续；未知创建结果先对账；Face/Voice/PAL/Tools 不日常删除；记录缺权限不影响本地释放/远端结束。

覆盖：A12,A14,A16,A19。证据：待登记。

## S4 任务

### TA-33 完成正式真人 Face/Voice 与品牌验收

- [ ] 完成

状态：todo。依赖：TA-07、TA-14。角色：素材/品牌/教研。外部条件：D02,D03。

模块归属：M5 真人 Face/Voice；M2 资产配置，M1 展示。

交付：按获准素材训练并审核正式 Face/Voice；记录模型、status/finetune、声音和服装/背景参考；Phoenix-4.5/4 按实际保真取舍。

落点：`docs/assets/、config/teacher/（仅非敏感引用）`。

验收：用户/品牌审核仍认作同一位老师；20 段倾听/中英/快慢/长短/打断样例无阻断性漂移/口型问题；stock/预览水印不替代正式验收。

覆盖：A12（另加 PRD §7 真人必需项）。证据：待登记。

### TA-34 校准中文声音、原生语速和 Sparrow 参数

- [ ] 完成

状态：todo。依赖：TA-14、TA-21、TA-23、TA-24、TA-33。角色：音视频/教研。外部条件：D02,D03；真实设备。

模块归属：M5 TTS/Sparrow；M2 配置，M1 设备，M3 教学要求。

交付：从 tavus-auto 与本人 Voice 起步；在支持范围内对照慢速/正常、停顿耐心、可打断性和中英读法；记录自动路由归因限制。

落点：`config/voice/、config/pal/、docs/evidence/voice/`。

验收：教师声调/轻声/多音字/数字/中英转换、慢速自然度和回声体验通过；不混淆语速与难度；若原生不足报告必要项失败，不默默引入外部 TTS。

覆盖：A11,A12,A13。证据：待登记。

### TA-35 校准 Tavus 人设/工具提示与 Pi 规划质量

- [ ] 完成

状态：todo。依赖：TA-06、TA-17、TA-18、TA-19、TA-20、TA-21、TA-22、TA-27、TA-28、TA-34。角色：Agent/教研。外部条件：D01,D02。

模块归属：M3 教学/Pi 策略；M2 发布配置，M5 人设/工具提示。

交付：版本化 Tavus/工具说明和 Pi 提案规则；用开发集改进自然回应、难度、正确句/澄清、冷却、拒绝、语言、目标与摘要执行；冻结候选。

落点：`config/prompts/、config/tools/、eval/review/`。

验收：质量看实际回复而非计划字段；未使用 holdout 调参；无固定句数/模板答案；每次记录 Pi 模型、Gemma、PAL/策略 hash 及失败类，不临时换实时模型。

覆盖：A01,A03,A04,A06,A07,A08,A09,A10,A11,A14,A15。证据：待登记。

### TA-36 完成系统内嵌与业务接入边界演示

- [ ] 完成

状态：todo。依赖：TA-17、TA-25、TA-29、TA-30、TA-32。角色：全栈/业务集成。外部条件：D04（真实系统联调部分）。

模块归属：M2 系统接入编排；M1 内嵌页面、M4 业务适配。

交付：定义现有系统启动/授权/返回及业务 Ports；先实现宿主页面 Mock 演示，区分测试学习者入口和真实授权；提供外部适配契约与错误处理。

落点：`apps/server/integration/、apps/web/、docs/integration/`。

验收：前端不自报任意身份或持 key；跨标签页/过期票据/返回页面处理有测试；Mock 嵌入可重复演示；真实系统未接通时明确 pending，不扩大成生产系统部署。

覆盖：A02,A16,A19。证据：待登记。

## S5 任务

### TA-37 完成关键权限、竞态、幂等与恢复回归

- [ ] 完成

状态：todo。依赖：TA-06、TA-16、TA-17、TA-18、TA-19、TA-20、TA-21、TA-22、TA-23、TA-24、TA-28、TA-29、TA-30、TA-31、TA-32、TA-36。角色：工程/评测。外部条件：无。

模块归属：跨模块验证：M1–M5；M2 状态/权限为重点。

交付：覆盖跨人/跨会话/注入、撤权、重放、同键异参、旧 final/计划/收尾/回执、丢 callback、重启/创建未知与重复副作用。

落点：`tests/、fixtures/faults/、eval/reports/`。

验收：关键失败为零；运行时/契约变化执行相关 verify/replay/browser；合成与真实故障分开；无法验证的必须 pending/unknown，不把 mock 安全回执当真人服务。

覆盖：A03,A04,A06,A09,A14,A16,A17,A19。证据：待登记。

### TA-38 采集并审阅原 FreeChat 与语言基线

- [ ] 完成

状态：todo。依赖：TA-06、TA-15、TA-35、TA-37。角色：评测/教研。外部条件：D01,D02；教研校准。

模块归属：独立评测支撑；采集 M1–M5 实际链路。

交付：Tavus 实际链路采集原 40+8 案，保存实际此前回复、模型/数据/配置版本；独立十维与逐项要求评审、ASR/前文偏离标记。

落点：`eval/collectors/tavus/、eval/reports/content/`。

验收：244+11 计划话轮全部报告覆盖/缺失；不注入参考或未来，不用豆包记录冒充 Tavus；技术失败、rule、review、unassessable 保留；历史长度只作诊断。

覆盖：A01,A07,A08,A09,A10,A11,A18。证据：待登记。

### TA-39 执行四背景个性化对照与独立 holdout

- [ ] 完成

状态：todo。依赖：TA-06、TA-15、TA-35、TA-37。角色：评测/教研。外部条件：D01,D02；教研校准。

模块归属：独立评测支撑；覆盖 M1–M5 个性化效果。

交付：四背景×自然交流/支持变化/学生控制结束 12 场，另 12 场 holdout；增加同等级不同需要、只改姓名/兴趣、缺/冲突资料、超范围问词与降级成对案例。

落点：`eval/datasets/adaptation/、eval/reports/adaptation/`。

验收：每格 6–10 个有效回合；差异有依据，简单问题允许相同帮助；实际难度/语言/任务负担合适；全部失败/缺失保留，holdout 不用于调优后回填通过。

覆盖：A02,A03,A04,A06,A08,A09,A10,A11,A18。证据：待登记。

### TA-40 执行长会话、目标/语言恢复与早期内容总结

- [ ] 完成

状态：todo。依赖：TA-06、TA-15、TA-35、TA-37。角色：评测/教研。外部条件：D01,D02。

模块归属：跨模块验证：M1–M5 的长会话与记录。

交付：三场各 20–30 个有效学生回合，检查 15 分钟/实际裁剪；包含早期内容、局部求助失效、暂停/停止/恢复、换题、误纠/拒绝和收尾撤销。

落点：`eval/datasets/long/、eval/reports/long/`。

验收：真实链路连贯，旧目标不复活，早期知识/来源不被编造；最终摘要和记录读回版本一致；长时间在线或 synthetic 快速回放不算真实长会话通过。

覆盖：A04,A05,A06,A07,A09,A14,A15,A16,A17,A18。证据：待登记。

### TA-41 完成真人设备、品牌、稳定性与成本验收

- [ ] 完成

状态：todo。依赖：TA-15、TA-23、TA-24、TA-29、TA-32、TA-33、TA-34、TA-35、TA-37。角色：音视频/教研/品牌。外部条件：D02,D03；真人及设备。

模块归属：M1/M5 媒体体验；M2 资源/费用与协作验收。

交付：按目标设备/地区做 E01–E09 耳机/扬声器；实际首响/插话停播/字幕/恢复/收尾/声音形象；20 次启动与连续会话稳定性，资源计时与费用对账。

落点：`eval/reports/devices/、eval/reports/cost/`。

验收：测量基准一致且全部分母公开；按 PRD 体验目标及品牌样例验收；失败启动/等待/超时资源计费可解释；供应商首包或 API active 不代替可听效果。

覆盖：A12,A13,A14,A18（另加 PRD 品牌/成本）。证据：待登记。

### TA-42 完成目标逐项裁决、运行手册与交付演示

- [ ] 完成

状态：todo。依赖：TA-15、TA-33、TA-36、TA-37、TA-38、TA-39、TA-40、TA-41。角色：工程/教研/产品。外部条件：无。

模块归属：跨模块最终裁决：M1–M5。

交付：逐项回填 A01–A19、G01–G06 与 PRD 独立品牌/嵌入项；整理启动/配置/测试/清理/故障/成本、未完成条件和可重复演示。

落点：`docs/evidence/、docs/runbook.md（拟建）、task-list.md`。

验收：必需实现、内容、供应商及设备证据齐全才判 POC 完成；关键失败或必要 unknown/missing 保持未完成；真实业务适配 pending 不伪称生产集成，交付范围明示。

覆盖：A01,A02,A03,A04,A05,A06,A07,A08,A09,A10,A11,A12,A13,A14,A15,A16,A17,A18,A19。证据：待登记。

## 4. 目标与 Gate 的完成证据

下表给出主责实现与独立验收任务；不得仅凭此映射宣称要求已通过。

| 目标 | 主责实现 | 必需验收/检查 |
| --- | --- | --- |
| A01 自由交流 | TA-17、TA-19、TA-35 | TA-38、TA-39 |
| A02 资料与四背景 | TA-04、TA-17、TA-25 | TA-37、TA-39 |
| A03 初始计划与准备 | TA-17 | TA-37、TA-39 |
| A04 每回合规划 | TA-09、TA-11、TA-18、TA-22 | TA-38、TA-39、TA-40 |
| A05 反馈与真实前文 | TA-18、TA-26 | TA-37、TA-40 |
| A06 目标生命周期 | TA-19 | TA-37、TA-39、TA-40 |
| A07 冷却与行动重心 | TA-19、TA-21、TA-35 | TA-38、TA-40 |
| A08 澄清/纠错 | TA-21、TA-35 | TA-38、TA-39 |
| A09 语言作用范围 | TA-20、TA-22 | TA-37、TA-38、TA-40 |
| A10 自然有意义回复 | TA-21、TA-35 | TA-38、TA-39 |
| A11 个性化中文难度 | TA-17、TA-21、TA-34、TA-35 | TA-38、TA-39、TA-41 |
| A12 语速/打断/设备 | TA-23、TA-33、TA-34 | TA-41 |
| A13 渐进字幕 | TA-24 | TA-37、TA-41 |
| A14 正常结束与继续 | TA-27、TA-28、TA-29 | TA-37、TA-40、TA-41 |
| A15 同源摘要与早期内容 | TA-26、TA-27、TA-31 | TA-38、TA-40 |
| A16 自动记录及读回 | TA-30、TA-31、TA-32 | TA-37、TA-40 |
| A17 保守观察与版本 | TA-16、TA-18、TA-26 | TA-37、TA-40 |
| A18 冻结独立评测 | TA-06 | TA-38、TA-39、TA-40、TA-41、TA-42 |
| A19 程序权限与状态 | TA-03、TA-04、TA-16、TA-32、TA-36 | TA-37、TA-42 |
| PRD §7 真人一致性 | TA-14、TA-33 | TA-33、TA-41、TA-42，品牌确认必需 |
| PRD §12 系统嵌入/业务契约 | TA-36 | TA-36、TA-42，Mock 与真实接入范围分别标注 |
| PRD §16 资源与费用 | TA-07、TA-32 | TA-41、TA-42 |

G01→TA-09/11；G02→TA-11；G03→TA-10/11；G04→TA-12；G05→TA-13；G06→TA-08/14。TA-15 汇总 S1 结论，TA-42 汇总完整实现后的最终结论。

## 5. 每次任务更新格式

完成一个批次，回填状态、实际修改路径、验证命令/条件、结果范围和未通过项：

```text
任务：TA-xx
状态：implemented / verified / blocked
实际改动：路径、提交和版本
验证：synthetic / real Pi / real Tavus / browser synthetic / human device
结果：完整分母、通过/失败/unknown/missing、证据引用
未完成条件：缺少输入或能力、下一项验证
```

报告中的真实输入/录音/完整 trace 留在获准本地位置，不提交仓库；task list 只引用脱敏证据与版本。无测试、未连通、未实听时明确写未运行。最终不以任务框数量或代码测试数替代实际教学、品牌与设备验收。
