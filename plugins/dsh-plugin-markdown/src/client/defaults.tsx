import { cloneElement, isValidElement, type ReactNode } from "react";
import type { Components } from "streamdown";
import type { MarkdownExtension } from "@amiba/markdown";
import { MarkdownCodeView, MarkdownTableView } from "@amiba/ui/plugin";
/** Native pre contract: preserve Streamdown's code renderer and data-block flag. */
export const DefaultCodePre: NonNullable<Components["pre"]> = ({
  children,
}) => {
  if (
    !isValidElement<{ children?: ReactNode; "data-block"?: string }>(children)
  )
    return <pre>{children}</pre>;
  const source = children.props.children;
  const code = typeof source === "string" ? source : "";
  return (
    <MarkdownCodeView code={code}>
      {cloneElement(children, { "data-block": "true" })}
    </MarkdownCodeView>
  );
};
export const defaultMarkdown: MarkdownExtension = {
  id: "amiba.markdown.defaults",
  version: "2",
  order: 1000,
  components: {
    pre: DefaultCodePre,
    table: ({ node: _node, ...props }) => <MarkdownTableView {...props} />,
  },
};
