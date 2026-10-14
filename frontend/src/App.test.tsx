import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('Admin app shell', () => {
  it('shows the APK update administration title', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Quản lý cập nhật APK' })).toBeInTheDocument();
  });
});
