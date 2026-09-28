import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { $createParagraphNode, $createTextNode, $getRoot, UNDO_COMMAND, type LexicalEditor } from 'lexical';
import { DraftBoundComposer } from '../draft-bound-composer';
import { createComposerDraftSource } from '../composer-draft-store';

const canSubmitDraft = (text: string) => text.trim().length > 0;
const onSubmit = () => {};
const editor = () => (screen.getByRole('textbox') as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;

describe('draft-bound composer native document', () => {
  it('keeps token-shaped literal text as text rather than silently turning it into a reference', async () => {
    const source = createComposerDraftSource();
    const text = 'literal @[file:/tmp/example.txt]';
    source.setParts([{ kind: 'text', text }]);
    render(<DraftBoundComposer draftSource={source} canSubmitDraft={canSubmitDraft} onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getByRole('textbox').textContent).toBe(text));
    expect(screen.getByRole('textbox').querySelector('[data-mention-type]')).toBeNull();
    expect(source.getDocument().parts).toEqual([{ kind: 'text', text }]);
  });

  it('keeps undo history attached to its session across remounts', async () => {
    const source = createComposerDraftSource();
    source.set('original');
    const view = () => <DraftBoundComposer draftSource={source} canSubmitDraft={canSubmitDraft} onSubmit={onSubmit} />;
    const mounted = render(view());
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveTextContent('original'));
    await act(async () => { editor().update(() => { $getRoot().clear().append($createParagraphNode().append($createTextNode('changed'))); }, { discrete: true, tag: 'history-push' }); });
    await waitFor(() => expect(source.getSnapshot()).toBe('changed'));
    mounted.unmount();
    render(view());
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveTextContent('changed'));
    await act(async () => { editor().dispatchCommand(UNDO_COMMAND, undefined); });
    await waitFor(() => expect(source.getSnapshot()).toBe('original'));
  });
});
