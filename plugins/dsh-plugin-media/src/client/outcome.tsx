import { usePluginT } from "@amiba/ui/plugin";
import type { MediaRecord } from "../store.js";
import { resultUrl } from "../result-links.js";
import { mediaCopy } from "./i18n-media.js";
export function MediaOutcome({ record }: { record: MediaRecord }) {
  const { t } = usePluginT(mediaCopy);
  if (record.generationStatus !== "succeeded") return null;
  const pending = record.storageStatus !== "saved";
  const links = pending
    ? (record.remoteArtifacts ?? []).filter(
        (row) => row.index >= record.artifacts.length && resultUrl(row.url),
      )
    : [];
  return (
    <div className="amiba-media-outcome">
      <p role="status">
        {t(
          record.storageStatus === "failed"
            ? "media.generatedSaveFailed"
            : pending
              ? "media.generatedSaving"
              : "media.generatedSaved",
        )}
      </p>
      {record.storageError && (
        <details>
          <summary>{t("media.saveDetails")}</summary>
          <p>{record.storageError}</p>
        </details>
      )}
      {links.map((row) => (
        <a
          key={row.index}
          href={resultUrl(row.url)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("media.upstreamResult")} {row.index + 1}
        </a>
      ))}
      {links.length > 0 && <p>{t("media.linkExpiry")}</p>}
      {record.storageStatus === "failed" && <p>{t("media.saveRetryHint")}</p>}
    </div>
  );
}
