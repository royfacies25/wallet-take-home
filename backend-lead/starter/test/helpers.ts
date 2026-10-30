import request from 'supertest';
import { Express } from 'express';

export async function createMember(app: Express, username: string): Promise<{ memberId: string; walletId: string }> {
  const res = await request(app).post('/members').send({ username });
  return { memberId: res.body.member.id, walletId: res.body.wallet.id };
}
