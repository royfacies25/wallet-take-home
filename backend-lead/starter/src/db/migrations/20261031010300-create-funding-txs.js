'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('funding_txs', {
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
      status: { type: Sequelize.STRING, allowNull: false },
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      turnover_multiplier: { type: Sequelize.INTEGER, allowNull: true },
      psp_ref: { type: Sequelize.STRING, allowNull: true, unique: true },
      received_amount: { type: Sequelize.DECIMAL(36, 18), allowNull: true },
      review_reason: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });
    await queryInterface.sequelize.query(`
      ALTER TABLE funding_txs
        ADD CONSTRAINT funding_txs_type_valid CHECK (type IN ('deposit', 'withdrawal')),
        ADD CONSTRAINT funding_txs_status_valid CHECK (status IN ('Pending', 'Completed', 'Failed')),
        ADD CONSTRAINT funding_txs_amount_positive CHECK (amount > 0),
        ADD CONSTRAINT funding_txs_multiplier_non_negative CHECK (turnover_multiplier >= 0),
        ADD CONSTRAINT funding_txs_deposit_fields CHECK (
          type <> 'deposit' OR (turnover_multiplier IS NOT NULL AND psp_ref IS NOT NULL)
        )
    `);
    await queryInterface.addIndex('funding_txs', ['wallet_id']);
    // Completed and Failed are terminal. The service checks this under a row lock; this catches a path that forgets.
    await queryInterface.sequelize.query(`
      CREATE FUNCTION funding_txs_terminal_status() RETURNS trigger AS $$
      BEGIN
        IF OLD.status <> 'Pending' AND NEW.status <> OLD.status THEN
          RAISE EXCEPTION 'funding_txs % cannot move from % to %', OLD.id, OLD.status, NEW.status;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER funding_txs_status_guard
        BEFORE UPDATE OF status ON funding_txs
        FOR EACH ROW EXECUTE FUNCTION funding_txs_terminal_status();
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('funding_txs');
    await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS funding_txs_terminal_status()');
  },
};
