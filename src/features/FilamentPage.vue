<script setup lang="ts">
import { computed } from "vue";
import { Layers3 } from "lucide-vue-next";
import { api, form } from "../api";
import AdvancedPanel from "../components/AdvancedPanel.vue";
import { useDashboard } from "../composables/dashboard";
const { base, connected, status, p, busy, error, run, showNotice } = useDashboard();
const ams = computed(() => p.value.ams?.ams || []);
</script>
<template>
  <div class="section-heading">
    <h2>Automatic Material System</h2>
    <button
      :disabled="!connected || busy"
      @click="
        run(async () => {
          await api(base + '/filament', form({ action: 'unload' }));
          showNotice('Unload request sent');
        })
      "
    >
      Unload filament
    </button>
  </div>
  <section v-for="unit in ams" :key="unit.id" class="panel ams-panel">
    <div class="panel-heading">
      <h2>AMS {{ Number(unit.id) + 1 }}</h2>
      <span class="muted"
        >Humidity
        {{ unit.humidity_raw ? unit.humidity_raw + "%" : unit.humidity + " / 5" }}
        · {{ unit.temp }}°C</span
      >
    </div>
    <div class="spool-grid">
      <div v-for="tray in unit.tray" :key="tray.id" class="spool">
        <div class="spool-ring">
          <span>{{ Number(tray.id) + 1 }}</span>
        </div>
        <h3>{{ tray.tray_type || "Empty slot" }}</h3>
        <p>
          {{ tray.tray_sub_brands || tray.tray_info_idx || "No material reported" }}
        </p>
        <small
          >{{ tray.remain >= 0 ? tray.remain + "% remaining" : "Remaining unknown" }} ·
          {{ tray.tray_color || "—" }}</small
        ><button
          :disabled="!connected || busy"
          @click="
            run(async () => {
              await api(
                base + '/filament',
                form({
                  action: 'load',
                  target: Number(unit.id) * 4 + Number(tray.id),
                }),
              );
              showNotice('Load request sent');
            })
          "
        >
          Load spool
        </button>
      </div>
    </div>
  </section>
  <section v-if="!ams.length" class="panel empty-inline">
    <Layers3 :size="32" />
    <h3>No AMS reported</h3>
    <p>Connected material systems appear here automatically.</p>
  </section>
  <section class="panel external-spool">
    <div>
      <h2>External spool</h2>
      <p>{{ p.vt_tray?.tray_type || "Manual filament feed" }}</p>
    </div>
    <button
      :disabled="!connected || busy"
      @click="
        run(async () => {
          await api(base + '/filament', form({ action: 'load', target: 254 }));
          showNotice('External spool load requested');
        })
      "
    >
      Load external
    </button>
  </section>
  <AdvancedPanel
    :base="base"
    :connected="connected"
    mode="filament"
    :status="status"
    @error="error = $event"
    @notice="showNotice"
  />
</template>
