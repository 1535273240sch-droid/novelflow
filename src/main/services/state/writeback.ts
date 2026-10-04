import * as path from 'node:path'
import { atomicWriteJson, readJson } from '../storage/atomic'

/**
 * 状态回写（验收要点 7）：把「状态回写」Skill 的结构化输出合并进 state/ 三个 json。
 *
 * 合并语义是增量式的——只记录发生变化的部分，重复运行幂等（同文本伏笔不重复登记）。
 */

export interface CharacterChange {
  name: string
  status?: string
  location?: string
  note?: string
}
export interface ForeshadowingChange {
  text: string
  plantedAt?: string
  resolvedAt?: string
}
export interface EventChange {
  summary: string
  characters?: string[]
  chapter?: number
}

export interface StateWritebackPayload {
  characters?: CharacterChange[]
  foreshadowingPlanted?: ForeshadowingChange[]
  foreshadowingResolved?: ForeshadowingChange[]
  events?: EventChange[]
}

export interface WritebackResult {
  charactersUpdated: number
  charactersAdded: number
  planted: number
  resolved: number
  eventsAdded: number
}

export class WritebackParseError extends Error {}

interface StateCharacter {
  name: string
  status?: string
  location?: string
  note?: string
  updatedAt?: string
}
interface StateForeshadowing {
  text: string
  status: 'open' | 'resolved'
  plantedAt?: string
  resolvedAt?: string
}
interface StateEvent {
  summary: string
  characters?: string[]
  chapter?: number
  at?: string
}

interface CharactersFile {
  version: number
  characters: StateCharacter[]
}
interface ForeshadowingFile {
  version: number
  items: StateForeshadowing[]
}
interface EventsFile {
  version: number
  events: StateEvent[]
}

function extractJson(raw: string): unknown {
  const text = raw.trim()
  const fence = /```[a-zA-Z]*\s*([\s\S]*?)```/.exec(text)
  const candidate = (fence ? fence[1] : text).trim()
  try {
    return JSON.parse(candidate)
  } catch {
    // 从混杂文本里抠出第一个平衡对象
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        /* fallthrough */
      }
    }
    throw new WritebackParseError('状态回写输出不是可解析的 JSON')
  }
}

/** 宽松解析状态回写输出（容忍代码块与前后解释）。 */
export function parseWriteback(raw: string): StateWritebackPayload {
  const obj = extractJson(raw)
  if (!obj || typeof obj !== 'object') throw new WritebackParseError('状态回写输出不是对象')
  const o = obj as Record<string, unknown>
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    characters: arr<CharacterChange>(o.characters).filter((c) => (c?.name ?? '').trim()),
    foreshadowingPlanted: arr<ForeshadowingChange>(o.foreshadowingPlanted).filter((f) => (f?.text ?? '').trim()),
    foreshadowingResolved: arr<ForeshadowingChange>(o.foreshadowingResolved).filter((f) => (f?.text ?? '').trim()),
    events: arr<EventChange>(o.events).filter((e) => (e?.summary ?? '').trim())
  }
}

export async function applyStateWriteback(
  root: string,
  payload: StateWritebackPayload,
  chapterNo?: number,
  now: Date = new Date()
): Promise<WritebackResult> {
  const iso = now.toISOString()
  const charactersPath = path.join(root, 'state', 'characters.json')
  const foreshadowingPath = path.join(root, 'state', 'foreshadowing.json')
  const eventsPath = path.join(root, 'state', 'events.json')

  const characters = await readJson<CharactersFile>(charactersPath, { version: 1, characters: [] })
  const foreshadowing = await readJson<ForeshadowingFile>(foreshadowingPath, { version: 1, items: [] })
  const events = await readJson<EventsFile>(eventsPath, { version: 1, events: [] })

  const result: WritebackResult = {
    charactersUpdated: 0,
    charactersAdded: 0,
    planted: 0,
    resolved: 0,
    eventsAdded: 0
  }

  for (const change of payload.characters ?? []) {
    const name = change.name.trim()
    const existing = characters.characters.find((c) => c.name === name)
    if (existing) {
      if (change.status != null) existing.status = change.status
      if (change.location != null) existing.location = change.location
      if (change.note != null) existing.note = change.note
      existing.updatedAt = iso
      result.charactersUpdated++
    } else {
      characters.characters.push({
        name,
        ...(change.status != null ? { status: change.status } : {}),
        ...(change.location != null ? { location: change.location } : {}),
        ...(change.note != null ? { note: change.note } : {}),
        updatedAt: iso
      })
      result.charactersAdded++
    }
  }

  const norm = (s: string): string => s.replace(/\s+/g, '').trim()
  for (const f of payload.foreshadowingPlanted ?? []) {
    const text = f.text.trim()
    if (foreshadowing.items.some((it) => norm(it.text) === norm(text))) continue
    foreshadowing.items.push({
      text,
      status: 'open',
      ...(f.plantedAt ? { plantedAt: f.plantedAt } : chapterNo != null ? { plantedAt: `第${chapterNo}章` } : {})
    })
    result.planted++
  }

  for (const f of payload.foreshadowingResolved ?? []) {
    const text = f.text.trim()
    const hit = foreshadowing.items.find((it) => norm(it.text) === norm(text) && it.status === 'open')
    if (hit) {
      hit.status = 'resolved'
      hit.resolvedAt = f.resolvedAt ?? (chapterNo != null ? `第${chapterNo}章` : iso)
    } else {
      foreshadowing.items.push({
        text,
        status: 'resolved',
        resolvedAt: f.resolvedAt ?? (chapterNo != null ? `第${chapterNo}章` : iso)
      })
    }
    result.resolved++
  }

  for (const e of payload.events ?? []) {
    const summary = e.summary.trim()
    if (events.events.some((x) => norm(x.summary) === norm(summary))) continue
    events.events.push({
      summary,
      ...(e.characters ? { characters: e.characters } : {}),
      ...(e.chapter != null ? { chapter: e.chapter } : chapterNo != null ? { chapter: chapterNo } : {}),
      at: iso
    })
    result.eventsAdded++
  }

  await atomicWriteJson(charactersPath, characters)
  await atomicWriteJson(foreshadowingPath, foreshadowing)
  await atomicWriteJson(eventsPath, events)
  return result
}
