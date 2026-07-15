import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthBootstrap } from './AuthBootstrap';

describe('AuthBootstrap', () => {
  it('renders a neutral bootstrap view before authentication status resolves', () => {
    const markup = renderToStaticMarkup(<AuthBootstrap />);

    expect(markup).toContain('Checking GitHub connection…');
    expect(markup).not.toContain('Sign in with GitHub');
    expect(markup).not.toContain('GitHub connection</span>');
  });
});
