import { join } from "pathe"

class Config {
  config?: Record<string, any>

  constructor() {
    try {
      const path = join(process.cwd(), "rn-build-it.json")
      this.config = require(path)
    } catch (e) {
      if (e instanceof Error) {
        console.error(e.message)
      }
    }
  }

  get() {
    return this.config
  }
}

export const config = new Config().get()
