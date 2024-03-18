import { join } from "pathe"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import assert from "node:assert"
import { glob } from "zx"

export class Fingerprint {
  dir: string
  platform: "ios" | "android"
  ignorePatterns: string[] = []
  args: Record<string, string | boolean | number>

  hashMap: Record<string, string> = {}

  constructor({
    dir,
    platform,
    ignore,
    args,
  }: {
    dir: string
    platform: "ios" | "android"
    ignore?: string[]
    args: Record<string, string | boolean | number>
  }) {
    assert(dir, "dir is required")
    assert(
      platform === "ios" || platform === "android",
      "platform is required and should be either ios or android",
    )
    assert(args, "args is required")

    this.dir = dir
    this.platform = platform
    this.ignorePatterns = ignore ?? []
    this.args = args
  }

  async getFiles() {
    let dependencies: Record<string, { root: string }> = {}

    try {
      const config = await $`npx react-native config`.quiet()
      const json = JSON.parse(config.stdout.toString())
      dependencies = json.dependencies
    } catch (e) {
      if (e instanceof Error) {
        console.error(e.message)
      }
    }

    const globPatterns = [
      join(this.dir, this.platform),
      join(this.dir, "patches"),
    ]

    for (const key in dependencies) {
      globPatterns.push(dependencies[key].root)
    }

    const files = [
      ...(await glob(globPatterns, {
        onlyFiles: true,
        ignore: [
          "**/__{tests,mocks}__/**",
          "**/*mock*",
          "**/*.{md,flow,d.ts,map,log}",
          "**/*.{config,setup}.*",
          "**/LICENSE",
          ...this.ignorePatterns,
        ],
      })),
    ]

    return files.sort((a, b) => a.localeCompare(b))
  }

  argsHash() {
    const sortedArgs = Object.keys(this.args)
      .sort()
      .reduce((acc, key) => {
        return { ...acc, [key]: this.args[key] }
      }, {})

    const argsHash = createHash("sha1")
    argsHash.update(JSON.stringify(sortedArgs))
    return argsHash.digest("hex")
  }

  async compute() {
    const files = await this.getFiles()

    for (const entry of files) {
      const hash = createHash("sha1")
      const buffer = await fs.readFile(entry)

      hash.update(buffer)

      this.hashMap[entry] = hash.digest("hex")
    }

    this.hashMap["args"] = this.argsHash()

    return this.hashMap
  }

  hash() {
    const hash = createHash("sha1")

    for (const key in this.hashMap) {
      hash.update(this.hashMap[key])
    }

    return hash.digest("hex")
  }
}
