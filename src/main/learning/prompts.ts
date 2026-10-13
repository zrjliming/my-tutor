import baseTutor from '../prompts/base-tutor.md?raw'
import freeChat from '../prompts/free-chat.md?raw'
import lessonQa from '../prompts/lesson-qa.md?raw'
import rolePlay from '../prompts/role-play.md?raw'
import scenarioTask from '../prompts/scenario-task.md?raw'
import extractLesson from '../prompts/extract-lesson.md?raw'
import targetedPractice from '../prompts/targeted-practice.md?raw'
import summarizeSession from '../prompts/summarize-session.md?raw'
import analyzeLearner from '../prompts/analyze-learner.md?raw'
import type { Difficulty, LearnerProfile, Mode } from '@shared/types'

export const EXTRACT_LESSON_PROMPT: string = extractLesson
export const SUMMARIZE_SESSION_PROMPT: string = summarizeSession
export const ANALYZE_LEARNER_PROMPT: string = analyzeLearner

export const OPENING_INSTRUCTION =
  '(The session starts now. Greet the learner in one or two sentences and ask your first question. No correction this turn.)'

export { SCENARIOS } from '@shared/types'

export interface TargetedMaterial {
  weaknesses: string[]
  mistakes: Array<{ original: string; improved: string }>
}

export interface PromptContext {
  mode: Mode
  difficulty: Difficulty
  chineseExplanations: boolean
  lesson?: { title: string; body: string; notesZh: string }
  scenario?: string
  profileSummary?: string
  targeted?: TargetedMaterial
}

const MODE_PROMPT: Record<Mode, string> = {
  free: freeChat,
  lesson: lessonQa,
  roleplay: rolePlay,
  scenario: scenarioTask,
  targeted: targetedPractice
}

export function formatProfileSummary(p: Pick<LearnerProfile, 'level' | 'weaknesses'>): string {
  const focus = p.weaknesses.slice(0, 3)
  return focus.length
    ? `Estimated level: ${p.level}. Focus areas: ${focus.join('; ')}.`
    : `Estimated level: ${p.level}.`
}

function formatTargeted(t: TargetedMaterial): string {
  if (t.weaknesses.length === 0 && t.mistakes.length === 0) {
    return 'No recorded weak points yet: run a general review of common everyday structures at the learner level.'
  }
  const parts: string[] = []
  if (t.weaknesses.length)
    parts.push(`Weak points:\n${t.weaknesses.map((w) => `- ${w}`).join('\n')}`)
  if (t.mistakes.length) {
    parts.push(
      `Past mistakes to revisit:\n${t.mistakes.map((m) => `- "${m.original}" → "${m.improved}"`).join('\n')}`
    )
  }
  return parts.join('\n\n')
}

const LEVEL_HINT: Record<Difficulty, string> = {
  beginner: 'beginner (A2): very short sentences, common words only, one idea per sentence',
  intermediate: 'intermediate (B1): everyday sentences, occasional new word',
  advanced: 'advanced (B2+): natural pace, idioms allowed'
}

export function buildSystemPrompt(ctx: PromptContext): string {
  if (ctx.mode === 'targeted' && !ctx.targeted)
    throw new Error('targeted mode requires targeted material')
  if (ctx.mode === 'lesson' && !ctx.lesson) throw new Error('lesson mode requires a lesson')
  if ((ctx.mode === 'roleplay' || ctx.mode === 'scenario') && !ctx.scenario) {
    throw new Error(`${ctx.mode} mode requires a scenario`)
  }

  const parts: string[] = [baseTutor.trim()]
  parts.push(`Learner level: ${ctx.difficulty}. Guidance: ${LEVEL_HINT[ctx.difficulty]}.`)
  parts.push(
    ctx.chineseExplanations
      ? 'Write explanationZh and meaningZh in simple Chinese.'
      : 'The learner turned Chinese off: write explanationZh in simple English and meaningZh in simple English.'
  )
  if (ctx.profileSummary) parts.push(`Learner profile:\n${ctx.profileSummary}`)
  parts.push(MODE_PROMPT[ctx.mode].trim())
  if (ctx.mode === 'targeted' && ctx.targeted) parts.push(formatTargeted(ctx.targeted))
  if (ctx.mode === 'lesson' && ctx.lesson) {
    parts.push(
      `Lesson title: ${ctx.lesson.title}\nLesson text:\n${ctx.lesson.body}\nNotes (Chinese): ${ctx.lesson.notesZh}`
    )
  }
  if (ctx.scenario) parts.push(`Scenario: ${ctx.scenario}`)
  return parts.join('\n\n')
}
