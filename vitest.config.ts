import { defineConfig } from 'vitest/config'

// 单元测试配置：全部在 node 环境运行，全部 mock 网络，不依赖真实 API Key。
// 使用线程池（不是进程池）：Windows 上进程池 spawn 偶发 EBUSY（文件锁抖动）会被记为未处理错误。
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    pool: 'threads'
  }
})
