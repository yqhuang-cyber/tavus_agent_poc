# 原生 Free Talk POC：本地运行

2026-10-21。默认 `npm run dev` 已切换为 `apps/server/main.ts`，提供本地页面和原生 Tavus/Pi 编排。此前 Pi 生成口语的 SSE 探针保留在 `npm run dev:legacy`，不再作为默认通话入口。

## Mac 上更新并打开

已有 `.env` 不需重建，也不提交到 Git。先在原服务终端按 Ctrl+C，再执行：

```sh
git pull --ff-only origin main
npm ci --include=dev
npm run preflight -- --live-assets
npm run dev
```

保持 `ngrok http 8787` 运行，`.env` 的 `GATEWAY_PUBLIC_URL` 与当前 Forwarding 根地址一致。浏览器打开 **http://127.0.0.1:8787/**。初次输入 `.env` 的 `OPERATOR_TOKEN` 作为内部演示访问码；不要输入 Tavus key、模型 key 或 ngrok token。

页面以 HttpOnly / SameSite Cookie 维持内部操作者身份；该身份只用于本 POC，尚未接真实学生认证。Tavus、模型和工具签名密钥只在服务端。可以选择 Alex/Maya/Leo/Nina 四位 Mock 学习者、中文偏好和保存许可；活动会话不能换身份。

`MODEL_MODE=live`、`TAVUS_MODE=live` 才创建真实通话。两者为 fixture/offline 时，页面明确显示离线演示，只有合成文字反馈，不播放假视频或模拟真实听感。

## 点开始后发生什么

1. 服务端运行有界 Pi 初始规划，构造本次资料/语言上下文；初始教学目标为空。
2. 首次按 Face、Voice、规则、回调根地址和工具签名版本创建专用 PAL 与三个原生工具，GET 复核并关联。PAL 的 LLM 固定为 **tavus-gemma-4**，不填写自定义 LLM URL。配置复用且不修改用户之前手工 build 的 PAL。
3. 记录每次创建意图和资源 ID 后，创建最长 15 分钟、最多两个内部并发的私有 Conversation。页面通过固定版本 Daily JS 加入，老师音视频轨道可用后才进入交流，学生摄像头关闭。
4. 按浏览器提示允许麦克风；拒绝时可以打字。如果自动播放被拦，点击视频区的「开启老师声音」。手动打断先本地静音，再发送原生 interrupt 和取消 Pi；下一条新回复才能恢复旧播放边界之外的声音。
5. 有效 final 输入经会话/epoch/顺序校验后独立触发 Pi；不要求 Tavus 每轮自主调用工具。通过结束发声等已知边界发送最新完整上下文，诊断仅记 client-reported-sent，不宣称已应用。

Pi 规划超时或失败会明确显示规则降级；普通 Tavus 交流可继续。这不是 Pi 模型调用通过。工具从共享规划结果取教学建议；工具参数不能成为学生身份、实际输入或已练习的事实。

## 回顾、继续和退出

点击「回顾并结束」后，由 Pi 对有来源的摘要执行一次有界审查，页面预览和结束工具共用同一摘要 hash。Tavus 按工具结果组织口头回顾。新输入或点击「还想继续聊」会撤销预览，迟到结果不冻结旧记录。

正常结束提供 **「我已听完，结束」** 的人工确认；它记录为 user-confirmed，不等于独立可验证的逐词播放证据。30 秒未确认将有界退出并标为播放未确认。仅 `stopped_speaking` 不自动证明已播放完成；PRD 的 G04 自动播放边界仍待真机验证。

「立即退出」先停止本地播放和设备，跳过等待回顾；服务端结束并 GET 复核房间。页面离开也发送退出请求，缺失时由心跳租约兜底。服务重启关闭账本中旧房间，不恢复旧内存授权。共享 PAL/Tools、Face/Voice 不随每次退出删除。

网络 interrupted 时先停止旧播放并退出旧房间，再由用户重新开始；不让 SDK 自动恢复旧音频。显式恢复尚存会话会提升 epoch，旧连接的输入、退出和控制回执均被拒绝。上下文按 RTC 字节预算保留基础规则/当前教学状态并裁去可选历史摘录，覆盖状态明确 partial。

勾选保存许可后，结束自动产生真实的内存 Mock 保存回执；「查看本地会话记录」读回同一摘要。页面明确标记重启重置；运行观察中可撤销许可。post-call 只做来源候选对账，不自动新增学习事实；最小幂等收据落盘后才确认接收，候选正文和完整转写不写入该任务账本。

## 诊断与恢复

- `/healthz` 现在包含 `pipeline: native`、`web: ready`；没有这些字段通常是旧服务仍在占用端口，需 Ctrl+C 后重启。
- 运行观察显示 Pi/rule/cancelled 分母、当前计划、上下文已发送/未知应用状态、输入覆盖缺口、工具次数、保存和清理结果。
- `.runtime/native-resources.json` 保留配置及房间 ID、创建/关闭状态，不含 key 或入房 token。未知创建结果会阻止新创建，避免重复收费；通过 Tavus 控制台核对资源后再处理账本，不直接删除文件跳过对账。
- `.runtime/native-signing-seed` 自动生成、权限 600；这是工具签名根密钥，不发给浏览器。运行期间保留此文件，避免无意义地重建工具版本。
- `.runtime/native-jobs.json` 只保留最小课后收据、hash、状态和来源匹配计数；重启时未完成任务标为授权过期。
- `npm run preflight` 只读检查新旧两套资源账本；真实活跃房间也会列为待释放资源，不代表应在通话中删除账本。

## 本轮验证及仍待实测的边界

类型检查、前端构建、全仓 133 项测试、旧双会话 20 轮探针和 36 场景 80 轮协议回放；实际结果以 `.runtime/verification-latest.json` 为准。新增 18 项覆盖原生资源/竞态、HMAC/幂等、输入/规划取消、收尾/保存、HTTP 身份隔离、重连 epoch 和原生账本只读预检。

可另执行真实 Chromium 的本机离线页面探针：

```sh
npx playwright install chromium
npm run probe:web
```

已有系统 Chromium 可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。探针自己启动临时 fixture 服务，仅允许本机网络请求，验证登录、选人、输入、规划、回顾/撤销/再次结束、保存读回及手机布局。结果写 `.runtime/web-probe.json`，截图为 `.runtime/web-probe-desktop.png` 与 `.runtime/web-probe-mobile.png`。这些证明浏览器流程可执行，不证明 Daily 真实设备行为或 Tavus/Gemma 教学质量。

当前云端未取得用户 Mac 的运行密钥，尚未执行真实供应商创建、工具投递、Gemma 回复或真机听感。实际事件形状/关联、工具采纳、原评分基线、HSK 难度语义、长会话、真实业务身份和正式品牌仍按 [TA 清单](task-list.md) 待验。语速调节尚未提供；不显示一个仅改状态的假语速按钮。
