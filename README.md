# Tavus × Pi：Ask Kai Free Talk POC

**当前：可交互的原生 Free Talk POC 已实现，默认启动会提供页面；真实 Tavus/模型/设备和教学质量待在用户 Mac 上联调验收。**

Tavus 原生 full / `tavus-gemma-4` 生成实时口语；Pi 负责初始/逐轮教学规划、工具及摘要审查。页面支持四位 Mock 学习者、Daily 老师视频/声音、学生麦克风、渐进字幕、文字辅助、打断、可撤销回顾、人工确认结束及 Mock 小结保存读回。当前可以使用 Tavus 自带 Face/Voice 做技术联调，正式品牌要求继续独立待验。

主干开发直接在 `main` 推进。当前方案及验收依据为 [PRD](docs/tavus-agent-poc-prd.md)、[实施方案](docs/implementation-plan.md) 和 [TA-01～42 清单](docs/task-list.md)。旧 Pi/SSE 探针保留用于回归，不承担默认实时口语。

## Mac 上打开 POC

保持 ngrok 隧道运行；已有 `.env` 不需重建。先 Ctrl+C 停止原服务，然后：

```sh
git pull --ff-only origin main
npm ci --include=dev
npm run dev
```

打开 **http://127.0.0.1:8787/**，使用 `.env` 中的 `OPERATOR_TOKEN` 登录内部演示，再点击「开始聊天」。Tavus/模型 key 不输入到页面。首次开始自动创建专用版本 PAL/工具和私有房间，之后复用共享配置；有 `live` 凭证时才创建真实通话。

完整配置、只读预检、恢复、浏览器验证及仍待实测的边界见 [原生 POC 运行说明](docs/native-poc-runbook.md)。`/healthz` 包含 `pipeline: native` 才是新入口；只看到 mode 字段时通常还运行着旧进程。

## 运行与验证

需要 Node >=22.19.0；完整本地媒体测试另需 ffmpeg/ffprobe：

```sh
npm ci
npm run verify:offline
```

133 项自动检查、两个并发会话各十轮合成对话已通过。场景矩阵另有 36 场、80 轮协议及程序教学状态回放通过。探针运行真正的 Pi Agent，使用显式合成模型；不调用真实 Tavus，不代表真人语音或教学语义质量通过。一键验收索引在 `.runtime/verification-latest.json`，沿其 report_directory 读取本次测试、探针、矩阵和 20 段未审核样例；每次独立 run ID/源码指纹，失败或旧报告不能整体通过。

仍可分别运行 `npm run check`、`npm test`、`npm run probe:offline`、`npm run eval:offline`、`npm run prepare:brand-review`。单独的探针/矩阵命令默认写 `.runtime/`，不替代本次完整验收索引。

首次离线运行可复制 `.env.example` 为 `.env` 并设置随机 `OPERATOR_TOKEN`，默认 fixture/offline，仅监听 localhost。真实通话需 `.env` 中配置 Tavus/Face/可选 Voice、Pi 独立模型及公网 HTTPS 根地址，并把两种 mode 都设为 live。`npm run dev:legacy` 保留旧探针入口，其接口和协议见 [历史 M0 运行说明](docs/m0-runbook.md)。

`npm run build:web` 构建浏览器包；`npx playwright install chromium` 后可运行 `npm run probe:web`，验证真实 Chromium 中的离线页面流程和手机布局，输出 `.runtime/web-probe.json`。它不调用真实 Tavus，也不代表真人听感通过。

只读预检：`npm run preflight` 检查配置与资源账本；加 `-- --media /本地视频路径.mp4` 检查素材元数据。默认无外部请求，只有显式 `--live-assets` 才 GET 既有 Face/Voice，按技术可用性检查；Voice 留空使用 Face 的默认声音。正式 Phoenix-4.5 训练检查另加 `--formal-assets`。配置或当前检查不满足时退出 1；报告中的未运行项继续待验。详见 [预检与并发清理交付](docs/preflight-and-resource-recovery.md)。

## 文档

- [原生 POC 本地运行与真实联调步骤](docs/native-poc-runbook.md)
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

- `apps/server/`：原生会话编排、浏览器授权、逐轮 Pi、HMAC 工具、回顾和 Mock 保存。
- `apps/web/`：Daily 媒体、字幕、控制和同源小结页面。
- `apps/gateway/`：保留的旧 Pi/SSE 回归探针。
- `packages/tutor/`：有来源的教学状态、动作约束、单个文字纠错校验、两步 Pi 执行与模型适配。
- `packages/tavus/`：REST、私有房间配置、字幕 reducer、资源账本与清理、素材/资产预检、SSE 解析。
- `packages/config/`：启动前运行配置校验及不含凭证值的检查报告。
- `packages/observability/`：普通回复单调计时和分状态统计，不含可听首响或费用估值。
- `packages/media/`：媒体控制核心与注入异步执行器；页面另实现 Daily 事件/设备适配，真机边界仍待验证。
- `packages/verification/`：独立运行报告、源码指纹及失败/陈旧结果校验。
- `packages/business/`：合成学习者资料、单次准备票据与 Mock 保存端口；尚未连接真实业务系统。
- `packages/evidence/`：来源证据、可撤销预览/冻结、小结及同源口头回顾控制合同。
- `tests/`、`scripts/`：协议/故障检查及二十轮离线探针。

页面和原生端口已实现，真实供应商创建、事件形状、Gemma 工具采纳、音视频/打断听感、自动播放完成边界、原评测基线、真实业务系统和正式品牌仍按 task list 验收。正常结束提供人工确认，不以 stopped_speaking 冒充已播放；当前保存是明确标注的内存 Mock 回执。云端验证未使用用户 Mac 的运行密钥，未创建付费通话、上传真人素材或部署服务。
