import "zx"

type BuildOptions = {
  entryFile: string
  platform: string
  assetsDest: string
  bundleOutput: string
}

export class Metro {
  constructor() {}

  async bundle(options: BuildOptions) {
    console.log("Building with options:", options)

    const flags = [
      "--entry-file",
      options.entryFile,
      "--platform",
      options.platform,
      "--assets-dest",
      options.assetsDest,
      "--bundle-output",
      options.bundleOutput,
    ]

    await $`./node_modules/.bin/react-native bundle ${flags}`

    // TODO: compile the bundle using hermes
  }
}
