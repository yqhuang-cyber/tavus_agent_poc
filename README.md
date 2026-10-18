# Tavus × Pi：Ask Kai Free Talk POC

2026-10-18 · 研究与需求设计阶段。

推荐使用 **Pi 教学 Agent + Tavus CVI 自定义 LLM 接口 + 已有真人老师的定制 Face**，嵌入现有对外汉语教学系统。Pi 指 [pi.dev](https://pi.dev/)，使用其 TypeScript/Node.js Agent 包，不是 Python。

- [POC PRD：产品、架构、接入、验收与实施阶段](docs/tavus-agent-poc-prd.md)
- [选型研究：Tavus 可定制边界、替代路径与官方依据](docs/tavus-pi-research.md)
- [分层控制权与 API 设计：实际端点、请求响应、SSE、RTC、回调及 Echo](docs/tavus-layer-and-api-design.md)

v0.2 已重新核对完整官方 OpenAPI，区分“调参数”“切换支持的供应商”和“接任意自定义实现”，并补充请求示例及静态合同校核记录。尚未使用账号执行真实 API。

用户已确认：已有真人老师形象、有本人授权、可以拍摄训练视频；应用交互参照本机 `ask_kai_freetalk` 项目。本设计已阅读该项目的 README、PRD、Pi 接入设计及适配代码。

本仓库当前只交付设计文档。尚未创建 Tavus 资源、上传素材、调用付费模型、部署服务或验证真人音视频效果。文档中的功能为拟实现需求，性能为待验证目标。
