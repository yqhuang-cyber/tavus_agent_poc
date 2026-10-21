# 只读预检与资源并发清理：离线交付

2026-10-21 修复：`.env` 中 `TAVUS_VOICE_ID=` 或仅空格现在正确选择 Face 默认声音。此前本地参数校验会被误报为 `asset-get-failed/httpStatus=null`；该输出不能直接归因于网络、key 或素材 ID。新增 7 项回归检查，全仓现为 115 项，实际运行结果以 `.runtime/verification-latest.json` 为准。

`--live-assets` 现在按 Face/Voice 的技术可用性检查，适用于自带 Avatar 的先行联调。正式 Phoenix-4.5 训练门槛显式使用 `--live-assets --formal-assets`，必须同时启用 `--live-assets` 才允许外部 GET。两种模式分别报告 `requirement/requirementPassed`；通过技术检查不自动通过正式训练、真人品牌或中文听感要求。

错误报告增加固定枚举 `failureCode`：`http` 保留实际 HTTP 状态（如 401/404），`timeout/dns/tls/connection/transport` 区分可识别的传输失败，`invalid_response` 表示返回内容无法解析为所需对象；后者保留已收到的 HTTP 状态。`invalid_asset_id` 单独报告本地参数校验失败，未发请求。原始错误、凭证和响应正文仍不输出；`transport` 只表示未能细分，不推断具体原因。

最新交付（2026-10-20）：连接执行、生命周期观测及同源回顾合同已落地，全仓验收口径为 108 项，见 [当前连接与收尾说明](connection-lifecycle-and-review.md)。本页保留其阶段记录。

2026-10-19 11:37（Asia/Shanghai）。本轮继续完成 M0-08～10 不依赖真实接口的子项，真实供应商和真人验收保持未运行。

本报告保留该阶段 68 项结果。后续 HTTP 故障、计时及媒体控制增量后为 87 项，最新一键执行索引及合同见 [当前验收说明](offline-control-and-verification.md)。

## 交付与复现

```sh
npm run preflight
npm run preflight -- --media /absolute/path/teacher-video.mp4
# 以后环境具备凭证时，显式启用 Face/Voice GET；本轮没有执行这一项真实请求。
npm run preflight -- --live-assets
# 正式 Phoenix-4.5 训练检查（技术联调不需要这个额外门槛）。
npm run preflight -- --live-assets --formal-assets
```

命令读取 `.env`，报告写入 `.runtime/preflight.json`。通过当前启用的检查退出 0，有缺失/失败退出 1。`checks-passed` 仅指本次启用检查通过，不能表示真实联调、授权、品牌或听感通过；报告分别保留这些未运行字段。

默认无外部请求。资源账本只读，不触发 end、DELETE、训练或创建。只有显式 `--live-assets` 才使用环境中的 Tavus key 查询既有 Face/Voice，保留托管环境的代理和 TLS 信任。报告不输出密钥、meeting token、素材 URL、远端原始错误或素材本地路径。

## 配置与账本

- 检查运行模式、操作者 token 格式、端口和 live 模式必需配置；真实 Tavus 必须配合 live Pi。
- 模型/Gateway 基址要求 HTTPS，拒绝 URL 内用户名密码、query 和 fragment。配置存在仅说明语法可用，端点鉴权和模型接口合同仍未验证。
- Gateway 主进程在启动恢复前完成配置校验；无效配置不会先执行远端资源清理。
- 账本校验字段、类型、重复会话和资源状态一致性；整份校验通过后才载入。预检报告未解决/未知数量，不修改账本、不自动认定已释放。

当前环境无 `.env` 或操作者 token，直接执行默认预检正确返回 `blocked`；这不是离线回归失败。真实模型及 Tavus 凭证也尚未配置。

## 本地素材

需要本机 `ffprobe`。仅接受本地常见视频文件，不下载 URL；ffprobe 的协议限为 file/pipe。读取报告后仅保留数值元数据、SHA-256 和字节数，并检查期间文件是否变化。

自动检查一个有效视频流、至少 1080p（支持横竖屏）、平均至少 25 FPS、视频至少 60 秒以及音轨存在。时长来自视频流或视频帧数，不能用容器内较长的音轨时长替代。平均帧率也不证明全过程恒定帧率。

前 30 秒连续讲话、随后 30 秒静止、正面口型、拍摄环境、真人形象和中文音质保持人工待验。音轨存在不能证明有讲话；元数据通过不能证明供应商接受训练素材。

本轮以黑屏和正弦音生成明确合成的 1920×1080、25 FPS、60 秒文件，完整执行了本地预检，元数据检查通过。报告在 `.runtime/preflight-synthetic-media.json`；它不是可用的老师训练素材。另有真实 ffmpeg/ffprobe 测试验证 1 秒视频会因时长不足失败。两者均未上传。

## Face/Voice GET 状态判定

读取指定 Face，核对返回 ID；使用显式 Voice 或该 Face 的 default_voice_id，再核对 Voice ID。只有两个 GET 均为 `completed` 才标为技术可用。正式 Phoenix-4.5 训练完成还要求 `model_name=phoenix-4.5` 和 `finetune_status=completed`。

`started/error/errored/null/未知`、ID 不符及 callback 的 `ready` 均不能替代对应 GET 状态。品牌审核、中文声音质量和实际媒体表现独立保持未评测。本轮仅使用模拟 REST 验证判定和 GET 路径，没有查询真实资产。

## 创建与关闭并发

关闭请求立即设置 closing，后续创建步骤受其约束。若 PAL 创建、PAL 配置复核或房间创建正在进行，清理等待该阶段结果；不提前删除仍可能被房间使用的 PAL。

房间迟到返回时，先记录 ID，再 GET/必要时 end/再次 GET 确认 ended，最后删除 PAL。创建期间关闭会使启动失败，已关闭会话不会取得迟到的入房凭证。并发关闭合并为同一次清理。

明确失败且没有资源被创建时，账本可记为无待释放资源，不伪造一次 DELETE 回执。请求结果不确定或重启 pending 继续保留 unknown，禁止自动重建及删除关联 PAL。仍需按 [运行说明](m0-runbook.md#清理与失败处理) 对账，不可删账本跳过检查。

## 验证结果

| 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm test` | 68 项通过，0 失败、0 跳过；上轮 51 项 |
| 双会话 Pi/SSE 探针 | 20 轮通过，真实 Tavus 请求 0 |
| 场景矩阵 | 36 场、80 轮协议/程序教学状态通过；教学质量未评测 |
| 配置、资产与媒体预检 | 12 项自动检查通过，含真实本地 ffprobe 与 CLI |
| 资源增量 | 5 项新检查通过，覆盖迟到创建、关闭、确定/不确定失败及坏账本 |
| 60 秒合成素材 | 元数据预检通过，人工项未运行，上传 0 |

机器报告另见 `.runtime/offline-probe.json`、`.runtime/eval-offline.json`；`.runtime/` 忽略跟踪。既有任务继续保留真实接口、真实房间/设备释放、Face/Voice 品牌及听感验收要求。
