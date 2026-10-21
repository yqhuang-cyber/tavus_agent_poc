# 连接执行、生命周期观测与收尾回顾：离线交付

2026-10-20（Asia/Shanghai）。M1-01b、M3-02b、M2-03b 已完成离线合同和模拟验证，新增 21 项，全仓验收口径为 108 项。实际执行状态、时间及源码指纹以 `.runtime/verification-latest.json` 为准。没有真实供应商请求或真机审核。

## 媒体异步执行

修复 connect 失败回执被忽略、一直 connecting 且无法重连的问题。失败进入 error，可显式重连；连接期限同时覆盖 joining，media-ready 才解除期限。

`MediaExecutor` 执行核心命令并注入 `MediaPort`，没有浏览器或 Daily 依赖。默认连接期限 10 秒、适配命令期限 5 秒。验证了：

- 本地静音同步、按 epoch 定位播放目标，早于 Pi 取消和远端打断；静音失败时不启动后续连接。
- 麦克风获取按连接排队；返回的 InputLease 必须保持禁用，只有当前 epoch、ready 且许可有效时才启用。
- 退出、超时或撤权使旧请求失效；迟到输入会禁用并 stop，迟到连接会 leave/destroy。
- 每连接去重清理，等待 leave 结果或期限后尝试 destroy；leave 失败仍尝试 destroy，失败保持可见。
- 远端失败不恢复播放，旧回执不恢复会话。

适配回执只说明注入方法完成，不证明声音停止、真机或计费释放。`settled()` 是测试排空方法，若第三方永久不返回，会继续观察迟到结果；用户退出不等待该测试方法。真实适配须兑现按 epoch 静音、禁用输入不会发送以及连接句柄所有权，本轮未接 Daily。

## 启动与清理计时

认证的 `GET /internal/metrics` 新增 lifecycle。进程内单调时钟记录 startup、greeting-decision/generation、pal-create/verify、room-create、cleanup、room-end-check/request/verify、pal-delete。

startup 成功仅到 joining，失败时包括补偿等待。开场生成不代表播放；创建阶段识别资源 ID 后，加入凭证或后续启动仍可能失败。end 请求返回不证明 ended；cleanup 仅在状态符合结束/删除条件时成功，创建未知或清理未复核记为 unresolved。阶段尝试数不是实际 REST 请求数。

每阶段按 running/succeeded/failed/cancelled/unresolved 分别给出尝试数、有效样本数及 p50/p95。最多保留 1000 条，优先移除已完成旧记录，显式报告移除和丢弃数；分母仅限保留窗口。记录只有操作 ID、不透明 session ID、阶段、结果和耗时，无正文、凭证或原始异常；指标不持久化，账本仍独立持久化。可听首响和费用继续为 null。

## 同源口头回顾合同

`EvidenceJournal.preview`、`Summaries.preview` 提供可撤销的候选快照，不提前锁定证据；freeze 仍只冻结一次。冻结后版本或许可变化时拒绝把旧快照重新绑定为当前预览。

`ReviewClosing` 接收预览、获取当前预览的受信函数和 ReviewClosingPort：

1. 核对快照 ID、会话、截止版本、许可、资料和 epoch，回顾命令与卡片使用同一预览。
2. 生成完成只进入等待回执，不提前冻结或关闭；普通适配/模拟回执也不改变 presentation=unknown。
3. 默认回顾期限 15 秒，失败或超时后记录实际结果并尝试正常结束，不无限等待。
4. 最终提交再次校验。适配端必须无 await 地执行 guard → 冻结同一快照 → committed 通知，再撤销会话并清理资源。新输入、许可/资料/epoch 变化会阻止旧提交。
5. 新输入可取消回顾并继续交流，旧卡片标为 obsolete-preview，证据仍可接受新输入。立即退出或断连跳过回顾，调用独立退出端口；退出/最终提交默认最多等待 10 秒。

重复 start 合并执行，迟到结果不能复活旧回顾。空会话如实说明无可引用记录。测试使用真实 Mock 证据预览/冻结核对口头文本和最终卡片一致，未推断掌握。失败不报告资源释放成功。

这是正常收尾的注入端口合同，尚未接入 Tavus、页面或真实播放确认，也不是公开播放回调。现有 `POST .../end` 继续处理立即退出。真实适配必须落实提交边界及资源结束复核，不能将生成或 speak Promise 完成当作已听到。

## 验证

`npm run verify:offline` 串行执行类型检查、108 项测试、20 轮 Pi/SSE 探针、36 场/80 轮协议及教学状态回放、20 条中文/品牌审核材料准备。新增为媒体执行 9 项、生命周期 3 项、HTTP 指标 1 项、回顾合同 8 项；真人输出和品牌审核仍未运行。
