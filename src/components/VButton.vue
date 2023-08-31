<script setup>
//
</script>

<template>
  <button class="v-button">
    <slot />
  </button>
</template>

<style scoped>
.v-button {
  background: #1B1E24;
  color: #FFFFFF;
  border: none;
  cursor: pointer;
  border-radius: 5px;
  padding: 6px 10px;
  /* width: 30px; */
  /* height: 30px; */
  /* line-height: 0.5; */
}
</style>
