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
  background: rgba(27, 30, 36, 0.7);
  color: #FFFFFF;
  border: none;
  cursor: pointer;
  border-radius: 5px;
  padding: 6px 10px;

  &:hover {
    background: rgb(27, 30, 36);
  }
}
</style>
