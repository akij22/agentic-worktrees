// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';

afterEach(() => cleanup());

describe('AppShell visual language', () => {
  it('renders the product mark plus a consistent vector navigation icon set', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<div>Dashboard content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', {
      name: 'Main navigation',
    });

    expect(navigation.querySelectorAll('svg')).toHaveLength(3);
    expect(navigation.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Agentic Worktrees' })).toBeTruthy();
  });
});
