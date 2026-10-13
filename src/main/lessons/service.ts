import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LessonExtractionSchema } from '@shared/schemas'
import type {
  ExtractLessonInput,
  Lesson,
  LessonAsset,
  LessonExtraction,
  LessonSentence,
  SaveLessonInput
} from '@shared/types'
import type { AIProvider } from '../ai/types'
import type { Db } from '../db/index'
import {
  deleteLesson,
  getLesson,
  getSentenceAudioPath,
  insertLesson,
  listLessonSentences,
  listLessons
} from '../db/lessons'
import { upsertVocab } from '../db/vocabulary'
import { EXTRACT_LESSON_PROMPT } from '../learning/prompts'
import { tm } from '../i18n'

export interface LessonServiceDeps {
  db: Db
  ai: AIProvider
  lessonsDir: string
  uuid?: () => string
  now?: () => string
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

export class LessonService {
  private readonly uuid: () => string
  private readonly now: () => string

  constructor(private readonly deps: LessonServiceDeps) {
    this.uuid = deps.uuid ?? randomUUID
    this.now = deps.now ?? (() => new Date().toISOString())
  }

  async extract(input: ExtractLessonInput, model?: string): Promise<LessonExtraction> {
    const hasImages = (input.images?.length ?? 0) > 0
    const text = hasImages
      ? 'Extract the English learning material from the attached image(s).' +
        (input.text?.trim() ? `\n\nExtra text from the learner:\n${input.text}` : '')
      : `Extract the English learning material from this text:\n\n${input.text}`
    return this.deps.ai.analyze({
      systemPrompt: EXTRACT_LESSON_PROMPT,
      text,
      images: hasImages ? input.images : undefined,
      schema: LessonExtractionSchema,
      model
    })
  }

  save(input: SaveLessonInput): Lesson {
    const id = this.uuid()
    const assets: LessonAsset[] = []
    if (input.images?.length) {
      const dir = join(this.deps.lessonsDir, id)
      mkdirSync(dir, { recursive: true })
      input.images.forEach((img, i) => {
        const path = join(dir, `${i}.${EXT[img.mime] ?? 'bin'}`)
        const buf = Buffer.from(img.base64, 'base64')
        writeFileSync(path, buf)
        assets.push({ id: this.uuid(), lessonId: id, path, mime: img.mime, size: buf.length })
      })
    }
    const lesson: Lesson = {
      id,
      title: input.title,
      body: input.body,
      source: input.source,
      notesZh: input.notesZh,
      vocabulary: input.vocabulary,
      createdAt: this.now(),
      assets
    }
    insertLesson(this.deps.db, lesson)
    // 课程已保存：生词写入失败只记日志，不让保存失败
    try {
      for (const v of input.vocabulary) {
        upsertVocab(
          this.deps.db,
          {
            word: v.word,
            meaningZh: v.meaningZh,
            example: v.example,
            source: 'lesson',
            sourceId: id
          },
          lesson.createdAt,
          this.uuid()
        )
      }
    } catch (e) {
      console.warn('[my-tutor] lesson vocabulary upsert failed', e)
    }
    return getLesson(this.deps.db, id)!
  }

  list(): Lesson[] {
    return listLessons(this.deps.db)
  }

  sentences(lessonId: string): LessonSentence[] {
    return listLessonSentences(this.deps.db, lessonId)
  }

  /** 只读数据库里登记的路径，不接受渲染进程传入的路径 */
  sentenceAudio(sentenceId: string): Uint8Array {
    const path = getSentenceAudioPath(this.deps.db, sentenceId)
    if (!path) throw new Error(tm('句子不存在', 'Sentence not found'))
    return new Uint8Array(readFileSync(path))
  }

  // 课文目录（含导入的逐句音频 audio/）整个删掉
  async delete(id: string): Promise<void> {
    deleteLesson(this.deps.db, id)
    rmSync(join(this.deps.lessonsDir, id), { recursive: true, force: true })
  }
}
