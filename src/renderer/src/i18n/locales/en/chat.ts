// en · chat 命名空间（键名用 camelCase；插值写 {name}）
export default {
  // 侧边栏
  'chat.nav.chat': 'Chat',
  'chat.nav.lessons': 'Lessons',
  'chat.nav.mistakes': 'Mistakes',
  'chat.nav.vocab': 'Vocabulary',
  'chat.nav.analysis': 'Insights',
  'chat.nav.settings': 'Settings',
  // 模式
  'chat.mode.free': 'Free chat',
  'chat.mode.lesson': 'Lesson Q&A',
  'chat.mode.roleplay': 'Role-play',
  'chat.mode.scenario': 'Scenario',
  'chat.mode.targeted': 'Targeted practice',
  // 会话列表
  'chat.conversations': 'Conversations',
  'chat.newConversation': '＋ New',
  'chat.noConversations': 'No conversations yet. Click "New" to start.',
  // 聊天页
  'chat.error.notLoggedIn':
    'Claude Code is not signed in or unavailable. Go to Settings and click "Test connection".',
  'chat.error.binaryMissing': 'Claude binary not found. Please reinstall dependencies.',
  'chat.error.rateLimited': 'Rate limited. Please try again later.',
  'chat.error.network': 'Network error. Please try again later.',
  'chat.error.unknown': 'Request failed. Please try again later.',
  'chat.voice.notReady': 'Speech recognition not ready',
  'chat.voice.statusFailed': 'Speech recognition not ready: could not read status',
  'chat.voice.binaryMissing':
    'Speech recognition not ready: whisper-cli not found. Check it in Settings',
  'chat.voice.modelMissing':
    'Speech recognition not ready: model not downloaded. Download it in Settings',
  'chat.voice.startRecording': 'Start recording',
  'chat.voice.checking': 'Checking speech recognition…',
  'chat.voice.silent': "Didn't hear anything. Move closer to the mic and try again.",
  'chat.voice.micDenied':
    'Microphone access denied. Allow my-tutor in System Settings → Privacy & Security → Microphone.',
  'chat.voice.startFailed': "Couldn't start recording: {message}",
  'chat.dropHint': 'Drop to extract study material',
  'chat.dropUnsupported': 'Only images and .txt / .md text files are supported',
  'chat.stopSpeaking': 'Stop reading',
  'chat.confirmDelete': 'Confirm delete?',
  'chat.delete': 'Delete',
  'chat.retrying': 'Retrying Claude request (attempt {n})…',
  'chat.openSystemSettings': 'Open System Settings',
  'chat.dismiss': 'Got it',
  'chat.emptyHint': 'Start a new conversation to practice',
  // 输入栏
  'chat.input.fromAsr': '🎙 From speech recognition',
  'chat.input.asrUncertain': ' · Uncertain, please check',
  'chat.input.clearAsr': 'Clear label',
  'chat.input.pickImage': 'Choose an image to extract study material',
  'chat.input.transcribing': 'Transcribing…',
  'chat.input.placeholder': 'Type in English, or tap the mic to speak…',
  'chat.input.stopRecording': 'Stop recording',
  'chat.input.cancelTranscribe': 'Cancel transcription',
  'chat.input.stopGenerating': 'Stop generating',
  'chat.input.send': 'Send',
  // 消息
  'chat.message.voiceInput': '🎙 Voice input',
  'chat.message.stopped': 'Stopped',
  'chat.message.sendFailed': 'Failed to send',
  'chat.message.speakDisabled': 'Reply still generating, cannot read aloud yet',
  'chat.message.speak': '🔈 Read aloud',
  // 纠错卡
  'chat.correction.title': 'Correction · {category}',
  'chat.correction.uncertain': 'Possibly a recognition error',
  'chat.correction.original': 'Original',
  'chat.correction.improved': 'Better',
  'chat.correction.explanation': 'Why',
  'chat.category.grammar': 'Grammar',
  'chat.category.wordChoice': 'Word choice',
  'chat.category.naturalness': 'Naturalness',
  'chat.category.other': 'Other',
  // store 写入的提示
  'chat.asr.binaryMissing':
    'Speech recognition not ready: whisper-cli not found. Check it in Settings.',
  'chat.asr.modelMissing':
    'Speech recognition not ready: model not downloaded. Download it in Settings.',
  'chat.asr.empty': "Couldn't recognize anything. Try again.",
  'chat.asr.timeout': 'Recognition timed out. Try a shorter recording.',
  'chat.asr.failed': 'Recognition failed',
  'chat.asr.failedWithReason': 'Recognition failed: {message}',
  'chat.speakFailed': 'Read-aloud failed: {message}',
  'chat.sendFailed': 'Failed to send: {message}',
  // 录音与图片
  'chat.recorder.alreadyRecording': 'Already recording',
  'chat.recorder.micDisconnected': 'Microphone disconnected',
  'chat.image.decodeFailed': "Couldn't decode image",
  'chat.image.canvasUnavailable': 'Canvas unavailable',
  'chat.image.tooLarge': 'Image is still too large after compression'
} as Record<string, string>
