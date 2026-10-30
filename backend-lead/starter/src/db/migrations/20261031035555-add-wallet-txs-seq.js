'use strict';

module.exports = {
  async up(queryInterface) {
    // created_at can tie or come out of commit order; seq is taken at insert, under the wallet lock.
    await queryInterface.sequelize.query('ALTER TABLE wallet_txs ADD COLUMN seq BIGSERIAL NOT NULL');
    await queryInterface.addIndex('wallet_txs', ['wallet_id', 'seq'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('wallet_txs', 'seq');
  },
};
