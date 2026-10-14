<script setup lang="ts">
import { ref, onMounted } from "vue";
import { X } from "lucide-vue-next";
defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
onMounted(() => dialog.value?.showModal());
</script>
<template>
  <dialog
    ref="dialog"
    class="modal"
    @cancel.prevent="emit('close')"
    @click="$event.target === dialog && emit('close')"
  >
    <div class="modal-heading">
      <h2>{{ title }}</h2>
      <button
        class="icon-button"
        aria-label="Close dialog"
        @click="emit('close')"
      >
        <X :size="20" />
      </button>
    </div>
    <slot />
  </dialog>
</template>
