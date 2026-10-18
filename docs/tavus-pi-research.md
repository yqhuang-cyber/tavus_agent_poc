# Tavus 与 Pi 选型研究

研究日期：2026-10-18；职责与方案更新：2026-10-19。用途：为 Ask Kai Free Talk 的数字人教师 POC 提供选型依据。

v0.5：用户已确认 Tavus 使用 tavus-gemma-4 生成实时回复，Pi 负责教学规划与工具，顶层架构继续沿用 M1–M5。已下载并核对官方完整 OpenAPI。实际端点、字段、请求响应、协议与文档冲突详见 [分层控制权及 API 接入设计](tavus-layer-and-api-design.md)；静态核对不等于真实账号调用成功。

## 1. 结论与适用条件

**采用 Tavus 原生 full pipeline：托管 tavus-gemma-4 生成实时回复，Pi 负责教学规划与受控工具。** Pi 在开聊前准备方案，每个有效学生回合异步观察并规划，按需通过原生工具返回结果；结束前审查同源摘要，课后对账；不再自建兼容 SSE 或替换 ASR/TTS/RTC。

用户已确认已有真人老师形象、有授权、可以拍摄视频。建议以真人视频创建定制 Face；先验证“像本人”，再验证“作为中文老师好用”。这两个结果要分别报告。

公开文档证明这条集成路线存在；尚不能据此证明其中文教学效果、目标地区网络、延迟、打断完整性或商业条款满足要求。

## 2. Tavus 到底提供什么

Tavus 当前文档把整体角色称为 **PAL**，外观称为 **Face**，一次实时互动称为 **Conversation**；CVI 是实时对话接口。旧文档和示例可能使用 Persona、Replica。这些名称在部分 API 中仍保留兼容别名，新项目应按当前端点和字段建立适配层。[PAL API](https://docs.tavus.io/api-reference/pals/create-pal)、[Face 概览](https://docs.tavus.io/sections/faces/overview)

它提供的能力是组合的：

| 层 | 能力 | 对本项目的意义 |
| --- | --- | --- |
| Phoenix / Face | 根据素材生成实时人物视频 | 老师外观、表情和口型的载体 |
| STT | 识别学生语音 | 为 Tavus 实时回复和工具调用提供输入 |
| Sparrow / Conversational Flow | 判断轮次、等待与打断 | 减少初学者组织中文时被抢话 |
| LLM | Tavus 托管模型或自定义后端 | 本项目选原生 tavus-gemma-4，按需调用 Pi 工具 |
| TTS / Voice | 朗读、声音及语速配置 | 中文示范的音质和可懂度 |
| Raven / Perception | 音视频场景理解 | 看图、展示物品等后续能力 |
| RTC / Daily | 浏览器实时通话和数据通道 | 嵌入现有页面 |

这些层可配置不等于所有实现可替换。Phoenix 等模型不是我们可以下载修改的开源渲染器；部分自带模型、供应商路由和实际播放队列由 Tavus 管理。[Pipeline Modes](https://docs.tavus.io/sections/conversational-video-interface/quickstart/pipeline-modes)

## 3. 哪些可以变，哪些有边界

| 项目 | 可配置部分 | 不能据此承诺的部分 | POC 选择 |
| --- | --- | --- | --- |
| 教师身份与教学风格 | 提示词、上下文、我们自己的决策代码 | 提示词不能保证每轮绝对遵循 | 教学政策由我们版本化，配置 PAL 并由 Pi 提供计划；执行效果需评测 |
| 大模型 | 自定义兼容接口；后端可以是业务逻辑 | 不是直接把任意 SDK 接给 Tavus | 本 POC 不替换该层；直接配置托管 Gemma |
| 业务工具 | Tavus 有工具体系；Pi 也可运行工具 | 不自动拥有 HSKai 权限 | 原生 Tools API 将请求交给 Pi/受控业务端口；权限由程序校验 |
| 真人外观 | 以照片或视频创建定制 Face | 不保证任意镜头、服装细节和动作精确一致 | 已有老师真人视频，比较 Phoenix 路径 |
| 声音 | Face 默认声音、Tavus Voice、指定外部声音 | 声音克隆不保证普通话教学发音准确 | 先验证本人声音，再决定是否换教学声线 |
| 语言 | 明确声明 `zh`、`en` | 识别中文不等于能识别所有学习者口音 | 中文优先，只开需要的两种语言 |
| 语速 | 部分 TTS 引擎支持全局或分句控制 | 不是所有引擎同一字段都有效 | 慢速与正常两档，固定引擎实测 |
| 轮次与打断 | 等待耐心、可打断程度、外部 interrupt | 不保证外部 Pi 自动取消，也不保证已缓冲音频撤回 | 分别测试 Tavus 停播、Pi 规划取消与迟到工具结果 |
| 感知 | 开关、查询与提示配置 | 不把感知推测当作能力评估 | 首期关闭；后续只加有明确用途的视觉输入 |
| UI | 自定义 Daily UI，或复制 Tavus React 组件 | 无法把原 PCM transport 原样换成 WebRTC | 保留 Free Talk 业务界面，新建媒体适配 |
| 长期记忆 | Tavus 有参与者记忆；我们也能自行管理 | 厂商记忆不自动等于业务学习证据 | 业务证据由我们管理，跨会话偏好有需要先试原生记忆 |
| 部署 | 我们部署 Pi 与业务接口 | Tavus 云不能仅凭这些 API 被自部署 | 联调需 Tavus 可达的 HTTPS 工具接收端 |

依据：[LLM](https://docs.tavus.io/sections/conversational-video-interface/pal/llm)、[TTS](https://docs.tavus.io/sections/conversational-video-interface/pal/tts)、[STT](https://docs.tavus.io/sections/conversational-video-interface/pal/stt)、[轮次](https://docs.tavus.io/sections/conversational-video-interface/pal/conversational-flow)、[语言](https://docs.tavus.io/sections/conversational-video-interface/language-support)、[感知](https://docs.tavus.io/sections/conversational-video-interface/pal/perception)。

### 3.1 当前接法：原生 LLM + Tools API

在 PAL 的 `layers.llm.model` 配置 `tavus-gemma-4`。使用 `POST /v2/tools` 定义教学规划工具，再 `POST /v2/pals/{pal_id}/tools` 关联，HTTPS/HMAC 交付到我们的 Pi 服务。规划工具使用 `on_resolve=generate_response`，由 Tavus 结合结果生成自然回复；`add_to_context` 仅影响后续输入，不能假称本轮已按 Pi 计划执行。[LLM](https://docs.tavus.io/sections/conversational-video-interface/pal/llm)、[LLM Tools](https://docs.tavus.io/sections/conversational-video-interface/pal/llm-tool)

保持原生 speculative inference 默认值起步，测试输入修订、取消与误触发。Pi 工具默认只读/返回提案，业务写入由程序验证。工具触发与结果采纳由托管 LLM 决定，Pi 不具备每句播放前的硬审批权；验收要有漏调用、错误采纳与迟到结果样例。

自定义 LLM 仍是可行能力：兼容 `/chat/completions`、SSE，并配置 model/base_url/api_key。该路线会把回复生成权转向自有后端，不属于本次 POC。公开资料未确认供 Pi 直接调用 Tavus 托管 Gemma 的独立通用端点，因此 Pi 的规划模型仍需另外选型。

### 3.2 稳定 PAL 与会话级上下文

本 POC 使用稳定版本 PAL 配置老师、声音、教学规则与工具；每次 Conversation 放入 Pi 初始摘要、开场和授权范围，不为单个学生 PATCH 共享 PAL。HMAC 工具 envelope 提供 conversation_id、tool_call_id，服务端据映射路由，无需为路由每会话创建临时 PAL。[PAL 策略](https://docs.tavus.io/sections/onboarding-guide/pal-strategies)、[Tool Delivery](https://docs.tavus.io/sections/conversational-video-interface/pal/llm-tool-delivery)

跨会话原生记忆依赖同一 PAL 与参与者 tag；默认不发 tag，有需求先用合成资料试验，不另建聊天记忆替代品。业务画像与学习证据继续由业务系统管理。正常结束前通过原生 in_call 工具取得 Pi 审查后的结构化摘要，由 Tavus 生成口头回顾；课后候选使用原生 post-call 对账，同一授权会话记录自动保存并读回，学习尝试仍独立授权。[Memories](https://docs.tavus.io/sections/conversational-video-interface/memories)、[Post-Call Actions](https://docs.tavus.io/sections/conversational-video-interface/pal/post-call-tool)

文档不同页面存在更新节奏差异，例如策略页把 objectives 归入 PAL 层，Create Conversation API 已列出 objectives_id 覆盖。本项目按端点 schema 与实测确定字段。[Conversation API](https://docs.tavus.io/api-reference/conversations/create-conversation)

### 3.3 重新核对后的替换层级

LLM 的 `base_url` 支持真正外接后端；STT 的 `stt_engine` 只是在平台支持列表中切换，没有与 LLM 对称的自定义识别服务 URL；TTS 支持指定供应商账号/声音，也不能推导出任意 TTS URL 可接。Sparrow 与 Raven 可配置或关闭，当前没有公开任意替代服务端点。Phoenix 在选择 Tavus Avatar 时继续由 Tavus 执行。

若希望所有语音和轮次技术自主选型，应选 Echo 的音频输入或独立 LiveKit/Pipecat 等集成；此时 Tavus 主要提供同步人物媒体，外部框架承担被移出的能力。**并非只能买整套，但替换不同层需要不同接入模式。** 当前 POC 选择原生 A；自定义 LLM 与 Echo 只保留为能力参考，不自动扩展实施范围，详见技术附件第 1–2 节。

## 4. 已有真人老师形象怎么接

### 4.1 推荐路径

1. 固定老师的脸、发型、服装、背景和镜头范围，形成品牌参考。
2. 拍摄符合 Tavus 要求的连续训练视频，创建定制 Face。
3. 等待正式调优完成；分别审核静止、倾听、中文讲话、英文支架与打断后的状态。
4. 再比较声音克隆与候选普通话教学声线，最终锁定 Face + Voice + 渲染模型配置。

Phoenix-4.5 适合上半身和自然躯干运动；如果必须全身，或服装小标识、复杂纹理必须更忠实，需要把 Phoenix-4 视频路径加入对照。不要把“最新模型”直接当成品牌保真最优。[模型路径](https://docs.tavus.io/sections/faces/which-training-path)

背景也是具体模型的限制：当前 `apply_greenscreen` 不兼容 Phoenix-4.5，不能笼统宣称任何 Face 都可通过同一字段换背景。[背景定制](https://docs.tavus.io/sections/conversational-video-interface/conversation/customizations/background-customizations)

### 4.2 拍摄与素材

Phoenix-4.5 当前视频要求包括：单镜头连续拍摄，30 秒说话后接 30 秒静止；至少 1080p、25 FPS；画面正面稳定、嘴部清楚。训练视频会生成默认 Voice。素材 URL 需可被 Tavus 读取，适合采用有效期足够完成导入的受控签名 URL。[视频要求](https://docs.tavus.io/sections/faces/phoenix-45-video-requirements)

用户已有本人授权；实施时把允许的形象、声音、用途、服务和使用期限落实到素材登记。这是资产管理要求，不需要重新征求本次研究设计的许可。

Phoenix-4.5 的 `status=completed` 可能只说明预览可用；无预览水印的正式效果需确认 `finetune_status=completed`。预览与正式调优结果不得混在最终质量报告里。[状态说明](https://docs.tavus.io/sections/faces/phoenix-45-preview-and-status)

照片路径可用于快速技术验证，但最终 POC 仍应交付用户已有老师的真人视频版本。它支持成人真人及人形风格化角色；这不是导入任意 3D 模型、骨骼动画或非人吉祥物的通用接口。[图片要求](https://docs.tavus.io/sections/faces/phoenix-45-image-requirements)

## 5. Pi 应该扮演什么角色

Pi 是可嵌入的 Agent 运行机制，不是语音框架，也不是中文教学产品。推荐使用 `@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai`，以 TypeScript/Node.js 服务运行。

Agent core 提供上下文处理、模型流、工具执行、事件与取消等机制；教学状态、权限、证据和持久化需要我们实现。当前项目锁定 1.2.0，可作为新 POC 的首轮兼容基线，正式实施前再核对包与运行环境。[Pi core 1.2.0](https://raw.githubusercontent.com/earendil-works/pi/v1.2.0/packages/agent/README.md)、[Pi AI 1.2.0](https://raw.githubusercontent.com/earendil-works/pi/v1.2.0/packages/ai/README.md)

不需要把完整 coding-agent CLI 作为在线老师，也不应默认开放文件、shell、自动发现本机配置等能力。教学工具只注册业务白名单。Pi Durable 可在后续承担可靠总结任务；它不是实现第一次实时对话的必要条件。

## 6. 与现有 Ask Kai Free Talk 的关系

本次阅读了以下本机材料，未修改该项目：

- [README](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/README.md)
- [原产品 PRD](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/prd/ask-kai-agent-prd-v1.1.md)
- [Pi 理想架构](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/pi-ideal-tutor-harness-design.md)
- [Pi 接入任务与版本记录](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/pi-integration-tasking.md)
- [Pi Planner 代码](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/packages/agent-core/pi-planner.js)
- [多端接入说明](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/multi-client-integration.md)
- [体验基线](/Users/yuqinghuang/Documents/repos/ask_kai_freetalk/docs/experience-baseline.md)

现有 POC 是 Node.js 工程，三类资料使用 Mock HSKai；豆包 Seeduplex 负责持续语音，MiniMax 用于规划。Pi 已有可选 Planner 适配，不能因此称为“所有回复均由 Pi 先决策”。现有逐轮规划主要是对后续输入提供建议。

本次新 POC 的变化在于：Tavus 原生 Gemma 接管实时口语回复，Pi 保留教学规划与工具职责，通过原生 Tools API 接入。已有权限、零目标聊天、按需支架、证据及取消原则可复用；音频传输、播放控制、字幕与工具回调需新适配。已有 MiniMax 只是规划模型候选，不视为本项目已选定。

## 7. 三条接入路线比较

| 路线 | Pi 的位置 | 好处 | 代价 | 结论 |
| --- | --- | --- | --- | --- |
| A：Tavus full + 原生 Gemma + Pi 原生工具 | 初始化、逐轮观察/规划、按需工具、结束前摘要与课后对账 | 保留原生实时链，Pi 管教学计划和业务工具 | 工具触发与建议采纳不能程序性保证每句遵循 | **用户确认的主方案** |
| C：Tavus full + 自定义 Pi LLM 后端 | 生成每轮回复文本 | 可自行控制回复文本与模型 | 改变职责边界，增加 SSE、取消及推理适配 | 能力参考，不纳入本 POC |
| B：自建语音链 + Pi + Tavus Echo / 集成 | 识别与语音之间 | 更强的 ASR/TTS/媒体控制 | 自建轮次、同步、取消和媒体编排 | 能力参考，不纳入本 POC |

Echo 绕过大部分 CVI，第三方集成也有独立能力边界。不能选择 B 后继续宣称保留了完整 Tavus 的感知与识别能力。[Pipeline Modes](https://docs.tavus.io/sections/conversational-video-interface/quickstart/pipeline-modes)

Pi 与 Pipecat 是不同项目：前者是本次指定的 Agent 底座，后者是可选实时音视频编排框架。

## 8. 商业与技术待验证项

公开价格页同时出现旧 Replica/Starter 套餐和新 Face/Builder 套餐，额度有冲突；例如同为 $59/月，页面中分别出现 100 和 175 分钟。因此本设计不把抓取到的某一组额度当作确定报价。自定义 Face、并发、最长通话、BYO LLM 是否减免原模型费用，需以所选账号实际方案和书面说明确定。[价格页](https://www.tavus.io/pricing)

采购与实施前需确认：目标地区可达性、数据处理与留存、删除覆盖范围、RTC/TTS 子服务、最大并发、Face 训练费用、会话计时起止、重连和等待是否计费。我们关闭业务录音不等于供应商没有日志；结束通话也不等于删除数据。

最小技术验证清单：原生 Gemma 回复、工具注册与关联、HMAC 交付、结果采纳、超时/重试/打断中迟到结果、中文及中英切换、语速、正式 Face、同 PAL 双会话隔离、结束及 post-call 对账。验收方法见 [PRD](tavus-agent-poc-prd.md)。

进一步核对发现：流式 speech 为累计文本，完整 utterance 在打断时可能仍含未说稿；普通会话 callback 与工具 API HMAC 回调也有不同保证。技术附件已将这些落实为字幕、证据和认证契约，不能继续以“收到事件就证明已呈现”简化实现。

与源仓库目标的逐项审查见 [Free Talk 目标对照](ask-kai-freetalk-alignment.md)：v0.3 的仅按需规划和独立课后小结不足以覆盖要求，v0.4 已补成必要验收项。实际话语归属、上下文后续遵循、同源结束与媒体播放边界仍须 S1 验证；未通过不得标记达到源仓库目标。
