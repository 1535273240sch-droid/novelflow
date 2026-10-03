import { safeStorage } from 'electron'
import type { SecretBox } from '../storage/settings-store'

/**
 * Electron safeStorage 封装：API Key 只经系统钥匙串机制加密后落盘。
 * encryptString 返回 Buffer，存盘时转 base64 并加 enc:v1 前缀。
 */
export function createSafeStorageBox(): SecretBox {
  return {
    encrypt(plain: string): string | null {
      try {
        if (!safeStorage.isEncryptionAvailable()) return null
        return `enc:v1:${safeStorage.encryptString(plain).toString('base64')}`
      } catch {
        return null
      }
    },
    decrypt(stored: string): string | null {
      try {
        const b64 = stored.replace(/^enc:v1:/, '')
        return safeStorage.decryptString(Buffer.from(b64, 'base64'))
      } catch {
        return null
      }
    }
  }
}
