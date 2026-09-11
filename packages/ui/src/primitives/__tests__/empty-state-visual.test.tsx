import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyStateVisual, EmptyStateVisualProvider } from '../empty-state-visual';

describe('empty state visual extension', () => {
  it('keeps host defaults and actions without a plugin', () => {
    render(<><EmptyStateVisual scene="home"><span>Logo</span></EmptyStateVisual><button>Start</button></>);
    expect(screen.getByText('Logo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });
  it('replaces only the visual, forwards scene, and restores fallback without remounting the input', () => {
    const visual = <><EmptyStateVisual scene="home"><span>Logo</span></EmptyStateVisual><input aria-label="Draft" defaultValue="keep me" /></>;
    const { rerender } = render(<EmptyStateVisualProvider render={({ scene }) => <span>{scene} illustration</span>}>{visual}</EmptyStateVisualProvider>);
    const input = screen.getByLabelText('Draft');
    expect(screen.queryByText('Logo')).toBeNull();
    expect(screen.getByText('home illustration')).toBeInTheDocument();
    rerender(<EmptyStateVisualProvider render={({ defaultVisual }) => defaultVisual}>{visual}</EmptyStateVisualProvider>);
    expect(screen.getByText('Logo')).toBeInTheDocument();
    expect(screen.getByLabelText('Draft')).toBe(input);
    expect(input).toHaveValue('keep me');
  });
  it('allows a provider to opt out of a scene or intentionally render nothing', () => {
    render(<EmptyStateVisualProvider render={({ scene, defaultVisual }) => scene === 'workspace' ? defaultVisual : null}>
      <EmptyStateVisual scene="workspace">Workspace icon</EmptyStateVisual>
      <EmptyStateVisual scene="conversation">Conversation icon</EmptyStateVisual>
    </EmptyStateVisualProvider>);
    expect(screen.getByText('Workspace icon')).toBeInTheDocument();
    expect(screen.queryByText('Conversation icon')).toBeNull();
  });
});
