/**
 * 日志脱敏：维护已注册的敏感串（API Key 等），任何日志输出前统一替换为 ***。
 */
export class Redactor {
  private secrets = new Set<string>()

  /** 注册敏感串。过短（<4）或空白串忽略，避免误伤日志。 */
  add(secret: string | null | undefined): void {
    if (!secret || secret.length < 4) return
    this.secrets.add(secret)
  }

  remove(secret: string | null | undefined): void {
    if (!secret) return
    this.secrets.delete(secret)
  }

  redact(text: string): string {
    let out = text
    for (const s of this.secrets) {
      if (out.includes(s)) out = out.split(s).join('***')
    }
    return out
  }
}

/** 生成给 UI 展示的密钥提示，如 "sk-***abcd"；绝不返回明文。 */
export function maskKey(key: string | null | undefined): string {
  if (!key) return ''
  if (key.length <= 8) return '***'
  return `${key.slice(0, 3)}***${key.slice(-4)}`
}
