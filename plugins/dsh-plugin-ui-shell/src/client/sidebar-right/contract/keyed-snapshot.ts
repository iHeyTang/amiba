// Adapted from DeepSeek c291e796, MIT. See LICENSE.deepseek.
/** Selector Hook over an open family of keyed observable sources. */
export type KeyedSnapshotSelectorHook<Snapshot> = {
  /** @param key - source key. @returns the current value, or absence when the source is unavailable. */
  (key: string): Snapshot | undefined
  /**
   * @param key - source key.
   * @param selector - projection over the current keyed value.
   * @param equal - optional selected-value equality.
   * @returns the selected value.
   */
  <Selected>(
    key: string,
    selector: (value: Snapshot | undefined) => Selected,
    equal?: (left: Selected, right: Selected) => boolean,
  ): Selected
}
