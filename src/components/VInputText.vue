<script setup>
defineEmits(['update:modelValue'])

defineProps({
  modelValue: {
    type: String,
    default: ''
  }
})
</script>

<template>
  <input
    class="v-input"
    type="text"
    :value="modelValue"
    @input="$emit('update:modelValue', $event.target.value)"
  >
</template>

<style scoped>
.v-input {
  background: #1B1E24;
  color: #FFFFFF;
  border: none;
  border-radius: 5px;
  width: 100%;
  padding: 6px 10px;
}
</style>
