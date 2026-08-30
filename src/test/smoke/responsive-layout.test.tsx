import { GarminMappingsPage } from '@/pages/account/garmin-mappings/garmin-mappings-page';
import { LandingPage } from '@/pages/public/landing-page';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '../test-utils';

// Mock hooks for GarminMappingsPage
vi.mock('@/hooks/use-garmin-mapping', () => ({
  useGarminMappings: vi.fn().mockReturnValue({ data: [], isLoading: false }),
  useUpsertGarminMapping: vi.fn().mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDeleteGarminMapping: vi.fn().mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/hooks/use-training-data', () => ({
  useSportTypes: vi.fn().mockReturnValue({ data: [], isLoading: false }),
}));

describe('Smoke Test: Responsive Layout Pages', () => {
  it('renders GarminMappingsPage without crashing', async () => {
    render(<GarminMappingsPage />);
    await waitFor(() => {
      expect(screen.queryByText(/loading mappings/i)).toBeNull();
    });
    expect(screen.getByText(/garmin activity mappings/i)).toBeDefined();
  });

  it('renders GarminMappingsPage form fields', async () => {
    render(<GarminMappingsPage />);
    await waitFor(() => {
      expect(screen.queryByText(/loading mappings/i)).toBeNull();
    });
    // "garmin activity type" appears in both the subtitle and the form label
    expect(
      screen.getAllByText(/garmin activity type/i).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/garmin unit/i).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getAllByText(/mapped sport/i).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('renders GarminMappingsPage Add Mapping button disabled when no input', async () => {
    render(<GarminMappingsPage />);
    await waitFor(() => {
      expect(screen.queryByText(/loading mappings/i)).toBeNull();
    });
    const addButton = screen.getByText(/add mapping/i);
    expect(addButton).toBeDefined();
    // Closest button ancestor should be disabled with empty inputs
    const button = addButton.closest('button');
    expect(button?.disabled).toBe(true);
  });

  it('renders LandingPage without crashing', async () => {
    render(<LandingPage />);
    await waitFor(() => {
      // Hero heading must be visible
      expect(screen.getByText(/structure your training/i)).toBeDefined();
    });
  });

  it('renders LandingPage features section', async () => {
    render(<LandingPage />);
    await waitFor(() => {
      expect(
        screen.getByText(/plan every session with precision/i),
      ).toBeDefined();
    });
    expect(screen.getByText(/interactive calendar/i)).toBeDefined();
    expect(
      screen.getAllByText(/garmin csv import/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('renders LandingPage navigation header', async () => {
    render(<LandingPage />);
    expect(screen.getAllByText(/sign in/i).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/register for free/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('renders LandingPage footer copyright', async () => {
    render(<LandingPage />);
    expect(screen.getByText(/all rights reserved/i)).toBeDefined();
  });
});
