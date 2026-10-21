# Tavus × Pi：Ask Kai Free Talk POC

**当前：已在 main 合入离线探针和可复用核心；Tavus 原生实时回复 + Pi 教学规划的新方案尚待接通。**

目标方案以 PRD v0.5 和 [实施方案](docs/implementation-plan.md) 为准：**Tavus 原生 full + tavus-gemma-4 生成实时回复，Pi 负责初始/逐轮教学规划、工具和总结审查**。Pi 指 [pi.dev](https://pi.dev/)，TypeScript/Node.js，两个 Pi 包锁定 1.2.0；Pi 独立规划模型/provider 待配置。现阶段可以使用 Tavus 自带 Avatar 做技术联调，真人教师 Face/Voice 仍是最终品牌验收要求。

现有 `apps/gateway/` 和 Pi/SSE 探针来自此前的自定义 LLM 方案。它们及状态、媒体、证据、资源清理核心保留在主干，但不代表原生 Tools、逐轮规划、上下文更新或 post-call 链路已实现。后续统一跟踪 [TA-01～42 task list](docs/task-list.md)；旧 M0～M3 清单仅保留离线实施记录，两套编号不能直接互认。详见 [主干合并与实现差异](docs/mainline-merge-notes.md)。

## 现有离线探针运行与验证

需要 Node >=22.19.0；完整本地媒体测试另需 ffmpeg/ffprobe：

```sh
npm ci
npm run verify:offline
```

115 项自动检查、两个并发会话各十轮合成对话已通过。场景矩阵另有 36 场、80 轮协议及程序教学状态回放通过。探针运行真正的 Pi Agent，使用显式合成模型；不调用真实 Tavus，不代表真人语音或教学语义质量通过。一键验收索引在 `.runtime/verification-latest.json`，沿其 report_directory 读取本次测试、探针、矩阵和 20 段未审核样例；每次独立 run ID/源码指纹，失败或旧报告不能整体通过。

仍可分别运行 `npm run check`、`npm test`、`npm run probe:offline`、`npm run eval:offline`、`npm run prepare:brand-review`。单独的探针/矩阵命令默认写 `.runtime/`，不替代本次完整验收索引。

现有探针的常驻启动（不是原生主链入口）：复制 `.env.example` 为 `.env`，设置随机 `OPERATOR_TOKEN`，执行 `npm run dev`。默认 fixture/offline，仅监听 localhost。完整配置、内部 API、身份与重试合同、清理和真实联调条件见 [M0 运行说明](docs/m0-runbook.md)。

只读预检：`npm run preflight` 检查配置与资源账本；加 `-- --media /本地视频路径.mp4` 检查素材元数据。默认无外部请求，只有显式 `--live-assets` 才 GET 既有 Face/Voice，按技术可用性检查；Voice 留空使用 Face 的默认声音。正式 Phoenix-4.5 训练检查另加 `--formal-assets`。配置或当前检查不满足时退出 1；报告中的未运行项继续待验。详见 [预检与并发清理交付](docs/preflight-and-resource-recovery.md)。

## 文档

- [实施方案：M1–M5 模块与 S0–S5 阶段](docs/implementation-plan.md)
- [当前 task list：TA-01～42](docs/task-list.md)
- [Free Talk 目标对照](docs/ask-kai-freetalk-alignment.md)
- [主干合并与实现差异](docs/mainline-merge-notes.md)
- [旧方案离线 task list 与实施记录](docs/implementation-task-list.md)
- [M0 离线验证报告与限制](docs/m0-offline-report.md)
- [证据、小结与 Mock 保存合同](docs/evidence-and-summary.md)
- [M2 离线增量验证报告](docs/m2-offline-report.md)
- [最新教学状态、动作约束及准备票据合同和验证](docs/teaching-policy-and-preparation.md)
- [只读配置/素材/资产预检与资源并发清理验证](docs/preflight-and-resource-recovery.md)
- [HTTP 故障、阶段计时、媒体控制及一键验收](docs/offline-control-and-verification.md)
- [连接执行、启动/清理观测与同源收尾回顾](docs/connection-lifecycle-and-review.md)
- [教学场景草案与评测限制](eval/README.md)
- [POC PRD：产品、架构、验收与实施阶段](docs/tavus-agent-poc-prd.md)
- [分层控制权与 API 接入设计](docs/tavus-layer-and-api-design.md)
- [选型研究及官方依据](docs/tavus-pi-research.md)

## 实现边界

- `apps/gateway/`：内部会话 HTTP、Pi/SSE、会话绑定、修订、取消与版本隔离。
- `packages/tutor/`：有来源的教学状态、动作约束、单个文字纠错校验、两步 Pi 执行与模型适配。
- `packages/tavus/`：REST、私有房间配置、字幕 reducer、资源账本与清理、素材/资产预检、SSE 解析。
- `packages/config/`：启动前运行配置校验及不含凭证值的检查报告。
- `packages/observability/`：普通回复单调计时和分状态统计，不含可听首响或费用估值。
- `packages/media/`：媒体控制核心与异步执行器，支持注入端口；当前使用模拟端口，未接 Daily。
- `packages/verification/`：独立运行报告、源码指纹及失败/陈旧结果校验。
- `packages/business/`：合成学习者资料、单次准备票据与 Mock 保存端口；尚未连接真实业务系统。
- `packages/evidence/`：来源证据、可撤销预览/冻结、小结及同源口头回顾控制合同。
- `tests/`、`scripts/`：协议/故障检查及二十轮离线探针。

用户已有真人老师形象、本人授权且可拍训练视频。真实 Face/Voice 创建、Daily 浏览器媒体页面、语音打断、本地停播和恢复、实际口头回顾/页面卡片、真实业务保存及品牌验收仍按 task list 后续推进。当前保存只有明确标注的内存 Mock 回执。本地合成视频仅用于预检验证，未上传真人素材、创建付费资源或部署服务。
