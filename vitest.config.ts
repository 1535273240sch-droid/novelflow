import { defineConfig } from 'vitest/config'

// 单元测试配置：全部在 node 环境运行，全部 mock 网络，不依赖真实 API Key。
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000
  }
})
