// lib/query.ts — Vue Query client configuration.

import { QueryClient, type VueQueryPluginOptions } from "@tanstack/vue-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const vueQueryOptions: VueQueryPluginOptions = {
  queryClient,
};
