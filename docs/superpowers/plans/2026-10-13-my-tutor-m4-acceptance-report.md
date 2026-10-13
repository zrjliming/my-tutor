# 阶段 4 打包验收报告（2026-10-13）

结论：**通过，附问题**。dmg 能在本机干净安装并启动，关键功能可用，§9 的失败场景里便宜可模拟的都能恢复。但有一个用户影响较大的问题：Claude 未登录时没有任何错误提示（见问题 ①）。

- 构建产物：dist/my-tutor-1.0.0.dmg（m4 @ 1632c3d，ad-hoc linker-signed，Identifier=Electron）
- spec 提交：a846cf3（只改 spec §2）
- 脚本与原始数据：/private/tmp/claude-501/-Users-zhouruijie-daypop-code-server-my-tutor/c2cebb77-b9bf-468e-9953-f355f859b543/scratchpad/acc4/
  - `turn0..4.json`（逐轮计时）、`deleted-session.jsonl`（被删的 CLI 会话，含时间戳）、`real-backup/`（真实数据目录备份，不含 466 MB 模型）、`real-dump-before/after.sql`、`mig-dialog.png`、`ps-voice.txt`
- 真实 Claude 调用共 8 次：检测连接、开场白、文字 2 轮、语音 1 轮、会话续接降级 1 轮、离开时的小结、更新分析。续接失败那次 resume 没有调到模型。未登录测试在 CLI 那一层就失败了，也没有调到模型。

## 1. 干净安装
- 先用 `hdiutil attach` 挂载，把 my-tutor.app 拷入 /Applications，再 detach。本地拷贝的文件没有 quarantine 属性。
- **注意**：直接执行 `open -a` 时，启动出来的进程继承了终端的完整 PATH（`ps eww` 里能看到），所以这不是最小 PATH。改用 `env -i HOME=… PATH=/usr/bin:/bin:/usr/sbin:/sbin open -a … --stdout/--stderr …`，这样 PPID=1、PATH 是最小的，stdout 和 stderr 也能落到文件里。
- 启动日志只有 `node:sqlite ExperimentalWarning`。设置页在最小 PATH 下显示「已找到 /opt/homebrew/bin/whisper-cli」。全新数据目录下显示「模型 ● 未下载」，并给出下载按钮。

## 2. 关键功能（隔离目录 /private/tmp/my-tutor-m4acc）
- 检测连接：连接正常 · claude-opus-5-5 · 3810 ms（从点击到界面显示共 5.7 s。多出的约 1.9 s 发生在 check() 计时之外，原因未查）。
- 自由聊天：开场白之后两轮文字，"goed/buyed" 和 "don't/prefer" 都出了纠错卡（语法），也出了生词。
- 语音一轮：注入的是 `say` 合成的 4.3 s WAV。录音到 transcribing 用时 5.4 s，识别 0.50 s，文字完全正确，带「来自语音识别」标记。发送后消息的 fromAsr=1，"have went" 记为错句（uncertain=false）。
- 错句本有 3 条，生词本有 9 个，学习分析页（统计 1 次 / 4 轮）都能正常渲染。离开聊天页后小结生成，内容贴合。点「更新分析」12.7 s 后得到 A2，薄弱点准确。

### 应用内计时（MutationObserver 记录 pill 和气泡变化，`speakmate.chat.onEvent` 记录 IPC 事件，再对照 CLI jsonl）
自动朗读：**开**（默认值）。状态序列是 sending → streaming → speaking → idle。React 批处理时 done 后的那次 idle 不会单独渲染出来，所以「回到 idle」要等朗读结束。

| 轮次 | 点击→CLI 收到 | 首字出现 | done（纠错卡） | 朗读 | 回到 idle |
|---|---|---|---|---|---|
| 开场白 | 0.26 s | 1.32 s | 2.58 s | 7.6 s | 10.2 s |
| 文字 1 | 0.27 s | 无流式（与 done 同时，5.35 s） | 5.35 s | 14.0 s | 19.3 s |
| 文字 2 | 0.25 s | 1.79 s（末个 delta 2.59 s） | 5.65 s | 13.7 s | 19.3 s |
| 语音 | 0.28 s | 5.15 s（末个 delta 6.29 s） | 9.31 s | 15.8 s | 25.1 s |
| 续接降级 | 1.40 s（resume 失败 + 删会话） | 3.21 s | 7.16 s | 13.4 s | 20.6 s |

时间主要花在这几处：
1. 应用自身开销（IPC、建占位消息、spawn CLI）约 0.25 s。UI 收到 done 的时间与 jsonl 里 StructuredOutput 的时间差小于 0.05 s，主进程这一段没有额外排队。
2. 模型 2.6～9.3 s。正文流完之后还要 2.5～4 s 才 done，这段时间模型在把 reply、纠错、生词再写一遍 StructuredOutput JSON，所以纠错卡总是比正文晚。文字第 1 轮模型先思考，然后直接调用工具，这一轮完全没有流式输出。
3. **自动朗读 7.6～15.8 s，是到 idle 为止最大的一块。** reply 本身包含英文的纠错讲解，所以每轮朗读都很长。
- 结论：之前报的「每轮 19～66 s」，主要是把自动朗读算进了「回到 idle」。本次「首字」和「纠错卡」的时间与直调 SDK 的基准（3～9 s）一致。66 s 这种量级本次没有复现。

## 3. 失败恢复
- **模型改名**：留在聊天页时，麦克风会先保持可点；一点就重新检查，随即禁用，title 和横幅都提示「语音识别未就绪：模型未下载，去设置页下载」。把模型改回原名后，麦克风仍是禁用状态（禁用后点不了，也就不会重新检查），要离开聊天页（比如按提示去设置页）再回来才恢复。恢复后旧横幅还留着，等下一次识别成功才清掉。之后识别正常。
- **whisper-cli 路径无效**：设置页没有输入框，所以通过 `settings.patch({whisperBinaryPath})` 设置。设置页显示「未找到 /nonexistent/whisper-cli，请在终端运行 brew install whisper.cpp」，麦克风禁用并提示「找不到 whisper-cli」。把路径设回空值后恢复。
- **会话文件缺失**：把这个会话的 jsonl 从 ~/.claude/projects/-private-tmp-my-tutor-m4acc-claude-sessions/ 移走后再发送。新的降级逻辑生效：用新会话重跑，首条输入带「previous session could not be restored」回顾，回复能接上上下文（"great weekend"），额外耗时约 1.1 s。
- **迁移失败**：用 `.backup` 复制 DB 到单独目录，把 `user_version` 改为 1（实际是 2），迁移 2 会重复建表。结果弹出「数据库打开失败 / table mistakes already exists」（mig-dialog.png），之后应用退出，DB 的 sha1 前后一致。**但弹窗大约 1.2～6 s 后自己消失、应用退出，我没有点「好」**（三次运行分别在约 1.8 s、约 2 s、6 s 以上退出），用户可能来不及看。原因未查。
- 版本更高（`user_version`=99）：不报错，照常打开并读写。
- **未登录**（额外测试，零成本）：用 `CLAUDE_CONFIG_DIR` 指向空目录启动。检测连接显示「**连接正常** · claude-opus-5-5 · 191 ms」。发一条消息后，AI 气泡显示 "Not logged in · Please run /login"，状态是 done，还被自动朗读出来，没有错误横幅，也没有 `claude login` 指引。主进程日志只有 "structured output missing or invalid, degrading to text"。原因：`src/main/ai/claude-cli.ts` 遇到 subtype=success 的 result 时不检查 `is_error`，`check()` 只要收到 done 就算成功。
- 静音录音（3 s 全零 WAV）：提示「没听到声音，请靠近麦克风再试。」，不调用识别，回到 idle。
- 图片：粘贴 txt 被忽略；粘贴损坏的 png 时对话框提示「图片无法解码」；粘贴正常 png 有预览、✕ 和取消，并告知会发送给 Claude；点取消能关掉。
- 朗读：停止后 0.4 s 内 say 退出；关窗后 say 立即退出，应用仍在运行（macOS 行为）。AppleScript quit 之后没有 say、whisper-cli 或 claude 进程残留。

## 4. 升级数据保留（真实目录 ~/Library/Application Support/my-tutor）
- 先 rsync 备份到 acc4/real-backup（不含模型），再把 DB 导出为 real-dump-before.sql。
- 发现：在这份数据上，启动时 `sweepPendingSummaries` 会给 3 个 ≥3 轮但没有小结的旧会话补跑小结，`maybeAutoAnalyze` 也会因为从未分析过而跑一次画像。这 4 次是真实调用，而且会写库。为了遵守「不改数据」，这次启动设置了 `CLAUDE_CONFIG_DIR=/private/tmp/my-tutor-m4acc-noclaude`（空目录），让这些调用在 CLI 层失败。
- 结果：5 个会话（turn 3/3/1/10/0）、1 条错句（I goed to work）、1 个生词（commute）都还在，学习分析统计为 4 次 / 17 轮。没有发送任何消息。AppleScript quit 之后导出 DB，与启动前完全一致（diff 为空），DB 的 mtime 仍是 11:18。stderr 里只有 3 条 summarize failed 和 1 条 analyzeProfile failed，这是上面重定向导致的预期警告，静默失败，界面不受影响。还有一条 `mistakes:list` 参数校验错误，是我的探测脚本传错了参数，不是应用的问题。
- 生词本页面切换后第一次读取时一度显示「共 0 个」，2.5 s 后正常显示 1 个。原因是我读得太早，不算问题。

## 5. 原需求文档 §10 手动清单
AI 与聊天
- 连续多轮对话上下文正确：**通过**（4 轮，降级后也能接上上下文）
- 流式回复正常，停止生成有效：流式**通过**（部分轮次没有流式，见计时）；停止生成本次没重测（为节省调用；阶段 1 已通过），**需人工 / 沿用阶段 1**
- 网络断开、API 超时、限流、无效密钥有明确提示：未登录**失败**（问题 ①）；断网、超时、限流**需人工**
- 结构化输出异常时可回退到普通文本：**通过**（未登录时回退成纯文本展示，单测也覆盖）

图片
- 拖拽、粘贴、文件选择：粘贴**通过**（模拟）；拖拽和文件选择本次没测，阶段 1 已通过，**需人工**（原生文件对话框）
- 非法格式、过大图片被拦截：非图片被忽略、损坏图片有提示，**通过**；过大图片会被压缩，压缩后仍超 1.5 MB 才拦截，没构造这种图片
- 上传前可预览和取消：**通过**
- 识别结果可编辑后保存：本次没测（要真实调用），阶段 1 已通过

语音
- 首次麦克风权限申请：**需人工**
- 拒绝权限后的恢复指引：**需人工**（阶段 2 只验证了深链）
- 空录音、静音、噪声、设备拔出：静音**通过**；噪声和拔出见阶段 2（拔出为模拟）；真实设备**需人工**
- ASR 失败不破坏会话：**通过**（模型缺失、路径无效都只是提示，会话不受影响）
- 转写可修改再发送：**通过**（文字填入输入框，带标记，可编辑）
- TTS 可停止，关窗释放资源：**通过**
- 口音、延迟、CPU、内存：口音**需人工**；延迟见计时表；ps 粗测：空闲时 4 个进程合计约 550 MB（主进程 199、渲染进程 166、GPU 93、两个 helper 各 46），CPU≈0；识别时 whisper-cli 峰值约 850 MB / 45% CPU，0.3～0.5 s 后退出

数据与安全
- 会话、课程、错句、生词持久化：**通过**（隔离目录和真实目录都重启验证过；课程本次没有新建）
- API Key 不出现在渲染进程、日志、配置中：**通过**（本方案不用 Key；cleanEnv 会剔除 ANTHROPIC_API_KEY 等变量；日志里没有 token）
- Renderer 无 Node 直接访问：**通过**（`typeof require/process` 都是 undefined，只暴露 `window.speakmate`）
- IPC 输入经过校验：**通过**（传入非法参数时被 zod 拒绝）
- 原始音频不长期保存：**通过**（识别后 userData/tmp 为空）
- 图片上传与云端处理有清晰告知：**通过**（对话框和设置页都有说明）

打包
- 干净环境安装并启动：**通过**（本机、最小 PATH、launchd 父进程）
- 打包版麦克风权限：**需人工**（本机已授权；注入方式绕过了真实采集）
- 模型不存在时能引导下载或配置：**通过**（有下载按钮和提示）；whisper-cli 路径在界面里没法配置，只能提示 brew 安装
- 升级后本地学习数据仍在：**通过**

## 6. 问题（按用户影响排序，均未修代码）
1. **Claude 未登录时没有错误提示**：检测连接显示「连接正常」；聊天把 "Not logged in · Please run /login" 当作正常回复落库（done）并朗读，没有 §9 要求的错误状态和 `claude login` 指引。位置：`src/main/ai/claude-cli.ts` 的 `run()`（subtype=success 时没检查 is_error）和 `check()`（拿到 done 就判 ok）。
2. **每轮主观等待长**：自动朗读默认打开，而且朗读整段 reply（包括英文纠错讲解），占 7.6～15.8 s，到 idle 共 10～25 s；纠错卡又比正文晚 2.5～4 s。这不是 bug，是体验问题，也是此前「19～66 s」的主要来源。
3. **回复里有 Markdown 加粗**：例如 `**went**`，气泡原样显示星号，朗读也会读这段（属于提示词或渲染问题）。
4. **迁移失败弹窗会自己消失**：大约 1～6 s 后弹窗消失、应用退出，用户没点「好」，可能看不清原因（数据安全，没被改）。
5. **模型恢复后麦克风不会自动恢复**：因模型缺失禁用后，恢复模型要离开聊天页才会重新检测；「模型未下载」横幅在恢复后仍保留，直到下次识别成功或手动关闭。
6. **DB 版本高于应用已知版本时不拦截**：`user_version` 高于已知迁移数时直接打开，降级运行有误读或误写风险。
7. **设置页缺少两项**：没有 whisper-cli 路径输入，也不显示数据目录的实际路径（§8.4 列了这两项）。
8. **升级后首次启动的后台调用**（设计行为，记录在此）：会为没有小结的旧会话补跑最多 3 个小结，并自动分析画像，共 4 次调用，用户无感知，并写库。
另有一点不是应用问题：`open -a` 会继承调用方的环境，验收时要配合 `env -i` 才是 Finder 式的最小 PATH。

## 7. 收尾
所有实例都用 AppleScript quit 退出，没有残留进程。/Applications/my-tutor.app 保留。隔离目录（/private/tmp/my-tutor-m4acc、-mig-fail、-mig-hi、-noclaude）和 ~/.claude/projects/-private-tmp-my-tutor-m4acc-claude-sessions 都保留，留作证据。
