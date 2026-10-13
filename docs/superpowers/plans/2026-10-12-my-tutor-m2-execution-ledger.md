# SDD ledger — plan: docs/superpowers/plans/2026-10-12-my-tutor-m2-voice-loop.md

Spec: docs/superpowers/specs/2026-10-12-speakmate-design.md（第 5、8.3、8.4、9、12 节）
Integration branch: m2（从 master 7a0716d 起）。并行任务各用 .worktrees/task-N，审核通过后 merge 回 m2。
Execution waves: [1] → [2,3,5,6] → [4] → [7] → [8,10] → [9] → [11]

## Pre-flight scan
| 配对 / 任务 | 产出 vs 消费 | 结果 |
|---|---|---|
| T1 ↔ T2/T3/T5/T6 | 常量与类型（SILENCE_RMS、MAX_RECORDING_SECONDS、ASRResult、ASRErrorKind、TTSVoice、ModelProgressEvent、WHISPER_MODEL_URL） | 一致，名称已核对 |
| T1 ↔ T7/T8/T9 | TranscribeOutcome / SpeakOutcome 走返回值而非 IPC 异常；preload voice API 在 T1 写好 | 一致（T1 已按此修订） |
| T3 ↔ T4 | parseWhisperJson 输入 unknown、输出 ASRResult；空文本由 T4 抛 empty | 一致 |
| T4 ↔ T7 | WhisperCliService({ getConfig, tmpDir }) 与 resolveWhisperConfig | 一致 |
| T5 ↔ T7 | TTSService.speak(text,{voice,rate}) / stop / listVoices；TTSError.kind | 一致 |
| T6 ↔ T7 | ModelManager.status/download/cancel/delete；onProgress 事件广播 | 一致 |
| T7 ↔ T9/T10 | IPC.voiceModelProgress 事件、voice.speak 返回 SpeakOutcome | 一致 |
| T8 ↔ T9 | 都改 ChatStore.tsx/ChatPage.tsx：T8 加 transcribe/asrDraft，T9 加 speak/autoSpeak | 串行执行（9 在 8 之后）避免冲突 |
| T8 ↔ T10 | 文件不相交（T10 只改 SettingsPage.tsx） | 可并行 |
| T2 Recorder | 'ended' 事件内调 stop() 但无人消费返回值 | 可接受：onError 已通知 UI，之后 ChatPage 的 stop 得到空样本 → 静音提示 |
| T8 ChatPage | useEffect 依赖 recorder.cancel（稳定）而非 recorder 对象 | 计划已修 |
| 各任务自洽 | 测试 vs 实现、创建 vs 后续修改 | 逐任务核对一致；T8/T9/T10/T11 无组件测试，以 typecheck + 手动验证为准（计划明示） |
| 模型文件位置 | M1 下载在 ~/Library/Application Support/speakmate/models，新目录为 my-tutor/models | Ruling: 执行前由控制器把模型文件复制到新目录（不是移动，保留旧文件以防回退）— 省 466 MB 下载 — 代价：磁盘多占 466 MB |
Task 1: dispatched (BASE 7a0716d, in-place on m2)
Task 1: implementer DONE_WITH_CONCERNS (11deb75)。Ruling: TranscribeInputSchema 保持 byteLength > 44，测试改用 45 字节 — 44 字节只有 WAV 头 — 代价：无。Ruling: register.test.ts 的通道集合断言暂时排除 voice:* 通道，Task 7 注册后恢复 — 任务间测试套件不能红 — 代价：Task 7 派发时需带上这条提醒。
Task 1: review clean. ⚠️ 设置存储是否保存新键：db/settings.ts 按 DEFAULT_SETTINGS 的键过滤，voice/rate/whisper* 本就在其中，满足。minor (deferred): schemas.ts 硬编码 100/300/2_100_000（types↔schemas 互相导入，避免循环）; voice-schemas 测试缺上边界接受用例。
Task 1: complete (commits 7a0716d..4993456, review clean) — on m2 in place
PAUSED by user after Task 1. Resume at Task 2 (wave [2,3,5,6] in parallel worktrees from 4993456). Task 7 dispatch must carry: restore the voice:* channel assertion in register.test.ts.
RESUMED 2026-10-13. Ruling: 此后提交 trailer 用 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`（会话模型已切换）— 代价：无。
Tasks 2/3/5/6: worktrees .worktrees/m2-task-N from 4993456, dispatched in parallel
Task 3: implementer DONE (5574319); minor (deferred): transcription 数组含 null 元素时抛 TypeError 而非带 transcription 的错误
Task 5: implementer DONE_WITH_CONCERNS (1061e2e)。真机 say 朗读与 35 个英语音色验证通过。minor (deferred): listVoices 无超时、忽略退出码。
Task 6: implementer DONE_WITH_CONCERNS (11e27e1)。Ruling: 删除 brief 中未使用的 existsSync import（否则 TS6133）— 计划缺陷 — 代价：无。
Task 3: review clean. minor (deferred): 空文本 segment 的 token 仍计入置信度; 未检查 Number.isFinite（JSON 不会出现）。
Task 3: complete (commits 4993456..5574319, review clean) — merged into m2
Task 2: implementer NEEDS_CONTEXT — eslint explicit-function-return-type 作用于 public/*.js。Ruling: eslint ignores 加 src/renderer/public/** — 纯 JS worklet 无法写返回类型 — 代价：该目录不受 lint。Ruling: wav.ts 去掉 Math.round 用 setInt16 截断，以 brief 测试为准 — 代价：无（PCM16 常规做法）。
Task 4: worktree from 247a432, dispatched
Task 2: implementer DONE (9a0071d)
Task 6: review — Important (plan-mandated): 写流无 error 监听，磁盘满/权限错误会在主进程抛未捕获异常。Ruling: 修复 + 顺带校验 received===total、catch 中 cancel reader、delete 先 cancel — spec 要求失败可恢复 — 代价：几行代码两条测试。minor (deferred): 缺 total:null 与 fetch 前取消的测试。
Task 6: fix round 1/5 dispatched
Task 5: review — Important ×2 (plan-mandated): (1) speak/stop 竞态可产生无法停止的孤儿 say 进程；(2) 多语言音色（Eddy 等 de_DE/en_GB/en_US）去后缀后合并，可能选到非英语变体（控制器已在本机确认，且 `say -v "Eddy (英语（美国）)"` 可用）。Ruling: 加 generation 计数修竞态；音色 id 用完整原名、按 id+lang 去重；stdin 加 error 监听防 EPIPE — 代价：设置页需兼容已存的 'Samantha' 短名（say 仍接受）。minor (deferred): listVoices 无超时; 正则对单空格对齐的长名会丢; stop 与超时同刻时 speak 以 timeout 拒绝。
Task 5: fix round 1/5 dispatched
Task 2: review — Important ×2 (plan-mandated): 60 s 自动结束/设备断开会丢弃录音；start 中途失败泄漏麦克风流与 AudioContext。Ruling: Recorder 加 onAutoStop 回调 + pending 结果供下一次 stop() 取回；start 加重入保护与失败清理 — 代价：Task 8 派发需带上"onAutoStop 接到与点击 ■ 相同的处理"。minor (deferred): worklet 关闭时尾部几毫秒丢失。
Task 2: fix round 1/5 dispatched
Task 4: implementer DONE_WITH_CONCERNS (43ef224)。真机 whisper 识别一句 485 ms，置信度 0.968，文本完全正确。Ruling: brief 的 missing 测试没建假二进制导致 model_missing 用例拿到 binary_missing，接受在该用例开头补 writeFakeBinary — 计划缺陷 — 代价：无。观察：测试假脚本的孙进程 sleep 在 abort 后残留数秒，真实 whisper-cli 单进程不受影响。
Task 2: fix round 1 implemented (ab3eba3); minor (deferred): start 等待中调用 cancel 仍会开始录音
Task 5: fix round 1 implemented (416751d)。Task 10 派发需带上：设置项 voice 可能是不在列表里的短名 'Samantha'，下拉框要保留该值（计划代码已有此分支）。
Task 4: review clean. minor (deferred): JSON 解析/写 wav 失败抛普通 Error 无 kind（VoiceService 会兜底映射为 failed）; stderr 无上限; 外部杀进程时"退出码 null"; existsSync/fileExists 两套。
Task 4: complete (commits 247a432..43ef224, review clean) — merged into m2
Task 6: fix round 1/5 (1 addressed, 0 open; commits 11e27e1..62faca1). minor (deferred): run() 中 try 前的 mkdirSync/rmSync 抛错会让 download() reject 而不发 error 事件 → Task 7 派发时一并移入 try; gzip 编码时长度校验会误判（模型主机不会）。
Task 6: complete (commits 4993456..62faca1, review clean after 1 fix round) — merged into m2
Task 2: fix round 1/5 (2 addressed, 0 open; commits 9a0071d..ab3eba3). minor (deferred): start 进行中 cancel/stop 无效; release 不清 chunks 直到下次 start。
Task 2: complete (commits 4993456..ab3eba3, review clean after 1 fix round) — merged into m2
Task 5: fix round 1/5 (2 addressed, 0 open; commits 1061e2e..416751d)。⚠️ 本地化全名作为 -v 是否可用：控制器已实测 `say -v "Eddy (英语（美国）)"` 成功。minor (deferred): 去重键冗余; current 结束后不清空（无害）。
Task 5: complete (commits 4993456..416751d, review clean after 1 fix round) — merged into m2
Task 7: dispatched in place on m2. Carries: 恢复 register.test.ts 的 voice:* 断言; ModelManager.run 中 try 前的 mkdirSync/rmSync 移入 try（失败一律发 error 事件、download() 不 reject）。
Task 7: implementer DONE (2932091)。dev:fake 实测 status/listVoices/speak/requestMic 正常。Ruling: catch 里的清理 rmSync 也包 try/catch（.part 为目录时仍会抛）— 保证 download() 永不 reject — 代价：无。观察：before-quit 不等待 voice.shutdown，快速退出时 say 可能残留 → Task 11 验收会检查 pgrep say。
Tasks 8/10: worktrees from 2932091 (task 7 head), dispatched in parallel with Task 7 review
Task 7: review clean. minor (deferred): requestMic 非 macOS 无保护; speak 中 getSettings 在 try 外; before-quit 不等 shutdown; FakeASR.calls 未断言。
Task 7: complete (commits a0aabd1..2932091, review clean) — in place on m2
Task 10: implementer DONE_WITH_CONCERNS (d21b7a6)。真实下载 465 MB 跑通，模型文件已还原。Ruling: set-state-in-effect 改为 api.voice.status().then(setVoice)，接受。minor (deferred): 466/465 MB 文案; 下载中离开再进设置页短暂显示未下载（未用 VoiceStatus.downloading）; 语速滑块每步都保存。
Task 10: review clean. minor (deferred): 下载失败前缀重复（下载失败：下载失败：HTTP 404）→ 最终修复波一并修; 重进设置页下载中短暂显示未下载; 删除确认定时器未清; void promise 无 catch; 按钮类名/模型文件名重复。
Task 10: complete (commits 2932091..d21b7a6, review clean) — merged into m2
Task 8: implementer DONE_WITH_CONCERNS (89ed470)。Ruling: eslint 驱动的 useLayoutEffect 赋 ref、渲染期按会话重置，接受；修正 brief 中 onClearAsr 读旧 text 导致停在 awaiting_confirmation，接受。Ruling: 实现者自报的 3 个缺陷（切会话时录音/识别不取消、转写结果落到新会话、自动停止与点击竞态）在审核前直接修 — 加 dispatchUiFor、切会话取消录音/识别、onMic 加 busy ref — 代价：ChatStore 多一个方法。观察：并行任务共用 CDP 端口导致一次误连，未造成改动。
Task 8: implementer DONE (89ed470..f24ef5c)。Ruling: 取消离开会话的语音工作放在 effect（渲染期副作用会触发 React 跨组件更新警告），接受；start 期间切会话丢弃录音、START_RECORDING 用 dispatchUiFor，接受。review dispatched.
Task 8: review — Important ×2: ASR 标记与 awaiting_confirmation 在输入文本被重置后仍残留（切会话/离开聊天页），导致手打的消息被标为语音输入；离开聊天页时录音/识别未取消，回来后状态卡在 recording。Ruling: 文本重置时同步清除该会话的 ASR 草稿并 INPUT_CLEARED；ChatPage 卸载时做与切会话相同的取消；requestMic 成功后清 micDenied — 代价：无。minor (deferred): 切换瞬间的 tag 竞态; 识别中切会话时 micBusyRef 让新会话麦克风短暂无响应; 未就绪文案两处重复; ChatPage 变大（后续可抽 useVoiceInput）; currentIdForEffect 命名。
Task 8: fix round 1/5 dispatched
Task 8: fix round 1/5 (2 addressed, 0 open; commits f24ef5c..9e5a2a2)。minor (deferred): recorder.stop() 期间卸载页面时迟到的转写仍写入草稿（毫秒级窗口）; 删除当前会话后 cleanup 重新写入 ui/asrDraft 孤儿键。
Task 8: complete (commits 2932091..9e5a2a2, review clean after 1 fix round) — merged into m2
Task 9: dispatched in place on m2
Task 9: implementer DONE_WITH_CONCERNS (71faf8f)。Ruling: 开始录音时渲染进程主动 stopSpeaking（否则会把朗读录进去，spec 要求录音打断朗读）接受；每会话 speak 序号避免被顶替的朗读发 SPEAK_END 接受 — 代价：无。观察：sending/streaming 中点 🔈 有声音但无停止按钮。
Task 9: review — Important (plan-mandated): sending/streaming/error 时点 🔈 有声音但无 speaking 状态与停止按钮。Ruling: 这些状态下禁用 🔈 并在 store 的 speak 加同样的守卫；朗读失败横幅也按最新序号门控 — 代价：生成中不能朗读旧消息（可接受）。minor (deferred): awaiting_confirmation 时点朗读结束后回 idle 而非原状态; 错误消息提取重复; ChatStore 继续变大。
Task 9: fix round 1/5 dispatched
Task 9: fix round 1/5 (2 addressed, 0 open; commits 71faf8f..0ce66d7)
Task 9: complete (commits f8c2a23..0ce66d7, review clean after 1 fix round) — on m2
Task 11: dispatched in place on m2 (acceptance)
Task 11: implementer DONE_WITH_CONCERNS (a4ae9ce)。验收：1.1–1.6、2.2（模拟）、2.3、2.4、打包闭环通过；2.1 撤销麦克风权限未验证（需人工）；语音为注入。识别 5.3 s 录音 0.51 s、60 s 录音 1.7 s；退出后无 say 残留。Ruling: electron-builder.yml 的 mac.extendInfo 从列表改为映射，使中文麦克风文案进入 Info.plist — 配置缺陷 — 代价：无。
Ruling: Task 11 只改了 spec 与一处 yml，不单独做任务审核，并入整分支终审一起审 — 代价：若 yml 改动有问题由终审发现。
验收发现交给终审分诊：(1) 语音就绪只在聊天页挂载时检查; (2) 错误横幅在后续成功录音后仍残留、重录时旧文本与标记仍在; (3) 点麦克风到开始录音 0.02–4.4 s（askForMediaAccess 已授权仍可达 3.2 s）; (4) whisper 会把学习者错误改成正确形式（goed→got），影响纠错; (5) dev:fake 创建的会话切到真实 provider 后续接失败且只显示通用错误; (6) 打包版为 ad-hoc 签名无 entitlements。
Final whole-branch review dispatched.
Final review: With fixes — Important ×3（启动中卸载导致热麦克风循环、whisper 非语音标注被当作转写、关窗不停朗读）。Ruling: 本波修 Important 1–3、验收缺陷 2/3（便宜部分）、fromAsr 告知 Claude（缓解 whisper 规范化学习者错误，审核建议 a）、下载失败前缀重复、transcribe IPC 拒绝不卡住、speak 截断 4000、spec §5.1 改为断开后照常识别已录部分。Ruling: whisper --prompt 不采用（会在噪声上幻听），需真人语音评估集后再议 — 代价：goed 类错误仍可能被抹平，但 Claude 会标 uncertain。其余 later 项留账本。Declined-to-judge 各行全部接受为 M2 范围外。
Final fix wave dispatched (one fixer) — findings: final-review-findings.md
Final fix wave DONE_WITH_CONCERNS (10 commits a4ae9ce..6a1b53c, 141/141)。观察：网络错误类下载失败不再带前缀; useRecorder/ChatPage/ChatStore 部分仅手动验证。scoped re-review dispatched.
Final re-review: all 10 addressed. minor (deferred): 网络/磁盘类下载错误不带"下载失败"前缀（建议在 model-manager.ts:115 补前缀）。
