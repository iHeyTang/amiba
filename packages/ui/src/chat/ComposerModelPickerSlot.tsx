import {
  AMIBA_COMPOSER_MODEL_PICKER_PROPS_PROP,
  AMIBA_COMPOSER_MODEL_PICKER_STATE_ATTR,
  type AmibaComposerModelPickerOwner,
  type AmibaComposerModelPickerPropsGetter,
} from "@amiba/extension-sdk";
import { useCallback, useId, useRef } from "react";

/**
 * The composer's model-picker hole: a generic `amiba.composer.modelPicker`
 * slot marker with ZERO model-plane knowledge. The DSH ui-shell scans for
 * `data-amiba-dsh-slot` markers and portals registered contributions into
 * them (`dsh-plugin-model-plane` contributes the actual picker); without a
 * contribution — or outside a DSH plugin runtime entirely — the marker
 * renders nothing (`display: contents`, no children, no reserved space).
 *
 * Prop transport is two-channel, per the extension-sdk contract:
 *   - the FULL owner props (functions included) ride a plain JS property on
 *     the marker node, as a getter that always returns the latest render's
 *     props — attribute strings cannot carry the `agentModels` pass-through
 *     or the draft callback;
 *   - the serializable subset rides {@link AMIBA_COMPOSER_MODEL_PICKER_STATE_ATTR}
 *     as a JSON fingerprint so the ui-shell's MutationObserver notices state
 *     changes (draft selection, session switch, disabled, refresh) and
 *     re-renders the portal with a fresh owner snapshot.
 *
 * `data-amiba-dsh-slot-instance` keeps concurrently mounted composers (chat
 * tabs stay mounted as persistent hosts) on distinct portal targets.
 */
type ComposerPickerMarkerElement = HTMLElement & {
  [AMIBA_COMPOSER_MODEL_PICKER_PROPS_PROP]?: AmibaComposerModelPickerPropsGetter;
};

export function ComposerModelPickerSlot(props: AmibaComposerModelPickerOwner) {
  const instanceId = useId();
  const propsRef = useRef(props);
  propsRef.current = props;
  // One stable getter per mount: the ui-shell snapshots owner props at scan
  // time, and event-time calls (select/draft commit) read through to the
  // latest render via the ref.
  const getterRef = useRef<AmibaComposerModelPickerPropsGetter>(
    () => propsRef.current,
  );
  const markerRef = useCallback((el: ComposerPickerMarkerElement | null) => {
    if (el) el[AMIBA_COMPOSER_MODEL_PICKER_PROPS_PROP] = getterRef.current;
  }, []);
  const stateFingerprint = JSON.stringify({
    sessionId: props.sessionId,
    draftSelection: props.draftSelection ?? null,
    disabled: props.disabled ?? false,
    dialogSize: props.dialogSize ?? "default",
    overlayVariant: props.overlayVariant ?? "dimmed",
    refreshKey: props.refreshKey ?? 0,
  });
  const markerProps = {
    [AMIBA_COMPOSER_MODEL_PICKER_STATE_ATTR]: stateFingerprint,
  };
  return (
    <span
      ref={markerRef}
      className="contents"
      data-amiba-dsh-slot="amiba.composer.modelPicker"
      data-amiba-dsh-slot-instance={instanceId}
      {...markerProps}
    />
  );
}
