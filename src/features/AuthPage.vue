<script setup lang="ts">
import { Box, ArrowUpRight } from "lucide-vue-next";
import { useDashboard } from "../composables/dashboard";
const { auth, password, authenticate, busy, error } = useDashboard();
</script>
<template>
  <main class="auth-page">
    <div class="auth-brand"><Box :size="28" />BambuDeck</div>
    <section class="auth-card">
      <h1>{{ auth.setupRequired ? "Set password" : "Sign in" }}</h1>
      <form @submit.prevent="authenticate">
        <label
          >{{ auth.setupRequired ? "Create dashboard password" : "Dashboard password"
          }}<input
            v-model="password"
            type="password"
            :minlength="auth.setupRequired ? 12 : 1"
            required
            :autocomplete="auth.setupRequired ? 'new-password' : 'current-password'"
            placeholder="Enter your password"
        /></label>
        <p v-if="auth.setupRequired" class="help">
          Use at least 12 characters. This protects access to every printer.
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button class="primary full" :disabled="busy">
          {{ busy ? "Signing in…" : auth.setupRequired ? "Set password" : "Sign in"
          }}<ArrowUpRight :size="18" />
        </button>
      </form>
    </section>
  </main>
</template>
