import { ref } from 'vue'

export function useTabs () {
  const curentTab = ref('')

  function setTab (tabName) {
    curentTab.value = tabName
  }

  return { curentTab, setTab }
}
