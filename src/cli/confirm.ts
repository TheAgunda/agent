import inquirer from 'inquirer';
import chalk from 'chalk';
import type { ConfirmFn } from '../permissions/index.js';

export function createInteractiveConfirm(nonInteractive: boolean): ConfirmFn {
  return async (message: string, detail?: string) => {
    if (nonInteractive) {
      // No TTY / --yes mode: deny anything requiring confirmation rather than hang.
      return false;
    }
    if (detail) console.log(chalk.dim(`  ${detail}`));
    const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
      { type: 'confirm', name: 'confirmed', message, default: false },
    ]);
    return confirmed;
  };
}

export function createAutoConfirm(): ConfirmFn {
  return async () => true;
}
