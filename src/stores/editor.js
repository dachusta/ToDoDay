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

    localStorage.setItem('days', JSON.stringify(days.days))
    localStorage.setItem('tasks', JSON.stringify(tasks.tasks))
  }
  function save () {
    is.value = false

    days.setDays()
    tasks.setTasks()
  }
  function cancel () {
    is.value = false

    days.days = JSON.parse(localStorage.getItem('days'))
    tasks.tasks = JSON.parse(localStorage.getItem('tasks'))
  }

  return {
    is,
    open,
    save,
    cancel
  }
})
