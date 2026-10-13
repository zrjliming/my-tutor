import { randomUUID } from 'node:crypto'
import type {
  ChatEvent,
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
import { insertMessage, updateMessage } from '../db/messages'
import { getLesson } from '../db/lessons'
import { getSettings } from '../db/settings'
import { buildSystemPrompt, OPENING_INSTRUCTION } from '../learning/prompts'

// 语音识别可能把 goed 悄悄规整成 go/got：告诉 Claude 这一轮来自 ASR，只发给 provider，不入库
const ASR_NOTE =
  '(This turn was transcribed by speech recognition, which may silently normalise verb forms or mishear words. If an error might be a transcription artifact, set correction.uncertain = true.)'

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
    if (input.mode === 'lesson' && !lesson) throw new Error('课程不存在')
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
    const assistantMessageId = this.startTurn(conversation, OPENING_INSTRUCTION)
    return { conversation, assistantMessageId }
  }

  async send(
    input: SendMessageInput
  ): Promise<{ userMessage: Message; assistantMessageId: string }> {
    const conversation = getConversation(this.deps.db, input.conversationId)
    if (!conversation) throw new Error('会话不存在')
    if (this.active.has(conversation.id)) throw new Error('上一轮尚未结束')
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

  private startTurn(conversation: Conversation, text: string): string {
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
    const done = this.runTurn(conversation.id, text, assistantMessageId, ac).finally(() =>
      this.active.delete(conversation.id)
    )
    this.active.set(conversation.id, { ac, done })
    return assistantMessageId
  }

  private async runTurn(
    conversationId: string,
    text: string,
    assistantMessageId: string,
    ac: AbortController
  ): Promise<void> {
    const { db, ai, send } = this.deps
    const conversation = getConversation(db, conversationId)
    if (!conversation) return
    const settings = getSettings(db)
    const firstTurn = !conversation.sessionStarted
    let systemPrompt: string | undefined
    if (firstTurn) {
      const lesson = conversation.lessonId ? getLesson(db, conversation.lessonId) : undefined
      systemPrompt = buildSystemPrompt({
        mode: conversation.mode,
        difficulty: settings.difficulty,
        chineseExplanations: settings.chineseExplanations,
        lesson: lesson
          ? { title: lesson.title, body: lesson.body, notesZh: lesson.notesZh }
          : undefined,
        scenario: conversation.scenario ?? undefined
      })
    }
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
    try {
      for await (const ev of ai.chat({
        conversationId,
        firstTurn,
        systemPrompt,
        text,
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
        } else if (ev.type === 'error') {
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
        message: aborted ? '已停止' : '回复意外中断，没有收到结果'
      })
    }
    // 首轮没成功时 CLI 可能已写下会话文件，不删的话下次带同一 sessionId 会被拒（already in use）
    if (firstTurn && !completed) await ai.deleteSession(conversationId)
  }
}
