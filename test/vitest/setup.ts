import 'fake-indexeddb/auto'

/**
 * Пробелы jsdom, которые мешают компонентным тестам (`test/layouts/*`).
 * Плагин Screen из Quasar читает `window.screen.orientation` и подписывается
 * на его событие 'change' при установке, а jsdom не реализует Screen
 * Orientation API — без заглушки `app.use(Quasar)` падает с
 * «Cannot destructure property 'type' of 'orientation'». EventTarget даёт
 * addEventListener/removeEventListener, которых ждёт Quasar.
 */
if (window.screen.orientation === undefined) {
  Object.defineProperty(window.screen, 'orientation', {
    configurable: true,
    value: Object.assign(new EventTarget(), { type: 'portrait-primary', angle: 0 }),
  })
}

/**
 * jsdom не реализует ResizeObserver, а на нём держится useElementSize из Quasar
 * (размеры AppBar, таб-панели). Заглушка ничего не измеряет — в компонентных
 * тестах проверяется состав и активное состояние навигации, а не геометрия.
 */
if (globalThis.ResizeObserver === undefined) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

/**
 * jsdom не реализует window.matchMedia, а плагин Dark из Quasar обращается к
 * нему в Dark.set('auto') (тема 'auto' — дефолт настроек, ТЗ §5.4). Заглушка
 * отвечает «системная тема светлая»: тесты не зависят от темы хост-системы.
 */
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  })
}
