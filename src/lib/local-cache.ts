import { basename, join } from "pathe"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import { glob } from "zx"

export class LocalCache {
  dir = `${process.env.HOME}/.cache/rnstack`

  tag: string

  constructor(tag: string) {
    this.tag = tag
  }

  path() {
    return join(this.dir, this.tag)
  }

  async get() {
    const cachePath = this.path()

    if (existsSync(cachePath)) {
      const [appPath] = await glob("**/*.app", { cwd: cachePath })
      const [ipaPath] = await glob("**/*.ipa", { cwd: cachePath })

      const appName = appPath ?? ipaPath

      if (!appName) {
        throw new Error("App not found in cache")
      }

      const commandOutput = await fs.readFile(
        join(cachePath, "commandOutput.log"),
        "utf-8",
      )

      return {
        appPath: join(cachePath, appName),
        commandOutput,
      }
    }

    return null
  }

  async set(path: string, commandOutput: string) {
    const cachePath = this.path()

    if (existsSync(cachePath)) {
      return
    }

    await fs.mkdir(cachePath, { recursive: true })

    const appName = basename(path)
    await fs.cp(path, join(cachePath, appName), { recursive: true })

    await fs.writeFile(
      join(cachePath, "commandOutput.log"),
      `${commandOutput}\n`,
    )
  }
}
