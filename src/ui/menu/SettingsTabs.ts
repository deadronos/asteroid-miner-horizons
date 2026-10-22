// Gameplay, Graphics and Interface tabs: plain settings forms.

import { TUNING } from '../../data/tuning';
import { AUTO_RESERVE_VALUES, QUALITY_MODES, type SettingsStore } from '../../settings';
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
    toggleRow(
      settings,
      'offlineProgress',
      'Offline progress',
      `On load, drones and outposts are credited a reduced income for the time away, up to ${TUNING.offlineCapSec / 3600} hours`,
    ),
    section('Hazards'),
    selectRow(
      settings,
      'hazards',
      'Comets and solar flares',
      [
        ['off', 'Off'],
        ['normal', 'Normal'],
        ['harsh', 'Harsh: more often, hits harder'],
      ],
      'Comets cross the belts; flares burn ships near M and B stars.',
    ),
    section('Fleet automation'),
    selectRow(
      settings,
      'autoRepairAt',
      'Autorepair below',
      [
        [0.25, '25% hull'],
        [0.5, '50% hull'],
        [0.75, '75% hull'],
      ],
      'Ships with REPAIR on fly home to repair once their hull drops this low.',
    ),
    selectRow(
      settings,
      'autoReserve',
      'Keep in reserve',
      AUTO_RESERVE_VALUES.map((n) => [n, n ? `${n} of each resource` : 'Nothing']),
      'REPAIR and UPGRADE only spend what the bank holds above this. Your own purchases ignore it.',
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
      QUALITY_MODES.map(
        (quality) =>
          [
            quality,
            quality === 'auto'
              ? 'Auto: adjusts resolution and effects to keep frames smooth'
              : quality === 'low'
                ? 'Low: 1× resolution, fewer stars & particles'
                : quality === 'medium'
                  ? 'Medium: up to 1.5× resolution'
                  : 'High: up to 2× resolution, full effects',
          ] as [typeof quality, string],
      ),
      "Resolution is capped at your display's pixel density; Auto starts at High",
    ),
    selectRow(
      settings,
      'renderScale',
      'Render scale',
      [
        [1, '100%'],
        [0.75, '75%'],
      ],
      'Multiplies the preset resolution cap.',
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
    toggleRow(settings, 'hudCompact', 'Compact HUD', 'Tighter panels and a shorter event log'),
    selectRow(
      settings,
      'help',
      'Help box',
      [
        ['auto', 'First minutes only'],
        ['on', 'Always'],
        ['off', 'Hidden'],
      ],
      'The ? button and the help key toggle it',
    ),
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
    section('Touch'),
    selectRow(
      settings,
      'touchControls',
      'On-screen controls',
      [
        ['auto', 'On touch screens'],
        ['on', 'Always'],
        ['off', 'Hidden'],
      ],
      'A thrust stick and buttons for the keyboard-only actions. Pinch zooms; a long press gives the right-click order.',
    ),
  ];
}
