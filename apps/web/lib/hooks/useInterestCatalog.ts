"use client";

import { useEffect, useState } from "react";
import {
  fetchActiveInterests,
  INTEREST_CATALOG_FALLBACK,
  type InterestOption,
} from "@weglue/shared";
import { createClient } from "../supabase/client";

// The interest list for BOTH web interest surveys (onboarding + Sidebar →
// Interests), read from the shared `interests` catalog so an admin change shows
// up with no deploy. Falls back to the bundled canonical list only if the
// fetch fails, so the survey never renders empty.

export interface InterestCatalogState {
  /** Display labels, ordered. Selections are held as labels everywhere. */
  labels: string[];
  /** Full options (id/slug/label) when the live catalog loaded; [] on fallback. */
  options: InterestOption[];
  loading: boolean;
  /** True when `labels` came from the bundled fallback, not the database. */
  usedFallback: boolean;
}

export function useInterestCatalog(): InterestCatalogState {
  const [state, setState] = useState<InterestCatalogState>({
    labels: [],
    options: [],
    loading: true,
    usedFallback: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const options = await fetchActiveInterests(createClient());
        if (cancelled) return;
        if (options.length === 0) {
          setState({
            labels: [...INTEREST_CATALOG_FALLBACK],
            options: [],
            loading: false,
            usedFallback: true,
          });
          return;
        }
        setState({
          labels: options.map((o) => o.label),
          options,
          loading: false,
          usedFallback: false,
        });
      } catch {
        if (cancelled) return;
        setState({
          labels: [...INTEREST_CATALOG_FALLBACK],
          options: [],
          loading: false,
          usedFallback: true,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
