import baseTutor from '../prompts/base-tutor.md?raw'
import freeChat from '../prompts/free-chat.md?raw'
import lessonQa from '../prompts/lesson-qa.md?raw'
import rolePlay from '../prompts/role-play.md?raw'
import scenarioTask from '../prompts/scenario-task.md?raw'
import extractLesson from '../prompts/extract-lesson.md?raw'
import type { Difficulty, Mode } from '@shared/types'

export const EXTRACT_LESSON_PROMPT: string = extractLesson

export const OPENING_INSTRUCTION =
  '(The session starts now. Greet the learner in one or two sentences and ask your first question. No correction this turn.)'

export { SCENARIOS } from '@shared/types'

export interface PromptContext {
  mode: Mode
  difficulty: Difficulty
  chineseExplanations: boolean
  lesson?: { title: string; body: string; notesZh: string }
  scenario?: string
  profileSummary?: string
}

const MODE_PROMPT: Record<Exclude<Mode, 'targeted'>, string> = {
  free: freeChat,
  lesson: lessonQa,
  roleplay: rolePlay,
  scenario: scenarioTask
}

const LEVEL_HINT: Record<Difficulty, string> = {
  beginner: 'beginner (A2): very short sentences, common words only, one idea per sentence',
  intermediate: 'intermediate (B1): everyday sentences, occasional new word',
  advanced: 'advanced (B2+): natural pace, idioms allowed'
}

export function buildSystemPrompt(ctx: PromptContext): string {
  if (ctx.mode === 'targeted') throw new Error('targeted mode is not available yet')
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
  if (ctx.mode === 'lesson' && ctx.lesson) {
    parts.push(
      `Lesson title: ${ctx.lesson.title}\nLesson text:\n${ctx.lesson.body}\nNotes (Chinese): ${ctx.lesson.notesZh}`
    )
  }
  if (ctx.scenario) parts.push(`Scenario: ${ctx.scenario}`)
  return parts.join('\n\n')
}
