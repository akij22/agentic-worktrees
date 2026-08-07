// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodingAgentLayoutMode } from '../components/CodingAgentLayoutControls';
import {
  DUAL_CHAT_TRANSITION_DURATION_MS,
  useDualChatTransition,
} from './useDualChatTransition';

describe('useDualChatTransition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (handle: number) =>
      window.clearTimeout(handle),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const renderTransition = (
    initialMode: CodingAgentLayoutMode = 'single',
    prefersReducedMotion = false,
  ) =>
    renderHook(
      ({ mode, reducedMotion }) =>
        useDualChatTransition(mode, reducedMotion),
      {
        initialProps: {
          mode: initialMode,
          reducedMotion: prefersReducedMotion,
        },
      },
    );

  it('mounts collapsed, then reveals the secondary panel on the next frame', () => {
    const { result, rerender } = renderTransition();

    rerender({ mode: 'dual', reducedMotion: false });
    expect(result.current).toEqual({
      isSecondaryMounted: true,
      isSecondaryVisible: false,
    });

    act(() => vi.advanceTimersByTime(0));
    expect(result.current.isSecondaryVisible).toBe(true);
  });

  it('keeps the panel mounted until the closing duration finishes', () => {
    const { result, rerender } = renderTransition('dual');
    act(() => vi.advanceTimersByTime(0));

    rerender({ mode: 'single', reducedMotion: false });
    expect(result.current).toEqual({
      isSecondaryMounted: true,
      isSecondaryVisible: false,
    });

    act(() => vi.advanceTimersByTime(DUAL_CHAT_TRANSITION_DURATION_MS - 1));
    expect(result.current.isSecondaryMounted).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.isSecondaryMounted).toBe(false);
  });

  it('cancels a pending unmount when dual mode reopens', () => {
    const { result, rerender } = renderTransition('dual');
    act(() => vi.advanceTimersByTime(0));
    rerender({ mode: 'single', reducedMotion: false });
    act(() => vi.advanceTimersByTime(100));

    rerender({ mode: 'dual', reducedMotion: false });
    act(() => vi.advanceTimersByTime(DUAL_CHAT_TRANSITION_DURATION_MS));

    expect(result.current).toEqual({
      isSecondaryMounted: true,
      isSecondaryVisible: true,
    });
  });

  it('switches immediately when reduced motion is requested', () => {
    const { result, rerender } = renderTransition('dual', true);
    expect(result.current.isSecondaryVisible).toBe(true);

    rerender({ mode: 'single', reducedMotion: true });
    expect(result.current).toEqual({
      isSecondaryMounted: false,
      isSecondaryVisible: false,
    });
  });
});
