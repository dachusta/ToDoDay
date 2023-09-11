import { ref, computed } from 'vue'

export function useCurrentDay () {
  const orderDay = ref('')

  const currentDay = computed(() => {
    const nextDay = orderDay.value * 24 * 60 * 60 * 1000

    const currentDate = new Date(new Date().getTime() + nextDay)
    const day = currentDate.getDate()
    const month = currentDate.getMonth() + 1
    const year = currentDate.getFullYear()
    return day + '/' + month + '/' + year
  })

  return { orderDay, currentDay }
}
