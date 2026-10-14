import { ref, computed, watch, onUnmounted } from "vue";
export function useTheme() {
  type Theme = "system" | "light" | "dark";
  const savedTheme = localStorage.getItem("theme");
  const theme = ref<Theme>(savedTheme === "light" || savedTheme === "dark" ? savedTheme : "system");
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  const systemDark = ref(colorScheme.matches);
  const dark = computed(
    () => theme.value === "dark" || (theme.value === "system" && systemDark.value),
  );
  const themeLabel = computed(
    () =>
      `Theme: ${theme.value}. Switch to ${theme.value === "system" ? "light" : theme.value === "light" ? "dark" : "system"} mode`,
  );
  function cycleTheme() {
    theme.value = theme.value === "system" ? "light" : theme.value === "light" ? "dark" : "system";
  }
  function syncSystemTheme(event: MediaQueryListEvent) {
    systemDark.value = event.matches;
  }
  colorScheme.addEventListener("change", syncSystemTheme);
  watch(theme, (value) => localStorage.setItem("theme", value));
  watch(
    dark,
    (value) => {
      document.documentElement.dataset.theme = value ? "dark" : "light";
    },
    { immediate: true },
  );
  onUnmounted(() => colorScheme.removeEventListener("change", syncSystemTheme));
  return { theme, themeLabel, cycleTheme };
}
