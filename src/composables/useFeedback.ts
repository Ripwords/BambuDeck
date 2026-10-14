import { ref, onUnmounted } from "vue";
export function useFeedback() {
  const busy = ref(false);
  const error = ref("");
  const notice = ref("");
  let pending = 0;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function showNotice(message: string) {
    clearTimeout(noticeTimer);
    notice.value = message;
    noticeTimer = setTimeout(() => {
      notice.value = "";
    }, 4000);
  }
  async function run(task: () => Promise<void>) {
    error.value = "";
    pending++;
    busy.value = true;
    try {
      await task();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy.value = --pending > 0;
    }
  }
  onUnmounted(() => clearTimeout(noticeTimer));
  return { busy, error, notice, showNotice, run };
}
