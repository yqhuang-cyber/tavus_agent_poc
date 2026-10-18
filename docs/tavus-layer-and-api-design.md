# Tavus 分层控制权与 API 接入设计

2026-10-19 · v0.5 技术设计附件 · 属于 [POC PRD](tavus-agent-poc-prd.md) 的实现依据。

本文重新核对官方分层文档、集成指南和完整 [OpenAPI](https://docs.tavus.io/openapi.yaml)，明确实际端点与协议。本次只下载公开资料、校核请求示例，没有使用 Tavus 账号执行创建、训练或通话。请求和响应中的 ID、域名、凭证均为示意。

产品顶层架构使用 M1–M5，见 [实施方案第 2 节](implementation-plan.md)：本附件的 Tavus REST/事件适配和 ToolDispatcher 属于 M2，Pi/ContextCompiler/SummaryBuilder 属于 M3，浏览器媒体/播放属于 M1，业务资料/记录属于 M4，外部 Tavus 与规划模型属于 M5。PAL 的 `layers` 是 M5 内部配置层，与产品模块编号分开；能力验证阶段统一称 S1。

## 1. “可以配置”和“可以替换实现”是两件事

需要区分三个级别：调参数；切换厂商支持的模型/供应商；把整个实现换成我们的服务。Tavus 的各层并非都达到第三种开放程度。

下面采用三种标记：**🔓 完全可换、🔐 部分可换、🔒 底层实现锁定**。按 full 模式的公开能力判断；本 POC 选择“full + Tavus 托管 Gemma + Pi 原生工具”，另注明切换 Echo/第三方集成后的变化。“完全可换”仍需满足接口契约；“锁定”指公开接口不允许替换底层实现，不等于该能力必须启用。一个组件的形象、参数与算法可能属于不同类别。

### 1.1 🔓 完全可换：我们决定实现，通过接口接入

| 组件 | 可以怎样换 | 对本 POC 的含义 |
| --- | --- | --- |
| LLM / Agent 后端 | 用自定义兼容 chat completions + SSE 服务替换托管 LLM | 这是可替换能力；本 POC 不替换 LLM，保留 tavus-gemma-4，仅经原生工具接 Pi |
| 页面 UI | 自己实现视频、字幕、表达卡和控制按钮 | 沿用 Ask Kai Free Talk 体验，不必使用 Tavus 默认页面 |
| 业务工具的实现 | 自有受控处理器，经 Tavus Tools API 或 MCP 交付 | 业务权限、资料查询、学习记录与回执由我们管理；不是任意工具自动获准 |
| 我们侧的知识检索与长期记忆 | 可在 Pi/业务服务中自行实现，不依赖其内置服务 | 能力可独立选型；本 POC 有需求先试原生知识库/记忆，业务证据仍由自己管理 |
| 我们侧的教学目标与校验 | 用自己的状态、规则和证据管理目标推进 | 不依赖 Tavus Objectives 的完成判断来认定学生掌握 |

LLM 自定义接入的关键配置是 `model`、`base_url`、`api_key`，可另加 `headers`；`extra_body` 只补充请求参数，不能代替后端地址。模型厂商的原生 API 若不兼容该协议，需要兼容适配服务，不能只填写厂商 key 就假定可直连。[LLM 官方契约](https://docs.tavus.io/sections/conversational-video-interface/pal/llm)

### 1.2 🔐 部分可换：在支持范围内选择，或通过改变接入路线替代

| 组件 | 可以换/配置什么 | 边界与替代方式 |
| --- | --- | --- |
| STT / ASR | 选择 `tavus-auto` 或其他公开支持的识别引擎，配置 hotwords | full 无任意自定义 ASR URL；自己做识别需改走 Echo/外部流水线 |
| TTS | 选择支持的引擎、声音及供应商账号，调支持的语速参数 | full 无任意 TTS URL；外部 TTS 音频需通过 audio Echo/集成链路输入 |
| Voice 声音资产 | 使用老师视频产生的声音、Tavus Voice，或受支持供应商的外部声音 | 可选声音不等于可选任意语音引擎；具体语言、字段互斥和声线可用性仍受支持范围限制 |
| Face 形象资产 | 选择 stock Face，或用已有真人素材制作 Face，选择支持的 Phoenix 版本 | 能换“老师长什么样”，不能把底层渲染器换成自己的 3D/视频模型 |
| RTC / Transport | 原生 Daily 路径，或官方 LiveKit、Pipecat、Agora 集成 | 切换接入路线和对应 SDK，不是任意替换一个 full PAL transport 参数 |
| Tavus 内置 Knowledge Base | 上传/选择内容、关联到 PAL 或会话，配置公开的检索选项 | 上传自己的资料是换内容，不是换内置 RAG 实现；自有 RAG 见 🔓 类 |
| Tavus 内置 Persistent Memory | 配置参与者关系、管理 pinned/learned memory；也可不用 | 内置维护机制归 Tavus；自有跨会话记忆可在 Pi 侧实现，不应笼统归为只能由 Tavus 管理 |
| Tavus 内置 Objectives / Guardrails | 自定义目标和行为边界、关联资源 | 使用内置服务时执行机制归 Tavus；这也不等于自动获得完整的产品合规保证 |
| Pipeline 模式与行为参数 | PAL `pipeline_mode` 选 `full/echo`；可调等待、打断，或关闭感知 | 模式可选，但不能在 full 中任意重排或插入底层流水线节点 |

依据：[STT](https://docs.tavus.io/sections/conversational-video-interface/pal/stt)、[TTS](https://docs.tavus.io/sections/conversational-video-interface/pal/tts)、[Knowledge Base](https://docs.tavus.io/sections/conversational-video-interface/knowledge-base)、[Memories](https://docs.tavus.io/sections/conversational-video-interface/memories)、[Guardrails](https://docs.tavus.io/sections/conversational-video-interface/guardrails)、[Pipeline Modes](https://docs.tavus.io/sections/conversational-video-interface/quickstart/pipeline-modes)。

### 1.3 🔒 底层实现锁定：使用该能力时，由 Tavus 的实现负责

| 组件/机制 | 锁定的是哪一部分 | 仍然能做什么 |
| --- | --- | --- |
| Phoenix 渲染模型 | 人物视频、表情和口型生成的模型实现 | 换 Face 素材、选支持的模型版本；使用 Tavus Avatar 时不能把渲染器换成自有模型 |
| Sparrow 轮次模型 | full 路径下的轮次识别与实时交互算法 | 调等待/打断等参数；转 Echo/外部流水线后自行承担对应能力 |
| Raven 感知模型 | 启用 Tavus 感知时的模型实现 | 配查询与用途、关闭 Raven；外置视觉理解不等于原位替换 Raven |
| full pipeline 内部调度 | Tavus 如何串联其识别、轮次、TTS、渲染与媒体输出 | 在公开接口边界接 Pi，或换整体接入模式；不能通过 config 任意修改内部执行图 |

这里依据公开接口判断替换边界，不用“护城河”“研发投入大”等推测解释商业动机。未核实来源与适用条件的 `10ms/100ms/35–40fps/30ms 检索` 等数字不列为 API 保证，也不用于 POC 验收门槛。

### 1.4 各层详细接口与本项目归属

| 状态 | 层 | full pipeline 内可做什么 | 能否接任意自定义实现 | 若要完全自控 | 本 POC 的控制者 |
| --- | --- | --- | --- | --- | --- |
| 🔓 | LLM / Agent | 选托管模型，或设 `model/base_url/api_key/headers` | **可以接兼容 chat completions + SSE 的后端** | 需兼容协议适配 | 本 POC Tavus 生成回复，Pi 管教学规划与受控工具 |
| 🔐 | STT / ASR | `layers.stt.stt_engine` 选厂商支持的识别引擎，配 hotwords | 当前公开 schema **没有任意 STT URL/自定义识别服务接口** | 外部 ASR 后用 Echo/集成链路 | A 路线由 Tavus 执行识别 |
| 🔐 | TTS | 选 `tavus-auto/cartesia/elevenlabs/azure`，配置声音、供应商 key 和部分语速 | **支持指定供应商的 BYO 声音/账号；不等于任意 TTS HTTP 接口** | 外部生成音频，用 audio Echo 或集成链路驱动 Face | A 路线由 Tavus 调度受支持 TTS |
| 🔐 参数；🔒 算法 | Conversational Flow | Sparrow 模型选择、等待耐心、打断程度、idle engagement | 当前没有自定义 VAD/轮次服务端点 | 外部 VAD/端点检测/取消，配 Echo/外部媒体框架 | A 路线 Tavus 管媒体轮次，我们管业务轮次与取消 |
| 🔐 配置；🔒 模型 | Perception | Raven、查询、工具触发，或 `off` | 当前没有把 Raven 替换为任意感知 URL 的字段 | 关闭 Raven，在我们侧做视觉理解并决定如何提供上下文 | P0 关闭；未来另行接入 |
| 🔐 资产；🔒 模型 | Face / Phoenix | 选 Phoenix 版本；用真人素材创建 Face | 不能通过这些 API 替换成我们自己的渲染模型/3D 引擎 | 若仍选 Tavus Avatar，此层继续用 Tavus | Tavus；我们选择资产、版本并验收 |
| 🔐 | RTC / transport | 原生 CVI 使用 Daily；也有官方 LiveKit、Pipecat、Agora 集成 | 不是在 full PAL 上填写任意 transport URL 即可替换 | 切换整条集成路径，使用对应框架 SDK | 本 POC Daily；外部路线可改 |
| 🔓 | UI | 自己渲染视频、字幕和教学卡，或用厂商 UI | 可以自行实现 | Daily JS / 自有页面代码 | 我们 |
| 🔓 自有实现；🔐 内置服务 | 记忆、RAG、目标与业务工具 | Tavus 提供现成能力，也可以由后端管理 | 可以放在 Pi/业务服务；不能假设工具完全同一协议 | 需自有服务及权限校验 | Pi 管计划和业务证据；Tavus 原生服务按需启用 |

一手依据：[LLM](https://docs.tavus.io/sections/conversational-video-interface/pal/llm)、[STT](https://docs.tavus.io/sections/conversational-video-interface/pal/stt)、[TTS](https://docs.tavus.io/sections/conversational-video-interface/pal/tts)、[Flow](https://docs.tavus.io/sections/conversational-video-interface/pal/conversational-flow)、[Perception](https://docs.tavus.io/sections/conversational-video-interface/pal/perception)。表中“没有接口”限于本次公开文档/schema；不推断企业私有协议或未来能力。

**Tavus 必须控制什么，取决于接法。** 使用 full pipeline 时，本 POC Tavus 控制识别、端点检测、Gemma 实时回复、工具触发、TTS 调度、渲染与媒体编排；我们通过公开配置和事件影响它。只使用其 Avatar 时，可把 ASR、Agent、TTS、VAD 和 RTC 移出去，Tavus 仍承担 Face 的音视频生成与同步。不能一边替换整条语音链，一边承诺继续保有完整 Sparrow/Raven 能力。

我们必须保有：学生身份与数据授权、教学策略、状态版本、Pi 工具权限、学习证据和业务回执。这些是产品职责，不因 Tavus 的内置功能而自动转移。

## 2. 三条架构的实际差异

### A：Tavus full + 原生 Gemma + Pi 工具（本 POC 主方案）

```text
学生 → Daily/CVI → Tavus STT + Sparrow → tavus-gemma-4 → Tavus TTS + Phoenix → 学生
                                               ↕ 原生 Tools API / HTTPS
                                      Pi 教学规划与受控业务工具

开聊前：业务服务 → Pi 初始规划 → Conversation conversational_context
每轮：Tavus 话语事件 → 业务状态/反馈 → Pi 规划 → 校验 → 原生上下文更新（后续输入建议）
结束前：Tavus Tools API → Pi 同源摘要 → Tavus 自然回顾 + 页面卡片 → 播放确认 → 自动结束/保存
结束后：Tavus post-call → 候选核对 → 同一会话记录修订/读回
```

Pi 在我们的 Node.js 服务运行；Tavus 生成说给学生听的实时回复。普通闲聊直接回复，业务服务对每个有效学生回合独立触发 Pi 观察/规划；指定教学或结束情境通过原生工具取 Pi 结果，再由 Gemma 组织语言。工具调用与建议采纳由 Tavus LLM 决定，Pi 不审批每句话，逐轮规划亦不依赖 Tavus 自主选择是否调用工具。主方案不实现 SSE Gateway、不替换 ASR/TTS/RTC。

### C：full + 自定义 LLM（能力参考，不纳入本 POC）

可在 `layers.llm` 配兼容后端，让 Pi 生成回复再通过 SSE 交给 Tavus。此时回复生成权发生变化，与当前确认的 A 不同；不能同时配置原生 Gemma 与自定义后端并声称两者都负责同一回复。第 8 节保留协议说明，未来另立选型决策才实施。

### B：自控语音链，Tavus 只呈现老师（能力参考，不纳入本 POC）

```text
学生 → 自有 RTC / ASR / VAD → Pi → 自有 TTS
                                      ↓ 音频
                              Tavus Echo / Avatar 集成
                                      ↓ 同步音视频
                                     学生
```

完整替换 TTS 要走 **audio** 输入；text Echo 只是把“要说什么”交给 Tavus，仍需其 TTS。不能把 text Echo 误称为已经替换语音合成。

官方集成可用性：

| 路径 | 我们运行的组件 | Tavus 的作用 | Pi 接法 |
| --- | --- | --- | --- |
| Daily + Echo | ASR、VAD、Pi、可选外部 TTS、媒体控制 | 接收 text/audio Echo，返回老师媒体 | Node 服务生成文本或音频，经房间数据通道送入 |
| LiveKit Agents | LiveKit 的语音会话与媒体编排 | AvatarSession 提供同步人物媒体 | Node/TS `@livekit/agents-plugin-tavus`；Pi 包装为该链的 LLM/Agent 逻辑 |
| Pipecat | Python 语音/媒体流水线 | TavusTransport 或 TavusVideoService | Pi 仍在 Node 服务，跨服务调用；不是把 pi.dev 当 Python 包导入 |

[Pipeline Modes](https://docs.tavus.io/sections/conversational-video-interface/quickstart/pipeline-modes)、[LiveKit 集成](https://docs.tavus.io/sections/integrations/livekit)、[Pipecat 集成](https://docs.tavus.io/sections/integrations/pipecat)。这些是不同接入契约，不能混用 SDK 或认为只改 `pipeline_mode` 就得到完整第三方集成。PAL 的该枚举在当前 schema 中只有 `full`、`echo`。

## 3. API 分为三个方向

| 方向 | 基址/通道 | 凭证与用途 |
| --- | --- | --- |
| 我们服务端 → Tavus | `https://tavusapi.com/v2/...` | `x-api-key: TAVUS_API_KEY`；创建资产、配置和会话 |
| Tavus → 我们服务端 | `/hooks/tavus/tools`、`/hooks/tavus/post-call`，以及普通状态回调 | 原生工具用 HMAC 原始字节验签；普通回调另行复核，不套用工具签名保证 |
| 浏览器 ↔ 实时房间 | 返回的 `conversation_url` + Daily JS/WebRTC | 私有房间 `meeting_token`；音视频和 `sendAppMessage` |

REST 用于资源与生命周期，不承载逐帧视频。实时说话/打断事件通过房间数据通道传递，不应虚构 `POST /v2/conversations/{id}/speak` 或 `/interrupt` REST 端点。[鉴权](https://docs.tavus.io/api-reference/authentication)、[交互协议](https://docs.tavus.io/sections/conversational-video-interface/interactions-protocols/overview)

Tavus 主 key 只保存在服务端。浏览器取得自己房间的加入信息，不取得主 key、Pi 规划模型 key、工具 HMAC secret或训练素材签名 URL。

## 4. 本 POC 真正需要的 REST 接口

下表方法、路径与成功状态已经核对下载的 OpenAPI。没有列出的参数不表示禁止使用，但新增时需重新校验。

| 用途 | 方法与路径 | 成功响应与调用时机 | 是否 P0 |
| --- | --- | --- | --- |
| 创建真人 Face | `POST /v2/faces` | `200`，`face_id/status`；素材制作时一次 | 必须 |
| 查询 Face | `GET /v2/faces/{face_id}` | `200`，状态、调优状态、默认声音；等待可用/审核时 | 必须 |
| 列出 Face | `GET /v2/faces` | `200`；发现 stock/既有资产，排错或对账 | 辅助 |
| 创建 PAL | `POST /v2/pals` | `200`，`pal_id`；配置发布时创建，按老师/声音/规则版本复用 | 必须 |
| 查询 PAL | `GET /v2/pals/{pal_id}` | `200`；核对实际生效配置 | 必须 |
| 创建 Conversation | `POST /v2/conversations` | `200`，ID、URL；私有房间附 token | 必须 |
| 查询 Conversation | `GET /v2/conversations/{conversation_id}` | `200`；`?verbose=true` 可取附加事件 | 必须 |
| 结束 Conversation | `POST /v2/conversations/{conversation_id}/end` | `200`，无规定业务 JSON；正常关闭 | 必须 |
| 删除不用的 PAL | `DELETE /v2/pals/{pal_id}` | `204`，无 JSON；仅管理已停用且不再有会话/记忆依赖的配置 | 非日常会话步骤 |
| 单独创建声音 | `POST /v2/voices`、`GET /v2/voices/{voice_id}` | 创建 `200` 后需等声音 `completed` | 可选；视频 Face 已产生默认声音 |
| 更改 Face 默认声音 | `PATCH /v2/faces/{face_id}` | `200`；JSON Merge Patch | 可选，资产管理用途 |
| 更改 PAL | `PATCH /v2/pals/{pal_id}` | `200/304`；JSON Patch 数组 | 可选，受控运维；不用它跨学生切配置 |
| 原生工具注册与关联 | `POST /v2/tools`、`POST /v2/pals/{pal_id}/tools` | `200`；注册教学、结束前摘要与课后工具，再关联 PAL | 必须，见第 11 节 |
| 核对关联工具 | `GET /v2/pals/{pal_id}/tools` | `200`；配置上线前确认，不以注册成功替代关联 | 必须 |
| 删除会话数据 | `DELETE /v2/conversations/{conversation_id}` | `204`；破坏性数据删除用途 | 不用于日常结束 |

第一行的 P0 为“必须，但不是每次通话重训”。Face、Voice 为共享老师资产，PAL、Tools 为稳定版本配置；Conversation 是每次会话资源。视频生成 API、已弃用 `/v2/lipsync`、部署 widget/landing-page API 均不是本 POC 核心依赖。

端点来源：[Face](https://docs.tavus.io/api-reference/faces/create-face)、[PAL](https://docs.tavus.io/api-reference/pals/create-pal)、[Conversation](https://docs.tavus.io/api-reference/conversations/create-conversation)、[End](https://docs.tavus.io/api-reference/conversations/end-conversation)、[Delete PAL](https://docs.tavus.io/api-reference/pals/delete-pal)。

## 5. 真人资产：请求、状态和声音

### 5.1 创建真人视频 Face

<!-- verify: request POST /v2/faces -->
```json
{
  "face_name": "Kai teacher approved video v1",
  "model_name": "phoenix-4.5",
  "train_video_url": "https://assets.example.com/kai-training.mp4?signature=REPLACE",
  "callback_url": "https://gateway.example.com/hooks/tavus/face"
}
```

实际请求：

```sh
curl --fail-with-body --request POST \
  'https://tavusapi.com/v2/faces' \
  --header "x-api-key: ${TAVUS_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data-binary @create-face.json
```

`create-face.json` 保存上面的请求体并填入有效素材 URL；命令是实施示例，本次未执行。视频和图片 URL 不能同时发送。新流程不发送旧 `consent_video_url`；有授权的真人素材仍需符合资产使用要求。

创建成功的最小形状是 `{"face_id":"<face-id>","status":"started"}`。随后 `GET /v2/faces/<face-id>`；关注以下字段：

| 字段 | 如何用 |
| --- | --- |
| `status` | `started/completed/error`，Face 是否可用 |
| `finetune_status` | Phoenix-4.5 的 `null/started/completed/errored`，是否完成正式调优 |
| `default_voice_id` | 默认朗读声音，可能为 null；需确认可解析 |
| `original_voice_id` | 从原始视频创建的声音，可用于恢复原声 |
| `model_name/error_message` | 版本与失败排错 |

Phoenix-4.5 正式效果验收要求 `status=completed` 且 `finetune_status=completed`。Face callback 的旧示例可能用 `status=ready`，不能与 GET 状态直接混用；callback 作为唤醒信号，GET 复核后再推进状态。[Get Face](https://docs.tavus.io/api-reference/faces/get-face)、[调优状态](https://docs.tavus.io/sections/faces/phoenix-45-preview-and-status)

**背景限制：Phoenix-4.5 不支持当前 `properties.apply_greenscreen` 背景定制，schema 明确该配置会解析为 false。** 若要求与既有老师环境一致，应在拍摄和资产验收时落实背景；需要绿幕合成时另评估 Phoenix-4 或经过验证的外部合成，不能承诺给 4.5 加一个参数就能换背景。[背景说明](https://docs.tavus.io/sections/conversational-video-interface/conversation/customizations/background-customizations)

### 5.2 什么时候才要单独创建 Voice

视频训练已生成原声时，不必再调用 Voice 创建接口。如果需要一份更清晰的中文声音样本再独立制作：

<!-- verify: request POST /v2/voices -->
```json
{
  "voice_name": "Kai Mandarin teaching v1",
  "training_audio_url": "https://assets.example.com/kai-mandarin.wav?signature=REPLACE",
  "description": "Approved teacher voice for Mandarin teaching audition",
  "callback_url": "https://gateway.example.com/hooks/tavus/voice"
}
```

等待 `GET /v2/voices/<voice-id>` 返回 `status=completed`，再用于 PAL 的 `layers.tts.voice_id`，或更新 Face 默认声音：

<!-- verify: request PATCH /v2/faces/{face_id} -->
```json
{ "default_voice_id": "<approved-voice-id>" }
```

Face 这个 PATCH 接受对象；PAL 的 PATCH 接受 JSON Patch 数组，不能复用同一请求形状。[Voice API](https://docs.tavus.io/api-reference/voices/create-voice)、[Update Face](https://docs.tavus.io/api-reference/faces/update-face)

## 6. 建稳定 PAL：原生 Gemma 与各层配置

<!-- verify: request POST /v2/pals -->
```json
{
  "pal_name": "Ask Kai native teacher v1",
  "pipeline_mode": "full",
  "default_face_id": "<approved-face-id>",
  "system_prompt": "你是 Kai 中文老师。先回应学生当前意思，中文优先，英文支架按需。普通聊天目标可为空，不强迫练习。回复不设固定句数，应自然、完整、有意义，每轮最多一个重点教学动作。当前语言请求优先于旧画像，区分本次与整场有效范围。帮助表达的程度、中文难度与语速分别遵循有效上下文。正确表达不制造纠错，歧义只必要澄清一次；主动教学后的冷却期间不叠加新点。学生明确要求持续练习、需要调整支架或改变目标时，先调用 get_next_teaching_action_v1，再依据有效结果回复。学生明确正常结束时，先调用 prepare_session_close_v1，依据同一摘要回顾并告别，不再追问；学生继续则撤销旧收尾，立即退出不强制总结。工具失败时说明限制；学生拒绝或换题优先，不执行过期计划。不从转写判断发音或掌握，不把计划当学习事实。",
  "greeting": "",
  "dynamic_greeting": false,
  "languages": ["zh", "en"],
  "layers": {
    "llm": {
      "model": "tavus-gemma-4",
      "speculative_inference": true
    },
    "stt": { "stt_engine": "tavus-auto" },
    "conversational_flow": {
      "turn_detection_model": "sparrow-2",
      "turn_taking_patience": "high",
      "pal_interruptibility": "high",
      "idle_engagement": "off"
    },
    "tts": { "voice_id": "<approved-voice-id>" },
    "perception": { "perception_model": "off" }
  }
}
```

成功后保存 `pal_id`，调用 `GET /v2/pals/<pal-id>` 复核生效配置。`default_face_id` 必填、full 模式需 system prompt，这两项主要写在官方描述而不是 JSON Schema `required` 数组里，因此不能只依赖生成的 schema 验证器。

这里明确使用 Tavus 托管模型，不设置 `base_url`、LLM `api_key` 或会话专用 Gateway header。Pi 独立规划模型由我们的服务配置，尚待选型。保持原生 speculative inference 默认值；工具默认只读/返回提案，实测修订输入和打断下的误触发后再决定是否调参。[LLM 配置](https://docs.tavus.io/sections/conversational-video-interface/pal/llm)

创建 PAL 后按第 11 节注册并关联三个工具，再 GET PAL 和关联工具列表复核。示例中工具名必须与实际注册名称一致，未来更新工具版本时一起更新提示词及 PAL 版本。共享 PAL 只存稳定教学规则，不放学生个人资料。

声音有两种配置方式，二选一：

- Tavus Voice：`voice_id`，不同时发送 `external_voice_id` 或自己的 TTS `api_key`。
- 指定外部供应商：`tts_engine + external_voice_id + 可选供应商 key + tts_model_name/voice_settings`，不再发送 `voice_id`。Azure 等引擎还有专门限制。

本例使用 Tavus Voice，TTS 引擎保持 tavus-auto 默认，以先验证本人声音；仅质量不足时评估支持的显式引擎配置。不是把二者字段全叠在同一个 PAL。[TTS 配置](https://docs.tavus.io/sections/conversational-video-interface/pal/tts)

## 7. 建 Conversation 并加入页面

### 7.1 服务端创建私有会话

<!-- verify: request POST /v2/conversations -->
```json
{
  "pal_id": "<versioned-teacher-pal-id>",
  "face_id": "<approved-face-id>",
  "conversation_name": "Ask Kai <opaque-session-id>",
  "require_auth": true,
  "max_participants": 2,
  "audio_only": false,
  "callback_url": "https://gateway.example.com/hooks/tavus/conversation",
  "conversational_context": "本次是自由聊天，初始教学目标为空。学生偏好慢速，允许按需短英文支架。",
  "custom_greeting": "你好，我是 Kai。今天想聊什么？",
  "dynamic_greeting": false,
  "participant_tags": [],
  "properties": {
    "languages": ["zh", "en"],
    "max_call_duration": 900,
    "participant_left_timeout": 10,
    "participant_absent_timeout": 60,
    "enable_closed_captions": true,
    "enable_recording": false,
    "auto_start_recording": false
  }
}
```

示例偏好、开场和超时均为本项目设计值；上下文由 Pi 初始计划的校验后摘要生成，实际开场从 Pi 候选中按有效难度/语言规则选择；无合格候选才使用有标记的审核模板。不能只生成个性化开场字段却始终播同一个固定开场。`properties.languages` 覆盖 PAL 的语言集合，不是合并。`audio_only=false` 保留老师视频；学生摄像头关闭是客户端选择，不应因此设成纯音频会话。

响应最小使用形状如下，ID/时间/token 为示意，不是实际调用记录：

<!-- verify: response POST /v2/conversations 200 -->
```json
{
  "conversation_id": "<conversation-id>",
  "conversation_url": "https://tavus.daily.co/<room>",
  "status": "active",
  "meeting_token": "<short-lived-room-token>"
}
```

`active` 只说明资源已创建，不说明老师媒体就绪。记录业务 session_id、pal_id、conversation_id 和 connection_epoch 的映射；前端只收到会话 ID/URL/token 与显示配置。[Create Conversation](https://docs.tavus.io/api-reference/conversations/create-conversation)

`participant_tags=[]` 表示本例不启用持久参与者记忆。独立试验原生记忆时，用一个稳定不透明 tag、同一 PAL 验证连续性；更换 PAL 不意味着同一份记忆自动迁移。不要每会话删除 PAL 后又声称保留原生跨会话记忆。

### 7.2 浏览器加入与事件通道

以下是 Daily JS 的接入骨架，不是完整 UI 实现；需安装固定版本 `@daily-co/daily-js`，把远端 tracks 挂到自有音视频元素并处理自动播放、权限及清理。

```js
import Daily from '@daily-co/daily-js';

const call = Daily.createCallObject();
call.on('app-message', (event) => {
  // 实现时先核对 sender、房间和业务会话，再分发 event.data。
  handleTavusEvent(event.data, event.fromId);
});
await call.join({
  url: session.conversation_url,
  token: session.meeting_token,
  startVideoOff: true,
  startAudioOff: true,
});
// 下面函数由业务页面实现，校验 PAL/媒体就绪和授权；不是 Tavus/Daily 自带 API。
await waitForPalMediaReadyAndAuthorization(call);
await call.setLocalAudio(true);

call.sendAppMessage({
  message_type: 'conversation',
  event_type: 'conversation.respond',
  conversation_id: session.conversation_id,
  properties: { text: '我今天想聊足球。' },
}, '*');
```

示例中的就绪等待函数必须在实现中验证：join 成功不等于 PAL 就绪，静音也不自动证明 SDK 未申请设备或未采集。需分别验证权限请求与音频上传时点，不能把 startAudioOff 配置本身当作已满足采音要求。[Daily setLocalAudio](https://docs.daily.co/reference/daily-js/instance-methods/set-local-audio)

`respond` 将文字作为学生输入触发回复；普通麦克风交流由媒体链自动识别，不需把同一句 ASR 文本再发一次 respond。后者会造成重复输入。`'*'` 是房间广播目标，不表示该消息经过业务服务端授权。[Tavus 交互示例](https://docs.tavus.io/sections/conversational-video-interface/interactions-protocols/overview)、[Daily join](https://docs.daily.co/reference/daily-js/instance-methods/join)、[Daily sendAppMessage](https://docs.daily.co/reference/daily-js/instance-methods/send-app-message)

## 8. 自定义 LLM 能力参考与当前逐轮编排

### 8.1 自定义 LLM 的兼容协议（非 POC 实现范围）

仅当未来决定将实时回复生成权迁移到自有后端时，才需提供 `POST https://gateway.example.com/v1/chat/completions`。下文为另一种架构的协议示意，不属于当前主方案的实现、部署或验收要求；当前 Pi 的接入口是第 11 节原生工具。该端点不是 Tavus REST API。

下面请求为兼容协议的预期最小形状，**完整入站 body/头部需未来采用该路线时实际联调确认**。官方公开 OpenAPI 没有完整描述 Tavus 作为客户端发给自定义 LLM 的每一个字段。

```http
POST /v1/chat/completions HTTP/1.1
Content-Type: application/json
X-AskKai-Session-Key: <session-gateway-credential>

{"model":"ask-kai-pi","stream":true,"messages":[{"role":"system","content":"..."},{"role":"user","content":"我喜欢足球。"}]}
```

我们提供的响应契约为兼容 SSE：

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

data: {"id":"chatcmpl-kai-example","object":"chat.completion.chunk","created":1792332000,"model":"ask-kai-pi","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-kai-example","object":"chat.completion.chunk","created":1792332000,"model":"ask-kai-pi","choices":[{"index":0,"delta":{"content":"我也喜欢足球。"},"finish_reason":null}]}

data: {"id":"chatcmpl-kai-example","object":"chat.completion.chunk","created":1792332000,"model":"ask-kai-pi","choices":[{"index":0,"delta":{"content":"你喜欢哪支球队？"},"finish_reason":null}]}

data: {"id":"chatcmpl-kai-example","object":"chat.completion.chunk","created":1792332000,"model":"ask-kai-pi","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

代理层关闭 SSE 响应缓冲与缓存，设置空闲超时和背压；别把整个流攒完再转发。每个 SSE frame 后是空行；网络分块不保证一次 read 正好读完一个 frame。

若未来采用这条路线，Pi 内部流程可为：认证解析会话 → 规范化当前输入 → 冻结状态 → 有界教学决策与工具 → 生成口语文本 → 转成 `delta.content`。Pi 的工具事件、计划 JSON、推理过程不直接透传到 Tavus。这会改变当前职责边界，不与 A 路线混合实施。

若未来实施此路线，取消时需同时停止 SSE 写入和 Pi/模型请求，不能把 HTTP stream close 当作 Pi 已取消的充分证据；实际重试、取消传播和错误恢复需另行专项验证，不属于当前 S1。

### 8.2 当前 POC 的逐轮 Pi 编排（与上面的自定义 LLM 路线无关）

逐轮计划是本项目业务服务主动运行的 Pi 任务，不是 Tavus LLM 每轮都调用某个工具。这样保持 Tavus 生成回复，也保证普通聊天不会漏掉观察与下一步规划。

1. 页面接收 Tavus user 话语事件，经授权业务连接转送必要字段；业务服务核对 conversation、participant、seq、有效 final 和输入 revision。服务端维护本地学生回合编号，不能把 respond 驱动的 turn_idx 当作连续语音的可靠计数。事件与身份不明时拒绝正式提交并记录覆盖缺口。
2. 为每个有效输入更新暂态反馈/拒绝/语言作用范围，触发一个 Pi 逐轮任务；背景包括实际前文和前一回复可观测执行范围。新输入或更正使旧任务失效，同一输入同步工具与后台任务共用结果/版本，避免重复规划。
3. 每轮从输入接受起最多 2 秒，含排队、修复、校验与提交。成功与 rule/not_configured/timeout/invalid/unavailable 分开报告；降级不制造新目标、学习事实或模型成功。
4. 校验后的最新提案经 Context Compiler 编译为完整最小上下文。业务服务通过已授权页面的控制连接下发原生 `conversation.overwrite_llm_context`；页面确认实际发送只说明 sent。保留稳定提示规则、授权资料摘要、语言/目标/冷却/拒绝状态和最新后续建议，不无限 append 旧计划。
5. 仅在已知安全的回复边界更新；无法判断是否还有活动发声、取消或新输入，则暂缓或丢弃旧建议，不能在新回合塞回旧目标。没有文档化版本 ACK，不把 sent 记为 applied；通过实际后续内容审阅遵循情况，不反推已开始的回复用了该计划。
6. 按有效来源维护有界会话 recap，保留较早目标/内容和覆盖不足状态，供结束前摘要用。完整 transcript 不进入普通日志或持久业务记录，裁剪不能把缺失内容补写为事实。

这是 S1 必须验证的原生消息与业务编排组合，不声明官方提供 Pi 插件、强制每轮工具或每句生成审批。实际后续语言/教学违规仍是必要验收失败，不能因异步而豁免。

## 9. 实时控制与字幕协议的精确字段

### 9.1 主方案使用的消息

| 事件 | 方向 | 作用 |
| --- | --- | --- |
| `conversation.respond` | 我们 → Tavus | 文字学生输入，触发一轮回复 |
| `conversation.interrupt` | 我们 → Tavus | 请求老师停止发声；不代表 Pi 自动取消 |
| `conversation.sensitivity` | 我们 → Tavus | 动态改变暂停或打断敏感度，每条只发一个属性 |
| `conversation.append_llm_context` | 我们 → Tavus | 添加会话上下文 |
| `conversation.overwrite_llm_context` | 我们 → Tavus | 替换会话上下文；不是替换学生业务身份 |
| `conversation.utterance.streaming` | Tavus → 我们 | 累计转写、是否 final/被打断 |
| `conversation.utterance` | Tavus → 我们 | 完整输入或生成稿，包含角色和可能的 interrupted |
| `conversation.started_speaking` / `conversation.stopped_speaking` | Tavus → 我们 | 发声状态；停止可带时长和 interrupted |
| `conversation.joined` / `conversation.left` | Tavus → 我们 | 参与者进入/离开 |

这组事件通过 Daily app-message 传输。基础必需先实现 respond、interrupt 和观察事件；context/sensitivity 属于受控增强，不能用它们修改共享 PAL 来影响别的会话。

手动打断消息：

<!-- verify: event interrupt -->
```json
{
  "message_type": "conversation",
  "event_type": "conversation.interrupt",
  "conversation_id": "<conversation-id>"
}
```

配套通过我们自己的授权控制接口取消 Pi，不能以发送该事件等同完成双端取消。正常发声、用户开始说话、手动按钮三个状态要分别处理。

### 9.2 字幕是累计文本，不能直接 append

<!-- verify: event conversation_utterance_streaming -->
```json
{
  "message_type": "conversation",
  "event_type": "conversation.utterance.streaming",
  "conversation_id": "<conversation-id>",
  "inference_id": "<inference-id>",
  "seq": 42,
  "turn_idx": 3,
  "properties": {
    "role": "pal",
    "speech": "我也喜欢足球。你喜欢哪支球队？",
    "content_index": 2,
    "final": false,
    "is_interrupted": false
  }
}
```

字段处理要求：

- `speech` 是本轮截至此刻的**累计文本**。按 inference/内容索引更新快照；直接拼接会重复。
- 同一 inference 的过期 `content_index/seq` 不覆盖较新状态。`role=pal` 和旧 `role=replica` 可能双发；优先新角色，归一化后去重。
- streaming 使用 `is_interrupted`；完整 utterance 和 stopped_speaking 使用 `interrupted`，不能统一猜字段名。
- 完整 utterance 的 `speech` 对老师可能是**整个 LLM 生成稿**，打断时会包含未说出口内容；它不是已播放文本回执。
- `stopped_speaking.duration` 是时长，不足以精确计算说到哪个汉字。没有可靠逐词播放证据时将未确定部分标为 unknown，不据此生成“学生已听过”的教学事实。

依据：[Streaming schema](https://docs.tavus.io/sections/event-schemas/conversation-utterance-streaming)、[Utterance schema](https://docs.tavus.io/sections/event-schemas/conversation-utterance)、[Speaking schema](https://docs.tavus.io/sections/event-schemas/conversation-started-stopped-speaking)。

### 9.3 动态参数与上下文

<!-- verify: event sensitivity -->
```json
{
  "message_type": "conversation",
  "event_type": "conversation.sensitivity",
  "conversation_id": "<conversation-id>",
  "properties": { "participant_interrupt_sensitivity": "medium" }
}
```

该事件可用 `superlow/verylow/low/medium/high/auto`，与 PAL 配置的 low/medium/high 枚举不同。暂停与打断属性每条只给一个；具体等待时长由 Tavus 判断，不把枚举映射成未经测量的毫秒数。

<!-- verify: event overwrite_llm_context -->
```json
{
  "message_type": "conversation",
  "event_type": "conversation.overwrite_llm_context",
  "conversation_id": "<conversation-id>",
  "properties": { "context": "规则版本 kai-v1；获准资料摘要与当前会话绑定；目标为空，拒绝练习状态继续有效；当前会话只中文；最新有效后续建议：回应学生当前话题，不新增教学任务。" }
}
```

`context` 是字符串，自己的状态版本仍由服务端管理。公开事件不等于存在带我们版本号的应用确认；没有实测 ACK 时只记录已请求，不虚报已对本句生效。

## 10. 结束、回调、状态复核

### 10.1 正常退出的调用顺序

1. 正常口头结束先走第 11.3 节：同源摘要、Tavus 回顾、匹配播放结束与可撤销收尾；立即退出/失败则跳过播报。真正退出时才停止采音/播放并取消在线 Pi 工作。
2. 服务端调用 `POST /v2/conversations/<id>/end`，期望 `200`，不强制解析 JSON body。
3. 页面 `await call.leave()` 并 `await call.destroy()`；即使服务端请求失败，也必须释放本地设备。
4. `GET /v2/conversations/<id>` 复核状态；未结束则有限重试并进入清理队列。
5. 按许可读取 `?verbose=true` 补充对账，通过同一 ConversationRecordPort 自动保存最终摘要并授权读回，post-call 对账/补充只修订这份记录；保留最低限度映射供重试幂等使用，处理完再清理短期状态。不删除共享 PAL/Tools。

服务端保存资源 ID 后再给浏览器加入信息，以便浏览器突然退出也可清理。不在每次退出删除 Face/Voice 或调用破坏性 DELETE Conversation。

### 10.2 普通会话 callback

接收端是我们实现的 `POST /hooks/tavus/conversation`。至少处理 `system.pal_joined`、`system.shutdown`、`application.transcription_ready`。`system.replica_joined` 是前者旧别名，需去重。

实时 app-message 的 timestamp 通常为 Unix 数字；普通 callback 的顶层 timestamp 示例为 ISO 字符串，不能复用一个强类型解析函数后静默丢事件。转写条目中角色使用 `assistant/user`，与实时 `pal/user` 也不同。

本次没找到普通 callback 的统一签名配置保证。因此普通 callback 只作待核实通知，使用服务端 key 查询该资源；对未知 ID 不无限发查询。记录允许的会话映射，限制消息大小和频率。

`application.transcription_ready` 在会话结束后提供 transcript，也可从 `GET ...?verbose=true` 的 events 读取。它是供应商保存的对话历史，不能替代真实音频/客户端呈现证据；根据自己的许可处理与留存，不默认存进业务库。[Callbacks](https://docs.tavus.io/sections/webhooks-and-callbacks)、[Get Conversation](https://docs.tavus.io/api-reference/conversations/get-conversation)

Face 的新旧 callback 可能分别以 face_id、replica_id 双发，同一个 ID/status 只触发一次复核。声音 callback 有专门 `application.voice_status_changed`，与 Face 的回调形状也不同。

## 11. 原生 Tools API 接 Pi：本 POC 的核心接入

使用独立工具注册表，创建并关联 PAL；不使用旧 `layers.llm.tools` 内联格式。P0 使用三个工具：教学规划、结束前摘要、课后核对；逐轮 Pi 规划另外由有效话语事件可靠触发，不再额外实现 MCP 服务器或自定义 LLM 接口。

### 11.1 在线教学规划工具

<!-- verify: request POST /v2/tools -->
```json
{
  "name": "get_next_teaching_action_v1",
  "description": "当学生明确要求持续练习、持续听不懂需要调整支架或改变教学目标时，取得 Pi 的教学建议。普通闲聊无需调用。参数是当前意图描述，不是授权身份或学习事实。",
  "parameters": {
    "type": "object",
    "properties": {
      "reason": { "type": "string", "enum": ["practice_request", "adjust_scaffolding", "change_goal"] },
      "student_request": { "type": "string", "description": "本次学生请求的概述，服务端仍须核对上下文。" }
    },
    "required": ["reason", "student_request"],
    "additionalProperties": false
  },
  "trigger_type": "in_call",
  "origin": "llm",
  "delivery": {
    "app_message": false,
    "api": {
      "url": "https://gateway.example.com/hooks/tavus/tools",
      "method": "POST",
      "timeout": 3,
      "auth": { "type": "hmac", "secret": "<tool-signing-secret>" }
    }
  },
  "on_call": "silent",
  "on_resolve": "generate_response"
}
```

`generate_response` 让 Tavus LLM 根据返回结果生成自然回复。它不同于 `add_to_context`（仅加入历史，供下一次学生输入使用）、`response_in_result`（逐字朗读工具返回的 text/plain）和默认 `fire_and_forget`（不等待/处理结果）。本 POC 不让 Pi 返回一段指定逐字朗读的最终回复。[LLM Tool](https://docs.tavus.io/sections/conversational-video-interface/pal/llm-tool)

### 11.2 回调、身份与结果契约

工具 API 的 HMAC 固定 envelope 形状如下；示例是官方契约的脱敏形状，不是已发生的调用：

```json
{
  "name": "get_next_teaching_action_v1",
  "arguments": "{\"reason\":\"practice_request\",\"student_request\":\"帮我练习讲昨天的事\"}",
  "tool_call_id": "<tool-call-id>",
  "conversation_id": "<conversation-id>",
  "inference_id": "<inference-id>",
  "turn_idx": 4
}
```

我们的处理步骤：

1. 对原始请求字节计算 HMAC-SHA256，与 `X-Tavus-Signature` hex digest 恒定时间比较；验签前不执行工具。不能 JSON.parse 后重新序列化验签。该模式忽略 body_template、query 和 URL 模板，直接使用 envelope。
2. 验证工具名/版本、conversation_id 映射、会话状态及授权快照；解析 arguments 并再次做 schema 校验。学生身份从服务端映射取得，不作为 LLM 参数。
3. 用 `(conversation_id, tool_call_id)` 幂等；同一调用重试复用已存结果，禁止同一键更换参数。HMAC 不自带新鲜度，过期会话拒绝执行。
4. Pi 基于获准资料与可用上下文做一次有界规划；返回前再核对 state_version、consent_version 和 connection_epoch。上下文仅有模型概述时给暂定建议，不将其保存为实际练习。
5. 以 `200 application/json` 返回结构化结果；失败不伪造成功。初始超时 3 秒，内部规划截止 2 秒，留网络和编码余量。普通规则查询可直接走白名单端口，不多加模型循环。

上下文来源分开标记：初始授权画像、已接受的 Pi 计划、本次工具参数、已接收的话语事件。页面可经授权业务连接镜像必要的 Tavus 事件，服务端校验房间、发送者和顺序后缓存，仍标记为 client_reported，不能提升为供应商可验证事实。事件未到或自然轮次无法对应时，同步工具可以给暂定建议，但不得伪称正式逐轮计划或绕过输入归属；该轮的事件覆盖缺口必须记录。课后再按许可取得 GET verbose 的来源核对；接受计划只更新计划状态，不新增“学生已经练过”的证据。

下面结果是我们定义的业务契约，不是 Tavus 固定字段：

```json
{
  "status": "ok",
  "plan_id": "<plan-id>",
  "state_version": 7,
  "action": "INVITE_PRACTICE",
  "target": "用中文讲述昨天发生的一件事",
  "scaffolding": "先让学生表达；听不懂时提供一个例句，再逐步撤除支架",
  "constraints": ["接受拒绝和换题", "不从转写推断发音或掌握"],
  "evidence_status": "planning_only"
}
```

建议是给 Gemma 的结构化输入，可含经审核的语言示例，但不是强制逐字播出的最终回复。`status=stale/unavailable` 的业务结果必须不携带旧计划，提示 Tavus 回应当前学生；其实际遵循需测试，不以本地版本号宣称已阻止旧结果发声。

工具 API 的 5xx/连接错误有一次文档化重试，超时标 timeout；不是所有 callback 的统一重试规则。`tool_call_id` 跨重试稳定，业务写入还要按业务事件幂等，防止模型用新调用 ID 重复申请同一动作。`tavus_` 是系统保留前缀，禁止自定义同名前缀参数。[Tool Delivery](https://docs.tavus.io/sections/conversational-video-interface/pal/llm-tool-delivery)、[Tool Auth](https://docs.tavus.io/sections/conversational-video-interface/pal/llm-tool-auth)

P0 在线工具默认只读或返回提案；结束前工具可提交摘要预览但不能挂断或写成正式记录。若后续注册偏好/记录写入工具，必须由程序校验许可与证据，不能因为原生模型选了工具就自动放行。app-message 工具有 4 KB 限制且没有此 API watchdog；P0 用 HTTPS 交付，不依赖浏览器转发业务工具。

### 11.3 结束前摘要工具：与正常收尾共用同一份记录

<!-- verify: request POST /v2/tools -->
```json
{
  "name": "prepare_session_close_v1",
  "description": "学生明确要求正常结束交流时，取得本次有来源的目标、知识项和交流回顾摘要，供 Kai 回顾后告别。不处理引语/否定/翻译问题。工具没有挂断权限；立即退出不强迫等待。",
  "trigger_type": "in_call",
  "origin": "llm",
  "parameters": {
    "type": "object",
    "properties": { "ending_request": { "type": "string" } },
    "required": ["ending_request"],
    "additionalProperties": false
  },
  "on_call": "silent",
  "on_resolve": "generate_response",
  "delivery": {
    "app_message": false,
    "api": {
      "url": "https://gateway.example.com/hooks/tavus/tools",
      "method": "POST",
      "timeout": 3,
      "auth": { "type": "hmac", "secret": "<tool-signing-secret>" }
    }
  }
}
```

HMAC 验签和 conversation_id 绑定与教学工具相同；参数只是结束请求候选，业务服务核对可用的实际输入/明确结束证据，拒绝不确定的关闭授权。有效请求进入 ClosingCoordinator，取消普通 Pi 规划并暂停旧目标推进，创建 closing_id。工具返回 `closing_id/summary_revision/summary_hash/objective/knowledge_points/conversation_recap/source_refs` 等业务字段；无可核验知识项则明确为空。它不是最终逐字台词，仍由 `tavus-gemma-4` 组织回顾与告别。

同版本摘要同时发页面并作为会话记录待保存版本；只允许口头选择重点，不允许无来源新增知识项。工具请求的 inference_id 与后续实际口头回复是否可稳定关联，必须实际测试。业务关闭只由 ClosingCoordinator 在当前收尾有效、媒体状态与客户端播放边界符合要求后执行，工具返回不等于可以立即调用 end。

必须测试收尾前先说告别/未调用工具、工具返回后继续发问、学生插话继续、立即退出、旧 inference/closing_id、字幕/音频未完成、断线及超时。正常继续取消旧预览，下一次结束生成新版本。无法证明匹配媒体已播完时只允许有界失败退出并标未确认，正常自动结束这项保持失败/未知；不能硬延时模拟确认。

### 11.4 原生课后工具：对账与异常恢复

优先使用 Tavus 原生 post-call 执行机制提交课后候选；它发生在通话结束后，不能承担上节结束前的口头小结。Pi 将候选与同一会话已有摘要/来源对账，完成必要校正与受控保存；不另起第二份独立最终总结。

<!-- verify: request POST /v2/tools -->
```json
{
  "name": "review_session_evidence_v1",
  "description": "结束后提交本次对话的小结与学生实际尝试候选供 Pi 对照现有摘要审查；没有尝试则返回空数组，不推断掌握或发音评分。",
  "trigger_type": "post_call",
  "parameters": {
    "type": "object",
    "properties": {
      "summary_candidate": { "type": "string" },
      "attempt_candidates": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["summary_candidate", "attempt_candidates"],
    "additionalProperties": false
  },
  "delivery": {
    "app_message": false,
    "api": {
      "url": "https://gateway.example.com/hooks/tavus/post-call",
      "method": "POST",
      "timeout": 3,
      "auth": { "type": "hmac", "secret": "<post-call-signing-secret>" }
    }
  }
}
```

post_call 必须省略 origin；参数由 Tavus 根据 transcript/感知分析生成，当前 Raven 关闭，不依赖视觉证据。它在有对话的会话结束后逻辑执行一次；完全无对话不会运行，HTTP 重试仍需服务端幂等。

接收端验签、映射和持久入队后快速返回 `202`；这只代表已接收，不代表 Pi 审查或业务保存成功。后续 Pi 等待获准转写/证据就绪，逐项核对来源与截止范围，剔除未发生、仅计划和无法证实的尝试；无来源时报告部分/待处理，不编造。不能将候选直接作为已掌握事实。已有结束前摘要时复用同一份，不重新生成相互独立的小结；来源更充分而需要校正时产生新 revision，保留原口头版本。立即退出/异常没有口头预览时可形成有来源的部分卡片，不伪称完成了口头总结。

`application.post_call_action_executed` 可由普通 callback 通知，再用 GET verbose 复核，状态有 success/error/timeout/skipped。原生投递成功、后台审查完成、业务保存成功分开呈现；通知缺失时对账，不重复创建另一条总结写入路径。[Post-Call Actions](https://docs.tavus.io/sections/conversational-video-interface/pal/post-call-tool)

### 11.5 将工具关联到稳定 PAL

三个工具创建后返回各自 tool_id：

<!-- verify: request POST /v2/pals/{pal_id}/tools -->
```json
{ "tool_ids": ["<teaching-tool-id>", "<closing-tool-id>", "<post-call-tool-id>"] }
```

调用 `GET /v2/pals/{pal_id}/tools` 确认实际关联。工具名在账号内唯一，遇到 `409` 先查现有版本，不循环创建。更新工具影响共享关系，上线前用测试 PAL 验证后发布新的配置版本。

### 11.6 其他原生能力的 POC 边界

| 能力 | 当前处理 | 接入方式/限制 |
| --- | --- | --- |
| 参与者记忆 | 默认 stateless；跨会话偏好另用合成资料验证 | Conversation 单个稳定 participant tag，与同一 PAL 形成记忆关系；业务证据仍单独校验 |
| Knowledge Base | Free Talk P0 不要求课程检索；确需时先试原生 | POST /v2/documents → 等待处理 → PAL/Conversation 关联 document_ids；当前官方说明只支持英文文档并偏向英文交流，不把中文 RAG 列为已解决 |
| Objectives | 自由聊天目标可空；有明确练习目标再评估 | 使用原生目标辅助推进，完成状态不能直接作为掌握证据 |
| Guardrails | PAL 提示词先承接原有教学规则；需要专门检测时用原生资源 | 原生检测不等于每句播放前硬拦截，不能宣称已满足全部产品约束 |
| MCP | 原生 Tools API 已覆盖 Pi 的 P0 接入口 | 暂不额外部署 MCP，避免重复工具通路 |

原生优先意味着优先复用已有机制，不要求同时启用所有功能。KB 和记忆正式启用时补端点示例、权限及专项验收；不因为暂未启用就替换成另一套平台。[Knowledge Base](https://docs.tavus.io/sections/conversational-video-interface/knowledge-base)、[Memories](https://docs.tavus.io/sections/conversational-video-interface/memories)、[Guardrails](https://docs.tavus.io/sections/conversational-video-interface/guardrails)

## 12. Echo 能力参考（非 POC 范围）

PAL 以 `pipeline_mode=echo` 创建，保留 `default_face_id`；该模式不要求 system_prompt。与 full 相同创建 Conversation 和加入房间，但需自己提供识别、轮次与响应来源。

text Echo，直接朗读提供的老师文本：

<!-- verify: event echo -->
```json
{
  "message_type": "conversation",
  "event_type": "conversation.echo",
  "conversation_id": "<conversation-id>",
  "properties": {
    "modality": "text",
    "text": "可以说：我昨天去踢足球了。",
    "inference_id": "<our-response-id>",
    "done": true
  }
}
```

audio Echo，使用我们外部 TTS 的音频块：

<!-- verify: event echo -->
```json
{
  "message_type": "conversation",
  "event_type": "conversation.echo",
  "conversation_id": "<conversation-id>",
  "properties": {
    "modality": "audio",
    "audio": "<base64-audio-chunk>",
    "sample_rate": 16000,
    "inference_id": "<our-response-id>",
    "done": false
  }
}
```

流式同一回复使用稳定 inference_id，最后一个音频块明确 `done=true`。官方说明可传入 ID 会被归一化为稳定 UUID，因此维护我们 ID 与返回 ID 的映射，不要求字符串相等。

schema 将 audio 描述为 PCM 或流水线特定编码，未完整固定所有位深/声道/分片约束。未来若实施此路径，必须以实际所选路径核实，不能仅凭 sample_rate=16000 猜成现有豆包 PCM 格式。控制消息和 base64 开销还受数据通道限制；持续音频更适合评估官方媒体 SDK，别把任意长音频塞成一个 app-message。[Echo 协议](https://docs.tavus.io/sections/event-schemas/conversation-echo)

## 13. 幂等、错误和配置更新

| 情况 | 实现要求 |
| --- | --- |
| REST `400` | 修复字段/资源状态后重试，不原样循环 |
| REST `401` | 核对服务端 Tavus key，停止新建；不向前端泄露 key |
| `429/5xx` 或网络超时 | 有界退避；仅在相应端点实际返回时分类，不能把未知状态视为确定失败 |
| 创建资源响应丢失 | 官方未在本次 schema 中给出通用 Idempotency-Key 保证；置 outcome_unknown，以业务创建账本和资源查询对账后决定重试 |
| `end` 返回 `200` | 不强制解析 JSON；查询/回调复核远端状态 |
| DELETE 返回 `204` | 按无正文处理；已删除/不存在的具体错误按实测契约归类 |
| PAL PATCH `409 maker_changes` | 保留冲突给运维，不自动 `force=true` 覆盖人工草稿 |
| 原生在线工具超时/过期 | 取消 Pi 工作，不提交旧状态；测试原生失败反馈及迟到结果是否引发旧话题发声 |

修改 PAL 使用 JSON Patch，例如变更未来使用的人格文本：

<!-- verify: request PATCH /v2/pals/{pal_id} -->
```json
[
  {
    "op": "replace",
    "path": "/system_prompt",
    "value": "你是 Kai 中文老师。先回应学生意思，每轮最多一个主要教学动作。"
  }
]
```

更新前读 GET PAL 核对 JSON Pointer 的实际形状。API 编辑直达 live 配置；不要默认存在“保存后还要 publish”的步骤，也不要为一个学生修改共享 PAL 的声音。[Patch](https://docs.tavus.io/api-reference/pals/patch-pal)、[编辑生命周期](https://docs.tavus.io/sections/conversational-video-interface/pal/editing-lifecycle)

## 14. 文档冲突与校核记录

本次下载的 OpenAPI 为 509,809 字节，声明 `openapi=3.0.3`、`info.version=1.0.0`。这不是运行服务版本号。SHA-256：

```text
6476b17a048982279fd3b25df619395f83b4e51286849af32edb19388a626662
```

对应的最小字段/类型快照与静态校核结果见 [API 契约校核记录](reference/tavus-contract-audit.json)。该文件不是 Tavus 完整规范，不用于自动生成生产 SDK。

| 发现 | 设计处理 |
| --- | --- |
| schema 仍列 `/v2/pals/{id}/publish`，但单独端点页明确标 removed/404 | 不纳入 P0 调用；只按 create/get/patch/delete 管配置 |
| PAL PATCH 的 `value` 在 schema 被声明 string 且 required，但 JSON Patch 的其他值类型与 remove 存在不一致 | 本稿只给 string replace 示例；复杂 patch 先与端点实际契约核实 |
| LLM 指南有 `default_query`，下载 schema 的 llm properties 未列 | P0 使用托管 Gemma，不依赖自定义基址或该字段 |
| Face callback 示例为 ready，GET 为 completed；新旧名称双发 | 规范化 ID 后 GET 复核，不直接套用 callback 状态 |
| 完整 utterance 可能包含未说文本，streaming speech 为累计 | 修正字幕 reducer 与证据契约，不推定已听到 |

[Publish 端点说明](https://docs.tavus.io/api-reference/pals/publish-pal)、[OpenAPI 原始来源](https://docs.tavus.io/openapi.yaml)。冲突处没有使用账号实测，故明确标为待验证，不选择某一个文档就宣称真实服务已证实。

## 15. S1 必须留下的真实 API 证据

| 验证项 | 实际操作 | 通过条件 |
| --- | --- | --- |
| 资产 | 创建/查询获准 Face；查询默认声音 | 确认正式 Face 状态与声音可解析，失败有原因 |
| PAL | 用本稿配置 create/get | 字段被接受；生效配置符合预期 |
| 会话 | 创建私有 Conversation，浏览器 join | token 生效、老师媒体到达；无 token 不能加入 |
| 逐轮规划 | 普通聊天、改语言、纠错和换题，逐轮话语进入 Pi 并发送有效后续上下文 | 每个有效回合有结果/降级，版本隔离；实际后续遵循独立通过 |
| 原生教学工具 | 明确练习请求，Gemma 发出工具调用，Pi 返回计划 | HMAC 可验证、映射正确；generate_response 的回复确实采用有效建议 |
| 结束前摘要与播放 | 正常口头结束、继续撤销、立即退出、媒体未完与旧回复事件 | 同一摘要生成回顾/卡片；工具返回不关闭；实际匹配播放后正常结束 |
| 并发 | 同一稳定 PAL 两个 Conversation 说相同文字 | conversation_id 路由隔离、合法重复不被文本全局去重 |
| 取消/超时 | Pi 规划中换题、工具超时、延迟返回，及 TTS/播放中打断 | Pi 取消/无过期写入可观察；Tavus 无旧话题迟到发声 |
| 字幕 | 累计文本、双角色、乱序、被打断完整稿 | 无重复拼接，不把未说部分写为已呈现 |
| 关闭/保存/课后 | end/get/leave/destroy、自动保存和详情读回、post-call 对账 | 同一摘要 revision/hash/记录；不勾旧框也保存授权会话记录，重复投递不重复写；共享配置保留 |
| 回调缺失 | 丢弃 callback 后用 GET/verbose 对账 | 状态可复核；缺少呈现证据保持 unknown |
| 幂等/安全 | 伪签名、重复投递、重放、过期会话与新 ID 重复写入 | 未授权零执行，重试零重复副作用 |
| 无对话/课后失败 | 无人加入、无对话、投递丢失、转写晚到 | 不虚构候选和学习记录，有界对账；卡片保持无内容/待处理 |

仅保留必要脱敏元数据和获准测试素材。字段静态校核通过不能替代上述网络与真人检查。
