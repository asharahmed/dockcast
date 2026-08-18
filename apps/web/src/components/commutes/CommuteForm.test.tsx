import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { CommuteForm } from './CommuteForm.js';
import { stationListResponseFixture, mapResponseFixture } from '../../mocks/fixtures.js';

function renderForm() {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <CommuteForm
      stations={stationListResponseFixture.stations}
      mapStations={mapResponseFixture.stations}
      mode="create"
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  );
  return { onSubmit, onCancel };
}

async function selectStation(
  user: ReturnType<typeof userEvent.setup>,
  labelText: string,
  query: string,
  optionName: string,
) {
  const combobox = screen.getByRole('combobox', { name: labelText });
  await user.type(combobox, query);
  const option = await screen.findByRole('option', { name: new RegExp(optionName) });
  await user.click(option);
}

describe('CommuteForm', () => {
  it('submit empty shows 4 validation messages', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: 'Save commute' }));

    expect(screen.getByText('Give it a name')).toBeInTheDocument();
    expect(screen.getAllByText('Choose a station')).toHaveLength(2);
    expect(screen.getByText('Pick at least one day')).toBeInTheDocument();
  });

  it('shows "Pick two different stations" for the same origin and dest', async () => {
    const user = userEvent.setup();
    renderForm();
    await selectStation(user, 'From', 'Union', 'Union Station');
    await selectStation(user, 'To', 'Union', 'Union Station');
    await user.click(screen.getByRole('button', { name: 'Save commute' }));
    expect(screen.getByText('Pick two different stations')).toBeInTheDocument();
  });

  it('valid submit calls the mutation with the exact CommuteCreateRequest body', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.type(screen.getByLabelText('Name'), 'Commute to work');
    await selectStation(user, 'From', 'Union', 'Union Station');
    await selectStation(user, 'To', 'Yonge', 'Yonge / Wellesley');
    await user.type(screen.getByLabelText('Leave at'), '08:15');
    await user.click(screen.getByRole('button', { name: 'Weekdays' }));
    await user.click(screen.getByRole('button', { name: 'Save commute' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const body = onSubmit.mock.calls[0]![0];
    expect(body.name).toBe('Commute to work');
    expect(body.origin_station_id).toBe(1);
    expect(body.dest_station_id).toBe(2);
    expect(body.depart_local_time).toBe('08:15');
    expect(body.days_of_week).toEqual([0, 1, 2, 3, 4]);
    expect(body.threshold).toBe(0.7);
  });
});
