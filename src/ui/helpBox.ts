// Help box behavior: auto-hide after onboarding minutes, with manual re-open support.

/** After this many in-run seconds, help auto-hides once per HUD instance. */
export const HELP_AUTO_HIDE_SEC = 180;

/** True when help should be auto-hidden on this refresh tick. */
export function shouldAutoHideHelp(runTimeSec: number, showHelp: boolean, alreadyAutoHidden: boolean): boolean {
  return showHelp && !alreadyAutoHidden && runTimeSec >= HELP_AUTO_HIDE_SEC;
}
