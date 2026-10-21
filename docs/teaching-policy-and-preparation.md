# 教学状态与准备票据：离线合同和验证

最新交付（2026-10-20）：连接执行、生命周期观测及同源回顾合同已落地，全仓验收口径为 108 项，见 [当前连接与收尾说明](connection-lifecycle-and-review.md)。本页保留其阶段记录。

2026-10-19（Asia/Shanghai）。本轮完成 M2-02 的状态/动作约束子项，以及 M1-01 的 Mock 准备票据子项；两个父任务的真实体验验收仍未完成。

## 教学状态

`packages/tutor/teaching-state.ts` 从初始中文偏好和 journal 中已接受的学生输入重算状态。供应商附带但未单独接受的历史、assistant 草稿、旧计划不写状态。已识别指令保留原文 quote、证据 ID、turn 和输入版本。

| 状态 | 已实现行为 |
| --- | --- |
| 语言 | chinese_first / chinese_only / english_support；明确的新请求覆盖旧偏好，否则保留 |
| 练习 | 默认 free_talk、无目标；明确请求进入 active；拒绝进入 declined 并清除旧请求 |
| 冷却 | 拒绝后阻止 INVITE_PRACTICE，不设任意轮数自动解除；学生明确重新请求才恢复 |
| 换题 | 清除旧练习请求；已拒绝练习的状态继续保留 |
| 纠错 | 默认 light；明确暂停切为 off，明确要求轻纠错后恢复 |
| 理解困难 | simplified / normal；只影响文本生成，不伪称 TTS 语速已改变 |
| 结束意图 | 当前输入请求结束时把主要动作校验为 CLOSE；新输入可撤销本轮结束意图，不自动关闭房间 |

每次接受输入都从有效证据重放，转写修订可以撤销旧拒绝或旧语言请求。旧回复持有自己的快照，不能读取后继轮次偏好再迟到提交。状态不写回业务长期画像，也不生成学习尝试或掌握结论。

## 明确请求识别的边界

这是 `bounded-explicit-requests`，不是通用自然语言意图分类器。支持短句、常见中文/英文礼貌前缀及句间/逗号分隔，例如：

- “只用中文”“可以用一点英语解释吗”“现在我明白了”。
- “今天只想聊天”“先不练了”“我们练习点菜吧”“我想换个话题”。
- “不要纠正我”“只帮我改一个最重要的地方”“能说得简单一点吗”。
- “今天到这里”“Please use some English”“Please don't correct me”。

常见成对引号内容，以及以已支持的“如果/比如/老师说/For example”等形式开头的句子不写偏好。复杂引用、转述、反讽、否定和未覆盖措辞仍需模型理解与真实评测；不能据当前测试宣称所有表达都已正确识别。未知措辞保留为 Pi 对话数据，不自动建立新目标或覆盖状态。覆盖不足可能使真实请求需要进一步澄清。

## Pi 生成前的动作约束

`packages/tutor/decision-guard.ts` 在当前回复版本仍有效时校验 Pi 提案，再进入口语生成；开场也经过该校验。拒绝练习时的邀请、暂停纠错时的纠错调整为 RESPOND；本轮明确结束时调整为 CLOSE。诊断记录 proposed_action、最终 action、policy_guards 和 decision_source，程序调整标为 policy-guard。

CORRECT 只允许一个结构化文字纠错对象：

```json
{
  "action": "CORRECT",
  "reason": "一个文字表达重点",
  "correction": {"kind": "wording", "quote": "三个书", "replacement": "三本书"}
}
```

quote 必须出现在当前学生输入中；quote/replacement 非空、各最多 240 字符，不能相同。不接受多个对象、pronunciation 类型、掌握评分或额外字段。缺少有效来源时不进行该纠错。一个对象是否确实只含一个教学重点，以及替代表达是否正确，仍需教研复核。

当前语言、冷却和纠错等枚举约束进入 Pi 两步的 system prompt；原始请求、练习请求摘录和纠错内容只留在 user 数据。生成只取得已接受的 action/correction，不取得内部 reason。自然度、语言遵守程度和单追问要求不能只靠动作校验证明，仍保持语义未评测。

## Mock 准备票据

`packages/business/preparation.ts` 实现纯离线、操作者认证下的准备合同：

1. `POST /internal/preparations`，例如 `{"fixture":"alex","chinese_only":true,"mock_save_allowed":false}`。
2. 返回随机 preparation_ticket、60 秒有效期、prepared 状态，以及 `media_ready=false`、`resources_created=false`。
3. `POST /internal/sessions` 仅提交 `{"preparation_ticket":"<返回值>"}`，原子兑换一次，使用准备时冻结的合成资料、许可和中文偏好。

请求仍需 OPERATOR_TOKEN，不是浏览器的生产身份入口。票据绑定受信操作者；服务端只索引 token 的 SHA-256，兑换不允许再传 fixture 或偏好覆盖。最多 16 个待用票据；过期拒绝，并发兑换只有一个成功。会话容量不足不消耗票据。关闭进程清除票据，重启不能重放。

票据一旦实际兑换，即使后续启动失败也不恢复为可重用，避免重复创建资源。当前接口仅允许 fixture/offline，不授权真实身份、Tavus 媒体或业务保存。原 `POST /internal/sessions {fixture,...}` 保留给 M0 内部探针。未实现慢速 TTS 选项。

## 验证与剩余项

2026-10-19 10:22:14（Asia/Shanghai）验证结果：

以下保留该阶段 51 项记录。预检/清理增量为 68 项；当前 HTTP 故障、计时及媒体控制增量后为 87 项，20 轮探针和 36 场/80 轮矩阵保持通过，见 [当前合同及一键验收](offline-control-and-verification.md)。

| 检查 | 结果 |
| --- | --- |
| TypeScript | 通过 |
| 全仓测试 | 51 项通过，0 失败；上一轮为 35 项 |
| 原双会话探针 | 20 轮通过 |
| 四类资料 × 九类本地场景 | 36 场、80 轮协议及程序教学状态全部通过 |
| 准备票据 | 来源/偏好绑定、过期、并发、防重放、容量与真实模式拒绝均通过 |
| 教学语义/中文听感/媒体 | 未评测或未运行 |

矩阵报告增加 teaching_state_passed 和逐场 teachingState 字段；十维语义分数仍为 null，合成模型不证明教学质量。执行 `npm run check`、`npm test`、`npm run probe:offline`、`npm run eval:offline` 复现。

仍需真实 Tavus→Pi 路径、M1 页面与 RTC、本地停播与设备释放、真实业务身份/许可、更多自然语言覆盖、真实模型教研和真人听感。原 E01～E09 与评分锚点仍未取得；本轮尝试当前 GitHub 账号下同名参考项目的只读 API 查询返回 Forbidden，未声称已读取或对齐。
