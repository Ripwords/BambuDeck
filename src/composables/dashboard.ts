import { inject, provide, type InjectionKey } from "vue";
import { useFeedback } from "./useFeedback";
import { usePrinter } from "./usePrinter";
import { useAuth } from "./useAuth";
function createDashboard() {
  const feedback = useFeedback();
  const printer = usePrinter(feedback);
  const auth = useAuth(feedback, printer);
  return { ...feedback, ...printer, ...auth };
}
type Dashboard = ReturnType<typeof createDashboard>;
const dashboardKey: InjectionKey<Dashboard> = Symbol("dashboard");
export function provideDashboard() {
  const dashboard = createDashboard();
  provide(dashboardKey, dashboard);
  return dashboard;
}
export function useDashboard() {
  const dashboard = inject(dashboardKey);
  if (!dashboard) throw new Error("Dashboard provider is missing");
  return dashboard;
}
