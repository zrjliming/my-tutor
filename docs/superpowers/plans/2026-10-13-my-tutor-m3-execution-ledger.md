# SDD ledger — plan: docs/superpowers/plans/2026-10-13-my-tutor-m3-learning-records.md

Spec: docs/superpowers/specs/2026-10-12-speakmate-design.md（§6、§7.1–7.4、§8.4、§12）
Integration branch: m3（从 dev 3a3e9ba 起），完成后合回 dev。并行任务用 .worktrees/m3-task-N。
Waves: [1] → [2,3] → [4,5] → [6] → [7,8,9] → [10]
Commit trailer: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

## Pre-flight scan
| 配对 / 任务 | 产出 vs 消费 | 结果 |
|---|---|---|
| T1 ↔ T2–T9 | Mistake/VocabEntry/LearnerProfile/LearningStats/MistakeFilter/AnalyzeOutcome/CATEGORY_LABEL/REVIEW_INTERVALS_DAYS 与 schema 名 | 一致 |
| T2 ↔ T4/T5/T6 | db 函数签名（insertMistake/upsertVocab/insertPracticeSession/getPracticeSession/dueMistakes/getMistakesByIds/markMistakeReviewed/…） | 一致；closeStaleSessions 由 T5 加到 practice.ts（T2 不写） |
| T3 ↔ T4/T5 | buildSystemPrompt targeted/profileSummary、formatProfileSummary、SUMMARIZE/ANALYZE 常量 | 一致 |
| T4 ↔ T5 | T4 改 chat/lessons service，T5 新建 learning/service.ts + practice.ts 追加函数 | 文件不相交，可并行 |
| T6 ↔ T7/8/9 | 页面导出名与 props；T6 写骨架，T7/8/9 只替换各自文件；T9 另改 NewConversationDialog/fake/index.ts | 可并行（T9 改 index.ts 的 Fake 分支，T6 已先合入） |
| T1 Step 7 ↔ T6 Step 1 | register.test 暂时排除新通道，T6 恢复 | 一致 |
| T6 Step 5 | dev:fake 里 Fake 分析结果为课文结构，小结会静默失败 | 已在 T6 说明；T9 提供 analyzeCandidates |
| 各任务自洽 | 测试 vs 实现 | 逐任务核对一致；T7/8/9 无组件测试，以 typecheck+手动为准 |
| spec §7.2 "应用退出时" | 退出时无法等 LLM | Ruling: 改为下次启动补跑（closeStaleSessions + sweep）— 代价：小结晚一次启动才出现 |
Task 1: dispatched (BASE 3a3e9ba, in place on m3)
Task 1: implementer DONE (7e02143)，147/147。review dispatched.
Tasks 2/3: worktrees from 7e02143, dispatched in parallel with Task 1 review
Task 1: review clean. minor (deferred): CorrectionCategory 与 MistakeFilterSchema 重复列举类别; IdSchema / ConversationIdSchema / 内联 uuid 三处重复。
Task 1: complete (commits 3a3e9ba..7e02143, review clean) — in place on m3
Task 3: implementer DONE (b7d9954); review dispatched
Task 3: review clean. minor (deferred → 终审修复波一并改): summarize-session "transcript only" 与提供的纠错矛盾，改为 "transcript and corrections provided"; targeted-practice "has to use exactly" 改为更自然的 "give natural chances to use"; 空材料时 "listed below" 与兜底文案不一致、"learner level" 应为 "learner's level"; analyze-learner 首次评估无先前水平的说明; 引号未转义。
Task 3: complete (commits 7e02143..b7d9954, review clean) — merged into m3
Task 2: review clean。控制器用真实 v1 数据库副本跑迁移 2：4 会话 / 32 消息保留，practice_sessions 补齐 4 条。minor (deferred): 熟悉度排序测试未真正区分; clearVocabSource 'nothing' 无断言; JSON.parse 无保护; stats 用 in 判断; 删除时置空与 DELETE 不在同一事务; listMistakes('all') 仅含 pending（UI 需按"全部待复习"理解）。
Task 2: complete (commits 7e02143..bfaa17d, review clean) — merged into m3 (a0bd112)
Tasks 4/5: worktrees from a0bd112, dispatched in parallel
Task 4: implementer DONE (60b7dca)。测试辅助的 uuid/now 生成调整，接受。review dispatched.
Task 5: implementer DONE_WITH_CONCERNS (6c2d4e6)。Ruling: auto-analyze 测试时间戳改为 last=NOW-0.05d、later=NOW+1.5d，使'只有新小结'真正被测到 — 计划测试缺陷 — 代价：无。closeStaleSessions 按 brief SQL 关闭所有未结束记录（<3 轮的本就不生成小结），接受。review dispatched.
Task 4: review clean. minor (deferred): 建会话时 now 取了两次; 每条记录各取一次 now; LessonService 生词写入无 try/catch（失败时课程已存但报错）; 测试名声称测重复实际只测 uncertain。
Task 4: complete (commits a0bd112..60b7dca, review clean) — merged into m3
Task 5: review clean. minor (deferred): sweepPendingSummaries 缺"仅启动时调用"注释 → Task 6 装配时加注释; 复习推进与 reviewsApplied 不在同一事务; 单条消息未截断; 启动补关的会话 ended_at 可能早于 lastProfileAnalysisAt，不计为新数据。
Task 5: complete (commits a0bd112..6c2d4e6, review clean) — merged into m3 (6da5eb5)
Task 6: dispatched in place on m3
Task 6: implementer DONE (8e7640d)。review dispatched.
Tasks 7/8/9: worktrees from 8e7640d, dispatched in parallel with Task 6 review。各自用不同的 dev 用户数据目录避免互相干扰。
Task 6: review clean. minor (deferred → 终审考虑): 开发模式 StrictMode 双挂载会在进入聊天页时立即 end 会话（生产不受影响）; 已结束的会话回来继续聊不会重新打开，后续轮次进不了小结（建议：send 时若练习记录已结束则清空 ended_at 与 summary，下次离开时重新生成）; 冒烟测试在真实 dev 库留下一个 3 轮会话。
Task 6: complete (commits 6da5eb5..8e7640d, review clean) — in place on m3
Task 9: implementer DONE_WITH_CONCERNS (acd6d0d)。Ruling: set-state-in-effect 改为 then 回调写法，接受。Ruling: "上次分析"显示 UTC 是用户可见缺陷，审核前直接改本地时间；列表加圆点 — 代价：无。minor (deferred → 终审): 练习次数把 0 轮会话也算进去（stats.ts 应只计 turn_count > 0）。
Task 8: implementer DONE (19affc1)。观察：并行任务共用 scratchpad 导致 CDP 脚本被覆盖、几次点击落到别的实例（仅导航，无写入）→ 今后并行任务各用独立 scratchpad 子目录。minor (deferred): 首屏 250 ms 先显示空状态。review dispatched.
Task 9: review — Important: 新建会话弹窗的针对性练习预览请求无 rejection 处理，且重开时显示旧数据。Ruling: 加失败兜底、重开时重置、alive 守卫；有画像但无薄弱点时文案改"学习画像暂无薄弱点"；分析页列表 key 用下标 — 代价：无。
Task 9: fix round 1/5 dispatched
Task 8: review clean. minor (deferred → 终审修复波): 搜索响应可能乱序覆盖; setFamiliarity/delete 失败未捕获; 首屏空状态闪现与计数 0; 熟悉度圆点可访问性（尺寸、aria-label 不含单词、当前值点击语义）; 计数只算当前搜索结果。
Task 8: complete (commits 8e7640d..19affc1, review clean) — merged into m3
Task 9: fix round 1/5 (2 addressed, 0 open; commits 3ae67d9..d5e1aaa)。minor (deferred): 课程列表加载同样缺 rejection 与 alive 守卫。
Task 9: complete (commits 8e7640d..d5e1aaa, review clean after 1 fix round) — merged into m3
Task 7: implementer DONE_WITH_CONCERNS (a59e13b)。Ruling: set-state-in-effect 用 load().then 写法，接受。concern: master/remove 无错误处理（照 brief），交审查判定。review dispatched.
Task 7: review — Important: master/remove 失败无提示（unhandled rejection）。Ruling: 加 try/catch 显示"操作失败"；顺带修 minor：筛选切换加 cancelled 守卫、md() 用本地日期 — 代价：无。
Task 7: fix round 1/5 dispatched
Task 7: fix round 1/5 (3 addressed, 0 open; commit 7db777a，controller 直接核对 diff)
Task 7: complete (commits 8e7640d..7db777a, review clean after 1 fix round) — merged into m3
Task 10: dispatched（真实 Claude 验收，隔离数据目录 /private/tmp/my-tutor-acc，端口 9880）
Task 10: complete (commit b223076, 真实 Claude 10 次调用) — 验收通过。Ruling: 练习次数计 0 轮会话 → 并入终审修复波（stats 只计 turn_count > 0）。Ruling: 针对性练习中同类错误换句子再犯记为新错句 — 不改：错句按原句去重是 spec 设计，语义合并需要额外 AI 调用，属过度设计 — 代价：错句本可能有近义条目。Ruling: 每轮 19–66 s 慢 — 记录给阶段 4 排查，不在 M3 处理。
Final review (3a3e9ba..b223076): needs fixes — Important 2（针对性会话 0 轮也推进复习；练习次数计 0 轮会话）。
Ruling: 终审修复波做 Important 1-2 + minor 3（等回复结束再结束会话）、4（续聊重开会话）、6（提示词措辞）、7（VocabPage 操作失败提示 + 首屏 loaded 标志）、8、9、10；其余（StrictMode、11、12、乱序搜索、圆点可访问性）不改 — 理由：无害或风险近零，避免过度设计 — 代价：小瑕疵留存。
Final fix wave dispatched
Final fix wave: commits 18814da, 5b5e6f1 (184 tests pass)。controller 直接核对 main 进程 diff，Important 1-2 已修。Ruling: 第 9 项用 BEGIN/COMMIT（node:sqlite 无 db.transaction），接受。Ruling: 离开后立刻回来发言、小结晚于重开写回的竞态窗口 — 接受，概率极低，后果仅为小结少一轮 — 代价：偶发旧小结。
M3 complete — merged into dev
