# M4 ledger — 阶段 4 稳定与打包（无单独计划文档，用户要求"快速并行执行完"；依据 spec §9、§10、§12 及 §2 阶段 2/3 验收问题）
Ruling: 不写完整计划文档、逐任务不派审查，改为 controller 核 diff + 末尾一次整分支终审 — 用户明确要快 — 代价：问题晚一步发现。
Ruling: 不签名、不开 hardened runtime — spec §12 验收只要求本机干净安装可启动 — 代价：分发给别人时会被 Gatekeeper 拦。
现状：build:mac 已能出 dmg（dist/my-tutor-1.0.0.dmg，ad-hoc），§9 错误表除下列外已实现。
Base: m4 @ 51c350b
Wave 1 (并行): voice（阶段 2 问题②③）、resume（问题⑥ 续聊失败降级）、perf（回复慢排查）
Wave 2: 合并后打包 + dmg 干净安装验收 + 手动清单，写回 spec §2
voice: complete (ea23ad2) merged。Ruling: 录音中断横幅在识别成功后清掉（可能一闪而过）接受 — 部分录音已正常识别，提示价值低。
resume: complete (30587dd) merged。会话找不到时以新会话重试一次 + 最近 10 条回顾。cwd 变化未实测。
perf: complete (6eb1413, 仅 spec 记录) merged。Ruling: 不改调用选项 — 实测 CLI 每轮 3–9 s，选项已最小；19–66 s 待 Wave 2 应用内计时确认。
Wave 2: dmg 已构建（m4 @ 1632c3d），打包验收 dispatched（安装到 /Applications，隔离数据目录 + 真实数据只读检查）
Acceptance: pass with issues (a846cf3)。每轮应用开销 0.25 s，模型 2.6–9.3 s，"慢"主要是自动朗读计入 idle。
Ruling: 修 ①未登录不报错 ③Markdown 星号 ④迁移失败弹窗自动消失 ⑤模型恢复后麦克风不恢复 ⑥DB 版本比应用新不拦截 ⑦设置页缺 whisper 路径与数据目录。不修 ②（体验：朗读可在设置关闭）⑧（设计行为：补跑小结/画像）— 代价：首次升级启动有 4 次后台调用。
Fix wave (并行): fixA 主进程（①④⑥）、fixB 渲染（③⑤）、fixC 设置页（⑦）
fixA: complete (6ae1ac4) merged。弹窗自动消失根因未查明，需打包复测。
fixB: complete (196ae36) merged
fixC: complete (61953b3) merged
Packaged retest (controller): ①未登录 check ok=false + chat 事件 kind=not_logged_in、消息 status=error 空正文 ✅；⑥ user_version=99 时弹窗阻塞 24 s+ 不退出、DB 未改 ✅（无辅助访问权限，未能点按钮验证点后退出）。Final review dispatched.
Final review: ready to merge。Important（弹窗未验证）已由 controller 打包复测覆盖。Minor 1–4 controller 直接修（$(git rev-parse --short HEAD)），194 tests pass。
M4 complete — merged into dev
