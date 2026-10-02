# English Coach for Claude Code

Turn vibe coding's waiting time into English practice.

A [Claude Code](https://claude.com/claude-code) mod that checks every prompt you send, Grammarly-style, while Claude works on your request. Built for native Mandarin (Traditional Chinese) speakers, but the corrections work for anyone writing prompts in English.

<!-- screenshot: the band above the prompt with red/green fixes -->

## What it does

After each prompt, a band appears above the prompt box:

```
can ~~u~~ you ~~summary~~ summarize what we ~~have did~~ did today
把 "summary" 改為動詞 "summarize"。
clean up — 整理、簡化                  [keep] [ex]
walk me through — 逐步說明             [keep] [ex]
heads-up — 事先通知                    [keep] [ex]
```

- **Inline corrections**: your own sentence, with mistakes struck through in red and fixes in green. Your wording is kept; only the words that change are marked.
- **✓ Natural** when nothing needs fixing.
- **Chinese input**: a mostly-Chinese prompt shows its natural English version.
- **One-line reason** in Traditional Chinese for the main fix.
- **3 words, phrases or slang** from your message, with a Chinese meaning.
  - **keep** saves it (kept across sessions).
  - **ex** shows an example sentence.
- **`/words`** lists everything you've saved.

The band clears when you send the next prompt. Prompts under 12 characters and slash commands are skipped.

## Install

Clone the repo, then point Claude Code at it in `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-code-english-coach"
  }
}
```

Start a new session (or run `/reload-plugins`) and send a prompt.

To try it once without changing settings:

```bash
claude --plugin-dir /path/to/claude-code-english-coach
```

## How it works

- `hooks/register.tsx` is the whole mod: a `prompt.submit` hook queues your prompt, a timer sends it to Claude Sonnet via `$.model.complete`, and an `AbovePrompt` render hook draws the result.
- The model returns small `{ wrong, right }` fixes; the mod finds each one in your original text and marks it in place. If a fix can't be located, the band falls back to the full corrected sentence.
- Language detection is local (share of CJK characters), not left to the model.

Each analysed prompt is one Sonnet call. Change `MODEL` in `hooks/register.tsx` to `'haiku'` for a cheaper, slightly less accurate coach.

## Files

```
.claude-plugin/plugin.json   manifest
hooks/hooks.json             points to register.tsx
hooks/register.tsx           the mod
types/index.d.ts             state contract
```

Check it with `claude plugin validate .`
