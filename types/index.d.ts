export type VocabItem = {
  term: string
  meaning_zh: string
  example: string
}

export type Edit = {
  wrong: string
  right: string
}

export type Card = {
  original: string
  rewrite: string
  fromChinese: boolean
  why_zh: string
  edits: Edit[]
  vocab: VocabItem[]
}

declare module 'claude-code' {
  interface PluginState {
    'english-coach': {
      card: Card | null
      isAnalysing: boolean
      shownExample: string
    }
  }
}
