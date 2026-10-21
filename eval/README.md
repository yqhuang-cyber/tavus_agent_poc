# 离线教学场景准备

`scenarios.ts` 提供四类合成学习者 × 九类本地场景，共 36 个独立会话。场景依据 PRD T01～T10 编写，采用 `LOCAL-01`～`LOCAL-09` 编号。原项目 E01～E09 定义和评分锚点不在当前仓库，尚未导入；这些草案不能冒充原基线。

运行 `npm run eval:offline`，使用真正的 Pi 执行与合成模型，验证场景可回放、SSE 可完成、结束后小结具有输入来源、没有自动记练习或自动保存；每轮还对照 `expectedTeachingStates` 检查程序语言、练习、纠错、理解及结束意图状态。该脚本验证协议与程序状态合同，不评定自由文本质量。合成模型固定回应，不用于评定真实教学能力；报告中的 `semanticReview=not-run`，十维分数保持 null。

十维名称沿用 PRD：intent、correctness、instructions、level、expression、continuity、progress、personalization、persona、safety。将来导入原评分锚点后，用获准模型输出和独立教研复核填写，不能为了本方案通过而另定宽松分数。现有场景 `review` 字段只列待观察的行为，不替代原评分标准。

报告保存在 `.runtime/eval-offline.json`，包含场景 ID、protocol/teachingState 结果、空评分和待验证标记，不保存模型回复或运行凭证。语音听感清单也在 `scenarios.ts`，全部待真人真机运行。脚本默认且仅使用 fixture，不接收真实模型/供应商模式开关。

`brand-samples.ts` 另提供 20 条中文/品牌人工样例。运行 `npm run prepare:brand-review` 生成 JSON/Markdown，固定朗读和学生刺激分开，所有真人结果及品牌结论默认未运行；不自动生成媒体或评分。

`npm run verify:offline` 可串行运行完整离线验收。应沿 `.runtime/verification-latest.json` 的 report_directory 读取本次矩阵和审核材料；每次独立 run ID，不复用单跑命令留下的旧报告。口径见 [验收说明](../docs/offline-control-and-verification.md)。
