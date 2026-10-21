# 学习证据、小结与 Mock 保存

2026-10-19（Asia/Shanghai）。M2-03 的离线核心已实现；实际口头回顾播放、页面卡片和真实业务写入仍待后续阶段。

## 证据与截止版本

`packages/evidence/journal.ts` 只接收 Gateway 已接受的当前学生输入，关联 session、response、turn、epoch、状态版本、资料版本与许可版本。供应商历史里没有单独接受过的旧输入不补录为新事实；小结遇到缺口保持 partial。

同一 turn 的新转写版本替换旧证据 ID。旧 ID 的标注随之失效，不能从旧文本生成新卡片。结束、到期、失败或服务关闭时冻结一次快照，快照 ID 和 cutoffVersion 不再改变；后续重复结束不会生成另一版小结。

Gateway 无法可靠区分 Tavus 发来的语音转写与辅助文字，因此真实模式下输入 modality 保持 unknown。只在纯离线 fixture 模式下允许请求带 `input_modality=text/audio_transcript/unknown`，用于模拟输入来源；它不是生产来源认证机制。

操作者可以在未结束会话中从当前有效证据选取 `topic` 或 `attempt`。quote 必须是来源中的原文片段、最多 120 个字符；不接受任意话题标签、掌握程度或发音评分。该接口需要操作者认证、当前状态版本和许可版本，不开放给模型自由写入。

文字来源的标注记为 `typed_attempt`，只表示文字表达尝试；ASR/unknown 标注保留为 `transcript_candidate`，不计入已核验的口语练习。两者均为 not_assessed、pronunciation=unverified。老师计划、生成稿、字幕和未验签 callback 没有写学习事实的入口。

## 同源的两种小结数据

`packages/evidence/summary.ts` 从冻结快照生成结构化卡片数据和 `oralReview` 草稿，二者共享相同来源 ID、quote、输入版本和 cutoffVersion。没有调用模型概括或自评分：topics 是操作者选取的原文，未选取时展示最近五条输入的可引用片段。

没有已标注的文字尝试时说明“本次以交流为主”，转写候选另列；没有输入则说明“本次没有可引用的交流记录”。缺少输入、部分回复、异常结束或 unknown 来源都维持 partial。complete 仅指已记录文字输入的覆盖完整，不能解释为真实通话、媒体呈现或教学效果完整。

`oralReview` 目前只返回草稿，不自动插入在线 Pi/SSE/TTS。点击结束仍先取消生成并清理资源，不强迫播完小结。页面卡片、正常口头收口和实际播放确认留在 M1/M2 联调阶段。

## 保存许可与回执

资料默认 `saveAllowed=false`。仅在纯 fixture 离线模式中，操作者创建会话可指定 `mock_save_allowed=true`，模拟已授权资料。它不能在真实 Tavus/模型模式里授权业务保存，不能代替生产身份/许可服务。

资料许可和本次保存选择必须同时满足。结束默认不保存；明确选择保存时还要提供当前许可版本。请求提交前、实际 Mock 内存提交前以及回执返回后均复核许可、资料/状态版本、epoch、截止版本和会话是否回收；超过会话到期后一分钟也拒绝新提交。

幂等键由 session、快照 ID、许可版本生成。同一保存任务并发请求共享任务；失败后重试使用同一个键。模拟存储已经写入但回执丢失时先显示“未收到保存回执”，重试取得原回执，不重复写入。

| save.status | 含义 |
| --- | --- |
| not_requested | 没有本次保存选择 |
| pending | 等待实际端口回执，不显示已保存 |
| saved | 已收到匹配会话、快照、许可版本和幂等键的真实 Mock 回执 |
| denied | 当前许可或版本不允许继续提交，不据此断言此前数据已删除 |
| failed | 没有有效回执；底层结果可能未知，可按原幂等键重试 |

已确认的历史保存不会因为后来许可改变而被显示为“从未保存”；响应另标 `current_binding_valid=false`。这不实现历史记录删除，生产删除/撤回合同属于真实业务适配。

Mock 存储明确显示“本地模拟，进程重启即丢失”，不写外部系统，不提供掌握度字段。普通日志不保存逐字稿；证据、小结读取仅走操作者接口。短期上下文和派生小结随会话回收；已选择保存的 Mock 记录作为独立内存存储保留到进程退出。

## 内部接口

都需要 `Authorization: Bearer <OPERATOR_TOKEN>`。学生的 Gateway 凭证不能访问这些接口。

| 接口 | 合同 |
| --- | --- |
| `GET /internal/sessions/:id/evidence` | 读取当前短期输入证据和有效标注；不要接入普通日志 |
| `POST /internal/sessions/:id/evidence` | `{kind, evidence_id, quote, expected_state_version, expected_consent_version}`；只接受 topic/attempt；过期版本或无来源引用拒绝 |
| `POST /internal/sessions/:id/end` | `{}` 默认不保存；`{save:true, expected_consent_version:1}` 明确选择保存；响应包含冻结小结与保存状态 |
| `GET /internal/sessions/:id/summary` | 未冻结返回 409；已冻结返回同一份数据和当前保存回执状态 |
| `POST /internal/sessions/:id/summary/save` | `{summary_id, expected_consent_version}`；结束后显式保存或重试，返回 202 和当前状态；不是成功回执保证 |

完整 HTTP 操作示例见 `tests/summary-http.test.ts`：创建获准合成资料、Pi/SSE 输入、按版本标注、结束、获取实际回执、幂等重试。无需模型或 Tavus key。
