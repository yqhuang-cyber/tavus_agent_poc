# Tavus × Pi：Ask Kai Free Talk POC

仓库：`tavus_agent_poc`。

2026-10-19 · 研究与需求设计阶段。

已确认使用 **Tavus 原生 full + tavus-gemma-4 实时回复 + Pi 教学规划与工具 + 已有真人老师的定制 Face**，嵌入现有对外汉语教学系统。Pi 指 [pi.dev](https://pi.dev/)，使用其 TypeScript/Node.js Agent 包，不是 Python。

- [POC PRD：产品、架构、接入、验收与实施阶段](docs/tavus-agent-poc-prd.md)
- [Free Talk 目标对照：19 项要求、缺口处理与必要验收](docs/ask-kai-freetalk-alignment.md)
- [选型研究：Tavus 可定制边界、替代路径与官方依据](docs/tavus-pi-research.md)
- [分层控制权与 API 设计：分层边界、原生工具接 Pi、请求响应、RTC 与课后回调](docs/tavus-layer-and-api-design.md)

v0.4 已修订技术术语，并逐项对齐 Ask Kai Free Talk：初始/逐轮 Pi 规划、语言与目标状态、同源口头总结、授权会话记录保存读回。保留 🔓/🔐/🔒 三类分层控制权说明。Pi 的独立规划模型待选；不再实现自定义 LLM Gateway 或 SSE。请求示例有静态契约校核记录，尚未使用账号执行真实 API。

用户已确认：已有真人老师形象、有本人授权、可以拍摄训练视频；应用交互参照本机 `ask_kai_freetalk` 项目。本设计已阅读该项目的 README、PRD、Pi 接入设计及适配代码。

本仓库当前只交付设计文档。尚未创建 Tavus 资源、上传素材、调用付费模型、部署服务或验证真人音视频效果。文档中的功能为拟实现需求，性能为待验证目标。
