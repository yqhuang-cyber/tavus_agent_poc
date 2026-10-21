# 主干合并与实现差异

2026-10-21（Asia/Shanghai）。本 POC 采用主干开发；将 `work` 的离线实现合入 `main`，保留主干已有 PRD v0.5、实施方案和 TA-01～42 清单。合并代码不表示两套运行架构已经完成迁移或真实联调。

## 当前方案与已有代码

| 范围 | 当前原生方案 | 本次合入的已有实现 |
| --- | --- | --- |
| 实时口语 | Tavus full / `tavus-gemma-4` | `apps/gateway/` 使用 Pi 决策、Pi 生成口语，再转成兼容 SSE；属于此前方案的探针 |
| Pi 职责 | 初始/逐轮教学规划、受控工具、总结审查 | 独立模型适配、程序教学状态和动作约束已做离线验证；原生规划协调器和工具接入未实现 |
| 供应商编排 | 原生事件、Tools API/HMAC、上下文更新、post-call | REST 资源创建/关闭/复核与持久清理账本；未接原生工具或逐轮事件 |
| 媒体与字幕 | Daily 浏览器采播、原生打断、播放状态 | 字幕 reducer、媒体控制和异步执行器；仅注入端口及模拟适配，无 Daily 页面 |
| 资料与总结 | 授权资料、同源口头/卡片、会话记录保存读回 | 合成资料、证据快照、可撤销回顾合同及内存 Mock 保存；原生朗读和业务记录端口待实现 |
| 验收 | TA-01～42、G01～G06、原内容/真人/设备要求 | 108 项离线检查、两会话 20 轮、36 场景 80 轮协议/状态回放；不是原生或真人验收 |

后续以 [实施方案](implementation-plan.md)、[当前 task list](task-list.md) 和 [PRD](tavus-agent-poc-prd.md) 为准。旧 [实施记录](implementation-task-list.md) 的 M0～M3 只是历史任务编号，不等同于当前 M1～M5 职责模块或 S0～S5 实施阶段。迁移时逐项核对交付物、覆盖与证据，再更新 TA 状态。

## 运行边界

`npm run verify:offline` 继续验证现有代码，包括真实 Pi 框架配合确定性合成模型的 SSE 探针；所有真实模型、Tavus、媒体、教学语义和品牌结果保持未运行/未评测。最新结果沿 `.runtime/verification-latest.json` 的 run ID、源码指纹和产物哈希读取。

`npm run dev` 当前仍启动旧 Gateway；默认 `.env.example` 使用 fixture/offline。其 `live` 模式依然执行自定义 LLM 配置，不会因主干合并自动变成原生方案。完整原生链路的启动入口、工具、逐轮规划和浏览器适配需要继续实施。

Tavus 账户 key 和 Pi 独立规划模型 key 分开配置。Tavus 托管的 `tavus-gemma-4` 不要求提供给 Pi 的独立推理接口；Pi 的模型名称、Base URL 和 key 应来自实际可调用的 provider。`.env`、运行报告、账本和依赖目录继续忽略提交。

先行技术联调可按用户选择使用 Tavus 自带 Avatar/声音；这不替代最终真人品牌验收。本次合并不创建或修改远端 Tavus 资源，不启动付费通话或部署。
