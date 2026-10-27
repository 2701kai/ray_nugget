export function usePwa() {
  return { online: true, offlineReady: false, installable: false, installed: false, updateReady: false, install: async () => undefined };
}
