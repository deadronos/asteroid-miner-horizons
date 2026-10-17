// What every HUD panel needs: live state, a way to send sim commands, and settings.

import type { SettingsStore } from '../../settings';
import type { Command } from '../../sim/commands';
import type { GameState } from '../../sim/types';

export interface PanelCtx {
  getState: () => GameState;
  send: (cmd: Command) => void;
  settings: SettingsStore;
}
