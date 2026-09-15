<template>
  <button @click="load">load</button>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const status = ref('idle');

async function load(): Promise<void> {
  try {
    status.value = 'loading';
  } catch {
  }
}
</script>

<style scoped>
button { color: blue; }
</style>
