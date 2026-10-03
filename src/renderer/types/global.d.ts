import type { Api } from '../../shared/types'

declare global {
  interface Window {
    novelflow: Api
  }
}

export {}
