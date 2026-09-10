import { useState, type ReactNode, type ComponentProps } from "react";
import { Check, Copy, WrapText } from "lucide-react";
import { useT } from "@amiba/i18n";

/** Visual actions only. Syntax selection and rendering are owned by the host/plugin. */
export function MarkdownCodeView({
  code,
  children,
}: {
  code: string;
  children: ReactNode;
}) {
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const { language } = useT();
  const zh = language === "zh-CN";
  const wrapLabel = zh ? "自动换行" : "Wrap lines";
  const copyLabel = copyError
    ? zh
      ? "复制失败，请重试"
      : "Copy failed, retry"
    : copied
      ? zh
        ? "已复制"
        : "Copied"
      : zh
        ? "复制代码"
        : "Copy code";
  return (
    <div className="amiba-markdown-code" data-wrap={wrap ? "true" : "false"}>
      {children}
      <div
        className="amiba-markdown-code-actions"
        data-streamdown="code-block-actions"
      >
        <button
          type="button"
          title={wrapLabel}
          aria-label={wrapLabel}
          aria-pressed={wrap}
          onClick={() => setWrap(!wrap)}
        >
          <WrapText aria-hidden="true" />
        </button>
        <button
          type="button"
          title={copyLabel}
          aria-label={copyLabel}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setCopyError(false);
            } catch {
              setCopyError(true);
            }
          }}
          onBlur={() => setCopied(false)}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
export function MarkdownTableView({
  children,
  ...props
}: ComponentProps<"table">) {
  return (
    <div data-streamdown="table-wrapper" className="amiba-markdown-table">
      <div>
        <table {...props} data-streamdown="table">
          {children}
        </table>
      </div>
    </div>
  );
}
