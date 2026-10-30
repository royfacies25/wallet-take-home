import { DataTypes, Model, Sequelize } from 'sequelize';

export type FundingTxType = 'deposit' | 'withdrawal';
export type FundingTxStatus = 'Pending' | 'Completed' | 'Failed';

export class FundingTx extends Model {
  declare id: string;
  declare walletId: string;
  declare type: FundingTxType;
  declare status: FundingTxStatus;
  declare amount: string;
  declare turnoverMultiplier: number | null;
  declare pspRef: string | null;
  declare receivedAmount: string | null;
  declare reviewReason: string | null;
}

export function initFundingTx(sequelize: Sequelize): void {
  FundingTx.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      walletId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      turnoverMultiplier: { type: DataTypes.INTEGER, allowNull: true },
      pspRef: { type: DataTypes.STRING, allowNull: true, unique: true },
      receivedAmount: { type: DataTypes.DECIMAL(36, 18), allowNull: true },
      reviewReason: { type: DataTypes.STRING, allowNull: true },
    },
    { sequelize, tableName: 'funding_txs', underscored: true },
  );
}
