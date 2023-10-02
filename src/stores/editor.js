import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useDaysStore } from './days'
import { useTasksStore } from './tasks'

export const useEditorStore = defineStore('editor', () => {
  const days = useDaysStore()
  const tasks = useTasksStore()

  const is = ref(false)

  function open () {
    is.value = true

    localStorage.setItem('days', JSON.stringify(days.list))
    localStorage.setItem('tasks', JSON.stringify(tasks.list))
  }
  function save () {
    is.value = false

    days.setList()
    tasks.setList()
  }
  function cancel () {
    is.value = false

    days.list = JSON.parse(localStorage.getItem('days'))
    tasks.list = JSON.parse(localStorage.getItem('tasks'))
  }

  return {
    is,
    open,
    save,
    cancel
  }
})
