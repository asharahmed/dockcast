import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import PrivacyPage, { PRIVACY_UPDATED } from './PrivacyPage.js';

describe('PrivacyPage', () => {
  it('states the date, the no-tracking summary, and how to delete an account or get in touch', () => {
    render(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeInTheDocument();
    expect(screen.getByText(`Last updated ${PRIVACY_UPDATED}`)).toBeInTheDocument();
    expect(screen.getByText(/no ads, no analytics, no tracking cookies/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'account page' })[0]).toHaveAttribute('href', '/account');
    const githubLinks = screen.getAllByRole('link', { name: 'GitHub' }).map((a) => a.getAttribute('href'));
    expect(githubLinks).toContain('https://github.com/asharahmed/dockcast/issues');
  });
});
