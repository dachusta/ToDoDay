import { defineStore } from 'pinia'
import { ref } from 'vue'
import { Notify } from 'quasar'
import type { AppError } from 'src/models/common'

export interface ConfirmDialogState {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

export const useUiStore = defineStore('ui', () => {
  const drawerOpen = ref(false)
  const confirmDialog = ref<ConfirmDialogState | null>(null)
  const globalError = ref<AppError | null>(null)
  const isOnline = ref(navigator.onLine)

  function toggleDrawer() { drawerOpen.value = !drawerOpen.value }

  function openConfirm(opts: Omit<ConfirmDialogState, 'resolve'>): Promise<boolean> {
    return new Promise(resolve => {
      confirmDialog.value = { ...opts, resolve }
    })
  }

  function notify(
    message: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info',
    action?: { label: string; handler: () => void },
    // Длительность показа в мс (вайрфреймы §9.3: 2 c у создания дела, 5 c у
    // архивации). undefined — дефолт Quasar Notify.
    timeout?: number,
  ) {
    Notify.create({
      message,
      type,
      // exactOptionalPropertyTypes: необязательные поля не принимают явный undefined
      ...(action
        ? { actions: [{ label: action.label, color: 'white', handler: action.handler }] }
        : {}),
      ...(timeout === undefined ? {} : { timeout }),
    })
  }

  function setGlobalError(err: AppError | null) { globalError.value = err }

  return {
    drawerOpen, confirmDialog, globalError, isOnline,
    toggleDrawer, openConfirm, notify, setGlobalError,
  }
})
