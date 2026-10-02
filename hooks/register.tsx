import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Card, Edit, VocabItem } from '../types'

const MODEL = 'sonnet'
const MIN_CHARS = 12
const MAX_INPUT = 600
const MAX_VOCAB = 3
const MAX_EDITS = 5

const card = atom({ plugin: 'english-coach', key: 'card' } as const, null)
const isAnalysing = atom({ plugin: 'english-coach', key: 'isAnalysing' } as const, false)
const shownExample = atom({ plugin: 'english-coach', key: 'shownExample' } as const, '')

const PHRASE_BANK =
  'walk me through, roll back, it blows up when..., nit, LGTM, circle back, heads-up, ship it, ' +
  'sanity check, edge case, bear with me, on my plate, loop in, follow up, push back, ' +
  'quick win, blocker, ETA, take a look, happy to, no worries, sounds good, let me know'

const ANALYSE_SYSTEM = `You are an English coach for a native Traditional Chinese (Taiwan) speaker at B2 level who talks to an AI coding assistant. Reply with ONLY one JSON object, no markdown, with these keys:
- fromChinese: true if the message is mostly Chinese.
- rewrite: if fromChinese, the natural English version of the message; otherwise the full corrected message.
- edits: Grammarly-style minimal fixes to the user's own wording, up to ${MAX_EDITS}, as [{wrong, right}]. Keep the user's words and meaning; only fix grammar, word choice and unnatural phrasing. "wrong" MUST be an exact substring of the message, listed in order of appearance, short but unambiguous. To insert a missing word, make "wrong" a neighbouring word and "right" that word plus the insertion. To delete, make "right" a shorter version. [] if the message is already natural or fromChinese.
- why_zh: one short sentence in Traditional Chinese on the most important fix; "" if no edits.
- vocab: ${MAX_VOCAB} of {term, meaning_zh, example}. meaning_zh is Traditional Chinese, a few words. example is one short English sentence. Choose words, phrases or slang from the corrected message that a B2 learner would benefit from; prefer phrases and slang over plain words. Prefer these when relevant: ${PHRASE_BANK}.`

const asText = (v: unknown): string => (typeof v === 'string' ? v : '')
const asList = (v: unknown): any[] => (Array.isArray(v) ? v : [])

// First balanced {...} object; ignores fences and any prose with braces after it.
const parseJson = (text: string): any => {
  const a = text.indexOf('{')
  if (a < 0) return null
  let depth = 0
  let inString = false
  for (let i = a; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(a, i + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

// Mark only the words that changed: drop shared leading/trailing words from a fix.
const trimEdit = (edit: Edit): Edit => {
  const w = edit.wrong.split(' ')
  const r = edit.right.split(' ')
  let head = 0
  while (head < w.length - 1 && head < r.length - 1 && w[head] === r[head]) head++
  let tail = 0
  while (
    tail < w.length - head - 1 &&
    tail < r.length - head - 1 &&
    w[w.length - 1 - tail] === r[r.length - 1 - tail]
  )
    tail++
  return {
    wrong: w.slice(head, w.length - tail).join(' '),
    right: r.slice(head, r.length - tail).join(' '),
  }
}

const toCard = (raw: any, original: string): Card | null => {
  if (!raw) return null
  // Decide locally: Haiku sometimes labels plain English as Chinese.
  const cjk = (original.match(/[㐀-鿿豈-﫿]/g) ?? []).length
  const fromChinese = cjk > original.replace(/\s/g, '').length * 0.3
  if (fromChinese && !asText(raw.rewrite)) return null

  const edits: Edit[] = asList(raw.edits)
    .filter(m => m && asText(m.wrong) && asText(m.wrong) !== asText(m.right))
    .slice(0, MAX_EDITS)
    .map(m => trimEdit({ wrong: asText(m.wrong), right: asText(m.right) }))

  // Haiku sometimes leaves rewrite empty; rebuild it from the edits.
  const spans = toSpans(original, edits)
  const rebuilt = spans ? spans.map(p => (p.edit ? p.edit.right : p.text)).join('') : original

  return {
    original,
    rewrite: asText(raw.rewrite) || rebuilt,
    fromChinese,
    why_zh: asText(raw.why_zh),
    edits: fromChinese ? [] : edits,
    vocab: asList(raw.vocab)
      .filter(v => v && asText(v.term))
      .slice(0, MAX_VOCAB)
      .map(v => ({
        term: asText(v.term),
        meaning_zh: asText(v.meaning_zh),
        example: asText(v.example),
      })),
  }
}

// Split the original into plain and edited spans. null when an edit cannot be located.
type Span = { text: string; edit?: Edit }
const toSpans = (original: string, edits: Edit[]): Span[] | null => {
  const spans: Span[] = []
  let pos = 0
  for (const edit of edits) {
    const at = original.indexOf(edit.wrong, pos)
    if (at < 0) return null
    if (at > pos) spans.push({ text: original.slice(pos, at) })
    spans.push({ text: edit.wrong, edit })
    pos = at + edit.wrong.length
  }
  if (pos < original.length) spans.push({ text: original.slice(pos) })
  return spans
}

const s = {
  isBusy: false,
  isTimerOn: false,
  seq: 0,
  pending: null as string | null,
}

const saveVocab = async ($: any, item: VocabItem) => {
  const old = asList(await $.store.get('saved'))
  if (old.some(v => v.term === item.term)) {
    $.ui.toast(`Already saved: ${item.term}`)
    return
  }
  await $.store.set('saved', [...old, item])
  $.ui.toast(`Saved: ${item.term}`)
}

const analyse = async ($: any) => {
  const text = s.pending
  if (text === null) return
  const id = s.seq
  s.pending = null

  const r = await $.model.complete({
    model: MODEL,
    system: ANALYSE_SYSTEM,
    prompt: text,
    maxTokens: 600,
    effort: 'low',
    timeoutMs: 20000,
  })
  const c = r.isAnswered ? toCard(parseJson(r.text), text) : null
  if (id === s.seq) {
    await update($, card, () => c)
    await update($, isAnalysing, () => false)
  }
}

// A reload does not always fire session.start again, so the first prompt starts the timer too.
const startTimer = ($: any) => {
  if (s.isTimerOn) return
  s.isTimerOn = true
  $.clock.every(500, async () => {
    if (s.isBusy || s.pending === null) return
    s.isBusy = true
    try {
      await analyse($)
    } catch {
      await update($, isAnalysing, () => false)
    } finally {
      s.isBusy = false
    }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'words',
      description: 'List the vocabulary you saved with "keep"',
    })

    startTimer($)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    startTimer($)
    s.seq += 1
    await update($, card, () => null)
    await update($, shownExample, () => '')

    const text = e.text.replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT)
    const isSkipped = text.length < MIN_CHARS || text.startsWith('/')
    s.pending = isSkipped ? null : text
    await update($, isAnalysing, () => !isSkipped)

    return next(e)
  })

  on('command.run', { command: 'words' }, async $ => {
    const saved = asList(await $.store.get('saved')) as VocabItem[]
    if (saved.length === 0) return { text: 'No saved words yet. Press "keep" on a word.' }

    const lines = saved
      .slice()
      .reverse()
      .map(v => `• ${v.term} — ${v.meaning_zh}${v.example ? `\n    ${v.example}` : ''}`)
    return { text: `Saved words (${saved.length})\n${lines.join('\n')}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const c: Card | null = await read($, card)
    const open: string = await read($, shownExample)
    const { Box, Button, Text } = $.ui.resolve(e)

    if (!c) {
      if (!(await read($, isAnalysing))) return next(e)
      return <Text dimColor>✎ …</Text>
    }

    // Grammarly style: your own sentence, wrong parts struck out, fixes in green.
    const spans = c.edits.length > 0 ? toSpans(c.original, c.edits) : null
    const headline =
      c.fromChinese || (c.edits.length > 0 && !spans) ? (
        <Text bold>✎ {c.rewrite}</Text>
      ) : spans ? (
        <Text>
          {spans.map((p, i) =>
            p.edit ? (
              <Text key={`s${i}`}>
                <Text color="red" strikethrough>{p.edit.wrong}</Text>
                <Text color="green" bold>{p.edit.right ? ` ${p.edit.right}` : ''}</Text>
              </Text>
            ) : (
              <Text key={`s${i}`}>{p.text}</Text>
            ),
          )}
        </Text>
      ) : (
        <Text bold>✓ Natural</Text>
      )

    return (
      <Box flexDirection="column">
        {headline}
        {c.why_zh !== '' && <Text dimColor>{c.why_zh}</Text>}
        {c.vocab.map((v, i) => (
          <Box key={`w${i}`} flexDirection="column">
            <Box>
              <Text wrap="truncate-end">
                {v.term} <Text dimColor>— {v.meaning_zh}</Text>{' '}
              </Text>
              <Button key={`keep-${i}`} label="keep" onPress={() => saveVocab($, v)} />
              {v.example !== '' && (
                <Button
                  key={`ex-${i}`}
                  label="ex"
                  onPress={() => update($, shownExample, cur => (cur === v.term ? '' : v.term))}
                />
              )}
            </Box>
            {open === v.term && v.example !== '' && <Text dimColor>  {v.example}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
