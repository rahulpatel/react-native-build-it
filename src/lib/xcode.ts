export class Xcode {
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

    throw new Error(
      `[xcode] configuration "${configuration}" not found, available configurations: ${this.configurations.join(", ")}`,
    )
  }

  scheme(scheme: string) {
    if (this.schemes.includes(scheme)) {
      return scheme
    }

    throw new Error(
      `[xcode] scheme "${scheme}" not found, available schemes: ${this.schemes.join(", ")}`,
    )
  }

  async information() {
    const flags = ["-list", "-json"]

    const result = await $`cd ${this.iosDir} && xcodebuild ${flags}`.quiet()
    const json = JSON.parse(result.stdout.toString())
    const info = json.project ?? json.workspace

    this.configurations = info.configurations
    this.schemes = info.schemes
    this.targets = info.targets
  }

  async settings(options: { scheme: string; configruation: string }) {
    const flags = [
      "-showBuildSettings",
      "-scheme",
      options.scheme,
      "-configuration",
      options.configruation,
      "-json",
    ]

    const result = await $`cd ${this.iosDir} && xcodebuild ${flags}`.quiet()
    const json = JSON.parse(result.stdout.toString())
    return json[0].buildSettings
  }

  async build(
    options: {
      scheme?: string
      configuration?: string
      destination?: string
    } = {},
  ) {
    await this.information()
    const scheme = this.scheme(options.scheme ?? this.schemes[0])
    const configuration = this.configuration(
      options.configuration ?? this.configurations[0],
    )

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
      "-scheme",
      scheme,
      "-configuration",
      configuration,
      "-destination",
      destination,
      "build",
    ]

    const result =
      await $`cd ${this.iosDir} && RCT_NO_LAUNCH_PACKAGER=true xcodebuild ${flags}`.nothrow()

    const output = result.toString()

    if (!output.includes("BUILD SUCCEEDED")) {
      const error = output.match(/error:.*/g)?.[0]
      throw new Error(error ?? "Build failed")
    }

    const exports = Object.fromEntries(
      output
        .split("\n")
        .filter((x) => x.includes("export") || x.includes("DEST="))
        .map((x) => {
          if (x.includes("DEST=")) {
            const [key, value] = x.replace("+ ", "").split("=")
            return [key, value]
          }

          return x.trim().replace("export ", "").split("\\=")
        }),
    )

    return {
      output,
      appPath: exports.DEST,
    }
  }

  async archive(options: {
    scheme?: string
    configuration?: string
    archivePath: string
  }) {
    await this.information()
    const scheme = this.scheme(options.scheme ?? this.schemes[0])
    const configuration = this.configuration(
      options.configuration ?? this.configurations[0],
    )

    const files = await fs.readdir(this.iosDir)
    const project = files.find((file) => file.endsWith(".xcodeproj"))
    const workspace = files.find((file) => file.endsWith(".xcworkspace"))

    if (!project && !workspace) {
      throw new Error("No Xcode project or workspace found")
    }

    const flags = [
      "archive",
      workspace ? "-workspace" : "-project",
      workspace ? workspace : project,
      "-scheme",
      scheme,
      "-configuration",
      configuration,
      "-archivePath",
      options.archivePath,
      "-sdk",
      "iphoneos",
    ]

    const result =
      await $`cd ${this.iosDir} && RCT_NO_LAUNCH_PACKAGER=true xcodebuild ${flags}`.nothrow()

    const output = result.toString()

    if (!output.includes("ARCHIVE SUCCEEDED")) {
      const error = output.match(/error:.*/g)?.[0]
      throw new Error(error ?? "Archive failed")
    }

    return { hello: "world" }
  }
}
