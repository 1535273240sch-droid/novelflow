import { contextBridge, ipcRenderer } from 'electron'
import type { Api, LlmEvent, SkillEvent } from '../shared/types'

/**
 * 预加载脚本：以 contextIsolation 方式暴露窄接口 window.novelflow。
 * 渲染进程没有任何 Node 能力，所有 LLM/文件/密钥操作都经主进程。
 */
const api: Api = {
  project: {
    createDialog: () => ipcRenderer.invoke('project:createDialog'),
    create: (dirPath, meta) => ipcRenderer.invoke('project:create', dirPath, meta),
    openDialog: () => ipcRenderer.invoke('project:openDialog'),
    open: (dirPath) => ipcRenderer.invoke('project:open', dirPath),
    getCurrent: () => ipcRenderer.invoke('project:getCurrent')
  },
  files: {
    list: (relDir) => ipcRenderer.invoke('files:list', relDir),
    read: (relPath) => ipcRenderer.invoke('files:read', relPath),
    write: (relPath, content) => ipcRenderer.invoke('files:write', relPath, content),
    writeWithSnapshot: (relPath, content) =>
      ipcRenderer.invoke('files:writeWithSnapshot', relPath, content),
    createChapter: (kind) => ipcRenderer.invoke('files:createChapter', kind)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    savePreset: (input) => ipcRenderer.invoke('settings:savePreset', input),
    deletePreset: (id) => ipcRenderer.invoke('settings:deletePreset', id),
    setRoles: (roles) => ipcRenderer.invoke('settings:setRoles', roles),
    setAppConfig: (config) => ipcRenderer.invoke('settings:setAppConfig', config)
  },
  llm: {
    testConnection: (input) => ipcRenderer.invoke('llm:testConnection', input),
    chat: (params) => ipcRenderer.invoke('llm:chat', params),
    cancel: (callId) => ipcRenderer.invoke('llm:cancel', callId),
    onEvent: (cb: (ev: LlmEvent) => void) => {
      const handler = (_e: unknown, ev: LlmEvent) => cb(ev)
      ipcRenderer.on('llm:event', handler)
      return () => ipcRenderer.removeListener('llm:event', handler)
    }
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:write', text)
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    get: (id) => ipcRenderer.invoke('skills:get', id),
    importDialog: () => ipcRenderer.invoke('skills:importDialog'),
    importText: (fileName, content) => ipcRenderer.invoke('skills:importText', fileName, content),
    save: (skill) => ipcRenderer.invoke('skills:save', skill),
    duplicate: (id) => ipcRenderer.invoke('skills:duplicate', id),
    remove: (id) => ipcRenderer.invoke('skills:remove', id),
    exportDialog: (id) => ipcRenderer.invoke('skills:exportDialog', id),
    run: (params) => ipcRenderer.invoke('skills:run', params),
    preview: (params) => ipcRenderer.invoke('skills:preview', params),
    cancel: (callId) => ipcRenderer.invoke('skills:cancel', callId),
    onEvent: (cb: (ev: SkillEvent) => void) => {
      const handler = (_e: unknown, ev: SkillEvent) => cb(ev)
      ipcRenderer.on('skill:event', handler)
      return () => ipcRenderer.removeListener('skill:event', handler)
    }
  },
  history: {
    list: (relPath) => ipcRenderer.invoke('history:list', relPath),
    read: (id) => ipcRenderer.invoke('history:read', id),
    restore: (id) => ipcRenderer.invoke('history:restore', id)
  },
  framework: {
    applyText: (text) => ipcRenderer.invoke('framework:applyText', text)
  },
  state: {
    writeback: (raw, chapterNo) => ipcRenderer.invoke('state:writeback', raw, chapterNo)
  },
  chapter: {
    checkGate: (chapterNo) => ipcRenderer.invoke('chapter:checkGate', chapterNo)
  },
  workflow: {
    list: () => ipcRenderer.invoke('workflow:list'),
    save: (workflow) => ipcRenderer.invoke('workflow:save', workflow),
    remove: (id) => ipcRenderer.invoke('workflow:remove', id),
    templates: () => ipcRenderer.invoke('workflow:templates'),
    createFromTemplate: (templateId) => ipcRenderer.invoke('workflow:createFromTemplate', templateId)
  },
  runs: {
    list: () => ipcRenderer.invoke('runs:list'),
    unfinished: () => ipcRenderer.invoke('runs:unfinished'),
    get: (id) => ipcRenderer.invoke('runs:get', id),
    start: (workflowId, opts) => ipcRenderer.invoke('runs:start', workflowId, opts),
    resume: (id) => ipcRenderer.invoke('runs:resume', id),
    confirm: (id, nodeId, editedOutput) => ipcRenderer.invoke('runs:confirm', id, nodeId, editedOutput),
    retry: (id, nodeId) => ipcRenderer.invoke('runs:retry', id, nodeId),
    abort: (id) => ipcRenderer.invoke('runs:abort', id)
  },
  app: {
    version: () => ipcRenderer.invoke('app:version')
  }
}

contextBridge.exposeInMainWorld('novelflow', api)
