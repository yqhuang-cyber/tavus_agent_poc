# Tavus 分层控制权与 API 接入设计

2026-10-18 · v0.2 技术设计附件 · 属于 [POC PRD](tavus-agent-poc-prd.md) 的实现依据。

本文重新核对官方分层文档、集成指南和完整 [OpenAPI](https://docs.tavus.io/openapi.yaml)，明确实际端点与协议。本次只下载公开资料、校核请求示例，没有使用 Tavus 账号执行创建、训练或通话。请求和响应中的 ID、域名、凭证均为示意。

## 1. “可以配置”和“可以替换实现”是两件事

需要区分三个级别：调参数；切换厂商支持的模型/供应商；把整个实现换成我们的服务。Tavus 的各层并非都达到第三种开放程度。

下面采用三种标记：**🔓 完全可换、🔐 部分可换、🔒 底层实现锁定**。判断以当前主方案“full + 自定义 Pi Gateway”为基准，另注明切换 Echo/第三方集成后的变化。“完全可换”仍需满足接口合同；“锁定”指公开接口不允许替换底层实现，不等于该能力必须启用。一个组件的形象、参数与算法可能属于不同类别。

### 1.1 🔓 完全可换：我们决定实现，通过接口接入

| 组件 | 可以怎样换 | 对本 POC 的含义 |
| --- | --- | --- |
| LLM / Agent 后端 | 用自定义兼容 chat completions + SSE 服务替换托管 LLM | Tavus 调用我们的 Pi Gateway；模型选择、教学与工具循环由我们控制 |
| 页面 UI | 自己实现视频、字幕、表达卡和控制按钮 | 沿用 Ask Kai Free Talk 体验，不必使用 Tavus 默认页面 |
| 业务工具的实现 | Pi 内注册自己的受控工具；也可按需接 Tavus 的工具/MCP 协议 | 业务权限、资料查询、学习记录与回执由我们管理；不是任意工具自动获准 |
| 我们侧的知识检索与长期记忆 | 在 Pi Gateway/业务服务中自行实现，不使用 Tavus 对应内置服务 | 课程检索、学习者记忆与证据可独立选型；不是替换 Tavus 内置检索器内部算法 |
| 我们侧的教学目标与校验 | 用自己的状态、规则和证据管理目标推进 | 不依赖 Tavus Objectives 的完成判断来认定学生掌握 |

LLM 自定义接入的关键配置是 `model`、`base_url`、`api_key`，可另加 `headers`；`extra_body` 只补充请求参数，不能代替后端地址。模型厂商的原生 API 若不兼容该协议，应通过 Pi Gateway 适配，不能只填写厂商 key 就假定可直连。[LLM 官方合同](https://docs.tavus.io/sections/conversational-video-interface/pal/llm)

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
| 🔓 | LLM / Agent | 选托管模型，或设 `model/base_url/api_key/headers` | **可以接兼容 chat completions + SSE 的后端** | Pi Gateway 实现协议转换 | 我们：教学、模型与工具；Tavus：发起请求和消费输出 |
| 🔐 | STT / ASR | `layers.stt.stt_engine` 选厂商支持的识别引擎，配 hotwords | 当前公开 schema **没有任意 STT URL/自定义识别服务接口** | 外部 ASR 后用 Echo/集成链路 | A 路线由 Tavus 执行识别 |
| 🔐 | TTS | 选 `tavus-auto/cartesia/elevenlabs/azure`，配置声音、供应商 key 和部分语速 | **支持指定供应商的 BYO 声音/账号；不等于任意 TTS HTTP 接口** | 外部生成音频，用 audio Echo 或集成链路驱动 Face | A 路线由 Tavus 调度受支持 TTS |
| 🔐 参数；🔒 算法 | Conversational Flow | Sparrow 模型选择、等待耐心、打断程度、idle engagement | 当前没有自定义 VAD/轮次服务端点 | 外部 VAD/端点检测/取消，配 Echo/外部媒体框架 | A 路线 Tavus 管媒体轮次，我们管业务轮次与取消 |
| 🔐 配置；🔒 模型 | Perception | Raven、查询、工具触发，或 `off` | 当前没有把 Raven 替换为任意感知 URL 的字段 | 关闭 Raven，在我们侧做视觉理解并决定如何提供上下文 | P0 关闭；未来另行接入 |
| 🔐 资产；🔒 模型 | Face / Phoenix | 选 Phoenix 版本；用真人素材创建 Face | 不能通过这些 API 替换成我们自己的渲染模型/3D 引擎 | 若仍选 Tavus Avatar，此层继续用 Tavus | Tavus；我们选择资产、版本并验收 |
| 🔐 | RTC / transport | 原生 CVI 使用 Daily；也有官方 LiveKit、Pipecat、Agora 集成 | 不是在 full PAL 上填写任意 transport URL 即可替换 | 切换整条集成路径，使用对应框架 SDK | A 路线 Daily；B 路线可改 |
| 🔓 | UI | 自己渲染视频、字幕和教学卡，或用厂商 UI | 可以自行实现 | Daily JS / 自有页面代码 | 我们 |
| 🔓 自有实现；🔐 内置服务 | 记忆、RAG、目标与业务工具 | Tavus 提供现成能力，也可以由后端管理 | 可以放在 Pi/业务服务；不能假设工具完全同一协议 | 自己维护资料、证据、检索与授权 | 我们，避免重复写入 |

一手依据：[LLM](https://docs.tavus.io/sections/conversational-video-interface/pal/llm)、[STT](https://docs.tavus.io/sections/conversational-video-interface/pal/stt)、[TTS](https://docs.tavus.io/sections/conversational-video-interface/pal/tts)、[Flow](https://docs.tavus.io/sections/conversational-video-interface/pal/conversational-flow)、[Perception](https://docs.tavus.io/sections/conversational-video-interface/pal/perception)。表中“没有接口”限于本次公开文档/schema；不推断企业私有协议或未来能力。

**Tavus 必须控制什么，取决于接法。** 使用 full pipeline 时，Tavus 控制识别、端点检测、TTS 调度、渲染与媒体编排；我们通过公开配置和事件影响它。只使用其 Avatar 时，可把 ASR、Agent、TTS、VAD 和 RTC 移出去，Tavus 仍承担 Face 的音视频生成与同步。不能一边替换整条语音链，一边承诺继续保有完整 Sparrow/Raven 能力。

我们必须保有：学生身份与数据授权、教学策略、状态版本、Pi 工具权限、学习证据和业务回执。这些是产品职责，不因 Tavus 的内置功能而自动转移。

## 2. 两条架构的实际差异

### A：保留 Tavus full，自定义 LLM 接 Pi（主方案）

```text
学生麦克风 → Daily/CVI → Tavus STT + Sparrow
                                 ↓
                     我们的 /v1/chat/completions
                                 ↓
                      Pi 决策、工具和回复生成
                                 ↓ SSE 文本
                       Tavus TTS → Phoenix
                                 ↓
                       学生听到声音、看到老师
```

这不是在 Tavus 内运行 Pi，而是 Tavus 把自定义 LLM 请求发给我们。Pi 在自己的 Node.js 服务运行。保留完整媒体链的同时，我们控制教学与文本；原始音频识别与朗读质量仍依赖 Tavus 所支持的服务。

### B：自控语音链，Tavus 只呈现老师（正式备选）

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

[Pipeline Modes](https://docs.tavus.io/sections/conversational-video-interface/quickstart/pipeline-modes)、[LiveKit 集成](https://docs.tavus.io/sections/integrations/livekit)、[Pipecat 集成](https://docs.tavus.io/sections/integrations/pipecat)。这些是不同接入合同，不能混用 SDK 或认为只改 `pipeline_mode` 就得到完整第三方集成。PAL 的该枚举在当前 schema 中只有 `full`、`echo`。

## 3. API 分为三个方向

| 方向 | 基址/通道 | 凭证与用途 |
| --- | --- | --- |
| 我们服务端 → Tavus | `https://tavusapi.com/v2/...` | `x-api-key: TAVUS_API_KEY`；创建资产、配置和会话 |
| Tavus → 我们服务端 | `https://<gateway>/v1/chat/completions`、回调地址 | Gateway 专用凭证/额外 headers；不能复用 Tavus 主 key 当业务身份 |
| 浏览器 ↔ 实时房间 | 返回的 `conversation_url` + Daily JS/WebRTC | 私有房间 `meeting_token`；音视频和 `sendAppMessage` |

REST 用于资源与生命周期，不承载逐帧视频。实时说话/打断事件通过房间数据通道传递，不应虚构 `POST /v2/conversations/{id}/speak` 或 `/interrupt` REST 端点。[鉴权](https://docs.tavus.io/api-reference/authentication)、[交互协议](https://docs.tavus.io/sections/conversational-video-interface/interactions-protocols/overview)

Tavus 主 key 只保存在服务端。浏览器取得自己房间的加入信息，不取得主 key、文本模型 key、Gateway 凭证或训练素材签名 URL。

## 4. 本 POC 真正需要的 REST 接口

下表方法、路径与成功状态已经核对下载的 OpenAPI。没有列出的参数不表示禁止使用，但新增时需重新校验。

| 用途 | 方法与路径 | 成功响应与调用时机 | 是否 P0 |
| --- | --- | --- | --- |
| 创建真人 Face | `POST /v2/faces` | `200`，`face_id/status`；素材制作时一次 | 必须 |
| 查询 Face | `GET /v2/faces/{face_id}` | `200`，状态、调优状态、默认声音；等待可用/审核时 | 必须 |
| 列出 Face | `GET /v2/faces` | `200`；发现 stock/既有资产，排错或对账 | 辅助 |
| 创建 PAL | `POST /v2/pals` | `200`，`pal_id`；P0 每会话一份临时配置 | 必须 |
| 查询 PAL | `GET /v2/pals/{pal_id}` | `200`；核对实际生效配置 | 必须 |
| 创建 Conversation | `POST /v2/conversations` | `200`，ID、URL；私有房间附 token | 必须 |
| 查询 Conversation | `GET /v2/conversations/{conversation_id}` | `200`；`?verbose=true` 可取附加事件 | 必须 |
| 结束 Conversation | `POST /v2/conversations/{conversation_id}/end` | `200`，无规定业务 JSON；正常关闭 | 必须 |
| 清理临时 PAL | `DELETE /v2/pals/{pal_id}` | `204`，无 JSON；会话结束并完成所需对账后 | 必须 |
| 单独创建声音 | `POST /v2/voices`、`GET /v2/voices/{voice_id}` | 创建 `200` 后需等声音 `completed` | 可选；视频 Face 已产生默认声音 |
| 更改 Face 默认声音 | `PATCH /v2/faces/{face_id}` | `200`；JSON Merge Patch | 可选，资产管理用途 |
| 更改 PAL | `PATCH /v2/pals/{pal_id}` | `200/304`；JSON Patch 数组 | 可选，受控运维；不用它跨学生切配置 |
| Tavus 工具注册与关联 | `POST /v2/tools`、`POST /v2/pals/{pal_id}/tools` | `200`；独立工具注册表 | P0 不需要，详见第 11 节 |
| 删除会话数据 | `DELETE /v2/conversations/{conversation_id}` | `204`；破坏性数据删除用途 | 不用于日常结束 |

第一行的 P0 为“必须，但不是每次通话重训”。Face、Voice 为共享老师资产；PAL、Conversation 为会话资产。视频生成 API、已弃用 `/v2/lipsync`、部署 widget/landing-page API 均不是本 POC 核心依赖。

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

## 6. 建 PAL：接 Pi 并确定各层配置

<!-- verify: request POST /v2/pals -->
```json
{
  "pal_name": "Ask Kai session <opaque-session-id>",
  "pipeline_mode": "full",
  "default_face_id": "<approved-face-id>",
  "system_prompt": "你是 Kai 中文老师。中文优先，按需短英文。遵守本会话教学规则，不把猜测写成学习结论。",
  "greeting": "",
  "dynamic_greeting": false,
  "languages": ["zh", "en"],
  "layers": {
    "llm": {
      "model": "ask-kai-pi",
      "base_url": "https://gateway.example.com/v1",
      "api_key": "<session-gateway-credential>",
      "headers": { "X-AskKai-Session-Key": "<session-gateway-credential>" },
      "speculative_inference": false
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

`base_url` 是基址，不填成 `.../v1/chat/completions`；Tavus 按协议调用该基址下的 `/chat/completions`。模型名 `ask-kai-pi` 是我们的路由别名，不是 Tavus 已内置模型名。

会话凭证在创建 PAL 前生成，服务端只保存其安全映射到 session_id。额外 header 是明确文档化的接口，作为会话身份绑定；`api_key` 也按兼容后端要求配置。M0 抓取脱敏请求验证实际头部、认证及取消行为；不假设存在未文档化的 conversation ID 请求头。凭证需覆盖预计通话时长并可由我们立即撤销。[自定义 LLM](https://docs.tavus.io/sections/conversational-video-interface/pal/llm)

声音有两种配置方式，二选一：

- Tavus Voice：`voice_id`，不同时发送 `external_voice_id` 或自己的 TTS `api_key`。
- 指定外部供应商：`tts_engine + external_voice_id + 可选供应商 key + tts_model_name/voice_settings`，不再发送 `voice_id`。Azure 等引擎还有专门限制。

本例使用 Tavus Voice，便于先验证本人声音；固定外部引擎和模型是另一份试验配置。不是把二者字段全叠在同一个 PAL。[TTS 配置](https://docs.tavus.io/sections/conversational-video-interface/pal/tts)

## 7. 建 Conversation 并加入页面

### 7.1 服务端创建私有会话

<!-- verify: request POST /v2/conversations -->
```json
{
  "pal_id": "<session-pal-id>",
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

示例偏好、开场和超时均为本项目设计值，实施时由授权快照/配置生成。`properties.languages` 覆盖 PAL 的语言集合，不是合并。`audio_only=false` 保留老师视频；学生摄像头关闭是客户端选择，不应因此设成纯音频会话。

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
});

call.sendAppMessage({
  message_type: 'conversation',
  event_type: 'conversation.respond',
  conversation_id: session.conversation_id,
  properties: { text: '我今天想聊足球。' },
}, '*');
```

`respond` 将文字作为学生输入触发回复；普通麦克风交流由媒体链自动识别，不需把同一句 ASR 文本再发一次 respond。后者会造成重复输入。`'*'` 是房间广播目标，不表示该消息经过业务服务端授权。[Tavus 交互示例](https://docs.tavus.io/sections/conversational-video-interface/interactions-protocols/overview)、[Daily join](https://docs.daily.co/reference/daily-js/instance-methods/join)、[Daily sendAppMessage](https://docs.daily.co/reference/daily-js/instance-methods/send-app-message)

## 8. Tavus 调用 Pi Gateway 的协议

我们需提供服务间接口 `POST https://gateway.example.com/v1/chat/completions`。该路径是我们实现的，不属于 Tavus REST API。

下面请求为兼容协议的预期最小形状，**完整入站 body/头部需 M0 真实探针确认**。官方公开 OpenAPI 没有完整描述 Tavus 作为客户端发给自定义 LLM 的每一个字段。

```http
POST /v1/chat/completions HTTP/1.1
Content-Type: application/json
X-AskKai-Session-Key: <session-gateway-credential>

{"model":"ask-kai-pi","stream":true,"messages":[{"role":"system","content":"..."},{"role":"user","content":"我喜欢足球。"}]}
```

我们提供的响应合同为兼容 SSE：

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

Pi 内部流程：认证解析会话 → 规范化当前输入 → 冻结状态 → 有界教学决策与工具 → 生成口语文本 → 转成 `delta.content`。Pi 的工具事件、计划 JSON、推理过程不直接透传到 Tavus。P0 不声明需要 Tavus 执行同一套 Pi 工具。

取消时同时停止 SSE 写入和 Pi/模型请求，递增响应版本；不能把 HTTP stream close 当作 Pi 已取消的充分证据。Tavus 的实际重试、取消传播、自动填充文本和错误恢复都列入 M0 实测，不从“兼容”两个字推导保证。

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
  "properties": { "context": "学生本轮明确要求只用中文；撤销之前的英文支架。" }
}
```

`context` 是字符串，自己的状态版本仍由服务端管理。公开事件不等于存在带我们版本号的应用确认；没有实测 ACK 时只记录已请求，不虚报已对本句生效。

## 10. 结束、回调、状态复核

### 10.1 正常退出的调用顺序

1. 业务服务置 closing，取消在线 Pi 生成；页面停止采音/播放。
2. 服务端调用 `POST /v2/conversations/<id>/end`，期望 `200`，不强制解析 JSON body。
3. 页面 `await call.leave()` 并 `await call.destroy()`；即使服务端请求失败，也必须释放本地设备。
4. `GET /v2/conversations/<id>` 复核状态；未结束则有限重试并进入清理队列。
5. 按许可读取 `?verbose=true` 事件补充对账，完成所需资产关联后撤销 Gateway 凭证、删除临时 PAL，期望 `204`。

服务端保存资源 ID 后再给浏览器加入信息，以便浏览器突然退出也可清理。不在每次退出删除 Face/Voice 或调用破坏性 DELETE Conversation。

### 10.2 普通会话 callback

接收端是我们实现的 `POST /hooks/tavus/conversation`。至少处理 `system.pal_joined`、`system.shutdown`、`application.transcription_ready`。`system.replica_joined` 是前者旧别名，需去重。

实时 app-message 的 timestamp 通常为 Unix 数字；普通 callback 的顶层 timestamp 示例为 ISO 字符串，不能复用一个强类型解析函数后静默丢事件。转写条目中角色使用 `assistant/user`，与实时 `pal/user` 也不同。

本次没找到普通 callback 的统一签名配置保证。因此普通 callback 只作待核实通知，使用服务端 key 查询该资源；对未知 ID 不无限发查询。记录允许的会话映射，限制消息大小和频率。

`application.transcription_ready` 在会话结束后提供 transcript，也可从 `GET ...?verbose=true` 的 events 读取。它是供应商保存的对话历史，不能替代真实音频/客户端呈现证据；根据自己的许可处理与留存，不默认存进业务库。[Callbacks](https://docs.tavus.io/sections/webhooks-and-callbacks)、[Get Conversation](https://docs.tavus.io/api-reference/conversations/get-conversation)

Face 的新旧 callback 可能分别以 face_id、replica_id 双发，同一个 ID/status 只触发一次复核。声音 callback 有专门 `application.voice_status_changed`，与 Face 的回调形状也不同。

## 11. Tavus 自带工具 API：可以接，但 P0 不重复建设

主方案的教学工具在 Pi Gateway 内执行，Tavus 仅接收最终口语流，所以 **P0 不必注册 Tavus 工具、MCP、Knowledge Base 或 Objectives**。这不表示 Tavus 没有这些能力，而是避免形成两套教学决策和写入路径。

未来若要由 Tavus 触发视觉工具、厂商系统工具或独立后处理，使用新工具注册表，不能继续抄旧 `layers.llm.tools` 内联示例：

<!-- verify: request POST /v2/tools -->
```json
{
  "name": "lookup_teaching_hint",
  "description": "Read a vetted teaching hint for an approved expression.",
  "parameters": {
    "type": "object",
    "properties": { "expression": { "type": "string" } },
    "required": ["expression"],
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
  "on_resolve": "add_to_context"
}
```

工具创建返回 `tool_id`，随后关联 PAL：

<!-- verify: request POST /v2/pals/{pal_id}/tools -->
```json
{ "tool_ids": ["<tool-id>"] }
```

这是可选能力示例，不声明已验证其与我们自定义 LLM 循环的全部交互。启用前需专项联调请求中的工具定义、调用结果及取消，不能同时让 Pi 和 Tavus 重复执行相同写入。

API delivery 的工具回调明确支持 HMAC-SHA256，header 为 `X-Tavus-Signature`；对**原始请求字节**计算 hex digest 并做恒定时间比较。不能先 JSON.parse 再重新序列化验签。它使用固定 envelope，arguments 是 JSON 字符串；body_template/query 模板在该模式被忽略。

HMAC 证明正文完整性和共享密钥持有者身份，不自动提供新鲜度。按 conversation/tool_call_id 校验会话归属与幂等，拒绝过期会话写入。工具 API 的 5xx/连接错误有文档化的一次重试；这个规则不能套到普通 callback 或自定义 LLM 请求。使用 app-message 交付工具时还有 4 KB 限制，超大参数可能丢失。[工具 API](https://docs.tavus.io/api-reference/tools/create-tool)、[Tool Delivery](https://docs.tavus.io/sections/conversational-video-interface/pal/llm-tool-delivery)、[Tool Auth](https://docs.tavus.io/sections/conversational-video-interface/pal/llm-tool-auth)

## 12. 备选 Echo 的真实调用形状

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

schema 将 audio 描述为 PCM 或流水线特定编码，未完整固定所有位深/声道/分片约束。M0 必须以实际所选路径核实，不能仅凭 sample_rate=16000 猜成现有豆包 PCM 格式。控制消息和 base64 开销还受数据通道限制；持续音频更适合评估官方媒体 SDK，别把任意长音频塞成一个 app-message。[Echo 协议](https://docs.tavus.io/sections/event-schemas/conversation-echo)

## 13. 幂等、错误和配置更新

| 情况 | 实现要求 |
| --- | --- |
| REST `400` | 修复字段/资源状态后重试，不原样循环 |
| REST `401` | 核对服务端 Tavus key，停止新建；不向前端泄露 key |
| `429/5xx` 或网络超时 | 有界退避；仅在相应端点实际返回时分类，不能把未知状态视为确定失败 |
| 创建资源响应丢失 | 官方未在本次 schema 中给出通用 Idempotency-Key 保证；置 outcome_unknown，以业务创建账本和资源查询对账后决定重试 |
| `end` 返回 `200` | 不强制解析 JSON；查询/回调复核远端状态 |
| DELETE 返回 `204` | 按无正文处理；已删除/不存在的具体错误按实测合同归类 |
| PAL PATCH `409 maker_changes` | 保留冲突给运维，不自动 `force=true` 覆盖人工草稿 |
| 已启动输出后 SSE 出错 | 标 partial、取消后续输出；不能自动重播整个答案 |

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

对应的最小字段/类型快照与静态校核结果见 [API 合同校核记录](reference/tavus-contract-audit.json)。该文件不是 Tavus 完整规范，不用于自动生成生产 SDK。

| 发现 | 设计处理 |
| --- | --- |
| schema 仍列 `/v2/pals/{id}/publish`，但单独端点页明确标 removed/404 | 不纳入 P0 调用；只按 create/get/patch/delete 管配置 |
| PAL PATCH 的 `value` 在 schema 被声明 string 且 required，但 JSON Patch 的其他值类型与 remove 存在不一致 | 本稿只给 string replace 示例；复杂 patch 先与端点实际合同核实 |
| LLM 指南有 `default_query`，下载 schema 的 llm properties 未列 | P0 不依赖它；使用已核对的 headers/基址 |
| Face callback 示例为 ready，GET 为 completed；新旧名称双发 | 规范化 ID 后 GET 复核，不直接套用 callback 状态 |
| 完整 utterance 可能包含未说文本，streaming speech 为累计 | 修正字幕 reducer 与证据合同，不推定已听到 |

[Publish 端点说明](https://docs.tavus.io/api-reference/pals/publish-pal)、[OpenAPI 原始来源](https://docs.tavus.io/openapi.yaml)。冲突处没有使用账号实测，故明确标为待验证，不选择某一个文档就宣称真实服务已证实。

## 15. M0 必须留下的真实 API 证据

| 探针 | 实际操作 | 通过条件 |
| --- | --- | --- |
| 资产 | 创建/查询获准 Face；查询默认声音 | 确认正式 Face 状态与声音可解析，失败有原因 |
| PAL | 用本稿配置 create/get | 字段被接受；生效配置符合预期 |
| 会话 | 创建私有 Conversation，浏览器 join | token 生效、老师媒体到达；无 token 不能加入 |
| Pi 回调 | 学生说中文，记录脱敏入站形状及 SSE | 请求到达正确 Pi 会话，最终只有可朗读文本 |
| 并发 | 两份临时 PAL/凭证同时说相同文字 | 身份和状态互不混用，合法重复不被全局去重 |
| 取消 | 在 Pi 生成中、TTS 缓冲中、老师播放中分别打断 | 停播、Pi 取消、迟到隔离分别可观察 |
| 字幕 | 累计文本、双角色、乱序、被打断完整稿 | 无重复拼接，不把未说部分写为已呈现 |
| 关闭 | end/get/leave/destroy/delete PAL | 远端结束、本地设备释放、临时资源清理有回执 |
| 回调缺失 | 丢弃 callback 后用 GET/verbose 对账 | 状态可复核；缺少呈现证据保持 unknown |
| 可选 B | echo text 与 audio 各一段 | 证实 TTS 控制边界、编码、分块与取消；未做则维持备选未验证 |

仅保留必要脱敏元数据和获准测试素材。字段静态校核通过不能替代上述网络与真人检查。
