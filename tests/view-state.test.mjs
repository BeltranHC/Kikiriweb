import test from 'node:test';
import assert from 'node:assert/strict';
import { readSearchState, writeSearchState, clearSearchStates, normalizeSearchState } from '../lib/view-state.mjs';

function storage() {
  const values = new Map();
  return { get length() { return values.size; }, key: index => [...values.keys()][index], getItem: key => values.get(key) ?? null,
    setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key) };
}
test('Search and pagination survive a new view instance within the same tab', () => {
  const tab = storage(); writeSearchState(tab, 'dashboard', { query: 'María 0012', page: 2 });
  assert.deepEqual(readSearchState(tab, 'dashboard'), { query: 'María 0012', page: 2 });
});
test('Search drafts are independent for each screen', () => {
  const tab = storage(); writeSearchState(tab, 'dashboard', { query: 'Ana', page: 1 }); writeSearchState(tab, 'students', { query: '2026', page: 2 });
  assert.equal(readSearchState(tab, 'dashboard').query, 'Ana'); assert.equal(readSearchState(tab, 'students').query, '2026');
});
test('Malformed or unavailable storage does not prevent searching', () => {
  const tab = storage(); tab.setItem('kikiriweb:view:dashboard', 'broken json');
  assert.deepEqual(readSearchState(tab, 'dashboard'), { query: '', page: 1 });
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(readSearchState(blocked, 'dashboard'), { query: '', page: 1 });
  assert.doesNotThrow(() => writeSearchState(blocked, 'dashboard', { query: 'New', page: 1 }));
});
test('Explicit logout removes only this application search drafts', () => {
  const tab = storage(); tab.setItem('unrelated', 'keep'); writeSearchState(tab, 'dashboard', { query: 'Private', page: 1 }); writeSearchState(tab, 'students', { query: 'Other', page: 2 });
  clearSearchStates(tab); assert.equal(tab.length, 1); assert.equal(tab.getItem('unrelated'), 'keep');
});
test('Restored search parameters stay within supported query limits', () => {
  assert.deepEqual(normalizeSearchState({ query: 'x'.repeat(500), page: -1 }), { query: 'x'.repeat(200), page: 1 });
});
