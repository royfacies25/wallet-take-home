import { DataTypes, Model, Sequelize } from 'sequelize';

export type WalletTxType = 'deposit' | 'wager' | 'withdrawal';

export class WalletTx extends Model {
  declare id: string;
  declare walletId: string;
  declare type: WalletTxType;
  declare amount: string;
  declare balanceAfter: string;
  declare fundingTxId: string | null;
  declare createdAt: Date;
}

export function initWalletTx(sequelize: Sequelize): void {
  WalletTx.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      walletId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      balanceAfter: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      fundingTxId: { type: DataTypes.UUID, allowNull: true, unique: true },
    },
    { sequelize, tableName: 'wallet_txs', underscored: true, updatedAt: false },
  );
}
