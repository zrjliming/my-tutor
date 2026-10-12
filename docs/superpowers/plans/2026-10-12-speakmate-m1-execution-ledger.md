# SDD ledger — plan: docs/superpowers/plans/2026-10-12-speakmate-m1-chat-lessons.md

Spec: docs/superpowers/specs/2026-10-12-speakmate-design.md（已读，为最终依据）
Integration branch: m1（从 master 8d2a873 起）。并行任务各用 .worktrees/task-N 分支，审核通过后 merge 回 m1。
Execution waves: [1] → [2] → [3,4,6] → [5,7,8] → [9] → [10] → [11, 14a(whisper+builder)] → [12] → [13] → [14b Finder]

## Pre-flight scan
| 配对 / 任务 | 产出 vs 消费 | 结果 |
|---|---|---|
| T1 ↔ T9 | T1 临时 index.ts/preload，T9 重写 | 一致（T1 标注临时） |
| T1 ↔ 现有 .gitignore | T1 rsync 模板会覆盖 .gitignore | Ruling: T1 rsync 后必须保留 .worktrees/ .superpowers/ 条目 — 否则工作区会被提交 — 代价：漏了会把工作树提交进仓库 |
| T2 ↔ T3/T5/T7/T8 | Mode/Difficulty/TutorResponseSchema/LessonExtractionSchema 名称 | 一致 |
| T3 ↔ T12 | SCENARIOS 先在 prompts.ts，T12 移到 shared 并 re-export | 一致（计划内迁移） |
| T4 ↔ T7 | T7 给 fake.ts 加 omitStructured | 一致 |
| T6 ↔ T7/T8/T9 | db 函数签名 insertConversation/markSessionStarted/bumpTurn/insertMessage/updateMessage/listMessages/insertLesson/getLesson/listLessons/deleteLesson/getSettings/patchSettings | 一致 |
| T5 ↔ Global | 不传 disallowedTools | 一致 |
| T9 ↔ T10 | SpeakMateAPI / window.speakmate 类型来自 preload d.ts | 一致 |
| T10 ↔ T11 | errors 存 kind，UI 按 kind 查文案 | 一致（计划已修） |
| T11 ↔ T12 | ChatPage 加 onNew prop | 一致（计划内） |
| T13 ↔ T14 | T14 Finder 步骤依赖设置页 | Ruling: T14 拆成 14a（whisper 脚本 + builder 配置，与 T11 并行）和 14b（Finder 验证，T13 之后）— 依赖顺序 — 代价：无 |
| 各任务自洽 | 测试 vs 实现、创建 vs 后续修改 | 逐任务核对一致；T1 无自动化测试（脚手架），以 typecheck + dev 启动验证 |
| 仓库根 SpeakMate_Electron_AI_.md | 用户放的未跟踪文件 | Ruling: 不动它、不提交它 — 不是本计划产物 — 代价：无 |
Task 1: dispatched (BASE 8d2a873, in-place on m1)
Task 1: implementer DONE_WITH_CONCERNS (commit 30070d4). Ruling: 开发态 CSP script-src 加 'unsafe-inline'（仅 is.dev，生产不变）— Vite React 插件在开发态注入内联 refresh 脚本，否则白屏 — 代价：仅影响开发态。Ruling: zod 被 --save-exact 钉到 4.6.6，保留 — 版本更新且 toJSONSchema 可用 — 代价：无。minor (deferred): @electron-toolkit/preload 仍在 dependencies 但未使用。
Task 2: dispatched in .worktrees/task-2 (branch task-2 from 30070d4), parallel with Task 1 review
Task 1: review clean (approved). minor (deferred): window.ts will-navigate 在 dev 且无 ELECTRON_RENDERER_URL 时 allowed='' 放行一切（建议回退 'file://'）; electron-builder.yml/README 仍是模板名 speakmate-tmp / com.electron.app（Task 14a 会改 builder.yml）; .gitignore 重复条目; index.html title 仍为 Electron。
Task 1: complete (commits 8d2a873..30070d4, review clean)
Task 2: implementer DONE_WITH_CONCERNS (b2835ac). Ruling: 计划里的代码块未按 prettier 排版，各任务实现者提交前必须对自己新建/修改的文件跑 `npx prettier --write` 并保证 `npx eslint <files>` 0 警告 — 统一格式避免最终审查噪音 — 代价：无。已让 Task 2 实现者补一笔格式化提交。
Tasks 3/4/6: worktrees from 95396f8 (task-2 head), dispatched in parallel with Task 2 review
Task 2: review clean. minor (deferred): Lesson.vocabulary 内联重复 vocab 形状（可从 schema 推导）; z.string().uuid() 在 zod 4 已标记弃用（z.uuid()）。
Task 2: complete (commits 30070d4..95396f8, review clean) — merged ff into m1
Task 4: implementer DONE (a141ed5); FakeAIOptions 导出来自 brief 代码，接受
Task 3: implementer DONE (88618d4)
Task 4: review clean. minor (deferred): fake 在最后一个 delta 后不再检查 abort 即 yield done; 空 reply 会发一个空 delta; analyze 忽略 signal; 缺 analyze schema 不匹配/failWith 的测试。
Task 4: complete (commits 95396f8..a141ed5, review clean) — merged into m1
Task 5: worktree from d7cf126 (m1 after Task 4 merge), dispatched
Task 3: review clean. minor (deferred): scenario 在非场景模式下也会进系统提示（可加 mode 判断）; 纯空格 scenario 可通过; 测试可多断言 scenario 文本/lesson 标题/中文开关 true 分支。
Task 3: complete (commits 95396f8..88618d4, review clean) — merged into m1
Task 6: implementer DONE (74d5eaf); review dispatched
Task 6: review clean. minor (deferred): settings 用 `k in DEFAULT_SETTINGS` 会放过原型键（IPC 层有 zod strict object 兜底，建议改 Object.hasOwn）; 存储 JSON 解析无保护（settings 行损坏会让 getSettings 抛错）; insertLesson 自带 BEGIN，不可嵌套外层事务; 缺回滚路径测试。
Task 6: complete (commits 95396f8..74d5eaf, review clean) — merged into m1 (86b2d6b)
Tasks 7/8: worktrees from 86b2d6b, dispatched in parallel
Task 5: implementer DONE_WITH_CONCERNS (b20a64a). 真实 SDK 首轮实测：无 text_delta，只有 done（structured 有效，rawText 是 result 里的 JSON 串）。Ruling: 接受 — ChatService 已按 structured.reply 优先、UI 允许无流式 — 代价：无流式时用户要等完整结果；minor (deferred): structured 缺失且 rawText 为 JSON 串时会把 JSON 原样展示，可在 provider 里尝试解析 rawText.reply 兜底。Ruling: `parsed.data as TutorResponse` 与 `as unknown as SDKUserMessage` 两处类型断言接受 — 仅为通过 typecheck — 代价：无。
Task 7: implementer DONE (6d1ec44); minor (deferred): cancel 测试依赖 15ms/40ms 时序，重负载下可能抖动; review dispatched
Task 8: implementer DONE_WITH_CONCERNS (3768d2d). Ruling: 计划测试缺陷 — `uuid: () => 'l1'` 让所有资产同 id 触发 UNIQUE 冲突，接受实现者把 fixture 改为 ids 队列 — 代价：无。minor (deferred): save 先写图片再 insertLesson，插入失败会留孤儿文件。
Task 5: review clean. ⚠️(a) sessionId 必须是 UUID：会话 id 由 crypto.randomUUID 生成，满足。⚠️(b) 真实 SDK 中断是否抛 AbortError：SDK 文档说明 abort 后迭代以 AbortError reject，Task 13 真机联调第 4 步会验证"停止后再发送"。minor (deferred): abort 监听器正常结束不移除; error result 未对照 signal.aborted; check() 无超时; 'enoent'/'429' 子串匹配可能误判; 缺 toJsonSchema/maxTurns/PATH 断言。
Task 5: complete (commits d7cf126..b20a64a, review clean) — merged into m1
Task 8: review clean. minor (deferred): insertLesson 失败留孤儿目录; 未知 mime 存为 .bin（IPC 层 zod 已限 mime）; "lists newest first" 测试名只存了一条; delete(id) 直接 join 路径，依赖 IPC 只传 uuid（register 用 z.string().uuid() 校验）。
Task 8: complete (commits 86b2d6b..3768d2d, review clean) — merged into m1
Task 14a: worktree from 4885f24, dispatched (whisper 脚本 + builder 配置)
Task 7: review clean. ⚠️ deleteSession best-effort：ClaudeCliProvider.deleteSession 内部 try/catch 吞错（Task 5 审核已确认），满足。minor (deferred): runTurn 的 catch 同时包住 deps.send，send 抛错会覆盖已保存的 done 并产生未处理 rejection（建议 send 单独 try/catch）; deleteConversation 未包 ai.deleteSession。
Task 7: complete (commits 86b2d6b..6d1ec44, review clean) — merged into m1
Task 9: worktree from 3a85492, dispatched
Task 9: implementer DONE (164c723); review dispatched
Task 10: worktree from 164c723 (task-9 head), dispatched in parallel with Task 9 review
Task 9: review clean. minor (deferred): pickImages 读文件无 try/catch（文件消失会整体 reject）; lessons:delete 内联 uuid schema 与 ConversationIdSchema 重复; 读图逻辑在入口文件; register.test 固定 /tmp 路径。
Task 9: complete (commits 3a85492..164c723, review clean) — ff merged into m1
Task 14a: implementer DONE_WITH_CONCERNS (12b4f5a). whisper.cpp 1.9.5，-ojf 可用，字段与计划一致，冷启动 7.46 s / 热 0.32 s，文本完全正确。Ruling: 脚本末行 `$WORK（` 改 `${WORK}（`（bash 3.2 set -u 下崩）接受 — 计划缺陷 — 代价：无。阶段 2 注意：token 含 [_BEG_]/[_TT_*] 特殊 token 拉低置信度均值，解析时要过滤；`say` 在后台作业下首次挂起 90 分钟（疑似等待 tty），app 内调用要带超时。help grep 只匹配到部分 flag（brief 的 grep 模式缺陷，真实 help 行已记在报告）。
Task 10: implementer NEEDS_CONTEXT — eslint react-refresh/only-export-components 报 useChat 与 ChatProvider 同文件。Ruling: eslint.config.mjs 的 react-refresh 规则加 allowExportNames: ['useChat']，保持计划文件结构 — 代价：该文件热更新时整树刷新，开发态可接受。Ruling: brief 接口摘要里的 refreshConversations 与代码块不一致，以代码块（ui/dispatchUi/clearError）为准 — Task 11 计划代码正是按此写的 — 代价：无。
Task 10: implementer DONE_WITH_CONCERNS (4f80219); 规则级别保持模板的 error，接受; review dispatched
Task 11: worktree from 4f80219 (task-10 head), dispatched in parallel with Task 10 review
Task 14a: review clean. minor (deferred): help grep 正则漏掉带逗号的 flag; curl 无 -f 且直写最终路径，中断会留坏文件; 均值 p 含特殊 token。⚠️ files 列表未排除 .superpowers/ .worktrees/ 与根目录用户文件，是否被打进 asar → 交给 14b 的 build:unpack 确认并补 `!.superpowers/*` `!.worktrees/*` `!SpeakMate_Electron_AI_.md`。
Task 14a: complete (commits 4885f24..12b4f5a, review clean) — merged into m1
Task 10: review — Important (plan-mandated): 流式事件早于 send/create 的 IPC 回复到达时（如二进制缺失立即 error），reducer 随后的 userSent/created 会覆盖占位并把状态推回 sending，终态事件已被消费 → 会话卡死。Ruling: 按 spec（失败状态可恢复）修复 — reducer 的 created/userSent 幂等：id 已存在则不覆盖；若该消息已是终态则不转 SEND（或直接按终态转 DONE/FAIL/STOP）— 代价：reducer 多几行与两条测试。minor (deferred): messages 加载 effect 依赖 state.messages 可能重复加载/晚到覆盖; void 的 api promise 无 catch; 删除会话不清 ui/errors/retrying; errors 类型应为 AIErrorKind; 缺 error 事件清 retrying 的测试。
Task 10: fix round 1/5 dispatched (resume implementer)
Task 10: fix round 1/5 (1 addressed, 0 open — reducer 幂等 + 两条早到事件测试; commits 4f80219..84a811f)
Task 10: complete (commits 164c723..84a811f, review clean after 1 fix round) — merged into m1
Task 11: implementer DONE_WITH_CONCERNS (f427041). Ruling: brief 的 btn 公共类 bg-surface text-fg-2 覆盖了发送/停止按钮配色（发送键白底白箭头），接受实现者拆出 plain 类 — 计划缺陷 — 代价：无。Ruling: 引号改 &quot; 满足 react/no-unescaped-entities，接受。观察：打字发送时 sending 与首个 delta 同一渲染，状态条看不到 sending（Fake 太快），非缺陷。review dispatched。
Task 12: worktree from f427041 (task-11 head), dispatched in parallel with Task 11 review
Task 11: review — Important (plan-mandated): ERROR_TEXT 缺 unknown，错误横幅会显示英文 "unknown"。Ruling: 修复，类型收紧为 Record<Exclude<AIErrorKind,'aborted'>,string> 并加 unknown 中文文案 — spec 要求错误提示中文 — 代价：无。minor (deferred): 删除二次确认状态切换会话不重置且定时器不清; InputBar 草稿不按会话隔离; 发送键 border-line/border-transparent 冲突; li 不可键盘访问; VocabChips key 用 word 可能重复; onDragOver 对非文件拖拽也显示覆盖层。
Task 11: fix round 1/5 dispatched (resume implementer)
Task 11: fix round 1/5 (1 addressed, 0 open — ERROR_TEXT 补 unknown 并按 AIErrorKind 约束; commits f427041..60f4a6e)
Task 11: complete (commits 4f80219..60f4a6e, review clean after 1 fix round) — merged into m1
Task 12: implementer DONE_WITH_CONCERNS (db6bf20). Ruling: 为满足 react-hooks set-state-in-effect，弹窗打开时的状态重置改在渲染期按 open 变化执行、LessonsPage 用 then(apply)，接受 — 不禁用规则 — 代价：审核需确认无重复渲染副作用。brief "Produces" 漏写 onStartQa/refreshKey/onSaved，以代码块为准。minor (deferred): addFromDisk 无 try/catch。review dispatched。
Task 12: review — Important ×2 (plan-mandated): (1) LessonDialog 加载 effect 无取消且在 effect 内调原生选图（StrictMode 下双弹、关闭后重开出现旧图）；(2) addFromDisk 无 try/catch。Ruling: 修复 — pickFromDisk 改为 App 先 pick 再以 initialRaw 传入；effect 加 cancelled 标志；addFromDisk 包 try/catch 并只压缩 room 张 — 代价：props 变化一处。minor (deferred): 背板点击/Esc 丢弃草稿、保存后 createConversation 失败会重复保存课程、课程删除确认不绑定 id、Modal 无 role/焦点管理、Esc 监听随 App 渲染重订、压缩期间无反馈、NewConversationDialog 短暂显示旧课程列表、0×0 图片通过检查、重复生词 key、错误格式化重复 4 次。
Task 12: fix round 1/5 dispatched (resume implementer)
Task 12: fix round 1 implemented (79324bc); minor (deferred): App 的 pickAndOpen 若 image.pick 本身失败无 catch; re-review dispatched
Task 12: fix round 1/5 (2 addressed, 0 open; commits db6bf20..79324bc). minor (deferred): App.pickAndOpen 无 try/catch（pick 失败弹窗不开且 rejection 未处理）; addFromDisk 关闭后仍可 setState（下次打开会重置，无害）。
Task 12: complete (commits f427041..79324bc, review clean after 1 fix round) — merged into m1
Task 13: worktree from m1 head, dispatched
Task 13: implementer DONE_WITH_CONCERNS (b67ca88)。真实联调 7 步全过：check 4.9 s；开场首字 2.2 s；纠错卡正常（goed/buyed→went/bought + 中文解释 + 1 生词）；停止后 resume 正常；课文图片识别正常；重启数据保留；auth 状态不变。Ruling: “识别” 改中文引号满足 lint，接受；prettier 重排了 spec 全文（仅空白/表格对齐），接受 — 代价：该提交 diff 噪音。
**Important（Task 7 代码，留给最终审查修复波）**: 停止恰好落在回复完成时，provider 在 done 之后还会 yield 一个 aborted error，ChatService 把已完成消息改写为 stopped 并清掉 structured（纠错/生词丢失）。修法：ChatService 在 done 后忽略后续 error；provider 收到 result 后 return 不再迭代。
观察：长回复的 text_delta 全部在末尾到达（首个 20 s），停止生效约 2 s；真实数据目录里留下了 2 个会话 1 篇课程（联调产物，保留）。
Task 14b: worktree from b67ca88 (task-13 head), dispatched in parallel with Task 13 review
Task 13: review clean（审核确认 service.ts 停止晚于 done 的覆盖 bug 真实存在，升级为最终修复波必修项）。minor (deferred): runCheck 在 IPC 抛错时卡在 检测中; label 未与控件关联（toggle 的 label 为空）; model select 遇到未知值显示账号默认; 检测耗时与点击到结果有 ~2 s 差。
Task 13: complete (commits 1320e56..b67ca88, review clean) — merged into m1
Task 14b: implementer DONE_WITH_CONCERNS (e08fa72)。首次 Finder 启动检测失败 spawn ENOTDIR（SDK 从 app.asar 内路径找二进制）。Ruling: 接受代码修复 — 打包态通过 pathToClaudeCodeExecutable 指向 app.asar.unpacked 的 CLI（provider 新增 cliPath 选项 + 单测）— spec 第 11 节本就要求打包后可用 — 代价：provider 多一个可选项。修复后检测通过（claude-fable-5-1，2856 ms）。启动方式为 AppleScript 让 Finder 打开 .app（父进程 launchd、最简 PATH），非真人双击，建议用户亲手双击一次复核。asar 已确认不含 .superpowers/.worktrees/用户根文件。review dispatched。
Task 14b: review clean. minor (deferred): packagedCliPath 的 require.resolve 失败会在 whenReady 里未处理 reject（建议 try/catch 退回 SDK 默认）; 平台包命名与 electron-builder.yml 重复编码。
Task 14b: complete (commits b67ca88..e08fa72, review clean) — merged into m1 (06aff56)
All tasks complete. Final whole-branch review dispatched (merge-base 5fd7fc8..06aff56)
Final review: With fixes — Important ×5（停止晚于 done 覆盖、首轮失败后 sessionId 被占用永久不可用、streaming 行永不收尾、打包后拖文件导航到 file://、send 失败丢文本）+ 必修 minor ×6（JSON 原文降级、删除确认绑定 id、启动错误处理、窗口标题、识别结果回灌、spec 两处文字）。Ruling: §8.3 切换会话不取消后台回复 — 按实现改 spec；§4.5 启动二进制检查延后到阶段 4 — 改 spec；其余 later-milestone 条目全部保留在本账本，不进本波。Declined-to-judge 各行：cleanEnv 其他 ANTHROPIC_*/CLAUDE_* 变量、SDK 流式时序、HEIC、"无法识别"可保存、会话列表不重排、listLessons N+1、阶段 2/3 功能、无障碍 — 全部接受为 M1 范围外。
Final fix wave dispatched (one fixer) — findings file: final-review-findings.md
Final fix wave DONE_WITH_CONCERNS（11 commits 795c33b..93be8a9，84/84 测试）。Ruling: §8.3 保留"停止 speaking"只替换取消 streaming 部分，接受；item 5 增加 error/shown reducer 动作与 InputBar sending 防重复提交，接受（在裁定范围内的最小实现）。真实 Claude (a)(b) 通过（共 5 次调用）。拖放只能用合成事件验证，真人拖放留给用户验收。Scoped re-review dispatched.
Final re-review: all 11 addressed. minor (deferred): service.ts done 分支 terminal 先于 updateMessage 置位，DB 写失败时行停留 streaming 直到下次启动清扫。
