<script setup>
defineProps({
  loading: {
    type: Boolean,
    default: false
  },
  size: {
    type: String,
    default: 'm'
  },
  view: {
    type: String,
    default: ''
  },
  icon: {
    type: Boolean,
    default: false
  }
})
</script>

<template>
  <button
    class="v-button"
    :class="{
      s: size === 's',
      m: size === 'm',
      l: size === 'l',
      icon: loading || icon
    }"
  >
    <template
      v-if="loading"
    >
      <svg
        class="spinner"
        viewBox="0 0 50 50"
      >
        <circle
          class="path"
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke-width="5"
        />
      </svg>
    </template>

    <slot v-else />
  </button>
</template>

<style scoped>
.v-button {
  --text-color: #FFFFFF;

  display: flex;
  gap: 10px;
  align-items: center;
  background: rgba(27, 30, 36, 0.7);
  color: var(--text-color);
  border: none;
  cursor: pointer;
  border-radius: 5px;
  padding: 0px 20px;
  stroke: var(--text-color);

  &:hover {
    background: rgb(27, 30, 36);
  }

  &.m {
    height: 40px;
    padding: 0px 20px;

    &.icon {
      padding: 0px 10px;
    }
  }

  &.l {
    height: 50px;
    padding: 0px 30px;

    &.icon {
      padding: 0px 15px;
    }
  }

}

.spinner {
  animation: rotate 2s linear infinite;
  z-index: 2;
  width: 20px;
  height: 20px;

  .path {
    stroke: hsl(210, 70, 75);
    stroke-linecap: round;
    animation: dash 1.5s ease-in-out infinite;
  }
}

@keyframes rotate {
    100% {
      transform: rotate(360deg);
    }
  }

  @keyframes dash {
    0% {
      stroke-dasharray: 1, 150;
      stroke-dashoffset: 0;
    }
    50% {
      stroke-dasharray: 90, 150;
      stroke-dashoffset: -35;
    }
    100% {
      stroke-dasharray: 90, 150;
      stroke-dashoffset: -124;
    }
  }
</style>
