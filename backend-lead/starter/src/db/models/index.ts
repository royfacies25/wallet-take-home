import { sequelize } from '../sequelize';
import { Member, initMember } from './member';
import { Wallet, initWallet } from './wallet';
import { FundingTx, initFundingTx } from './fundingTx';
import { WalletTx, initWalletTx } from './walletTx';
import { IdempotencyKey, initIdempotencyKey } from './idempotencyKey';

initMember(sequelize);
initWallet(sequelize);
initFundingTx(sequelize);
initWalletTx(sequelize);
initIdempotencyKey(sequelize);

Member.hasOne(Wallet, { foreignKey: 'memberId', as: 'wallet' });
Wallet.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });
Wallet.hasMany(FundingTx, { foreignKey: 'walletId', as: 'fundingTxs' });
Wallet.hasMany(WalletTx, { foreignKey: 'walletId', as: 'walletTxs' });

export { Member, Wallet, FundingTx, WalletTx, IdempotencyKey };
