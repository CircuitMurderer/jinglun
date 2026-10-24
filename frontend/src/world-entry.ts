import type { MapResponse } from './types';

export type WorldEntry =
  | { stage: 'setup'; result?: MapResponse }
  | { stage: 'confirm'; result: MapResponse }
  | { stage: 'round'; result: MapResponse; round: { year: number; month: number } };

type EntryAction =
  | { type: 'generated'; result: MapResponse }
  | { type: 'configure' }
  | { type: 'confirm' }
  | { type: 'next-round' };

export function worldEntryReducer(state: WorldEntry, action: EntryAction): WorldEntry {
  switch (action.type) {
    case 'generated':
      return state.stage === 'setup' ? { stage: 'confirm', result: action.result } : state;
    case 'configure':
      return state.stage === 'confirm' ? { stage: 'setup', result: state.result } : state;
    case 'confirm':
      return state.stage === 'confirm'
        ? { stage: 'round', result: state.result, round: { year: 1, month: 1 } }
        : state;
    case 'next-round': {
      if (state.stage !== 'round') return state;
      const month = state.round.month === 12 ? 1 : state.round.month + 1;
      const year = state.round.year + (state.round.month === 12 ? 1 : 0);
      return { ...state, round: { year, month } };
    }
  }
}
