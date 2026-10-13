import { randomUUID } from 'node:crypto'
import type {
  ChatEvent,
  TutorResponse,
  ChatIpcEvent,
  Conversation,
  CreateConversationInput,
  Message,
  SendMessageInput
} from '@shared/types'
import { MODE_LABEL } from '@shared/types'
import type { AIProvider } from '../ai/types'
import type { Db } from '../db/index'
import {
  bumpTurn,
  deleteConversation,
  getConversation,
  insertConversation,
  markSessionStarted
} from '../db/conversations'
import { insertMessage, listMessages, updateMessage } from '../db/messages'
import { getLesson } from '../db/lessons'
import { getSettings } from '../db/settings'
import { dueMistakes, getMistakesByIds, insertMistake } from '../db/mistakes'
import { getPracticeSession, insertPracticeSession, reopenSession } from '../db/practice'
import { getProfile } from '../db/profile'
import { upsertVocab } from '../db/vocabulary'
import {
  buildSystemPrompt,
  formatProfileSummary,
  OPENING_INSTRUCTION,
  type TargetedMaterial
} from '../learning/prompts'
import { tm } from '../i18n'

// 语音识别可能把 goed 悄悄规整成 go/got：告诉 Claude 这一轮来自 ASR，只发给 provider，不入库
const ASR_NOTE =
  '(This turn was transcribed by speech recognition, which may silently normalise verb forms or mishear words. If an error might be a transcription artifact, set correction.uncertain = true.)'

// 会话文件丢失（dev:fake 建的会话、jsonl 被删、cwd 变了）时 CLI 报的就是这句
const RESUME_MISSING = /no conversation found with session id/i

export interface ChatServiceDeps {
  db: Db
  ai: AIProvider
  send: (event: ChatIpcEvent) => void
  now?: () => string
  uuid?: () => string
}

interface ActiveTurn {
  ac: AbortController
  done: Promise<void>
}

export class ChatService {
  private readonly active = new Map<string, ActiveTurn>()
  private readonly now: () => string
  private readonly uuid: () => string

  constructor(private readonly deps: ChatServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString())
    this.uuid = deps.uuid ?? randomUUID
  }

  async createConversation(
    input: CreateConversationInput
  ): Promise<{ conversation: Conversation; assistantMessageId: string }> {
    const lesson = input.lessonId ? getLesson(this.deps.db, input.lessonId) : undefined
    if (input.mode === 'lesson' && !lesson) throw new Error(tm('课程不存在', 'Lesson not found'))
    const title = lesson
      ? lesson.title
      : input.scenario
        ? `${input.scenario} · ${MODE_LABEL[input.mode]}`
        : MODE_LABEL[input.mode]
    const now = this.now()
    const conversation: Conversation = {
      id: this.uuid(),
      title,
      mode: input.mode,
      lessonId: lesson?.id ?? null,
      scenario: input.scenario ?? null,
      turnCount: 0,
      sessionStarted: false,
      createdAt: now,
      updatedAt: now,
      endedAt: null
    }
    insertConversation(this.deps.db, conversation)
    // 针对性练习的材料只在创建时选一次，首轮失败重试也用同一批
    const reviewedIds =
      input.mode === 'targeted' ? dueMistakes(this.deps.db, this.now(), 5).map((m) => m.id) : []
    insertPracticeSession(this.deps.db, conversation.id, input.mode, now, reviewedIds)
    const assistantMessageId = this.startTurn(conversation, OPENING_INSTRUCTION, true)
    return { conversation, assistantMessageId }
  }

  async send(
    input: SendMessageInput
  ): Promise<{ userMessage: Message; assistantMessageId: string }> {
    const conversation = getConversation(this.deps.db, input.conversationId)
    if (!conversation) throw new Error(tm('会话不存在', 'Conversation not found'))
    if (this.active.has(conversation.id))
      throw new Error(tm('上一轮尚未结束', 'The previous reply is still in progress'))
    const userMessage: Message = {
      id: this.uuid(),
      conversationId: conversation.id,
      role: 'user',
      content: input.text,
      structured: null,
      status: 'done',
      fromAsr: input.fromAsr ?? false,
      createdAt: this.now()
    }
    insertMessage(this.deps.db, userMessage)
    bumpTurn(this.deps.db, conversation.id, userMessage.createdAt)
    reopenSession(this.deps.db, conversation.id)
    const assistantMessageId = this.startTurn(
      conversation,
      userMessage.fromAsr ? `${ASR_NOTE}\n${input.text}` : input.text
    )
    return { userMessage, assistantMessageId }
  }

  cancel(conversationId: string): void {
    this.active.get(conversationId)?.ac.abort()
  }

  cancelAll(): void {
    for (const t of this.active.values()) t.ac.abort()
  }

  async whenIdle(conversationId: string): Promise<void> {
    await this.active.get(conversationId)?.done
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.cancel(conversationId)
    await this.whenIdle(conversationId)
    deleteConversation(this.deps.db, conversationId)
    await this.deps.ai.deleteSession(conversationId)
  }

  private startTurn(conversation: Conversation, text: string, isOpening = false): string {
    const assistantMessageId = this.uuid()
    insertMessage(this.deps.db, {
      id: assistantMessageId,
      conversationId: conversation.id,
      role: 'assistant',
      content: '',
      structured: null,
      status: 'streaming',
      fromAsr: false,
      createdAt: this.now()
    })
    const ac = new AbortController()
    const done = this.runTurn(conversation.id, text, assistantMessageId, ac, isOpening).finally(
      () => this.active.delete(conversation.id)
    )
    this.active.set(conversation.id, { ac, done })
    return assistantMessageId
  }

  private async runTurn(
    conversationId: string,
    text: string,
    assistantMessageId: string,
    ac: AbortController,
    isOpening: boolean
  ): Promise<void> {
    const { db, ai, send } = this.deps
    const conversation = getConversation(db, conversationId)
    if (!conversation) return
    const settings = getSettings(db)
    let firstTurn = !conversation.sessionStarted
    let prompt = text
    let content = ''
    let terminal = false
    let completed = false
    const emit = (ev: ChatEvent): void => {
      try {
        send({ ...ev, conversationId, messageId: assistantMessageId })
      } catch {
        // 窗口已关闭等：发送失败不能影响已落库的结果
      }
    }
    // 续接失败时这一轮以新会话重跑一次，并在提示前带上最近几条消息作为回顾
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        firstTurn = true
        content = ''
        await ai.deleteSession(conversationId)
        const recap = this.recentRecap(conversationId, assistantMessageId)
        if (recap) prompt = `${recap}\n\n${text}`
      }
      let resumeMissing = false
      try {
        for await (const ev of ai.chat({
          conversationId,
          firstTurn,
          systemPrompt: firstTurn ? this.firstTurnSystemPrompt(conversation) : undefined,
          text: prompt,
          signal: ac.signal,
          model: settings.model || undefined
        })) {
          if (terminal) continue
          if (ev.type === 'text_delta') {
            content += ev.text
          } else if (ev.type === 'done') {
            terminal = true
            completed = true
            const finalText = ev.structured?.reply ?? (content || ev.rawText)
            updateMessage(db, assistantMessageId, {
              content: finalText,
              structured: ev.structured ?? null,
              status: 'done'
            })
            if (firstTurn) markSessionStarted(db, conversationId)
            if (ev.structured && !isOpening) {
              this.recordLearning(conversationId, assistantMessageId, ev.structured)
            }
          } else if (ev.type === 'error') {
            if (attempt === 0 && !firstTurn && RESUME_MISSING.test(ev.message)) {
              resumeMissing = true
              break
            }
            terminal = true
            updateMessage(db, assistantMessageId, {
              content,
              structured: null,
              status: ev.kind === 'aborted' ? 'stopped' : 'error'
            })
          }
          emit(ev)
        }
      } catch (e) {
        if (!terminal) {
          terminal = true
          updateMessage(db, assistantMessageId, { content, structured: null, status: 'error' })
          emit({ type: 'error', kind: 'unknown', message: String((e as Error)?.message ?? e) })
        }
      }
      if (!resumeMissing) break
    }
    if (!terminal) {
      // 流结束却既无 done 也无 error：不能让消息停在 streaming
      const aborted = ac.signal.aborted
      updateMessage(db, assistantMessageId, {
        content,
        structured: null,
        status: aborted ? 'stopped' : 'error'
      })
      emit({
        type: 'error',
        kind: aborted ? 'aborted' : 'unknown',
        message: aborted
          ? tm('已停止', 'Stopped')
          : tm('回复意外中断，没有收到结果', 'The reply was interrupted before any result arrived')
      })
    }
    // 首轮没成功时 CLI 可能已写下会话文件，不删的话下次带同一 sessionId 会被拒（already in use）
    if (firstTurn && !completed) await ai.deleteSession(conversationId)
  }

  private firstTurnSystemPrompt(conversation: Conversation): string {
    const { db } = this.deps
    const settings = getSettings(db)
    const lesson = conversation.lessonId ? getLesson(db, conversation.lessonId) : undefined
    const profile = getProfile(db)
    let targeted: TargetedMaterial | undefined
    if (conversation.mode === 'targeted') {
      const ids = getPracticeSession(db, conversation.id)?.reviewedMistakeIds ?? []
      targeted = {
        weaknesses: profile?.weaknesses.slice(0, 3) ?? [],
        mistakes: getMistakesByIds(db, ids).map(({ original, improved }) => ({
          original,
          improved
        }))
      }
    }
    return buildSystemPrompt({
      mode: conversation.mode,
      difficulty: settings.difficulty,
      chineseExplanations: settings.chineseExplanations,
      lesson: lesson
        ? { title: lesson.title, body: lesson.body, notesZh: lesson.notesZh }
        : undefined,
      scenario: conversation.scenario ?? undefined,
      profileSummary: profile ? formatProfileSummary(profile) : undefined,
      targeted
    })
  }

  /** 最近约 10 条消息的纯文本回顾（不含本轮），给续接失败后的新会话垫上下文。 */
  private recentRecap(conversationId: string, assistantMessageId: string): string {
    const msgs = listMessages(this.deps.db, conversationId).filter(
      (m) => m.id !== assistantMessageId && m.content
    )
    // 最后一条用户消息就是本轮输入，已在 prompt 里
    if (msgs.at(-1)?.role === 'user') msgs.pop()
    const lines = msgs
      .slice(-10)
      .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content.slice(0, 200)}`)
    if (!lines.length) return ''
    return `(The previous session could not be restored. Recent conversation for context:\n${lines.join('\n')})`
  }

  private recordLearning(
    conversationId: string,
    assistantMessageId: string,
    structured: TutorResponse
  ): void {
    const { db } = this.deps
    try {
      const c = structured.correction
      if (c && c.uncertain !== true) {
        insertMistake(
          db,
          {
            conversationId,
            messageId: assistantMessageId,
            original: c.original,
            improved: c.improved,
            explanationZh: c.explanationZh,
            category: c.category
          },
          this.now(),
          this.uuid()
        )
      }
      for (const v of structured.vocabulary ?? []) {
        upsertVocab(
          db,
          {
            word: v.word,
            meaningZh: v.meaningZh,
            example: v.example,
            source: 'conversation',
            sourceId: conversationId
          },
          this.now(),
          this.uuid()
        )
      }
    } catch (e) {
      console.warn('[my-tutor] 学习记录写入失败', e)
    }
  }
}
