import { QueryClient } from "@tanstack/react-query";

/** Default sesuai AC F1: staleTime 60 s, retry 1, tidak refetch saat window fokus. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
