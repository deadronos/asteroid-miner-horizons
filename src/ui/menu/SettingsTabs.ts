// Gameplay, Graphics and Interface tabs: plain settings forms.

import type { SettingsStore } from '../../settings';
import { rangeRow, section, selectRow, toggleRow } from './form';

export function renderGameplay(settings: SettingsStore): Node[] {
  return [
    section('Pausing'),
    toggleRow(settings, 'pauseInMenus', 'Pause while menus are open', 'This menu and the Research panel'),
    toggleRow(settings, 'pauseUnfocused', 'Pause when the window loses focus', 'Switching to another app or tab'),
    section('Saving'),
    selectRow(settings, 'autosaveSec', 'Autosave', [
      [0, 'Off (only when leaving the page)'],
      [10, 'Every 10 seconds'],
      [30, 'Every 30 seconds'],
      [60, 'Every minute'],
    ]),
    toggleRow(
      settings,
      'confirmDestructive',
      'Confirm restart, delete and scrap',
      'Ask before erasing a save or scrapping a ship',
    ),
    section('Autopilot assists'),
    toggleRow(
      settings,
      'assistAvoid',
      'Steer around asteroids',
      'Move, dock and mining approaches avoid rocks. Off: straight lines; you may crash.',
    ),
    toggleRow(
      settings,
      'assistAutoDock',
      'Drones unload automatically',
      'Full drones fly home to unload. Off: they wait for a manual dock order.',
    ),
    toggleRow(
      settings,
      'assistChain',
      'Keep mining fragments',
      'After a rock breaks, the laser moves on to the nearest fragment',
    ),
  ];
}

export function renderGraphics(settings: SettingsStore): Node[] {
  return [
    section('Quality'),
    selectRow(
      settings,
      'quality',
      'Preset',
      [
        ['low', 'Low: 1× resolution, fewer stars & particles'],
        ['medium', 'Medium: up to 1.5× resolution'],
        ['high', 'High: up to 2× resolution, full effects'],
      ],
      "Resolution is capped at your display's pixel density",
    ),
    toggleRow(settings, 'nebula', 'Nebula backdrop'),
    toggleRow(settings, 'antialias', 'Anti-aliasing', 'Smooth edges. Takes effect after reloading the page.'),
    section('Effects'),
    selectRow(settings, 'shake', 'Screen shake', [
      ['off', 'Off'],
      ['low', 'Low'],
      ['full', 'Full'],
    ]),
    toggleRow(settings, 'showFps', 'Show FPS counter'),
  ];
}

export function renderInterface(settings: SettingsStore): Node[] {
  return [
    section('HUD'),
    rangeRow(settings, 'hudScale', 'HUD scale', 0.8, 1.4, 0.05, (v) => `${Math.round(v * 100)}%`),
    toggleRow(
      settings,
      'alwaysShowBars',
      'Always show ship bars',
      'Otherwise only for the selected, damaged or loaded ships',
    ),
    toggleRow(settings, 'showHelp', 'Show help box'),
    selectRow(
      settings,
      'logVerbosity',
      'Event log',
      [
        ['all', 'Everything'],
        ['important', 'Important only'],
      ],
      'Important: warnings, losses and milestones',
    ),
    section('Camera'),
    toggleRow(
      settings,
      'followByDefault',
      'Follow the selected ship',
      'Selecting a ship or flying re-centres the camera. The follow key always toggles it.',
    ),
    rangeRow(settings, 'zoomSpeed', 'Zoom speed', 0.4, 2.5, 0.1, (v) => `${v.toFixed(1)}×`),
    toggleRow(settings, 'edgePan', 'Edge panning', 'Pan by resting the cursor at the screen edge'),
  ];
}
