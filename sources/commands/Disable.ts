import {Command, Option, UsageError}                                     from 'clipanion';
import fs                                                                from 'fs';
import path                                                              from 'path';
import which                                                             from 'which';

import * as corepackUtils                                                from '../corepackUtils';
import {Context}                                                         from '../main';
import type {NodeError}                                                  from '../nodeUtils';
import {isSupportedPackageManager, SupportedPackageManagerSetWithoutNpm} from '../types';

export class DisableCommand extends Command<Context> {
  static paths = [
    [`disable`],
  ];

  static usage = Command.Usage({
    description: `Remove the Corepack shims from the install directory`,
    details: `
      When run, this command will remove the shims for the specified package managers from the install directory, or all shims if no parameters are passed.

      By default it will locate the install directory by running the equivalent of \`which corepack\`, but this can be tweaked by explicitly passing the install directory via the \`--install-directory\` flag.
    `,
    examples: [[
      `Disable all shims, removing them if they're next to the \`coreshim\` binary`,
      `$0 disable`,
    ], [
      `Disable all shims, removing them from the specified directory`,
      `$0 disable --install-directory /path/to/bin`,
    ], [
      `Disable the Yarn shim only`,
      `$0 disable yarn`,
    ]],
  });

  installDirectory = Option.String(`--install-directory`, {
    description: `Where the shims are located`,
  });

  names = Option.Rest();

  async execute() {
    let installDirectory = this.installDirectory;

    // Node always call realpath on the module it executes, so we already
    // lost track of how the binary got called. To find it back, we need to
    // iterate over the PATH variable.
    if (typeof installDirectory === `undefined`)
      installDirectory = path.dirname(await which(`corepack`));

    const names = this.names.length === 0
      ? SupportedPackageManagerSetWithoutNpm
      : this.names;

    const allBinNames: Array<string> = [];

    for (const name of new Set(names)) {
      if (!isSupportedPackageManager(name))
        throw new UsageError(`Invalid package manager name '${name}'`);

      const binNames = this.context.engine.getBinariesFor(name);
      allBinNames.push(...binNames);
    }

    const removeLink = process.platform === `win32` ?
      (binName: string) => this.removeWin32Link(installDirectory, binName) :
      (binName: string) => this.removePosixLink(installDirectory, binName);

    await Promise.all(allBinNames.map(removeLink));
  }

  async removePosixLink(installDirectory: string, binName: string) {
    const file = path.join(installDirectory, binName);
    try {
      if (binName.includes(`yarn`) && corepackUtils.isYarnSwitchPath(await fs.promises.realpath(file))) {
        console.warn(`${binName} is already installed in ${file} and points to a Yarn Switch install - skipping`);
        return;
      }

      await fs.promises.unlink(file);
    } catch (err) {
      if ((err as NodeError).code !== `ENOENT`) {
        throw err;
      }
    }
  }

  async removeWin32Link(installDirectory: string, binName: string) {
    for (const ext of [``, `.ps1`, `.cmd`]) {
      const file = path.join(installDirectory, `${binName}${ext}`);
      try {
        await fs.promises.unlink(file);
      } catch (err) {
        if ((err as NodeError).code !== `ENOENT`) {
          throw err;
        }
      }
    }
  }
}
