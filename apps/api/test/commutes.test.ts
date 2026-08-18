/** `docs/api.md` §6 — /commutes (auth required). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { commuteListResponseSchema, commuteCreateResponseSchema } from '@dockcast/shared';
import { setupTestApp, type TestContext } from './helpers/testApp.js';
import { insertCommute } from './seed.js';

const FETCH_HEADER = { 'X-Requested-With': 'fetch' };

async function registerAgent(
  app: TestContext['app'],
  email: string,
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent
    .post('/api/v1/auth/register')
    .set(FETCH_HEADER)
    .send({ email, password: 'a perfectly fine password' });
  return agent;
}

describe('commutes CRUD + outlook', () => {
  let ctx: TestContext;
  let agent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    ctx = await setupTestApp();
    agent = await registerAgent(ctx.app, 'commuter@example.com');
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('requires auth', async () => {
    const res = await request(ctx.app).get('/api/v1/commutes');
    expect(res.status).toBe(401);
  });

  it('requireFetchHeader: 403 on POST without X-Requested-With', async () => {
    const res = await agent.post('/api/v1/commutes').send({
      name: 'No header',
      origin_station_id: ctx.seeded.hub.id,
      dest_station_id: ctx.seeded.near1.id,
      depart_local_time: '09:15',
      days_of_week: [1],
    });
    expect(res.status).toBe(403);
  });

  it('POST /commutes: creates with a defaulted ride_minutes and default alert fields', async () => {
    const res = await agent
      .post('/api/v1/commutes')
      .set(FETCH_HEADER)
      .send({
        name: 'Home to work',
        origin_station_id: ctx.seeded.hub.id,
        dest_station_id: ctx.seeded.near1.id,
        depart_local_time: '09:15',
        days_of_week: [1],
      });
    expect(res.status).toBe(201);
    const body = commuteCreateResponseSchema.parse(res.body);
    expect(body.commute.name).toBe('Home to work');
    expect(body.commute.city.slug).toBe(ctx.seeded.citySlug);
    expect(body.commute.origin.id).toBe(ctx.seeded.hub.id);
    expect(body.commute.dest.id).toBe(ctx.seeded.near1.id);
    expect(body.commute.ride_minutes).toBe(5); // rideMinutesDefault(hub, near1), matches trip.test.ts
    expect(body.commute.alert_enabled).toBe(true);
    expect(body.commute.alert_lead_minutes).toBe(20);
    expect(body.commute.threshold).toBe(0.7);
  });

  it('POST /commutes: 400 when origin/dest are in different cities', async () => {
    const res = await agent
      .post('/api/v1/commutes')
      .set(FETCH_HEADER)
      .send({
        name: 'Cross city',
        origin_station_id: ctx.seeded.hub.id,
        dest_station_id: ctx.seeded.otherCityStation.id,
        depart_local_time: '09:15',
        days_of_week: [1],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST /commutes: 400 on an invalid depart_local_time / empty days_of_week', async () => {
    const badTime = await agent
      .post('/api/v1/commutes')
      .set(FETCH_HEADER)
      .send({
        name: 'Bad time',
        origin_station_id: ctx.seeded.hub.id,
        dest_station_id: ctx.seeded.near1.id,
        depart_local_time: '9:15',
        days_of_week: [1],
      });
    expect(badTime.status).toBe(400);

    const badDays = await agent
      .post('/api/v1/commutes')
      .set(FETCH_HEADER)
      .send({
        name: 'No days',
        origin_station_id: ctx.seeded.hub.id,
        dest_station_id: ctx.seeded.near1.id,
        depart_local_time: '09:15',
        days_of_week: [],
      });
    expect(badDays.status).toBe(400);
  });

  it('404s for an unknown station id', async () => {
    const res = await agent
      .post('/api/v1/commutes')
      .set(FETCH_HEADER)
      .send({
        name: 'Unknown station',
        origin_station_id: 999999999,
        dest_station_id: ctx.seeded.near1.id,
        depart_local_time: '09:15',
        days_of_week: [1],
      });
    expect(res.status).toBe(404);
  });

  it('GET /commutes: outlook fields are computed from the fixed clock and seeded forecasts', async () => {
    const owner = await registerAgent(ctx.app, 'outlook-owner@example.com');
    await owner
      .post('/api/v1/commutes')
      .set(FETCH_HEADER)
      .send({
        name: 'Outlook commute',
        origin_station_id: ctx.seeded.hub.id,
        dest_station_id: ctx.seeded.near1.id,
        depart_local_time: '09:15', // FIXED_NOW is Tue 2026-03-10 09:00 local -> next occurrence is today
        days_of_week: [1], // Tuesday
      });

    const res = await owner.get('/api/v1/commutes');
    expect(res.status).toBe(200);
    const body = commuteListResponseSchema.parse(res.body);
    expect(body.commutes).toHaveLength(1);
    const outlook = body.commutes[0]?.outlook;
    expect(outlook).toBeDefined();
    expect(outlook?.next_depart_at).toBe('2026-03-10T13:15:00.000Z'); // 09:15 EDT
    expect(outlook?.next_arrive_at).toBe('2026-03-10T13:20:00.000Z'); // + 5 min ride
    expect(outlook?.origin.kind).toBe('forecast');
    expect(outlook?.origin.p).toBe(0.95); // hub p_bike h15, lead exactly 15
    expect(outlook?.dest.kind).toBe('forecast');
    expect(outlook?.dest.p).toBeCloseTo(0.9333, 3); // near1 p_dock interpolated at lead 20
    expect(outlook?.verdict).toBe('good');
  });

  it('PATCH/DELETE: 404 for an unknown commute id', async () => {
    const randomId = '00000000-0000-0000-0000-000000000000';
    const patch = await agent
      .patch(`/api/v1/commutes/${randomId}`)
      .set(FETCH_HEADER)
      .send({ name: 'Whatever' });
    expect(patch.status).toBe(404);

    const del = await agent.delete(`/api/v1/commutes/${randomId}`).set(FETCH_HEADER);
    expect(del.status).toBe(404);
  });

  it('PATCH/DELETE: 403 when the commute belongs to another user', async () => {
    const owner = await registerAgent(ctx.app, 'owner-of-secret@example.com');
    const other = await registerAgent(ctx.app, 'intruder@example.com');

    const created = await owner
      .post('/api/v1/commutes')
      .set(FETCH_HEADER)
      .send({
        name: "Owner's commute",
        origin_station_id: ctx.seeded.hub.id,
        dest_station_id: ctx.seeded.near1.id,
        depart_local_time: '09:15',
        days_of_week: [1],
      });
    const commuteId = commuteCreateResponseSchema.parse(created.body).commute.id;

    const patch = await other
      .patch(`/api/v1/commutes/${commuteId}`)
      .set(FETCH_HEADER)
      .send({ name: 'Hijacked' });
    expect(patch.status).toBe(403);

    const del = await other.delete(`/api/v1/commutes/${commuteId}`).set(FETCH_HEADER);
    expect(del.status).toBe(403);
  });

  it('PATCH: partial update only touches the given fields; DELETE removes it', async () => {
    const owner = await registerAgent(ctx.app, 'patcher@example.com');
    const created = await owner
      .post('/api/v1/commutes')
      .set(FETCH_HEADER)
      .send({
        name: 'Original name',
        origin_station_id: ctx.seeded.hub.id,
        dest_station_id: ctx.seeded.near1.id,
        depart_local_time: '09:15',
        days_of_week: [1],
        threshold: 0.6,
      });
    const commuteId = commuteCreateResponseSchema.parse(created.body).commute.id;

    const patched = await owner
      .patch(`/api/v1/commutes/${commuteId}`)
      .set(FETCH_HEADER)
      .send({ name: 'Renamed' });
    expect(patched.status).toBe(200);
    const patchedBody = commuteCreateResponseSchema.parse(patched.body);
    expect(patchedBody.commute.name).toBe('Renamed');
    expect(patchedBody.commute.threshold).toBe(0.6); // untouched field survives the partial update

    const del = await owner.delete(`/api/v1/commutes/${commuteId}`).set(FETCH_HEADER);
    expect(del.status).toBe(204);

    const list = await owner.get('/api/v1/commutes');
    expect(commuteListResponseSchema.parse(list.body).commutes).toHaveLength(0);
  });

  it('POST /commutes: 400 once a user already has 20 commutes', async () => {
    const owner = await registerAgent(ctx.app, 'maxed-out@example.com');
    const ownerId = (
      await request(ctx.app)
        .post('/api/v1/auth/login')
        .set(FETCH_HEADER)
        .send({ email: 'maxed-out@example.com', password: 'a perfectly fine password' })
    ).body.user.id as string;

    for (let i = 0; i < 20; i++) {
      // eslint-disable-next-line no-await-in-loop
      await insertCommute(ctx.pool, {
        userId: ownerId,
        cityId: ctx.seeded.cityId,
        originStationPk: ctx.seeded.hub.id,
        destStationPk: ctx.seeded.near1.id,
        departLocalTime: '09:15',
        daysOfWeek: [1],
      });
    }

    const res = await owner
      .post('/api/v1/commutes')
      .set(FETCH_HEADER)
      .send({
        name: '21st commute',
        origin_station_id: ctx.seeded.hub.id,
        dest_station_id: ctx.seeded.near1.id,
        depart_local_time: '09:15',
        days_of_week: [1],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});
