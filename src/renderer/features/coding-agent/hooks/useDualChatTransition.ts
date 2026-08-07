import { useEffect, useRef, useState } from 'react';
import type { CodingAgentLayoutMode } from '../components/CodingAgentLayoutControls';

export const DUAL_CHAT_TRANSITION_DURATION_MS = 220;

export const useDualChatTransition = (
  mode: CodingAgentLayoutMode,
  prefersReducedMotion: boolean,
) => {
  const [isSecondaryMounted, setIsSecondaryMounted] = useState(
    mode === 'dual',
  );
  const [isSecondaryVisible, setIsSecondaryVisible] = useState(
    mode === 'dual',
  );
  const frameRef = useRef<number | undefined>(undefined);
  const closeTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (frameRef.current !== undefined) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    }
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }

    if (mode === 'dual') {
      if (!isSecondaryMounted) {
        setIsSecondaryMounted(true);
      } else if (prefersReducedMotion) {
        setIsSecondaryVisible(true);
      } else {
        frameRef.current = window.requestAnimationFrame(() => {
          setIsSecondaryVisible(true);
          frameRef.current = undefined;
        });
      }
    } else {
      setIsSecondaryVisible(false);
      if (isSecondaryMounted) {
        if (prefersReducedMotion) {
          setIsSecondaryMounted(false);
        } else {
          closeTimerRef.current = window.setTimeout(() => {
            setIsSecondaryMounted(false);
            closeTimerRef.current = undefined;
          }, DUAL_CHAT_TRANSITION_DURATION_MS);
        }
      }
    }

    return () => {
      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
      }
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, [isSecondaryMounted, mode, prefersReducedMotion]);

  return { isSecondaryMounted, isSecondaryVisible };
};
