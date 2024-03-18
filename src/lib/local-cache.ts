import { basename, join } from "pathe"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"

import { Fingerprint } from "./fingerprint"

export class LocalCache {
  dir = `${process.env.HOME}/.cache/rnstack`

  fingerprint: Fingerprint

  constructor(fingerprint: Fingerprint) {
    this.fingerprint = fingerprint
  }

  path() {
    return join(this.dir, this.fingerprint.hash())
  }

  async get() {
    const cachePath = join(this.dir, this.fingerprint.hash())

    if (existsSync(cachePath)) {
      const files = await fs.readdir(cachePath)
      const appName = files.find((file) => file.endsWith(".app"))
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
    const cachePath = join(this.dir, this.fingerprint.hash())

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
    await fs.writeFile(
      join(cachePath, "fingerprint.json"),
      `${JSON.stringify(this.fingerprint.hashMap, null, 2)}\n`,
    )
    await fs.writeFile(join(cachePath, "hash"), `${this.fingerprint.hash}\n`)
  }
}
