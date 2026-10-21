# M0 运行与联调说明

> 适用范围（2026-10-21）：本说明仅用于已保留的自定义 LLM / Pi/SSE 探针。当前目标采用 Tavus 原生实时回复与 Pi 教学规划；该原生链路仍需按 [当前 task list](task-list.md) 实现，不能仅填入 key 就视为已接通。见 [主干合并说明](mainline-merge-notes.md)。

2026-10-19（Asia/Shanghai）。这是单进程、内部操作者使用的探针服务。真实业务授权票据、浏览器/Daily 页面及真人评测按任务清单后续实施。

## 本地运行

需要 Node >=22.19.0，Pi 两个包锁定 1.2.0。安装后可以直接执行无外部调用的验证：

```sh
npm ci
npm run check
npm test
npm run probe:offline
```

受限环境可用 `npm ci --cache /tmp/askkai-npm-cache`。测试和探针会监听随机 localhost 端口；运行环境需允许本地 socket。启动脚本使用 Node 的 tsx import loader，避免 tsx CLI 的额外 IPC socket。

离线探针经过真实 Pi Agent 两次执行（动作决策、口语流），模型为显式合成 fixture。两个会话各运行十轮重复输入，解析真实 HTTP SSE 并校验隔离。报告写入忽略跟踪的 `.runtime/offline-probe.json`，不保存文本、凭证或学习记录。耗时不代表模型/真人延迟。

启动常驻服务：复制 `.env.example` 为 `.env`，将 `OPERATOR_TOKEN` 设置为至少 32 字符的随机值（例：`openssl rand -hex 32`），执行 `npm run dev`。默认只监听 `127.0.0.1:8787`。默认 `MODEL_MODE=fixture`、`TAVUS_MODE=offline`，不创建外部资源，不自动切换模型。

`npm run preflight` 可先只读检查配置和资源账本；`-- --media /absolute/path/video.mp4` 增加本地 ffprobe 元数据检查，显式 `--live-assets` 才会 GET 既有 Face/Voice。报告写入 `.runtime/preflight.json`，检查不满足退出 1；通过不代表真实通话或品牌验收通过。缺少 `.env`/操作者 token 时默认预检会正确阻止启动。细节与合成验证见 [预检报告](preflight-and-resource-recovery.md)。

## 内部探针接口

所有 `/internal/*` 需要 `Authorization: Bearer <OPERATOR_TOKEN>`。操作者 token 不应交给学生页面。该身份只允许内部选取合成 fixture，不是生产学习者认证。

| 接口 | 用途 |
| --- | --- |
| `GET /healthz` | 模式及进程存活；不代表 Tavus、模型或媒体健康 |
| `POST /internal/preparations` | 纯离线准备 Mock 资料/中文偏好，签发 60 秒单次票据，不创建房间 |
| `POST /internal/sessions`，`{"fixture":"alex"}` | 创建会话；另支持 maya/leo/nina；最多两个并发、十五分钟有效 |
| `GET /internal/sessions/:id` | 脱敏状态与每轮版本/动作/字符数；不含文本、凭证和资料 |
| `POST /internal/sessions/:id/stop`，`{"response_id":"..."}` | 取消精确回复；旧 ID 不能取消后继回复；媒体停止仍为 unknown |
| `POST /internal/sessions/:id/end` | 撤销凭证、取消 Pi、关闭并复核资源 |
| `GET/POST /internal/sessions/:id/evidence` | 操作者读取短期输入证据、按当前版本选择原文 topic/attempt |
| `GET /internal/sessions/:id/summary` | 读取冻结小结和当前保存状态；未结束时返回 409 |
| `POST /internal/sessions/:id/summary/save` | 明确保存/重试；必须匹配 summary_id 与 expected_consent_version |
| `GET /internal/resources` | 资源清理账本，不含凭证 |
| `GET /internal/metrics` | 保留会话的普通回复阶段耗时，分状态样本数与 p50/p95；无正文或凭证 |
| `POST /internal/resources/cleanup` | 对到期/待清理记录执行有限重试 |
| `POST /v1/chat/completions` | Tavus 服务间入口，模型别名 `ask-kai-pi`、`stream=true`、文本 messages |
| `POST /hooks/tavus/conversation` | 未验证通知，仅对已知资源以服务端 GET 复核，不写学习事实 |

离线模式建会话返回 `gateway_credential`，仅供操作者构造请求；真实 Tavus 模式只返回房间加入信息，凭证配置在本会话 PAL 中。Gateway 接受 `X-AskKai-Session-Key` 或相同 Bearer，双头不一致拒绝。凭证只在内存中保存 SHA-256 映射，结束或到期撤销。

结束请求默认 `{}` 不保存；离线 Mock 许可、输入来源、原文标注和显式保存流程见 [证据与小结合同](evidence-and-summary.md)。新命令 `npm run eval:offline` 可运行四类资料 × 九类本地场景的协议回放；教学质量及原 E01～E09 对齐保持未评测。

`npm run verify:offline` 可一次执行类型检查、全仓测试、探针、矩阵和 20 段中文/品牌审核材料准备。结果索引为 `.runtime/verification-latest.json`，每次运行独立目录/run ID/源码指纹；失败、缺失或陈旧报告及测试跳过均不算整体通过。详见 [HTTP/计时/媒体与验收合同](offline-control-and-verification.md)。

可先用 `/internal/preparations` 获取票据，再用 `/internal/sessions {preparation_ticket:...}` 一次兑换，不能在兑换时替换 fixture/偏好。准备与兑换均要求操作者认证，当前只支持 fixture/offline。教学状态约束、票据合同和逐轮状态验证见 [最新离线实现说明](teaching-policy-and-preparation.md)。

入站请求限制 64KiB、100 条 messages、单条 8,000 字符。Pi 输入快照最多 24,000 UTF-8 字节，每会话最多 200 次生成/修订；超过预算显式失败，当前需开启新会话，不自动总结或裁剪。忽略供应商 system 政策和 assistant 生成稿，从 user 序列规范化当前输入。服务端自己的先前生成文本以 `presentation=unknown` 放入短期上下文，不能当作已播放或学习证据。无 shell、文件或任意网络工具，Mock 资料在初始化读一次。关闭后内存上下文最迟到期后一分钟回收；资源账本单独保留。

## M0 去重/修订的暂定合同

在尚无实测稳定 request/turn ID 时，用会话内 user 历史的位置与前缀识别新增输入；同位置最后输入变化视为转写修订，先取消旧回复；历史前缀冲突返回 409。相同位置相同输入返回 `409 duplicate_turn_probe_required`，不自动重放音频或重复生成。重复的同一句话在新增 user 位置仍可执行。

已经出现过的输入修订版本若再次到达，返回 `409 stale_input_revision`，不会让旧文本复活；没有可靠版本 ID 时也无法区分“主动改回原文”和“旧请求重试”，需要真实探针解决。这是待真实探针验证的保守策略，不保证兼容 Tavus 的历史裁剪、预填 assistant 消息或取消重试形状。实际请求若有差异，先依据脱敏样本修订归属合同，再进入 M1。失败/部分回复的重试也不自动从头播放。

## 真正接入 Tavus 前

保留 `tavus-gemma-4` 为用户指定意向。只有确认供 Pi 独立调用的推理端点、鉴权和协议后才配置 `PI_MODEL_*`。没有该合同，不通过把 PAL 的 LLM 改为托管模型来绕过 Pi。`MODEL_MODE=live` 缺少任一模型参数会直接失败，不切换 fixture。

真实联调配置还需要 `TAVUS_MODE=live`、`TAVUS_API_KEY`、获准的 `TAVUS_FACE_ID`、可选 `TAVUS_VOICE_ID`、Tavus 可访问的 HTTPS `GATEWAY_PUBLIC_URL`。Tavus 真实模式拒绝 fixture 模型。环境需要允许 Tavus/模型域名出站访问；当前托管环境未配置这些凭证，网络策略也未证明这些域名可访问。主进程通过 undici 的 EnvHttpProxyAgent 保留继承的 HTTP(S)_PROXY/NO_PROXY 路径，不关闭 TLS 校验或覆盖环境 CA 信任。HTTPS 反向代理关闭 SSE 缓冲/缓存，并限制内部路由只对操作者开放。

服务端 Pi 生成一次开场，PAL 禁止动态开场，Conversation 使用 `custom_greeting`。每会话建临时 PAL，GET 复核 full 模式、Face、LLM 模型别名及基址，再创建 require_auth 的私有房间。创建成功不代表媒体就绪，状态只到 joining。真实慢速配置尚未实现；不提供只改状态的语速开关。

真人素材创建与上传暂未实施；不使用 stock Face 标记最终品牌验收通过。实测必须按 [API 设计第 15 节](tavus-layer-and-api-design.md#15-m0-必须留下的真实-api-证据) 记录：认证/请求形状、取消、两房间、字幕、回调缺失、Daily 加入与 leave/destroy、本地停播，以及 Face status/finetune_status。

生命周期指标见 `/internal/metrics` 的 lifecycle 字段；连接执行和正常收尾的注入端口合同见 [增量说明](connection-lifecycle-and-review.md)。正常收尾合同尚未绑定公开 HTTP 或 Tavus 播放事件；现有 end 继续立即退出。

## 清理与失败处理

`.runtime/resources.json` 在创建前原子写入意图，得到资源 ID 后立即保存。只保留不透明会话 ID、PAL/Conversation ID、到期时间和清理状态，文件权限 0600。此实现要求单进程和可写持久目录，不可多副本共享同一账本。

关闭会话先撤销 Gateway 凭证、取消 Pi，再 GET/必要时 POST end/再次 GET 复核 `status=ended`，最后 DELETE 临时 PAL。200 end 与 204 delete 不强制解析 JSON。每五秒检查到期资源；自动清理最多五次，仍失败则保留记录供操作者检查，不虚报释放。进程重启先校验运行配置，再尝试关闭账本内全部旧房间，有未解决资源则拒绝启动新会话。不要删除账本来跳过检查。

关闭会立即阻止后续创建步骤，并等待在途创建结果，记录迟到房间后才按上述顺序清理；不提前删 PAL。确定失败且未创建资源时可标记无待释放资源，不伪造远端 DELETE；未知结果继续隔离。坏格式、重复会话或不一致资源状态账本整体拒绝载入。

创建超时、5xx、无法解析成功响应或崩溃留下的 pending 意图，记为 `outcomeUnknown`，禁止自动重建或删除可能仍关联活动房间的 PAL。操作者需以账本 sessionId 对应的资源名在 Tavus 核对实际资源、结束已创建房间，再修复账本。当前不提供自动清除 unknown 的 API。不可因重试假设通用 Idempotency-Key 生效。

SIGTERM/SIGINT 会取消在线 Pi 并尝试清理；主进程最多等待 25 秒，未完成意图留在账本供重启对账。强制退出不能证明远端释放。Callback 只能提示 GET，未知 ID 不访问上游，限频 30/min，并限制已知 ID 查询间隔；不会把未验签 callback 视为播放或学习证据。
