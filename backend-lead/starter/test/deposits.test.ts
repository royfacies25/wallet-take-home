import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { FundingTx, Wallet } from '../src/db/models';
import { createMember } from './helpers';

const app = createApp();

beforeAll(async () => {
  await sequelize.authenticate();
});

beforeEach(async () => {
  await sequelize.truncate({ cascade: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('POST /deposits', () => {
  it('creates a pending deposit and moves no money', async () => {
    const { memberId, walletId } = await createMember(app, 'alice01');

    const res = await request(app).post('/deposits').send({ memberId, amount: '100.50', turnoverMultiplier: 2 });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('Pending');
    expect(res.body.pspRef).toMatch(/^psp_/);
    expect(res.body.amount).toBe('100.500000000000000000');

    const tx = await FundingTx.findByPk(res.body.id);
    expect(tx?.turnoverMultiplier).toBe(2);
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('0.000000000000000000');
  });

  it('defaults turnoverMultiplier to 1', async () => {
    const { memberId } = await createMember(app, 'alice01');
    const res = await request(app).post('/deposits').send({ memberId, amount: '10' });
    const tx = await FundingTx.findByPk(res.body.id);
    expect(tx?.turnoverMultiplier).toBe(1);
  });

  it.each([
    ['zero amount', { amount: '0' }],
    ['negative amount', { amount: '-5' }],
    ['number instead of string', { amount: 10 }],
    ['non-numeric string', { amount: 'abc' }],
    ['empty string', { amount: '' }],
    ['underscore separator', { amount: '1_000' }],
    ['too many decimals', { amount: '1.0000000000000000001' }],
    ['too many integer digits', { amount: '1000000000000000000' }],
    ['negative multiplier', { amount: '10', turnoverMultiplier: -1 }],
    ['fractional multiplier', { amount: '10', turnoverMultiplier: 1.5 }],
    ['requirement too large', { amount: '999999999999999999', turnoverMultiplier: 2 }],
  ])('rejects %s', async (_name, body) => {
    const { memberId } = await createMember(app, 'alice01');
    const res = await request(app).post('/deposits').send({ memberId, ...body });
    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(app).post('/deposits').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown member', async () => {
    const res = await request(app)
      .post('/deposits')
      .send({ memberId: '00000000-0000-4000-8000-000000000000', amount: '10' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('member_not_found');
  });
});
