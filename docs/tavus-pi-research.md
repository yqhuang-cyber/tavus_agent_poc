# Tavus 与 Pi 选型研究

研究日期：2026-10-18。用途：为 Ask Kai Free Talk 的数字人教师 POC 提供选型依据。

v0.2 增补：已下载并核对官方完整 OpenAPI。实际端点、字段、请求响应、协议与文档冲突详见 [分层控制权及 API 接入设计](tavus-layer-and-api-design.md)；静态核对不等于真实账号调用成功。

## 1. 结论与适用条件

**值得进入 POC。推荐保留我们对教学 Agent 的控制，把 Tavus 用作可配置的实时音视频和数字人层。** Pi 位于每轮回复的生成路径，负责教学动作、上下文和受控工具；Tavus 负责识别、话轮、语音合成、人物视频及 RTC。

用户已确认已有真人老师形象、有授权、可以拍摄视频。建议以真人视频创建定制 Face；先验证“像本人”，再验证“作为中文老师好用”。这两个结果要分别报告。

公开文档证明这条集成路线存在；尚不能据此证明其中文教学效果、目标地区网络、延迟、打断完整性或商业条款满足要求。

## 2. Tavus 到底提供什么

Tavus 当前文档把整体角色称为 **PAL**，外观称为 **Face**，一次实时互动称为 **Conversation**；CVI 是实时对话接口。旧文档和示例可能使用 Persona、Replica。这些名称在部分 API 中仍保留兼容别名，新项目应按当前端点和字段建立适配层。[PAL API](https://docs.tavus.io/api-reference/pals/create-pal)、[Face 概览](https://docs.tavus.io/sections/faces/overview)

它提供的能力是组合的：

| 层 | 能力 | 对本项目的意义 |
| --- | --- | --- |
| Phoenix / Face | 根据素材生成实时人物视频 | 老师外观、表情和口型的载体 |
| STT | 识别学生语音 | 为 Pi 提供文字输入 |
| Sparrow / Conversational Flow | 判断轮次、等待与打断 | 减少初学者组织中文时被抢话 |
| LLM | Tavus 托管模型或自定义后端 | 本项目将此处连接 Pi Gateway |
| TTS / Voice | 朗读、声音及语速配置 | 中文示范的音质和可懂度 |
| Raven / Perception | 音视频场景理解 | 看图、展示物品等后续能力 |
| RTC / Daily | 浏览器实时通话和数据通道 | 嵌入现有页面 |

这些层可配置不等于所有实现可替换。Phoenix 等模型不是我们可以下载修改的开源渲染器；部分自带模型、供应商路由和实际播放队列由 Tavus 管理。[Pipeline Modes](https://docs.tavus.io/sections/conversational-video-interface/quickstart/pipeline-modes)

## 3. 哪些可以变，哪些有边界

| 项目 | 可配置部分 | 不能据此承诺的部分 | POC 选择 |
| --- | --- | --- | --- |
| 教师身份与教学风格 | 提示词、上下文、我们自己的决策代码 | 提示词不能保证每轮绝对遵循 | 人格与教学政策由 Pi 侧版本化 |
| 大模型 | 自定义兼容接口；后端可以是业务逻辑 | 不是直接把任意 SDK 接给 Tavus | Gateway 转换 Pi 输出为兼容 SSE |
| 业务工具 | Tavus 有工具体系；Pi 也可运行工具 | 不自动拥有 HSKai 权限 | 教学业务工具集中由 Pi Tool Broker 执行 |
| 真人外观 | 以照片或视频创建定制 Face | 不保证任意镜头、服装细节和动作精确一致 | 已有老师真人视频，比较 Phoenix 路径 |
| 声音 | Face 默认声音、Tavus Voice、指定外部声音 | 声音克隆不保证普通话教学发音准确 | 先验证本人声音，再决定是否换教学声线 |
| 语言 | 明确声明 `zh`、`en` | 识别中文不等于能识别所有学习者口音 | 中文优先，只开需要的两种语言 |
| 语速 | 部分 TTS 引擎支持全局或分句控制 | 不是所有引擎同一字段都有效 | 慢速与正常两档，固定引擎实测 |
| 轮次与打断 | 等待耐心、可打断程度、外部 interrupt | 不保证外部 Pi 自动取消，也不保证已缓冲音频撤回 | 双向取消探针，必要时即时静音 |
| 感知 | 开关、查询与提示配置 | 不把感知推测当作能力评估 | 首期关闭；后续只加有明确用途的视觉输入 |
| UI | 自定义 Daily UI，或复制 Tavus React 组件 | 无法把原 PCM transport 原样换成 WebRTC | 保留 Free Talk 业务界面，新建媒体适配 |
| 长期记忆 | Tavus 有参与者记忆；我们也能自行管理 | 厂商记忆不自动等于业务学习证据 | 业务系统统一管理，避免双重事实来源 |
| 部署 | 我们部署 Pi 与业务接口 | Tavus 云不能仅凭这些 API 被自部署 | 联调需 Tavus 可访问的 HTTPS Gateway |

依据：[LLM](https://docs.tavus.io/sections/conversational-video-interface/pal/llm)、[TTS](https://docs.tavus.io/sections/conversational-video-interface/pal/tts)、[STT](https://docs.tavus.io/sections/conversational-video-interface/pal/stt)、[轮次](https://docs.tavus.io/sections/conversational-video-interface/pal/conversational-flow)、[语言](https://docs.tavus.io/sections/conversational-video-interface/language-support)、[感知](https://docs.tavus.io/sections/conversational-video-interface/pal/perception)。

### 3.1 自定义 LLM 的关键事实

官方要求自定义后端支持 `/chat/completions` 和 SSE，配置项包含 `model`、`base_url`、`api_key`，可添加额外 headers。自定义后端不一定真的只是一个 LLM，可以运行 Agent 后再返回兼容结果。因此，**Tavus 调用我们的 Pi Gateway** 是有官方依据的架构推导，而不是已有的官方 Pi 插件。[自定义 LLM](https://docs.tavus.io/sections/conversational-video-interface/pal/llm)

默认启用的 speculative inference 会在学生说完前开始推理。本 POC 初期关闭它，以降低重复推理、错误归属与误写学习记录的复杂度；待取消、重试和输入修订经过验证后再做对照实验。这是我们的设计取舍。

文档没有在本次阅读中充分保证：每次自定义 LLM 请求一定带可用的 conversation ID；断开 SSE 一定取消模型；请求重试一定有稳定 request ID；输出 token 一定全部被朗读。实现必须实测，不把这些当默认事实。

### 3.2 会话级定制不能靠修改共享 PAL

共享 PAL 适合稳定配置加每次会话上下文。需要不同声音、后端凭证或行为时，官方也支持每会话创建 PAL 的方式。修改共享 PAL 可能影响其他活动会话，所以本 POC 推荐临时 PAL，以会话专用 Gateway 凭证做可靠身份绑定。[PAL 策略](https://docs.tavus.io/sections/onboarding-guide/pal-strategies)

文档不同页面存在更新节奏差异。例如策略页把 objectives 归入 PAL 层，而当前 Create Conversation API 已列出 `objectives_id` 覆盖。本项目按具体端点 schema 和真实测试确定字段，不把概览页的限制扩展成绝对结论。[Conversation API](https://docs.tavus.io/api-reference/conversations/create-conversation)

### 3.3 重新核对后的替换层级

LLM 的 `base_url` 支持真正外接后端；STT 的 `stt_engine` 只是在平台支持列表中切换，没有与 LLM 对称的自定义识别服务 URL；TTS 支持指定供应商账号/声音，也不能推导出任意 TTS URL 可接。Sparrow 与 Raven 可配置或关闭，当前没有公开任意替代服务端点。Phoenix 在选择 Tavus Avatar 时继续由 Tavus 执行。

若希望所有语音和轮次技术自主选型，应选 Echo 的音频输入或独立 LiveKit/Pipecat 等集成；此时 Tavus 主要提供同步人物媒体，外部框架承担被移出的能力。**并非只能买整套，但替换不同层需要不同接入模式。** 当前 POC 默认 A，同时保留 B 为清楚定义的备选，详见技术附件第 1–2 节。

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

本次新 POC 的变化在于：Tavus 转写后调用我们的兼容端点；Pi 在这个端点里决定并生成本轮回复。已有的权限、零目标自由聊天、按需支架、证据与取消规则可复用，但音频传输、播放控制和字幕归属需要新适配，现有 MiniMax 规划封装也不能自动当作实时口语生成器。

## 7. 三条接入路线比较

| 路线 | Pi 的位置 | 好处 | 代价 | 结论 |
| --- | --- | --- | --- | --- |
| A：Tavus full + 自定义 Pi Gateway | 本轮教学回复生成路径 | 保留 Tavus 轮次/TTS/渲染，教学由我们控制 | 外部推理延迟、协议桥接、取消需要验证 | **主方案** |
| B：自建语音链 + Pi + Tavus Echo / LiveKit / Pipecat | 识别和语音之间 | 对 ASR/TTS 和原始音频控制更强 | 自建轮次、同步、取消与媒体编排；整体复杂 | A 的中文/控制能力失败后的备选 |
| C：Tavus 托管 LLM + Pi 后台工具或建议 | 实时回复之外 | 快速形成演示、可做质量对照 | Pi 不能证明控制本轮回复 | 不作为用户要求的最终 POC |

Echo 绕过大部分 CVI，第三方集成也有独立能力边界。不能选择 B 后继续宣称保留了完整 Tavus 的感知与识别能力。[Pipeline Modes](https://docs.tavus.io/sections/conversational-video-interface/quickstart/pipeline-modes)

Pi 与 Pipecat 是不同项目：前者是本次指定的 Agent 底座，后者是可选实时音视频编排框架。

## 8. 商业与技术待验证项

公开价格页同时出现旧 Replica/Starter 套餐和新 Face/Builder 套餐，额度有冲突；例如同为 $59/月，页面中分别出现 100 和 175 分钟。因此本设计不把抓取到的某一组额度当作确定报价。自定义 Face、并发、最长通话、BYO LLM 是否减免原模型费用，需以所选账号实际方案和书面说明确定。[价格页](https://www.tavus.io/pricing)

采购与实施前需确认：目标地区可达性、数据处理与留存、删除覆盖范围、RTC/TTS 子服务、最大并发、Face 训练费用、会话计时起止、重连和等待是否计费。我们关闭业务录音不等于供应商没有日志；结束通话也不等于删除数据。

最小技术探针清单：自定义 SSE 请求与认证、每会话绑定、断线取消与重试、中文及中英切换、慢速朗读、真实打断、Face 正式状态、两会话隔离、房间结束清理。验收方法见 [PRD](tavus-agent-poc-prd.md)。

进一步核对发现：流式 speech 为累计文本，完整 utterance 在打断时可能仍含未说稿；普通会话 callback 与工具 API HMAC 回调也有不同保证。技术附件已将这些落实为字幕、证据和认证合同，不能继续以“收到事件就证明已呈现”简化实现。
