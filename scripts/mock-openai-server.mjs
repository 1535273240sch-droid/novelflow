#!/usr/bin/env node
/**
 * NovelFlow 本地 OpenAI 兼容 mock server（零依赖，Node >= 18）。
 *
 * 用途：为『测试连接』与流式调用演示提供本地目标，不依赖真实 API Key。
 *
 * 支持的接口：
 *   POST /v1/chat/completions   （也接受 POST /chat/completions）
 *     - body.stream=true  → SSE 流式返回（data: {...delta...} + data: [DONE]）
 *     - body.stream=false → 一次性 JSON 返回
 *   GET  /v1/models             → 模型列表
 *   GET  /health                → { ok: true }
 *
 * 故障注入（命令行参数优先于环境变量）：
 *   --port 8801                 端口（env MOCK_PORT）
 *   --key  secret123            要求 Bearer Key 匹配，否则 401（env MOCK_API_KEY）
 *   --fail 429|500|503|timeout  失败模式：返回状态码 / 挂起模拟超时（env MOCK_FAIL_MODE）
 *   --fail-times 2              失败次数（之后恢复正常），默认 1（env MOCK_FAIL_TIMES）
 *   --hang-ms 30000             timeout 模式挂起时长（env MOCK_HANG_MS）
 *   --chunk-delay-ms 30         流式每个分片之间的延迟（env MOCK_CHUNK_DELAY_MS）
 *   --stream-chars 8            每个流式分片的字符数
 * 也可以用查询参数 ?fail=429&times=1 临时覆盖（不影响全局计数）。
 *
 * 示例：
 *   node scripts/mock-openai-server.mjs --port 8801
 *   node scripts/mock-openai-server.mjs --fail 429 --fail-times 2
 */

import http from 'node:http'

const args = process.argv.slice(2)
function argValue(name) {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}
function intOr(v, d) {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? n : d
}

const port = intOr(argValue('--port') ?? process.env.MOCK_PORT, 8801)
const apiKey = argValue('--key') ?? process.env.MOCK_API_KEY ?? null
const failMode = (argValue('--fail') ?? process.env.MOCK_FAIL_MODE ?? '').toLowerCase()
const failTimes = Math.max(1, intOr(argValue('--fail-times') ?? process.env.MOCK_FAIL_TIMES, 1))
const hangMs = intOr(argValue('--hang-ms') ?? process.env.MOCK_HANG_MS, 30_000)
const chunkDelayMs = intOr(argValue('--chunk-delay-ms') ?? process.env.MOCK_CHUNK_DELAY_MS, 30)
const streamChars = intOr(argValue('--stream-chars') ?? process.env.MOCK_STREAM_CHARS, 8)

let failCounter = 0

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function buildReply(body) {
  const messages = body?.messages ?? []
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const prompt = typeof lastUser?.content === 'string' ? lastUser.content : ''
  const shown = prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt
  return (
    `【Mock 流式回复】收到提示：“${shown}”。` +
    '这是一段来自本地 mock 服务的模拟输出，用于验证流式显示、节流与取消。' +
    '夜色像一层薄纱笼罩着小城，远处的灯火明明灭灭，仿佛有人在逐一确认它们是否还醒着。' +
    '他把稿纸摊开，笔尖悬在第一行上方，久久没有落下——不是因为无话可写，而是想说的话太多。'
  )
}

function sseChunk(id, model, content) {
  return `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    model,
    choices: [{ index: 0, delta: content === null ? {} : { content }, finish_reason: null }]
  })}\n\n`
}

async function handleChatCompletions(req, res, url) {
  const raw = await readBody(req)
  let body = {}
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: { message: '请求体不是合法 JSON' } }))
    return
  }

  // 鉴权（配置了 --key / MOCK_API_KEY 时启用，用于测试 401 失败路径）
  if (apiKey) {
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (token !== apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: { message: '无效的 API Key', type: 'invalid_request_error' } }))
      return
    }
  }

  // 故障注入（查询参数优先，可临时覆盖全局配置）
  const qFail = (url.searchParams.get('fail') ?? '').toLowerCase()
  const qTimes = url.searchParams.get('times')
  const mode = qFail || failMode
  const times = qTimes ? Math.max(1, intOr(qTimes, 1)) : failTimes
  if (mode) {
    if (mode === 'timeout') {
      await sleep(hangMs)
    } else {
      const status = intOr(mode, 0)
      if (status >= 400) {
        failCounter++
        if (failCounter <= times) {
          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: { message: `mock 注入的 ${status} 错误（第 ${failCounter} 次）` } }))
          return
        }
      }
    }
  }

  const model = body.model || 'mock-model'
  const reply = buildReply(body)
  const id = `chatcmpl-mock-${Date.now()}`

  if (body.stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    const chars = Array.from(reply)
    let buffered = ''
    for (let i = 0; i < chars.length; i++) {
      buffered += chars[i]
      if (buffered.length >= streamChars || i === chars.length - 1) {
        res.write(sseChunk(id, model, buffered))
        buffered = ''
        if (chunkDelayMs > 0) await sleep(chunkDelayMs)
      }
    }
    res.write(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
      })}\n\n`
    )
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(
    JSON.stringify({
      id: `chatcmpl-mock-${Date.now()}`,
      object: 'chat.completion',
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: Math.ceil(reply.length / 2), total_tokens: 10 + Math.ceil(reply.length / 2) }
    })
  )
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  const pathName = url.pathname.replace(/\/+$/, '') || '/'
  ;(async () => {
    if (req.method === 'GET' && (pathName === '/health' || pathName === '/v1/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, failMode, failCounter }))
      return
    }
    if (req.method === 'GET' && (pathName === '/v1/models' || pathName === '/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }))
      return
    }
    if (req.method === 'POST' && (pathName === '/v1/chat/completions' || pathName === '/chat/completions')) {
      await handleChatCompletions(req, res, url)
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: { message: `未实现的接口：${req.method} ${pathName}` } }))
  })().catch((e) => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
    }
    res.end(JSON.stringify({ error: { message: `mock server 内部错误：${e?.message ?? e}` } }))
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-openai-server] 监听 http://127.0.0.1:${port}/v1/chat/completions`)
  console.log(
    `[mock-openai-server] 配置：key=${apiKey ? '已启用(401 测试)' : '未启用'} fail=${failMode || '无'} failTimes=${failTimes} chunkDelay=${chunkDelayMs}ms hang=${hangMs}ms`
  )
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  })
}
