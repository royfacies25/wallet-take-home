import { DataTypes, Model, Sequelize } from 'sequelize';

// Written with raw SQL in services/idempotency.ts (it needs ON CONFLICT ... RETURNING); the model is for reads and test cleanup.
export class IdempotencyKey extends Model {
  declare id: string;
  declare scope: string;
  declare key: string;
  declare requestHash: string;
  declare responseStatus: number | null;
  declare responseBody: Record<string, unknown> | null;
}

export function initIdempotencyKey(sequelize: Sequelize): void {
  IdempotencyKey.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      scope: { type: DataTypes.STRING, allowNull: false },
      key: { type: DataTypes.STRING, allowNull: false },
      requestHash: { type: DataTypes.STRING, allowNull: false },
      responseStatus: { type: DataTypes.INTEGER, allowNull: true },
      responseBody: { type: DataTypes.JSONB, allowNull: true },
    },
    { sequelize, tableName: 'idempotency_keys', underscored: true, updatedAt: false },
  );
}
