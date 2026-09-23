import { fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RightbarRegion, rightbarGeometry } from '../RightbarRegion';
it('reports resolved normal width and narrow-screen/fullscreen eligibility', () => {
  expect(rightbarGeometry(1200, 240, 520)).toEqual({ viewportWidth: 1200, canShow: true, width: 520 });
  expect(rightbarGeometry(800, 240, 520)).toEqual({ viewportWidth: 800, canShow: true, width: 400 });
  expect(rightbarGeometry(699, 0, 520)).toEqual({ viewportWidth: 699, canShow: false, width: 0 });
});
it('updates geometry on resize, preserves native column placement, and releases listeners', () => {
  const remove = vi.spyOn(window, 'removeEventListener');
  const seat = vi.fn((_owner, fallback) => fallback);
  const view = render(<div data-testid="row"><RightbarRegion leftWidth={200} width={520} render={seat}><aside>native</aside></RightbarRegion></div>);
  expect(view.getByText('native').parentElement).toBe(view.getByTestId('row'));
  const old = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
  fireEvent(window, new Event('resize'));
  expect(seat.mock.calls.at(-1)?.[0]).toEqual({ width: 0, viewportWidth: 600, canShow: false });
  view.unmount();
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: old });
  remove.mockRestore();
});
