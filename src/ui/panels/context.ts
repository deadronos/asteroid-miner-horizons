// What every HUD panel needs: live state, a way to send sim commands, and settings.

import type { SettingsStore } from '../../settings';
import type { Command } from '../../sim/commands';
import type { GameState } from '../../sim/types';
import type { InputMode } from '../goals';

export interface PanelCtx {
  getState: () => GameState;
  send: (cmd: Command) => void;
  settings: SettingsStore;
  /** Active input mode for adapting copy; defaults to 'pointer' when omitted. */
  inputMode?: () => InputMode;
}
