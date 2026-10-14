<script setup lang="ts">
import { ref } from "vue";
import {
  Box,
  LayoutDashboard,
  FolderOpen,
  Layers3,
  Settings2,
  Plus,
  RefreshCw,
  Moon,
  Monitor,
  Sun,
  LogOut,
  Printer,
  ChevronRight,
  AlertCircle,
} from "lucide-vue-next";
import { useRegisterSW } from "virtual:pwa-register/vue";
import { provideDashboard } from "./composables/dashboard";
import { useTheme } from "./composables/useTheme";
import AuthPage from "./features/AuthPage.vue";
import OverviewPage from "./features/OverviewPage.vue";
import FilesPage from "./features/FilesPage.vue";
import FilamentPage from "./features/FilamentPage.vue";
import SettingsPage from "./features/SettingsPage.vue";
import PrinterEditor from "./features/PrinterEditor.vue";
const { needRefresh, updateServiceWorker } = useRegisterSW();
const {
  auth,
  profiles,
  selected,
  tab,
  connected,
  connecting,
  profile,
  caps,
  p,
  error,
  notice,
  connect,
  logout,
} = provideDashboard();
const { theme, themeLabel, cycleTheme } = useTheme();
const printerEditor = ref<InstanceType<typeof PrinterEditor>>();
const nav = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Files", icon: FolderOpen },
  { name: "Filament", icon: Layers3 },
  { name: "Settings", icon: Settings2 },
];
</script>
<template>
  <div v-if="!auth.ready" class="boot">Loading…</div>
  <AuthPage v-else-if="!auth.authenticated" />
  <div v-else class="app-shell">
    <aside class="sidebar">
      <a href="#" class="brand" @click.prevent="tab = 'Overview'"><Box :size="28" />BambuDeck</a>
      <div class="workspace-label">Printers</div>
      <nav aria-label="Main navigation">
        <button
          v-for="item in nav"
          :key="item.name"
          :class="{ active: tab === item.name }"
          @click="tab = item.name"
        >
          <component :is="item.icon" :size="19" /><span>{{ item.name }}</span
          ><ChevronRight v-if="tab === item.name" class="nav-arrow" :size="15" />
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-actions">
          <button
            class="icon-button"
            :aria-label="themeLabel"
            :title="themeLabel"
            @click="cycleTheme"
          >
            <Monitor v-if="theme === 'system'" :size="18" /><Sun
              v-else-if="theme === 'light'"
              :size="18"
            /><Moon v-else :size="18" /></button
          ><button class="text-button" @click="logout"><LogOut :size="16" />Sign out</button>
        </div>
      </div>
    </aside>
    <div class="main-column">
      <header class="topbar">
        <div v-if="profiles.length" class="header-printer">
          <div class="header-printer-icon"><Printer :size="21" /></div>
          <label class="header-printer-picker">
            <span class="sr-only">Selected printer</span>
            <select v-model="selected">
              <option v-for="item in profiles" :key="item.id" :value="item.id">
                {{ item.name }}
              </option>
            </select>
            <small>
              {{ caps.display_name || p.device_model || "Bambu Lab printer" }}
              <span>· {{ profile?.hostMasked }}</span>
            </small>
          </label>
        </div>
        <div v-else class="header-brand"><Box :size="23" />BambuDeck</div>
        <div class="topbar-right">
          <template v-if="profiles.length">
            <span class="connection" role="status">
              <i :class="{ online: connected }" />
              {{ connecting ? "Connecting" : connected ? "Connected" : "Offline" }}
            </span>
            <button
              class="icon-button"
              aria-label="Reconnect printer"
              :disabled="connecting"
              @click="connect"
            >
              <RefreshCw :size="18" :class="{ spinning: connecting }" />
            </button>
          </template>
          <button
            class="icon-button"
            :aria-label="themeLabel"
            :title="themeLabel"
            @click="cycleTheme"
          >
            <Monitor v-if="theme === 'system'" :size="18" /><Sun
              v-else-if="theme === 'light'"
              :size="18"
            /><Moon v-else :size="18" />
          </button>
        </div>
      </header>
      <main class="workspace">
        <div class="page-heading">
          <div>
            <h1>{{ tab }}</h1>
          </div>
          <button
            v-if="tab === 'Settings' || !profiles.length"
            class="primary"
            @click="printerEditor?.open()"
          >
            <Plus :size="18" />Add printer
          </button>
        </div>
        <div v-if="needRefresh" class="banner success" role="status">
          <span>A dashboard update is ready.</span
          ><button class="text-button" @click="updateServiceWorker(true)">Reload now</button
          ><button class="text-button" @click="needRefresh = false">Later</button>
        </div>
        <div v-if="error" class="banner error" role="alert">
          <AlertCircle :size="19" /><span>{{ error }}</span
          ><button class="text-button" @click="error = ''">Dismiss</button>
        </div>
        <div v-if="notice" class="toast" role="status" aria-live="polite">
          <span>{{ notice }}</span
          ><button class="text-button" @click="notice = ''">Dismiss</button>
        </div>
        <section v-if="!profiles.length && tab !== 'Settings'" class="empty-workshop">
          <div class="empty-printer">
            <Printer :size="68" :stroke-width="1" />
          </div>
          <h2>Add a printer</h2>
          <p>Enter your printer’s LAN connection details to get started.</p>
          <button class="primary" @click="printerEditor?.open()">
            <Plus :size="18" />Add printer</button
          ><small>Find its IP, serial number, and LAN access code in printer settings.</small>
        </section>
        <KeepAlive v-else>
          <OverviewPage v-if="tab === 'Overview'" />
          <FilesPage v-else-if="tab === 'Files'" />
          <FilamentPage v-else-if="tab === 'Filament'" />
          <SettingsPage
            v-else-if="tab === 'Settings'"
            @edit-printer="printerEditor?.open($event)"
          />
        </KeepAlive>
      </main>
    </div>
    <nav class="mobile-nav" aria-label="Mobile navigation">
      <button v-for="item in nav" :class="{ active: tab === item.name }" @click="tab = item.name">
        <component :is="item.icon" :size="21" /><span>{{ item.name }}</span>
      </button>
    </nav>
  </div>
  <PrinterEditor v-if="auth.authenticated" ref="printerEditor" />
</template>
