import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapLegend } from './MapLegend.js';

describe('MapLegend', () => {
  const now = new Date('2026-08-17T12:02:00Z');
  const asOf = new Date('2026-08-17T12:00:00Z');

  it('titles the legend "now" at horizon index 0', () => {
    render(
      <MapLegend
        target="bikes"
        horizonIndex={0}
        now={now}
        asOf={asOf}
        stationCount={3}
        forecastingEnabled
        cityName="Bike Share Toronto"
      />,
    );
    expect(screen.getByText('Chance of a bike now')).toBeInTheDocument();
    expect(screen.getByText('Updated 2 minutes ago · 3 stations')).toBeInTheDocument();
  });

  it('titles the legend with the slider readout at a later horizon', () => {
    render(
      <MapLegend
        target="docks"
        horizonIndex={3}
        now={now}
        asOf={asOf}
        stationCount={5}
        forecastingEnabled
        cityName="Bike Share Toronto"
      />,
    );
    expect(screen.getByText('Chance of an empty dock in 45 min')).toBeInTheDocument();
  });

  it('shows the live-only banner and 2-swatch legend when forecasting is disabled', () => {
    render(
      <MapLegend
        target="bikes"
        horizonIndex={0}
        now={now}
        asOf={asOf}
        stationCount={2}
        forecastingEnabled={false}
        cityName="Example City"
      />,
    );
    expect(
      screen.getByText("Live data only — forecasts aren't available for Example City yet."),
    ).toBeInTheDocument();
    expect(screen.getByText('Live availability')).toBeInTheDocument();
  });
});
