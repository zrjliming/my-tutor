import type { ZodType } from 'zod'
import type { AICheckResult, AIErrorKind, ChatEvent, ImageInput } from '@shared/types'

export interface ChatRequest {
  conversationId: string
  firstTurn: boolean
  systemPrompt?: string
  text: string
  signal: AbortSignal
  model?: string
}

export interface AnalyzeRequest<T> {
  systemPrompt: string
  text: string
  images?: ImageInput[]
  schema: ZodType<T>
  signal?: AbortSignal
  model?: string
}

export interface AIProvider {
  chat(req: ChatRequest): AsyncIterable<ChatEvent>
  analyze<T>(req: AnalyzeRequest<T>): Promise<T>
  deleteSession(conversationId: string): Promise<void>
  check(): Promise<AICheckResult>
}

export class AIError extends Error {
  constructor(
    public readonly kind: AIErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'AIError'
  }
}
