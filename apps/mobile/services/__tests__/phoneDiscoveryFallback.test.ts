import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Native-phone Discovery — missing-RPC safety (iPhone + Android phone)
// ============================================================================
//
// get_phone_discovery_categories / get_phone_discovery_clubs ship in migration
// 126. Until it is deployed, PostgREST answers "function not found" (PGRST202 /
// SQLSTATE 42883). The phone service must NOT surface that as an error — it
// falls back to the legacy discovery functions so the tab keeps working.
//
// This does NOT restore interest categories before migrations 122+123+126
// (club_categories is already empty in production); it only keeps the branch
// from crashing / rejecting the query. Any OTHER error still propagates.
// ============================================================================

const rpc = vi.fn();
const order = vi.fn();
const select = vi.fn(() => ({ order }));
const from = vi.fn(() => ({ select }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...a: any[]) => (rpc as any)(...a),
    from: (...a: any[]) => (from as any)(...a),
  },
}));

import { getPhoneDiscoveryCategories, getPhoneDiscoveryClubs } from '../searchService';

const MISSING_FN = { code: 'PGRST202', message: 'Could not find the function public.get_phone_discovery_categories' };

beforeEach(() => {
  rpc.mockReset();
  from.mockClear();
  select.mockClear();
  order.mockReset();
});

describe('getPhoneDiscoveryCategories', () => {
  it('maps the RPC result to {value: slug, label} when the function exists', async () => {
    rpc.mockResolvedValueOnce({
      data: [
        { slug: 'music', label: 'Music', sort_order: 2 },
        { slug: 'writing', label: 'Writing', sort_order: 18 },
      ],
      error: null,
    });
    const out = await getPhoneDiscoveryCategories();
    expect(rpc).toHaveBeenCalledWith('get_phone_discovery_categories');
    expect(out).toEqual([
      { value: 'music', label: 'Music' },
      { value: 'writing', label: 'Writing' },
    ]);
  });

  it('falls back to the legacy club_categories path on a missing-function error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: MISSING_FN });
    order.mockResolvedValueOnce({ data: [{ category: 'Music' }, { category: 'Music' }, { category: 'Art' }], error: null });

    const out = await getPhoneDiscoveryCategories();

    expect(from).toHaveBeenCalledWith('club_categories');
    // legacy shape: value === label, de-duplicated
    expect(out).toEqual([
      { value: 'Music', label: 'Music' },
      { value: 'Art', label: 'Art' },
    ]);
  });

  it('rethrows any non-missing-function error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(getPhoneDiscoveryCategories()).rejects.toMatchObject({ code: '42501' });
    expect(from).not.toHaveBeenCalled();
  });
});

describe('getPhoneDiscoveryClubs', () => {
  it('falls back to get_discovery_clubs on a missing-function error', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: '42883', message: 'function get_phone_discovery_clubs(...) does not exist' } })
      .mockResolvedValueOnce({ data: [{ id: 'c1', name: 'Nature Club' }], error: null });

    const out = await getPhoneDiscoveryClubs('u1', null, 0, 20);

    expect(rpc).toHaveBeenNthCalledWith(1, 'get_phone_discovery_clubs', expect.any(Object));
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_discovery_clubs', expect.objectContaining({ p_user_id: 'u1' }));
    expect(out[0]).toMatchObject({ id: 'c1', name: 'Nature Club' });
  });

  it('uses the phone RPC result when the function exists', async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: 'c9', name: 'Climbing Club', categories: ['Sports & Athletics'] }], error: null });
    const out = await getPhoneDiscoveryClubs('u1', 'sports-and-athletics', 0, 20);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_phone_discovery_clubs', {
      p_user_id: 'u1',
      p_interest_slug: 'sports-and-athletics',
      p_limit: 20,
      p_offset: 0,
    });
    expect(out[0]).toMatchObject({ id: 'c9', name: 'Climbing Club', categories: ['Sports & Athletics'] });
  });
});
