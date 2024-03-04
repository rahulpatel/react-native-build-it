import type { ArgsDef } from "citty"

import 'zx/globals'
import { defineCommand, runMain } from "citty"
import { basename, join, resolve } from "pathe"
import fastGlob from "fast-glob"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"

class Fingerprint {
  dir: string
  ignorePatterns: string[] = []

  fileHashMap: Record<string, string> = {}

  constructor(dir: string, ignore: string[] = []) {
    this.dir = dir
    this.ignorePatterns = ignore
  }

  async compute() {
    const files = await fastGlob(`${this.dir}/**/*`, { ignore: this.ignorePatterns })
    
    const sortedFiles = files.sort((a, b) => a.localeCompare(b))
    for (const entry of sortedFiles) {
      const hash = createHash("sha1")
      const buffer = await fs.readFile(entry)

      hash.update(buffer)

      this.fileHashMap[entry] = hash.digest("hex")
    }

    return this.fileHashMap
  }

  hash() {
    const hash = createHash("sha1")

    for (const key in this.fileHashMap) {
      hash.update(this.fileHashMap[key])
    }

    return hash.digest("hex")
  }
}

class LocalCache {
  dir = `${process.env.HOME}/.cache/rnstack`

  fingerprint: Fingerprint

  constructor(fingerprint: Fingerprint) {
    this.fingerprint = fingerprint 
  }

  async get() {
    const cachePath = join(this.dir, this.fingerprint.hash())

    if (existsSync(cachePath)) {
      const files = await fs.readdir(cachePath) 
      const appName = files.find((file) => file.endsWith(".app"))
      if (!appName) {
        throw new Error("App not found in cache")
      }

      const commandOutput = await fs.readFile(join(cachePath, "commandOutput.log"), "utf-8")

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
    
    await fs.writeFile(join(cachePath, "commandOutput.log"), `${commandOutput}\n`)
    await fs.writeFile(join(cachePath, "fingerprint.json"), `${JSON.stringify(this.fingerprint.fileHashMap, null, 2)}\n`)
    await fs.writeFile(join(cachePath, "hash"), `${this.fingerprint.hash}\n`)
  }
}

class Xcode {
  iosDir: string 

  configurations: string[] = []
  schemes: string[] = []
  targets: string[] = []

  constructor(iosDir: string) {
    this.iosDir = iosDir
  }

  configuration(configuration: string) {
    if (this.configurations.includes(configuration)) {
      return configuration
    }

    throw new Error(`[xcode] configuration "${configuration}" not found, available configurations: ${this.configurations.join(", ")}`)
  }

  scheme(scheme: string) {
    if (this.schemes.includes(scheme)) {
      return scheme
    }

    throw new Error(`[xcode] scheme "${scheme}" not found, available schemes: ${this.schemes.join(", ")}`)
  }

  async information() {
    const flags = [
      '-list',
      '-json',
    ]

    const result = await $`cd ${this.iosDir} && xcodebuild ${flags}`.quiet()
    const json = JSON.parse(result.stdout.toString())
    const info = json.project ?? json.workspace
    
    this.configurations = info.configurations
    this.schemes = info.schemes
    this.targets = info.targets
  }

  async settings(options: { scheme: string, configruation: string }) {
    const flags = [
      '-showBuildSettings',
      '-scheme', options.scheme,
      '-configuration', options.configruation,
      '-json',
    ]

    const result = await $`cd ${this.iosDir} && xcodebuild ${flags}`.quiet()
    const json = JSON.parse(result.stdout.toString())
    return json[0].buildSettings
  }
  
  async build(options: { scheme?: string, configuration?: string, destination?: string } = {}) {
    await this.information()
    const scheme = this.scheme(options.scheme ?? this.schemes[0])
    const configuration = this.configuration(options.configuration ?? this.configurations[0])

    let destination = options.destination ?? "simulator"
    if (destination !== "simulator") {
      destination = `udid=${options.destination}`
    } else if (options.configuration === "Debug") {
      destination = "generic/platform=iOS Simulator"
    } else {
      destination = "generic/platform=iOS"
    }

    const files = await fs.readdir(this.iosDir)
    const project = files.find((file) => file.endsWith(".xcodeproj"))
    const workspace = files.find((file) => file.endsWith(".xcworkspace"))

    if (!project && !workspace) {
      throw new Error("No Xcode project or workspace found")
    }

    const flags = [
      workspace ? "-workspace" : "-project",
      workspace ? workspace : project,
      "-scheme", scheme,
      "-configuration", configuration,
      "-destination", destination,
      "build",
    ]

    const result = await $`cd ${this.iosDir} && xcodebuild ${flags}`.nothrow()

    const output = result.toString()
    
    if (!output.includes("BUILD SUCCEEDED")) {
      const error = output.match(/error:.*/g)?.[0]
      throw new Error(error ?? "Build failed")
    }

    const exports = Object.fromEntries(output.split("\n").filter((x) => x.includes('export') || x.includes('DEST=')).map((x) => {
      if (x.includes('DEST=')) {
        const [key, value] = x.replace('+ ', '').split('=')
        return [key, value]
      }
      
      return x.trim().replace('export ', '').split('\\=')
    }))

    return { 
      output,
      appPath: exports.DEST
    }
  }
}

async function getConfig(dir: string) {
  const config = require(join(dir, "rn-build-it.json"))

  if (config.remote === 'gcp') {
    if (!config.gcp) {
      throw new Error("gcp config not found")
    }

    if (!config.gcp.bucketName) {
      throw new Error("gcp bucketName not found")
    }
  }
}

const commonArgs = <ArgsDef>{
    dir: {
        type: "string",
        description: "project root directory",
    },
    _dir: {
        type: "positional",
        default: ".",
        description: "project root directory (prefer using `--dir`)",
    },
}

const buildIos = defineCommand({
  meta: {
    name: "build-ios",
    description: "Builds the project for iOS",
  },
  args: {
    ...commonArgs,
    scheme: {
      type: "string",
      description: "scheme to build",
    },
    configuration: {
      type: "string",
      description: "configuration to build",
    },
    target: {
      type: "string",
      description: "target to build",
    },
    force: {
      type: "boolean",
      description: "force build",
      default: false
    },
  },
  async run({ args }) {
    const force = args.force

    const rootDir = resolve((args.dir || args._dir || ".") as string)
    const iosDir = resolve(rootDir, "ios")

    try {
      const config = await getConfig(rootDir)
      const xcode = new Xcode(iosDir)

      const fingerprint = new Fingerprint(iosDir, ["**/build", "**/Pods"])
      await fingerprint.compute()
      
      const cache = new LocalCache(fingerprint)

      const cached = await cache.get()
      if (!force && cached?.appPath) {
        console.log(cached.commandOutput)
        console.log(">>>>>>>>>> BUILT IT FROM CACHE")
        return
      }

      const { output, appPath } = await xcode.build()
      if (!appPath) {
        throw new Error("Build failed")
      }
      
      cache.set(appPath, output)

      console.log(">>>>>>>>>> BUILT IT")
    } catch (e: unknown) {
      if (e instanceof Error) {
        console.error(e.message)
      } else {
        console.error(e)
      }

      process.exitCode = 1
    }
  },
})

const main = defineCommand({
  subCommands: {
    'build-ios': () => buildIos,
  },
})

runMain(main)
