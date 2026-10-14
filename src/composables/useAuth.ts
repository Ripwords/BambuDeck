import { reactive, ref, onMounted } from "vue";
import { api } from "../api";
import type { useFeedback } from "./useFeedback";
import type { usePrinter } from "./usePrinter";
export function useAuth(
  feedback: ReturnType<typeof useFeedback>,
  printer: ReturnType<typeof usePrinter>,
) {
  const { run } = feedback;
  const { loadProfiles, disconnect } = printer;
  const auth = reactive({ ready: false, setupRequired: false, authenticated: false });
  const password = ref("");
  async function authenticate() {
    await run(async () => {
      await api(`/api/auth/${auth.setupRequired ? "setup" : "login"}`, {
        password: password.value,
      });
      password.value = "";
      auth.authenticated = true;
      auth.setupRequired = false;
      await loadProfiles();
    });
  }
  async function logout() {
    await run(async () => {
      await api("/api/auth/logout", {});
      disconnect();
      auth.authenticated = false;
    });
  }
  onMounted(async () => {
    await run(async () => {
      Object.assign(auth, await api("/api/auth/status"));
      if (auth.authenticated) await loadProfiles();
    });
    auth.ready = true;
  });
  return { auth, password, authenticate, logout };
}
