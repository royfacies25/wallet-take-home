'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('wallet_txs', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      wallet_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'wallets', key: 'id' },
      },
      type: { type: Sequelize.STRING, allowNull: false },
      // Signed: credits positive, debits negative. SUM(amount) per wallet must equal wallets.balance.
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      balance_after: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      // One ledger entry per funding tx at most. Second guard against a double credit.
      funding_tx_id: {
        type: Sequelize.UUID,
        allowNull: true,
        unique: true,
        references: { model: 'funding_txs', key: 'id' },
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });
    await queryInterface.sequelize.query(`
      ALTER TABLE wallet_txs
        ADD CONSTRAINT wallet_txs_type_valid CHECK (type IN ('deposit', 'wager', 'withdrawal')),
        ADD CONSTRAINT wallet_txs_amount_sign CHECK ((type = 'deposit') = (amount > 0) AND amount <> 0),
        ADD CONSTRAINT wallet_txs_balance_after_non_negative CHECK (balance_after >= 0),
        ADD CONSTRAINT wallet_txs_funding_link CHECK ((type = 'wager') = (funding_tx_id IS NULL))
    `);
    await queryInterface.addIndex('wallet_txs', ['wallet_id', 'created_at']);
    await queryInterface.sequelize.query(`
      CREATE FUNCTION wallet_txs_append_only() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'wallet_txs is append-only';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER wallet_txs_no_update_delete
        BEFORE UPDATE OR DELETE ON wallet_txs
        FOR EACH ROW EXECUTE FUNCTION wallet_txs_append_only();
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('wallet_txs');
    await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS wallet_txs_append_only()');
  },
};
