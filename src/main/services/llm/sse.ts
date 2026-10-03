/**
 * 增量 SSE（text/event-stream）解析器：
 * 网络分片可能把一条 event 拆到多个 chunk，这里按空行（\n\n）切帧缓冲。
 */
export class SseParser {
  private buffer = ''

  constructor(private readonly onData: (data: string) => void) {}

  push(text: string): void {
    // SSE 行结束符可能是 \r\n 或 \n，统一归一为 \n 后按空行切帧
    this.buffer += text.replace(/\r\n/g, '\n')
    let idx: number
    while ((idx = this.buffer.indexOf('\n\n')) >= 0) {
      const raw = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 2)
      this.emitEvent(raw)
    }
  }

  /** 流结束时调用，处理没有以空行收尾的残余数据 */
  flush(): void {
    if (this.buffer.trim().length > 0) {
      this.emitEvent(this.buffer)
      this.buffer = ''
    }
  }

  private emitEvent(raw: string): void {
    const dataLines: string[] = []
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
    }
    if (dataLines.length > 0) this.onData(dataLines.join('\n'))
  }
}

/** OpenAI 兼容协议：从一条 data 载荷中提取增量文本；返回 null 表示该帧无内容（如 [DONE]）。 */
export function extractOpenAiDelta(data: string): string | null {
  if (data === '[DONE]') return null
  try {
    const json = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string }; text?: string }>
    }
    const choice = json.choices?.[0]
    if (!choice) return null
    const delta = choice.delta?.content ?? choice.text ?? ''
    return delta.length > 0 ? delta : null
  } catch {
    return null
  }
}

/** Anthropic 协议：从一条 data 载荷中提取增量文本。 */
export function extractAnthropicDelta(data: string): string | null {
  try {
    const json = JSON.parse(data) as {
      type?: string
      delta?: { type?: string; text?: string }
    }
    if (json.type === 'content_block_delta' && json.delta?.text) return json.delta.text
    return null
  } catch {
    return null
  }
}
