import { getPlatform } from "@amiba/app-runtime/platform";
import { $getSelection, $isRangeSelection, type LexicalEditor } from "lexical";
import { $createMentionNode } from "../MentionNode";
import type { MenuItem, MentionData, TriggerProvider } from "./types";

async function load(sessionId?: string) {
  const platform = getPlatform();
  if (!platform.agentSkills || !platform.agentSessions) return [];
  const resolvedSessionId =
    sessionId ||
    (await platform.agentSessions.list()).sort(
      (left, right) => right.updatedAt - left.updatedAt,
    )[0]?.sessionId;
  if (!resolvedSessionId) return [];
  const result = await platform.agentSkills.list(resolvedSessionId);
  // No user-invocable filter: the engine's `skill.list` RPC returns only
  // user-invocable rows by contract (`AgentSkillMention.userInvocable` is
  // the literal type `true` — see its doc comment in
  // `@amiba/app-runtime/platform`), so filtering here would be dead code.
  return result.skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
  }));
}

export function makeSkillsProvider(sessionId?: string): TriggerProvider {
  return {
    trigger: "/",
    id: "skills",
    group: "Skills",
    ownsType: "skill",
    // Skill names are a single slash token. A space means the user is now
    // entering arguments for a DSH command or skill, so completion is done.
    match: (query) => !query.includes(" "),
    async search(query: string): Promise<MenuItem[]> {
      const q = query.toLowerCase();
      const skills = await load(sessionId);
      return skills
        .filter((s) => s.name.toLowerCase().includes(q))
        .slice(0, 20)
        .map((s) => ({
          id: `skills:${s.name}`,
          label: s.name,
          description: s.description,
          insert: {
            type: "skill",
            payload: { name: s.name },
            display: s.name,
          } as MentionData,
        }));
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (!item.insert) return;
      insertMentionAtTrigger(editor, item.insert);
    },
    serialize(m: MentionData): string {
      return `/${m.payload.name}`;
    },
  };
}

/** Replace the open trigger run (e.g. "@trans") with a MentionNode + trailing space. Reused by all @ providers. */
export function insertMentionAtTrigger(
  editor: LexicalEditor,
  mention: MentionData,
) {
  editor.update(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
    const node = sel.anchor.getNode();
    const offset = sel.anchor.offset;
    const text = node.getTextContent();
    const before = text.slice(0, offset);
    const m = /([/@])([^\s]*)$/.exec(before);
    if (!m) return;
    const triggerStart = offset - m[0].length;
    if (typeof (node as { spliceText?: unknown }).spliceText === "function") {
      (
        node as unknown as {
          spliceText: (i: number, n: number, t: string) => void;
        }
      ).spliceText(triggerStart, m[0].length, "");
    }
    const chip = $createMentionNode(mention);
    sel.insertNodes([chip]);
    sel.insertText(" ");
  });
}
