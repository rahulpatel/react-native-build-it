import type { ArgsDef, ParsedArgs } from "citty"

import "zx/globals"
import { glob } from "zx"
import { defineCommand, runMain } from "citty"
import { resolve, basename, dirname, join } from "pathe"
import assert from "node:assert"
import os from "node:os"

import { config } from "./lib/config"
import { Fingerprint } from "./lib/fingerprint"
import { Xcode } from "./lib/xcode"
import { LocalCache } from "./lib/local-cache"
import { RemoteCache } from "./lib/remote-cache"
import { Metro } from "./lib/metro"

function filterArgs(args: ParsedArgs) {
  return Object.keys(args).reduce((acc, key) => {
    if (key === "_" || key === "dir" || key === "_dir" || key === "force") {
      return acc
    }

    return { ...acc, [key]: args[key] }
  }, {})
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
    destination: {
      type: "string",
      description: `destination to build ("simulator" or "device")`,
      default: "simulator",
    },
    tag: {
      type: "string",
      description: "tag to use for the remote build",
      default: "latest",
    },
    force: {
      type: "boolean",
      description: "force build",
      default: false,
    },
  },
  async run({ args }) {
    const force = args.force

    const rootDir = resolve((args.dir || args._dir || ".") as string)
    const iosDir = resolve(rootDir, "ios")

    assert(
      ["simulator", "device"].includes(args.destination),
      "Invalid destination, should be either 'simulator' or 'device'",
    )

    try {
      const xcode = new Xcode(iosDir)

      // const fingerprint = new Fingerprint({
      //   dir: rootDir,
      //   platform: "ios",
      //   ignore: ["**/build", "**/Pods"],
      //   args: filterArgs(args),
      // })
      // await fingerprint.compute()

      const cache = new LocalCache(args.tag)
      const remoteCache = new RemoteCache(cache)
      const metro = new Metro()

      const cached = await cache.get()
      if (!force && cached?.commandOutput) {
        console.log(cached.commandOutput)

        if (args.configuration === "Release") {
          const extractedDir = `${os.tmpdir()}/${basename(cached.appPath).split(".")[0]}`
          if (args.destination === "device") {
            await $`unzip -q ${cached.appPath} -d ${extractedDir}`
          }

          let [appPath] = await glob("**/main.jsbundle", { cwd: extractedDir })
          appPath = dirname(appPath)

          const destPath =
            args.destination === "device"
              ? join(extractedDir, appPath)
              : cached.appPath

          console.log(">>>>>>>>>> BUNDLING JS")
          await metro.bundle({
            entryFile: resolve(rootDir, "index.js"),
            platform: "ios",
            assetsDest: resolve(destPath, "assets"),
            bundleOutput: resolve(destPath, "main.jsbundle"),
          })

          if (args.destination === "device") {
            await $`cd ${extractedDir} && zip -r ${cached.appPath} .`
            await $`rm -rf ${extractedDir}`
          }
        }

        console.log(">>>>>>>>>> BUILT IT FROM CACHE")
        return
      }

      const remotelyCached = remoteCache.enabled
        ? await remoteCache.exists()
        : false
      if (!force && remotelyCached) {
        await remoteCache.download()

        const cached = await cache.get()

        if (cached) {
          if (cached.commandOutput) {
            console.log(cached.commandOutput)
          }

          if (args.configuration === "Release") {
            const extractedDir = `${os.tmpdir()}/${basename(cached.appPath).split(".")[0]}`
            if (args.destination === "device") {
              await $`unzip -q ${cached.appPath} -d ${extractedDir}`
            }

            let [appPath] = await glob("**/main.jsbundle", {
              cwd: extractedDir,
            })
            appPath = dirname(appPath)

            const destPath =
              args.destination === "device"
                ? join(extractedDir, appPath)
                : cached.appPath

            console.log(">>>>>>>>>> BUNDLING JS")
            await metro.bundle({
              entryFile: resolve(rootDir, "index.js"),
              platform: "ios",
              assetsDest: resolve(destPath, "assets"),
              bundleOutput: resolve(destPath, "main.jsbundle"),
            })

            if (args.destination === "device") {
              await $`cd ${extractedDir} && zip -qr ${cached.appPath} .`
              await $`rm -rf ${extractedDir}`
            }
          }

          console.log(">>>>>>>>>> BUILT IT FROM REMOTE CACHE")
          return
        }
      }

      if (args.destination === "simulator") {
        const { output, appPath } = await xcode.build()
        if (!appPath) {
          throw new Error("Build failed")
        }

        await cache.set(appPath, output)
        if (remoteCache.enabled) {
          await remoteCache.upload(cache.path())
        }
      }

      if (args.destination === "device") {
        const { output, appPath } = await xcode.archive({
          archiveDir: os.tmpdir(),
        })
        if (!appPath) {
          throw new Error("Build failed")
        }

        await cache.set(appPath, output)
        if (remoteCache.enabled) {
          await remoteCache.upload(cache.path())
        }
      }

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
    "build-ios": () => buildIos,
  },
})

runMain(main)
